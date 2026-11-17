import type { RecordRef } from "@/foundation/data/records";
import { getDb } from "@/foundation/db";
import { type Decision, checkPermission } from "@/foundation/permissions/resolver";
import { getActivePolicy } from "@/foundation/policy/active";
import { buildResource } from "@/foundation/pipeline/execute";
import { getAction } from "@/foundation/pipeline/registry";
import type { ApprovalRow, ApprovalStatus } from "./requests";

export { decideApproval } from "./decide";
export type { ApprovalDecisionResult } from "./decide";
export type { ApprovalStatus } from "./requests";

export interface ApprovalView {
  id: string;
  actionId: string;
  tool: string;
  summary: string;
  customerId: string | null;
  /** The tool record the request targets or creates, if any. */
  record: RecordRef | null;
  requestedBy: string;
  requestedAt: string;
  status: ApprovalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  /** Whether the viewer could approve it right now, and why. */
  viewerDecision: Decision | null;
}

export interface ListApprovalsOptions {
  /** Only requests for this tool's actions. */
  tool?: string;
  /** Only pending requests the viewer could approve right now. */
  canDecide?: boolean;
}

/**
 * Approvals the viewer requested or could decide. The decision shown here is a
 * preview; `decideApproval` checks again at decision time.
 */
export function listApprovals(viewerId: string, options: ListApprovalsOptions = {}): ApprovalView[] {
  const db = getDb();
  const policy = getActivePolicy();
  const rows = db
    .prepare("SELECT * FROM approvals WHERE (? IS NULL OR tool = ?) ORDER BY requested_at DESC")
    .all(options.tool ?? null, options.tool ?? null) as ApprovalRow[];
  return rows.flatMap((row) => {
    const def = getAction(row.action_id);
    let viewerDecision: Decision | null = null;
    let record: RecordRef | null = null;
    const approvalPermission = def && policy.permissions[def.permission]?.approvalPermission;
    try {
      const input = def?.parse(JSON.parse(row.input));
      const ref = def?.record?.(input) ?? def?.newRecord?.(input);
      record = ref ? { kind: ref.kind, key: ref.key } : null;
      if (def && approvalPermission && row.status === "pending") {
        const built = buildResource(db, def, input, { requestedBy: row.requested_by });
        if (built.ok) {
          viewerDecision = checkPermission(db, policy, {
            actorId: viewerId,
            permission: approvalPermission,
            resource: built.resource,
          });
        }
      }
    } catch {
      viewerDecision = null;
    }
    const relevant =
      row.requested_by === viewerId || row.decided_by === viewerId || viewerDecision?.matchedGrants.length;
    if (!relevant) return [];
    if (options.canDecide && (row.status !== "pending" || viewerDecision?.effect !== "allow")) return [];
    return [
      {
        id: row.id,
        actionId: row.action_id,
        tool: row.tool,
        summary: row.summary,
        customerId: row.customer_id,
        record,
        requestedBy: row.requested_by,
        requestedAt: row.requested_at,
        status: row.status,
        decidedBy: row.decided_by,
        decidedAt: row.decided_at,
        viewerDecision,
      },
    ];
  });
}
