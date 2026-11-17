import { appendAudit } from "@/foundation/audit/log";
import { appendHistory, type ToolRecord } from "@/foundation/data/records";
import { getDb } from "@/foundation/db";
import { type Decision, checkPermission } from "@/foundation/permissions/resolver";
import { loadActor } from "@/foundation/permissions/grants";
import { getActivePolicy } from "@/foundation/policy/active";
import { PipelineDenial, buildResource, errorMessage, executeWithAudit, targetRecord } from "@/foundation/pipeline/execute";
import { getAction } from "@/foundation/pipeline/registry";
import { consumeApproval, loadApproval } from "./requests";

export interface ApprovalDecisionResult {
  outcome: "approved" | "rejected" | "denied" | "failed";
  auditId: number;
  reasons: string[];
  error?: string;
}

const ALREADY_USED = "this approval was already used";

/**
 * Approves or rejects a pending request. Re-runs the full permission check for
 * the approver against current data, applies guardrails, consumes the approval
 * exactly once, and writes exactly one audit row. Every attempt, including
 * refused ones, is also recorded in the history of the record the request targets.
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
  let record: ToolRecord | null = null;
  const deny = (reasons: string[]): ApprovalDecisionResult => ({
    outcome: "denied",
    reasons,
    auditId: db.transaction(() => {
      const auditId = appendAudit(db, {
        actorId: approverId,
        actionId: approval?.action_id ?? "approvals.decide",
        tool: approval?.tool ?? "approvals",
        outcome: "denied",
        customerId: approval?.customer_id,
        approvalId,
        input,
        reasons,
      });
      if (record) {
        appendHistory(db, {
          record,
          event: "decision-refused",
          actorId: approverId,
          actionId: approval!.action_id,
          approvalId,
          auditId,
          reasons: [`Refused ${decision} attempt.`, ...reasons],
        });
      }
      return auditId;
    })(),
  });

  if (!approval) return deny([`Denied: approval "${approvalId}" does not exist.`]);
  if (!def) return deny([`Denied: action "${approval.action_id}" is no longer registered.`]);
  try {
    input = def.parse(input);
  } catch (error) {
    return deny([`Denied: stored input is no longer valid: ${errorMessage(error)}`]);
  }
  record = targetRecord(db, def, input);
  if (approval.status !== "pending") return deny([`Denied: ${ALREADY_USED} (${approval.status}).`]);
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
        const reasons = [`Rejected by ${approver.name}.`, ...approverDecision.reasons];
        const id = appendAudit(db, {
          actorId: approverId,
          actionId: def.id,
          tool: def.tool,
          outcome: "rejected",
          customerId: built.customerId,
          approvalId,
          input,
          reasons,
        });
        if (built.record) {
          appendHistory(db, { record: built.record, event: "rejected", actorId: approverId, actionId: def.id, approvalId, auditId: id, reasons });
        }
        return id;
      })();
      return { outcome: "rejected", auditId, reasons: approverDecision.reasons };
    } catch (error) {
      return deny([`Denied: ${errorMessage(error)}.`]);
    }
  }

  // The requester must still be allowed to make the request at approval time.
  const requesterResource = buildResource(db, def, input, {}, approval.requested_by);
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
    built,
    approvalId,
    outcome: "approved",
    reasons,
    historyEvent: "approved",
    deniedEvent: "decision-refused",
    before: () => {
      if (!consumeApproval(db, approvalId, "approved", approverId)) throw new PipelineDenial(ALREADY_USED);
    },
  });
  // The action's result is shaped (and masked) for the requester, so it is never returned to the approver.
  if (execution.status === "done") return { outcome: "approved", auditId: execution.auditId, reasons };
  return { outcome: execution.status, auditId: execution.auditId, reasons, error: execution.error };
}
