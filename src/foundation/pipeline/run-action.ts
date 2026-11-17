import { createApprovalRequest } from "@/foundation/approvals/requests";
import { appendAudit } from "@/foundation/audit/log";
import { appendHistory, type ToolRecord } from "@/foundation/data/records";
import { getDb } from "@/foundation/db";
import { loadActor } from "@/foundation/permissions/grants";
import { checkPermission } from "@/foundation/permissions/resolver";
import { getActivePolicy } from "@/foundation/policy/active";
import { buildResource, errorMessage, executeWithAudit, targetRecord } from "./execute";
import { getAction } from "./registry";
import type { ActionResult } from "./types";

/**
 * The single server-side entry point for every write. Resolves the call to
 * execute, request-approval or deny, and always writes exactly one audit row
 * (plus history entries on the record it targets).
 */
export function runAction(actorId: string, actionId: string, rawInput: unknown): ActionResult {
  const db = getDb();
  const policy = getActivePolicy();
  const def = getAction(actionId);

  let input: unknown = rawInput;
  let customerId: string | null = null;
  let record: ToolRecord | null = null;
  const deny = (reasons: string[]): ActionResult => ({
    outcome: "denied",
    reasons,
    auditId: db.transaction(() => {
      const auditId = appendAudit(db, {
        actorId,
        actionId,
        tool: def?.tool ?? "unknown",
        outcome: "denied",
        customerId: customerId ?? record?.customerId,
        input,
        reasons,
      });
      if (record) appendHistory(db, { record, event: "denied", actorId, actionId, auditId, reasons });
      return auditId;
    })(),
  });

  if (!def) return deny([`Denied: unknown action "${actionId}".`]);
  try {
    input = def.parse(rawInput);
  } catch (error) {
    return deny([`Denied: invalid input: ${errorMessage(error)}`]);
  }
  record = targetRecord(db, def, input);
  const actor = loadActor(db, actorId);
  if (!actor) return deny([`Denied: unknown user "${actorId}".`]);
  const built = buildResource(db, def, input, {}, actorId);
  if (!built.ok) return deny([`Denied: ${built.reason}.`]);
  customerId = built.customerId;

  const decision = checkPermission(db, policy, { actorId, permission: def.permission, resource: built.resource });

  if (decision.effect === "deny") return deny(decision.reasons);

  if (decision.effect === "approval-required") {
    if (!policy.permissions[def.permission]?.approvalPermission) {
      return deny([`Denied: ${def.permission} needs approval but the policy names no approval permission.`, ...decision.reasons]);
    }
    const { approvalId, auditId } = db.transaction(() => {
      const id = createApprovalRequest(db, {
        actionId: def.id,
        tool: def.tool,
        input,
        customerId,
        summary: def.summarize(input),
        requestedBy: actorId,
      });
      const audit = appendAudit(db, {
        actorId,
        actionId: def.id,
        tool: def.tool,
        outcome: "approval-requested",
        customerId,
        approvalId: id,
        input,
        reasons: decision.reasons,
      });
      if (built.record) {
        appendHistory(db, {
          record: built.record,
          event: "approval-requested",
          actorId,
          actionId: def.id,
          approvalId: id,
          auditId: audit,
          reasons: decision.reasons,
        });
      }
      return { approvalId: id, auditId: audit };
    })();
    return { outcome: "approval-requested", approvalId, auditId, reasons: decision.reasons };
  }

  const execution = executeWithAudit(db, policy, {
    def,
    actor,
    input,
    built,
    approvalId: null,
    outcome: "executed",
    reasons: decision.reasons,
  });
  if (execution.status === "done") {
    return { outcome: "executed", auditId: execution.auditId, reasons: decision.reasons, result: execution.result };
  }
  return { outcome: execution.status, auditId: execution.auditId, reasons: decision.reasons, error: execution.error };
}
