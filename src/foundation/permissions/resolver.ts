import type { Database } from "better-sqlite3";
import type { AttrValue, Effect, Guardrail, Policy } from "@/foundation/policy/types";
import { evaluateCondition } from "./conditions";
import { type Actor, type EffectiveGrant, describeSource, loadActor, loadEffectiveGrants } from "./grants";

/** What a permission is checked against. Customer data goes in `attrs` for conditions. */
export interface Resource {
  customerId?: string;
  productArea?: string;
  attrs: Record<string, AttrValue>;
}

export interface MatchedGrant {
  grantId: string;
  role: string;
  effect: Effect;
  source: string;
}

export interface Decision {
  effect: Effect | "deny";
  actorId: string;
  permission: string;
  /** Plain-language explanation, most important line first. */
  reasons: string[];
  matchedGrants: MatchedGrant[];
  /** Set when a guardrail overrode the grants. */
  guardrail?: string;
}

export interface CheckInput {
  actorId: string;
  permission: string;
  resource: Resource;
}

function scopeMismatch(grant: EffectiveGrant, resource: Resource): string | null {
  if (!grant.scope) return null;
  if ("productArea" in grant.scope) {
    return resource.productArea === grant.scope.productArea
      ? null
      : `it is scoped to product area ${grant.scope.productArea}, but the resource is in ${resource.productArea ?? "no product area"}`;
  }
  return resource.customerId === grant.scope.customerId
    ? null
    : `it is scoped to customer ${grant.scope.customerId}, but the resource is ${resource.customerId ? `customer ${resource.customerId}` : "not a customer"}`;
}

function guardrailViolation(guardrail: Guardrail, actor: Actor, resource: Resource): string | null {
  const rule = guardrail.rule;
  if (rule.kind === "actor-is-requester") {
    const requestedBy = resource.attrs.requestedBy;
    if (typeof requestedBy !== "string") return "the request has no requester, so self-approval cannot be ruled out";
    return requestedBy === actor.id ? `${actor.name} made this request` : null;
  }
  if (rule.kind === "actor-matches-attribute") {
    const set = rule.attributes.filter((name) => typeof resource.attrs[name] === "string" && resource.attrs[name] !== "");
    if (set.length === 0) return `the resource names no ${rule.attributes.join(" or ")}, so it cannot be ruled out`;
    const match = set.find((name) => resource.attrs[name] === actor.id);
    return match ? `${actor.name} is this record's ${match}` : null;
  }
  return actor[rule.attribute] === rule.equals ? `${actor.name} is a contractor` : null;
}

function guardrailApplies(guardrail: Guardrail, permission: { isApproval?: boolean; isDecision?: boolean }): boolean {
  return guardrail.appliesTo === "approval-permissions" ? !!permission.isApproval : !!permission.isDecision;
}

function grantLabel(grant: EffectiveGrant): string {
  return `grant "${grant.id}" (role ${grant.role}, ${describeSource(grant.source)})`;
}

/**
 * Computes the actor's effective permission from user grants and inherited team
 * grants, applying grant scope, role conditions and guardrails (which override all grants).
 */
export function checkPermission(db: Database, policy: Policy, input: CheckInput): Decision {
  const { actorId, permission, resource } = input;
  const deny = (reasons: string[], extra: Partial<Decision> = {}): Decision => ({
    effect: "deny",
    actorId,
    permission,
    reasons,
    matchedGrants: [],
    ...extra,
  });

  const actor = loadActor(db, actorId);
  if (!actor) return deny([`Denied: unknown user "${actorId}".`]);
  const permissionDef = policy.permissions[permission];
  if (!permissionDef) return deny([`Denied: permission "${permission}" is not defined in the policy config.`]);

  const matched: MatchedGrant[] = [];
  const notes: string[] = [];
  const failedLimits: string[] = [];
  for (const grant of loadEffectiveGrants(db, actorId)) {
    const entries = policy.roles[grant.role]?.permissions.filter((p) => p.permission === permission) ?? [];
    if (entries.length === 0) continue;
    const mismatch = scopeMismatch(grant, resource);
    if (mismatch) {
      notes.push(`Not applied: ${grantLabel(grant)} would give ${permission}, but ${mismatch}.`);
      continue;
    }
    for (const entry of entries) {
      const effect = entry.effect ?? "allow";
      const condition = entry.when ? evaluateCondition(entry.when, resource.attrs, grant.params, actorId) : null;
      if (condition && !condition.passed) {
        notes.push(`Not applied: ${grantLabel(grant)} gives ${permission} (${effect}) only when ${condition.explanation}.`);
        for (const failure of condition.failures) failedLimits.push(`${failure} (grant "${grant.id}")`);
        continue;
      }
      matched.push({ grantId: grant.id, role: grant.role, effect, source: describeSource(grant.source) });
      notes.push(
        `Matched: ${grantLabel(grant)} gives ${permission} (${effect})${condition ? ` because ${condition.explanation}` : ""}.`,
      );
    }
  }

  for (const guardrail of policy.guardrails) {
    if (!guardrailApplies(guardrail, permissionDef)) continue;
    const violation = guardrailViolation(guardrail, actor, resource);
    if (violation) {
      return deny(
        [
          `Denied by guardrail "${guardrail.id}": ${guardrail.description} (${violation}). Guardrails override all grants.`,
          ...notes,
        ],
        { guardrail: guardrail.id, matchedGrants: matched },
      );
    }
  }

  const effect: Decision["effect"] = matched.some((m) => m.effect === "allow")
    ? "allow"
    : matched.length > 0
      ? "approval-required"
      : "deny";
  const headline =
    effect === "allow"
      ? `Allowed: ${actor.name} has ${permission}.`
      : effect === "approval-required"
        ? `Approval required: ${actor.name} can request ${permission}, but it needs approval${permissionDef.approvalPermission ? ` by someone with ${permissionDef.approvalPermission}` : ""}.`
        : `Denied: no grant gives ${actor.name} ${permission} here.${
            failedLimits.length > 0 ? ` Failed limit: ${[...new Set(failedLimits)].join("; ")}.` : ""
          }`;
  return { effect, actorId, permission, reasons: [headline, ...notes], matchedGrants: matched };
}
