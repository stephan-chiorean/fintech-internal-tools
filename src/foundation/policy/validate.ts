import type { Condition, Policy } from "./types";

function conditionParams(condition: Condition): string[] {
  if ("all" in condition) return condition.all.flatMap(conditionParams);
  if ("any" in condition) return condition.any.flatMap(conditionParams);
  return "param" in condition ? [condition.param] : [];
}

/** Throws if the policy references unknown permissions, roles or parameters. */
export function validatePolicy(policy: Policy): void {
  const errors: string[] = [];
  const permissionNames = new Set(Object.keys(policy.permissions));

  for (const [name, def] of Object.entries(policy.permissions)) {
    if (def.isApproval && def.isDecision) errors.push(`Permission ${name}: cannot be both an approval and a decision permission`);
    if (def.approvalPermission && !policy.permissions[def.approvalPermission]?.isApproval) {
      errors.push(`Permission ${name}: approvalPermission ${def.approvalPermission} must be an approval permission`);
    }
  }

  for (const [roleName, role] of Object.entries(policy.roles)) {
    for (const entry of role.permissions) {
      if (!permissionNames.has(entry.permission)) {
        errors.push(`Role ${roleName}: unknown permission ${entry.permission}`);
      }
      for (const param of entry.when ? conditionParams(entry.when) : []) {
        if (!role.params?.[param]) errors.push(`Role ${roleName}: condition uses undeclared param ${param}`);
      }
    }
  }

  const grantIds = new Set<string>();
  for (const grant of policy.grants) {
    if (grantIds.has(grant.id)) errors.push(`Grant ${grant.id}: duplicate id`);
    grantIds.add(grant.id);
    if ("allTeams" in grant.to && new Set(grant.to.allTeams).size < 2) {
      errors.push(`Grant ${grant.id}: allTeams needs at least two different teams`);
    }
    const role = policy.roles[grant.role];
    if (!role) {
      errors.push(`Grant ${grant.id}: unknown role ${grant.role}`);
      continue;
    }
    for (const [param, type] of Object.entries(role.params ?? {})) {
      if (typeof grant.params?.[param] !== type) {
        errors.push(`Grant ${grant.id}: role ${grant.role} needs ${type} param ${param}`);
      }
    }
    for (const param of Object.keys(grant.params ?? {})) {
      if (!role.params?.[param]) errors.push(`Grant ${grant.id}: role ${grant.role} has no param ${param}`);
    }
  }

  for (const [field, rule] of Object.entries(policy.fieldMasking)) {
    for (const reveal of rule.reveal) {
      if (!permissionNames.has(reveal.permission)) {
        errors.push(`Masking ${field}: unknown permission ${reveal.permission}`);
      }
    }
  }

  if (errors.length > 0) throw new Error(`Invalid policy config:\n- ${errors.join("\n- ")}`);
}
