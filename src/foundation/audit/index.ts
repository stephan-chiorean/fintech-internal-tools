import { getDb } from "@/foundation/db";
import { check, type Decision } from "@/foundation/permissions";
import { type AuditEntry, readAudit } from "./log";

export type { AuditEntry, AuditOutcome } from "./log";

export type AuditResult = { ok: true; entries: AuditEntry[]; decision: Decision } | { ok: false; decision: Decision };

/** The audit log, newest first. Needs audit.read. */
export function listAuditEntries(actorId: string, options: { limit?: number; customerId?: string } = {}): AuditResult {
  const decision = check({ actorId, permission: "audit.read", resource: { attrs: {} } });
  if (decision.effect !== "allow") return { ok: false, decision };
  return { ok: true, entries: readAudit(getDb(), options), decision };
}
