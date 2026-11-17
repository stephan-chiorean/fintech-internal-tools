import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalRow {
  id: string;
  action_id: string;
  tool: string;
  input: string;
  customer_id: string | null;
  summary: string;
  requested_by: string;
  requested_at: string;
  status: ApprovalStatus;
  decided_by: string | null;
  decided_at: string | null;
}

/** Stores a pending request. Only the action pipeline calls this, inside its transaction. */
export function createApprovalRequest(
  db: Database,
  request: { actionId: string; tool: string; input: unknown; customerId: string | null; summary: string; requestedBy: string },
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO approvals (id, action_id, tool, input, customer_id, summary, requested_by, requested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    request.actionId,
    request.tool,
    JSON.stringify(request.input),
    request.customerId,
    request.summary,
    request.requestedBy,
    new Date().toISOString(),
  );
  return id;
}

export function loadApproval(db: Database, approvalId: string): ApprovalRow | null {
  return (db.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as ApprovalRow | undefined) ?? null;
}

/** Marks a pending approval decided. Returns false if it was already used. */
export function consumeApproval(db: Database, approvalId: string, status: Exclude<ApprovalStatus, "pending">, decidedBy: string): boolean {
  const result = db
    .prepare(
      "UPDATE approvals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
    )
    .run(status, decidedBy, new Date().toISOString(), approvalId);
  return result.changes === 1;
}
