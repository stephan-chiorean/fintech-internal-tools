import type { Database } from "better-sqlite3";
import { appendAudit, type AuditOutcome } from "@/foundation/audit/log";
import { customerResource, loadCustomer, readCustomerProfile } from "@/foundation/data/customers";
import { insertFact } from "@/foundation/data/facts";
import type { Actor, Resource } from "@/foundation/permissions";
import type { Policy } from "@/foundation/policy/types";
import type { ActionContext, ActionDefinition, JsonValue } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Def = ActionDefinition<any, JsonValue | void>;

/** Thrown inside the transaction to turn the call into a denial instead of a failure. */
export class PipelineDenial extends Error {}

export type BuiltResource = { ok: true; resource: Resource; customerId: string | null } | { ok: false; reason: string };

/** Builds the permission resource from the action input and current customer data. */
export function buildResource(db: Database, def: Def, input: unknown, extra: Resource["attrs"] = {}): BuiltResource {
  const actionAttrs = def.attributes?.(input) ?? {};
  const customerId = def.customerId?.(input);
  if (!customerId) return { ok: true, resource: { attrs: { ...actionAttrs, ...extra } }, customerId: null };
  const row = loadCustomer(db, customerId);
  if (!row) return { ok: false, reason: `customer "${customerId}" does not exist` };
  const base = customerResource(row);
  return { ok: true, resource: { ...base, attrs: { ...actionAttrs, ...base.attrs, ...extra } }, customerId };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function makeContext(db: Database, policy: Policy, def: Def, actor: Actor, approvalId: string | null): ActionContext {
  return {
    actor,
    actionId: def.id,
    tool: def.tool,
    approvalId,
    publishFact: (customerId, key, value) =>
      insertFact(db, { customerId, namespace: def.tool, key, value, publishedBy: actor.id, auditActionId: def.id }),
    getCustomerProfile: (customerId) => readCustomerProfile(db, policy, actor.id, customerId),
  };
}

export type ExecutionResult =
  | { status: "done"; auditId: number; result: JsonValue | void }
  | { status: "denied" | "failed"; auditId: number; error: string };

/**
 * Runs the action and its audit row in one transaction. If anything throws, the
 * transaction rolls back and a single denied/failed audit row is written instead.
 */
export function executeWithAudit(
  db: Database,
  policy: Policy,
  args: {
    def: Def;
    /** The user the action runs as (the requester, for approved requests). */
    actor: Actor;
    /** The user who made this call, if not `actor` (the approver). */
    auditActorId?: string;
    input: unknown;
    customerId: string | null;
    approvalId: string | null;
    outcome: AuditOutcome;
    reasons: string[];
    /** Runs first inside the transaction, e.g. to consume an approval. */
    before?: () => void;
  },
): ExecutionResult {
  const { def, actor, input, customerId, approvalId, outcome, reasons } = args;
  const audit = { actorId: args.auditActorId ?? actor.id, actionId: def.id, tool: def.tool, customerId, approvalId, input };
  try {
    return db.transaction((): ExecutionResult => {
      args.before?.();
      const result = def.execute(makeContext(db, policy, def, actor, approvalId), input);
      const auditId = appendAudit(db, { ...audit, outcome, reasons, result });
      return { status: "done", auditId, result };
    })();
  } catch (error) {
    const denied = error instanceof PipelineDenial;
    const message = errorMessage(error);
    const auditId = appendAudit(db, {
      ...audit,
      outcome: denied ? "denied" : "failed",
      reasons: [denied ? `Denied: ${message}` : `Failed: ${message}`, ...reasons],
    });
    return { status: denied ? "denied" : "failed", auditId, error: message };
  }
}
