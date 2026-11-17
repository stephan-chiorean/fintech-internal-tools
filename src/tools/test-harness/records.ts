import { defineRecordKind, KYC_STATUSES, type KycStatus } from "@/foundation/data";
import { defineAction, InvalidInputError } from "@/foundation/pipeline";

/**
 * Test-only record kind and actions that exercise tool records: trusted
 * attributes, history, approvals on records, claims, decisions and KYC updates.
 */
export const caseKind = defineRecordKind({
  tool: "test-harness",
  kind: "case",
  description: "A test case (test harness only)",
  readPermission: "test-harness.case.read",
  attributes: { env: "string", status: "string", amountCents: "number", claimedBy: "string" },
});

function object(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) throw new InvalidInputError("expected an object");
  return raw as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) {
    throw new InvalidInputError(`${name} must be a string of 1 to 100 characters`);
  }
  return value;
}

function cents(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100_000_000) {
    throw new InvalidInputError("amountCents must be a whole number of cents between 0 and 100,000,000");
  }
  return value;
}

export interface OpenCaseInput {
  key: string;
  productArea: string;
  env: "staging" | "prod";
  amountCents: number;
  customerId?: string;
}

defineAction({
  id: "test-harness.open-case",
  tool: "test-harness",
  title: "Open test case",
  permission: "test-harness.case.open",
  parse: (raw): OpenCaseInput => {
    const { key, productArea, env, amountCents, customerId } = object(raw);
    if (env !== "staging" && env !== "prod") throw new InvalidInputError("env must be staging or prod");
    return {
      key: text(key, "key"),
      productArea: text(productArea, "productArea"),
      env,
      amountCents: cents(amountCents),
      customerId: customerId === undefined ? undefined : text(customerId, "customerId"),
    };
  },
  newRecord: (input) => ({
    kind: "case",
    key: input.key,
    productArea: input.productArea,
    customerId: input.customerId,
    attrs: { env: input.env, status: "open", amountCents: input.amountCents },
    data: { note: "opened" },
  }),
  summarize: (input) => `Open test case ${input.key} (${input.productArea}, ${input.env})`,
  execute: (ctx) => ({ version: ctx.record!.version }),
});

export interface UpdateCaseInput {
  key: string;
  amountCents: number;
  note: string;
}

const parseUpdate = (raw: unknown): UpdateCaseInput => {
  const { key, amountCents, note } = object(raw);
  return { key: text(key, "key"), amountCents: cents(amountCents), note: typeof note === "string" ? note.slice(0, 200) : "" };
};

defineAction({
  id: "test-harness.update-case",
  tool: "test-harness",
  title: "Change test case",
  permission: "test-harness.case.update",
  parse: parseUpdate,
  record: (input) => ({ kind: "case", key: input.key }),
  summarize: (input) => `Change test case ${input.key} to ${input.amountCents} cents`,
  execute: (ctx, input) => ({
    version: ctx.updateRecord({ attrs: { amountCents: input.amountCents }, data: { note: input.note }, note: input.note }).version,
  }),
});

defineAction({
  id: "test-harness.claim-case",
  tool: "test-harness",
  title: "Claim test case",
  permission: "test-harness.case.claim",
  parse: (raw) => ({ key: text(object(raw).key, "key") }),
  record: (input) => ({ kind: "case", key: input.key }),
  summarize: (input) => `Claim test case ${input.key}`,
  execute: (ctx) => ({ version: ctx.updateRecord({ attrs: { status: "claimed", claimedBy: ctx.actor.id } }).version }),
});

defineAction({
  id: "test-harness.decide-case",
  tool: "test-harness",
  title: "Decide test case",
  permission: "test-harness.case.decide",
  parse: (raw) => ({ key: text(object(raw).key, "key") }),
  record: (input) => ({ kind: "case", key: input.key }),
  summarize: (input) => `Decide test case ${input.key}`,
  execute: (ctx) => ({ version: ctx.updateRecord({ attrs: { status: "decided" } }).version }),
});

defineAction({
  id: "test-harness.set-kyc",
  tool: "test-harness",
  title: "Set KYC status",
  permission: "test-harness.kyc.set",
  parse: (raw) => {
    const { customerId, status } = object(raw);
    if (!KYC_STATUSES.includes(status as KycStatus)) throw new InvalidInputError(`status must be one of ${KYC_STATUSES.join(", ")}`);
    return { customerId: text(customerId, "customerId"), status: status as KycStatus };
  },
  customerId: (input) => input.customerId,
  summarize: (input) => `Set KYC status of ${input.customerId} to ${input.status}`,
  execute: (ctx, input) => {
    ctx.setCustomerKycStatus(input.status);
    return { status: input.status };
  },
});
