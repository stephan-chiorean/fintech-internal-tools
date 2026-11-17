import type { Database } from "better-sqlite3";
import type { Policy } from "@/foundation/policy/types";
import { type Decision, checkPermission } from "@/foundation/permissions/resolver";
import { customerResource, loadCustomer } from "./customers";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface CustomerFact {
  id: number;
  customerId: string;
  /** The tool that published the fact. */
  namespace: string;
  key: string;
  value: JsonValue;
  publishedBy: string;
  publishedAt: string;
}

export interface FactsResult {
  ok: boolean;
  facts: CustomerFact[];
  /** Namespaces with facts the actor may not read, and why. */
  withheld: { namespace: string; count: number; decision: Decision }[];
  decision: Decision;
}

interface FactRow {
  id: number;
  customer_id: string;
  namespace: string;
  key: string;
  value: string;
  published_by: string;
  published_at: string;
}

/** Inserts a fact. Only the action pipeline calls this, inside its transaction. */
export function insertFact(
  db: Database,
  fact: { customerId: string; namespace: string; key: string; value: JsonValue; publishedBy: string; auditActionId: string },
): number {
  const result = db
    .prepare(
      `INSERT INTO customer_facts (customer_id, namespace, key, value, published_by, published_at, audit_action_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fact.customerId,
      fact.namespace,
      fact.key,
      JSON.stringify(fact.value),
      fact.publishedBy,
      new Date().toISOString(),
      fact.auditActionId,
    );
  return Number(result.lastInsertRowid);
}

/**
 * Reads facts any tool published about a customer. Needs customer.read on the
 * customer and facts.read for each publishing tool's namespace.
 */
export function readCustomerFacts(
  db: Database,
  policy: Policy,
  actorId: string,
  customerId: string,
  options: { namespace?: string } = {},
): FactsResult {
  const row = loadCustomer(db, customerId);
  const customerDecision: Decision = row
    ? checkPermission(db, policy, { actorId, permission: "customer.read", resource: customerResource(row) })
    : {
        effect: "deny",
        actorId,
        permission: "customer.read",
        reasons: [`Denied: customer "${customerId}" does not exist.`],
        matchedGrants: [],
      };
  if (!row || customerDecision.effect !== "allow") {
    return { ok: false, facts: [], withheld: [], decision: customerDecision };
  }

  const rows = db
    .prepare(
      `SELECT * FROM customer_facts WHERE customer_id = ? AND (? IS NULL OR namespace = ?) ORDER BY id DESC`,
    )
    .all(customerId, options.namespace ?? null, options.namespace ?? null) as FactRow[];

  const decisions = new Map<string, Decision>();
  for (const namespace of new Set(rows.map((r) => r.namespace))) {
    decisions.set(
      namespace,
      checkPermission(db, policy, {
        actorId,
        permission: "facts.read",
        resource: customerResource(row, { namespace }),
      }),
    );
  }

  const facts: CustomerFact[] = [];
  const withheld = new Map<string, { namespace: string; count: number; decision: Decision }>();
  for (const fact of rows) {
    const decision = decisions.get(fact.namespace)!;
    if (decision.effect === "allow") {
      facts.push({
        id: fact.id,
        customerId: fact.customer_id,
        namespace: fact.namespace,
        key: fact.key,
        value: JSON.parse(fact.value),
        publishedBy: fact.published_by,
        publishedAt: fact.published_at,
      });
    } else {
      const entry = withheld.get(fact.namespace) ?? { namespace: fact.namespace, count: 0, decision };
      entry.count += 1;
      withheld.set(fact.namespace, entry);
    }
  }
  return { ok: true, facts, withheld: [...withheld.values()], decision: customerDecision };
}
