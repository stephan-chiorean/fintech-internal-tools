import { defineRecordKind, getRecordHistory } from "@/foundation/data";
import { defineAction, defineSeed, InvalidInputError } from "@/foundation/pipeline";

export const TOOL = "feature-flags";
export const KIND = "flag";
export const ENVS = ["staging", "prod"] as const;
export type Env = (typeof ENVS)[number];

export interface FlagData {
  name: string;
  description: string;
}

defineRecordKind({
  tool: TOOL,
  kind: KIND,
  description: "A feature flag in one environment",
  readPermission: "feature-flags.read",
  attributes: { env: "string", enabled: "boolean" },
});

/** Each flag has one record per environment, keyed `<name>.<env>`. */
export const flagKey = (name: string, env: Env) => `${name}.${env}`;

function object(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) throw new InvalidInputError("expected an object");
  return raw as Record<string, unknown>;
}

function key(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9.-]{0,99}$/.test(value)) {
    throw new InvalidInputError("key must be a flag key like payments.instant-payouts.prod");
  }
  return value;
}

export interface CreateFlagInput {
  name: string;
  productArea: string;
  env: Env;
  enabled: boolean;
  description: string;
}

defineAction({
  id: "feature-flags.create",
  tool: TOOL,
  title: "Create feature flag",
  permission: "feature-flags.create",
  parse: (raw): CreateFlagInput => {
    const { name, productArea, env, enabled, description } = object(raw);
    if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]{0,60}$/.test(name)) throw new InvalidInputError("name must be lowercase letters, digits and dashes");
    if (typeof productArea !== "string" || !/^[a-z]{1,30}$/.test(productArea)) throw new InvalidInputError("productArea is required");
    if (!ENVS.includes(env as Env)) throw new InvalidInputError("env must be staging or prod");
    if (typeof enabled !== "boolean") throw new InvalidInputError("enabled must be true or false");
    if (typeof description !== "string" || description.length > 200) throw new InvalidInputError("description must be at most 200 characters");
    return { name, productArea, env: env as Env, enabled, description };
  },
  newRecord: (input) => ({
    kind: KIND,
    key: flagKey(`${input.productArea}.${input.name}`, input.env),
    productArea: input.productArea,
    attrs: { env: input.env, enabled: input.enabled },
    data: { name: `${input.productArea}.${input.name}`, description: input.description },
  }),
  summarize: (input) => `Create flag ${input.productArea}.${input.name} in ${input.env}`,
  execute: (ctx) => ({ key: ctx.record!.key, version: ctx.record!.version }),
});

export interface ToggleInput {
  key: string;
  enabled: boolean;
}

defineAction({
  id: "feature-flags.toggle",
  tool: TOOL,
  title: "Turn feature flag on or off",
  permission: "feature-flags.toggle",
  parse: (raw): ToggleInput => {
    const { key: k, enabled } = object(raw);
    if (typeof enabled !== "boolean") throw new InvalidInputError("enabled must be true or false");
    return { key: key(k), enabled };
  },
  record: (input) => ({ kind: KIND, key: input.key }),
  summarize: (input) => `Turn ${input.enabled ? "on" : "off"} ${input.key}`,
  execute: (ctx, input) => {
    if (ctx.record!.attrs.enabled === input.enabled) throw new Error(`${input.key} is already ${input.enabled ? "on" : "off"}`);
    const record = ctx.updateRecord({ attrs: { enabled: input.enabled }, note: `Turned ${input.enabled ? "on" : "off"}` });
    return { key: record.key, enabled: input.enabled, version: record.version };
  },
});

export interface RollbackInput {
  key: string;
  toVersion: number;
}

/** A rollback is a toggle to the value a flag had at an earlier version, so it follows the same rules. */
defineAction({
  id: "feature-flags.rollback",
  tool: TOOL,
  title: "Roll back feature flag",
  permission: "feature-flags.toggle",
  parse: (raw): RollbackInput => {
    const { key: k, toVersion } = object(raw);
    if (typeof toVersion !== "number" || !Number.isInteger(toVersion) || toVersion < 1) {
      throw new InvalidInputError("toVersion must be a version number");
    }
    return { key: key(k), toVersion };
  },
  record: (input) => ({ kind: KIND, key: input.key }),
  summarize: (input) => `Roll back ${input.key} to version ${input.toVersion}`,
  execute: (ctx, input) => {
    const history = getRecordHistory(ctx.actor.id, TOOL, { kind: KIND, key: input.key });
    if (!history.ok) throw new Error(history.decision.reasons[0]);
    const target = history.entries.findLast((e) => e.version === input.toVersion);
    if (!target || typeof target.attrs.enabled !== "boolean") throw new Error(`${input.key} has no version ${input.toVersion}`);
    if (input.toVersion >= ctx.record!.version) throw new Error(`version ${input.toVersion} is not an earlier version`);
    const enabled = target.attrs.enabled;
    const record = ctx.updateRecord({ attrs: { enabled }, note: `Rolled back to version ${input.toVersion}` });
    return { key: record.key, enabled, version: record.version };
  },
});

defineSeed({
  id: "feature-flags.demo-flags",
  tool: TOOL,
  description: "Demo feature flags",
  steps: [
    {
      actionId: "feature-flags.create",
      input: { name: "instant-payouts", productArea: "payments", env: "prod", enabled: false, description: "Pay out card settlements instantly" },
    },
    {
      actionId: "feature-flags.create",
      input: { name: "instant-payouts", productArea: "payments", env: "staging", enabled: true, description: "Pay out card settlements instantly" },
    },
    {
      actionId: "feature-flags.create",
      input: { name: "virtual-cards", productArea: "cards", env: "prod", enabled: true, description: "Let customers create virtual cards" },
    },
  ],
});
