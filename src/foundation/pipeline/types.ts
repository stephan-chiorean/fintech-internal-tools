import type { CustomerProfile, JsonValue, ProfileResult } from "@/foundation/data";
import type { Actor } from "@/foundation/permissions";
import type { AttrValue } from "@/foundation/policy/types";

export type { CustomerProfile, JsonValue };

/** What an action's `execute` can do. Writes only happen through these methods. */
export interface ActionContext {
  actor: Actor;
  actionId: string;
  tool: string;
  approvalId: string | null;
  /** Publishes a fact under this tool's namespace for other tools to read. */
  publishFact(customerId: string, key: string, value: JsonValue): number;
  /** Reads a customer profile masked for the acting user. */
  getCustomerProfile(customerId: string): ProfileResult;
}

export interface ActionDefinition<I = unknown, R extends JsonValue | void = JsonValue | void> {
  /** Globally unique, prefixed with the tool id, e.g. "test-harness.adjust". */
  id: string;
  tool: string;
  title: string;
  /** Permission from the policy config. The pipeline checks it; the tool never does. */
  permission: string;
  /** Validates untrusted input. Throw to reject it. */
  parse(raw: unknown): I;
  /** The customer the action affects, if any. Their data is used for scope and conditions. */
  customerId?(input: I): string | undefined;
  /** Extra attributes for policy conditions, e.g. { amountCents }. Cannot override customer data. */
  attributes?(input: I): Record<string, AttrValue>;
  /** One line shown in approval queues. */
  summarize(input: I): string;
  /** Runs inside the pipeline's transaction. Must be synchronous. */
  execute(ctx: ActionContext, input: I): R;
}

export type AnyActionDefinition = ActionDefinition<never, JsonValue | void>;

export interface ActionResult {
  outcome: "executed" | "approval-requested" | "denied" | "failed";
  auditId: number;
  reasons: string[];
  approvalId?: string;
  result?: JsonValue | void;
  error?: string;
}

export class InvalidInputError extends Error {}
