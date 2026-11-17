import { appendAudit } from "@/foundation/audit/log";
import { getDb } from "@/foundation/db";
import { type Decision, checkPermission } from "@/foundation/permissions/resolver";
import { loadActor } from "@/foundation/permissions/grants";
import { getActivePolicy } from "@/foundation/policy/active";
import { PipelineDenial, buildResource, errorMessage, executeWithAudit } from "@/foundation/pipeline/execute";
import { getAction } from "@/foundation/pipeline/registry";
import type { JsonValue } from "@/foundation/pipeline/types";
import { consumeApproval, loadApproval } from "./requests";

export interface ApprovalDecisionResult {
  outcome: "approved" | "rejected" | "denied" | "failed";
  auditId: number;
  reasons: string[];
  result?: JsonValue | void;
  error?: string;
}

const ALREADY_USED = "this approval was already used";

/**
 * Approves or rejects a pending request. Re-runs the full permission check for
 * the approver against current data, applies guardrails, consumes the approval
 * exactly once, and writes exactly one audit row.
 */
export function decideApproval(
  approverId: string,
  approvalId: string,
  decision: "approve" | "reject",
): ApprovalDecisionResult {
  const db = getDb();
  const policy = getActivePolicy();
  const approval = loadApproval(db, approvalId);
  const def = approval ? getAction(approval.action_id) : undefined;

  let input: unknown = approval ? JSON.parse(approval.input) : null;
  const deny = (reasons: string[]): ApprovalDecisionResult => ({
    outcome: "denied",
    reasons,
    auditId: appendAudit(db, {
      actorId: approverId,
      actionId: approval?.action_id ?? "approvals.decide",
      tool: approval?.tool ?? "approvals",
      outcome: "denied",
      customerId: approval?.customer_id,
      approvalId,
      input,
      reasons,
    }),
  });

  if (!approval) return deny([`Denied: approval "${approvalId}" does not exist.`]);
  if (approval.status !== "pending") return deny([`Denied: ${ALREADY_USED} (${approval.status}).`]);
  if (!def) return deny([`Denied: action "${approval.action_id}" is no longer registered.`]);
  try {
    input = def.parse(input);
  } catch (error) {
    return deny([`Denied: stored input is no longer valid: ${errorMessage(error)}`]);
  }
  const approver = loadActor(db, approverId);
  if (!approver) return deny([`Denied: unknown user "${approverId}".`]);

  const approvalPermission = policy.permissions[def.permission]?.approvalPermission;
  if (!approvalPermission) return deny([`Denied: ${def.permission} has no approval permission in the policy.`]);

  const built = buildResource(db, def, input, { requestedBy: approval.requested_by });
  if (!built.ok) return deny([`Denied: ${built.reason}.`]);

  const approverDecision: Decision = checkPermission(db, policy, {
    actorId: approverId,
    permission: approvalPermission,
    resource: built.resource,
  });
  if (approverDecision.effect !== "allow") return deny(approverDecision.reasons);

  if (decision === "reject") {
    try {
      const auditId = db.transaction(() => {
        if (!consumeApproval(db, approvalId, "rejected", approverId)) throw new PipelineDenial(ALREADY_USED);
        return appendAudit(db, {
          actorId: approverId,
          actionId: def.id,
          tool: def.tool,
          outcome: "rejected",
          customerId: built.customerId,
          approvalId,
          input,
          reasons: [`Rejected by ${approver.name}.`, ...approverDecision.reasons],
        });
      })();
      return { outcome: "rejected", auditId, reasons: approverDecision.reasons };
    } catch (error) {
      return deny([`Denied: ${errorMessage(error)}.`]);
    }
  }

  // The requester must still be allowed to make the request at approval time.
  const requesterResource = buildResource(db, def, input);
  const requesterDecision = checkPermission(db, policy, {
    actorId: approval.requested_by,
    permission: def.permission,
    resource: requesterResource.ok ? requesterResource.resource : built.resource,
  });
  if (requesterDecision.effect === "deny") {
    return deny([
      `Denied: the requester no longer has ${def.permission}.`,
      ...requesterDecision.reasons,
    ]);
  }

  const requester = loadActor(db, approval.requested_by);
  if (!requester) return deny([`Denied: requester "${approval.requested_by}" no longer exists.`]);

  const reasons = [`Approved by ${approver.name}; executed on behalf of ${requester.name}.`, ...approverDecision.reasons];
  const execution = executeWithAudit(db, policy, {
    def,
    actor: requester,
    auditActorId: approverId,
    input,
    customerId: built.customerId,
    approvalId,
    outcome: "approved",
    reasons,
    before: () => {
      if (!consumeApproval(db, approvalId, "approved", approverId)) throw new PipelineDenial(ALREADY_USED);
    },
  });
  if (execution.status === "done") {
    return { outcome: "approved", auditId: execution.auditId, reasons, result: execution.result };
  }
  return { outcome: execution.status, auditId: execution.auditId, reasons, error: execution.error };
}
