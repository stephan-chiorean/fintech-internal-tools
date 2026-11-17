import type { Database } from "better-sqlite3";

export type AuditOutcome = "executed" | "approval-requested" | "approved" | "rejected" | "denied" | "failed";

export interface AuditInput {
  actorId: string;
  actionId: string;
  tool: string;
  outcome: AuditOutcome;
  customerId?: string | null;
  approvalId?: string | null;
  input: unknown;
  reasons: string[];
  result?: unknown;
}

export interface AuditEntry extends Omit<AuditInput, "input" | "result"> {
  id: number;
  at: string;
  input: unknown;
  result: unknown;
}

interface AuditRow {
  id: number;
  at: string;
  actor_id: string;
  action_id: string;
  tool: string;
  outcome: AuditOutcome;
  customer_id: string | null;
  approval_id: string | null;
  input: string;
  reasons: string;
  result: string | null;
}

function toJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null) ?? "null";
  } catch {
    return JSON.stringify(String(value));
  }
}

/** Appends one row. The table rejects updates and deletes with triggers. */
export function appendAudit(db: Database, entry: AuditInput): number {
  const result = db
    .prepare(
      `INSERT INTO audit (at, actor_id, action_id, tool, outcome, customer_id, approval_id, input, reasons, result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      new Date().toISOString(),
      entry.actorId,
      entry.actionId,
      entry.tool,
      entry.outcome,
      entry.customerId ?? null,
      entry.approvalId ?? null,
      toJson(entry.input),
      JSON.stringify(entry.reasons),
      entry.result === undefined ? null : toJson(entry.result),
    );
  return Number(result.lastInsertRowid);
}

export function readAudit(db: Database, options: { limit?: number; customerId?: string } = {}): AuditEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM audit WHERE (? IS NULL OR customer_id = ?) ORDER BY id DESC LIMIT ?`,
    )
    .all(options.customerId ?? null, options.customerId ?? null, options.limit ?? 100) as AuditRow[];
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    actorId: row.actor_id,
    actionId: row.action_id,
    tool: row.tool,
    outcome: row.outcome,
    customerId: row.customer_id,
    approvalId: row.approval_id,
    input: JSON.parse(row.input),
    reasons: JSON.parse(row.reasons),
    result: row.result === null ? null : JSON.parse(row.result),
  }));
}
