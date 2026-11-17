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
  requestedBy: string;
  requestedAt: string;
  status: ApprovalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  /** Whether the viewer could approve it right now, and why. */
  viewerDecision: Decision | null;
}

/**
 * Approvals the viewer requested or could decide. The decision shown here is a
 * preview; `decideApproval` checks again at decision time.
 */
export function listApprovals(viewerId: string): ApprovalView[] {
  const db = getDb();
  const policy = getActivePolicy();
  const rows = db.prepare("SELECT * FROM approvals ORDER BY requested_at DESC").all() as ApprovalRow[];
  return rows.flatMap((row) => {
    const def = getAction(row.action_id);
    let viewerDecision: Decision | null = null;
    const approvalPermission = def && policy.permissions[def.permission]?.approvalPermission;
    if (def && approvalPermission && row.status === "pending") {
      try {
        const built = buildResource(db, def, def.parse(JSON.parse(row.input)), { requestedBy: row.requested_by });
        if (built.ok) {
          viewerDecision = checkPermission(db, policy, {
            actorId: viewerId,
            permission: approvalPermission,
            resource: built.resource,
          });
        }
      } catch {
        viewerDecision = null;
      }
    }
    const relevant =
      row.requested_by === viewerId || row.decided_by === viewerId || viewerDecision?.matchedGrants.length;
    if (!relevant) return [];
    return [
      {
        id: row.id,
        actionId: row.action_id,
        tool: row.tool,
        summary: row.summary,
        customerId: row.customer_id,
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
