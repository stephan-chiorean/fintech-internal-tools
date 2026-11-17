export type MaskLevel = "full" | "last4" | "hidden";

/** Customer fields that are masked unless a permission reveals them. */
export type MaskedField = "ssn" | "bankAccount" | "dob" | "address";

/** What a matching role permission lets the actor do. */
export type Effect = "allow" | "approval-required";

export type AttrValue = string | number | boolean | null;

export type Comparison = "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in";

/**
 * A condition on the resource's data. Compare an attribute with a fixed `value`
 * or with a role parameter (`param`), e.g. "amountCents <= maxAmountCents".
 */
export type Condition =
  | { attr: string; op: Comparison; value: AttrValue | AttrValue[] }
  | { attr: string; op: Exclude<Comparison, "in">; param: string }
  /** Compares an attribute with the acting user's id, e.g. "claimedBy = actor" or "openedBy ≠ actor". */
  | { attr: string; op: "eq" | "neq"; actor: "id" }
  | { all: Condition[] }
  | { any: Condition[] };

export interface PermissionDefinition<P extends string> {
  description: string;
  /** Permission an approver needs when this permission resolves to approval-required. */
  approvalPermission?: NoInfer<P>;
  /** Marks a permission used to approve requests. Guardrails apply to these. */
  isApproval?: boolean;
  /** Marks a permission that decides a record (e.g. a KYC case). Decision guardrails apply to these. */
  isDecision?: boolean;
}

export interface RolePermission<P extends string> {
  permission: NoInfer<P>;
  /** Defaults to "allow". */
  effect?: Effect;
  when?: Condition;
}

export type ParamType = "number" | "string";

export interface RoleDefinition<P extends string> {
  description: string;
  /** Parameters each grant of this role must supply, e.g. an approval limit. */
  params?: Record<string, ParamType>;
  permissions: RolePermission<P>[];
}

/** `allTeams`: the user must belong to every listed team (directly or through a child team). */
export type GrantSubject = { user: string } | { team: string } | { allTeams: string[] };

export type GrantScope = { productArea: string } | { customerId: string };

export interface GrantDefinition<R extends string> {
  id: string;
  to: GrantSubject;
  role: NoInfer<R>;
  params?: Record<string, number | string>;
  /** Limits the grant to one product area or one customer. Unscoped grants apply everywhere. */
  scope?: GrantScope;
  description: string;
}

export interface FieldMaskingRule<P extends string> {
  /** Level shown when no reveal permission is allowed. */
  default: MaskLevel;
  /** Checked in order; the first allowed permission sets the level. */
  reveal: { level: Exclude<MaskLevel, "hidden">; permission: NoInfer<P> }[];
}

export type GuardrailRule =
  | { kind: "actor-is-requester" }
  | { kind: "actor-attribute"; attribute: "isContractor"; equals: boolean }
  /** Denies when the actor's id equals any of these resource attributes, or when none is set. */
  | { kind: "actor-matches-attribute"; attributes: string[] };

/** Guardrails deny regardless of any grant. */
export interface Guardrail {
  id: string;
  description: string;
  appliesTo: "approval-permissions" | "decision-permissions";
  rule: GuardrailRule;
}

export interface PolicyConfig<P extends string = string, R extends string = string> {
  permissions: Record<P, PermissionDefinition<P>>;
  roles: Record<R, RoleDefinition<P>>;
  grants: GrantDefinition<R>[];
  fieldMasking: Record<MaskedField, FieldMaskingRule<P>>;
  guardrails: Guardrail[];
}

export type Policy = PolicyConfig<string, string>;

export function definePolicy<P extends string, R extends string>(
  config: PolicyConfig<P, R>,
): PolicyConfig<P, R> {
  return config;
}
