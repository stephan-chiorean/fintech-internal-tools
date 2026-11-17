import type { CustomerProfile, JsonValue, KycStatus, ProfileResult, RecordRef, ToolRecord } from "@/foundation/data";
import type { Actor } from "@/foundation/permissions";
import type { AttrValue } from "@/foundation/policy/types";

export type { CustomerProfile, JsonValue, RecordRef, ToolRecord };

/** A record an action creates. The pipeline checks these values, then stores exactly them. */
export interface NewRecord extends RecordRef {
  /** Product area for grant scope. A customer's record always takes its customer's product area. */
  productArea?: string;
  customerId?: string;
  /** Values for the kind's declared attributes. */
  attrs?: Record<string, AttrValue>;
  data?: JsonValue;
}

/** What an action's `execute` can do. Writes only happen through these methods. */
export interface ActionContext {
  actor: Actor;
  actionId: string;
  tool: string;
  approvalId: string | null;
  /** The record the action targets (`record` or `newRecord`), as stored right now. */
  record: ToolRecord | null;
  /**
   * Changes the target record: merges declared attributes and replaces `data` if given.
   * Appends an `updated` history entry. Reserved attributes (opener, product area,
   * customer) can't be changed.
   */
  updateRecord(change: { attrs?: Record<string, AttrValue>; data?: JsonValue; note?: string }): ToolRecord;
  /** Publishes a fact under this tool's namespace for other tools to read. */
  publishFact(customerId: string, key: string, value: JsonValue): number;
  /** Reads a customer profile masked for the acting user. */
  getCustomerProfile(customerId: string): ProfileResult;
  /**
   * Sets the KYC status of the action's customer. The pipeline also requires
   * customer.kycStatus.update for the acting user on the action's resource.
   */
  setCustomerKycStatus(status: KycStatus): void;
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
  /**
   * An existing record of this tool the action affects. Its stored product area,
   * attributes, opener and customer are used for scope and conditions.
   */
  record?(input: I): RecordRef;
  /** A record the action creates. The pipeline creates it before `execute` runs. */
  newRecord?(input: I): NewRecord;
  /**
   * Extra attributes for policy conditions, e.g. { amountCents }. Cannot override
   * customer or record data, the kind's declared attributes or reserved attributes.
   */
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
