import { randomUUID } from "node:crypto";
import { defineRecordKind, type JsonValue } from "@/foundation/data";
import { defineAction, defineSeed, InvalidInputError, type ActionContext } from "@/foundation/pipeline";

export const TOOL = "kyc-review";
export const CASE = "case";

export const CASE_STATUSES = ["pending", "claimed", "escalated", "approved", "rejected"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export type Decision = "approve" | "reject";

/** What a case keeps beyond its attributes. Shown on the case screen and in history. */
export interface CaseData {
  note: string;
  escalationReason?: string;
  decision?: Decision;
  decisionReason?: string;
  decidedBy?: string;
}

/** The value published as the customer's kyc-review/status fact. */
export interface KycStatusFact {
  kycStatus: "verified" | "rejected";
  caseKey: string;
  decidedBy: string;
}

defineRecordKind({
  tool: TOOL,
  kind: CASE,
  description: "An identity check awaiting or after review",
  readPermission: "kyc-review.case.read",
  attributes: { status: "string", claimedBy: "string" },
});

function object(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) throw new InvalidInputError("expected an object");
  return raw as Record<string, unknown>;
}

function text(value: unknown, name: string, max = 100): string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidInputError(`${name} is required`);
  if (value.length > max) throw new InvalidInputError(`${name} must be at most ${max} characters`);
  return value.trim();
}

function decision(value: unknown): Decision {
  if (value !== "approve" && value !== "reject") throw new InvalidInputError("decision must be approve or reject");
  return value;
}

const keyInput = (raw: unknown) => ({ key: text(object(raw).key, "key") });
const caseRef = <I extends { key: string }>(input: I) => ({ kind: CASE, key: input.key });
const caseData = (ctx: ActionContext) => (ctx.record?.data ?? {}) as unknown as CaseData;

interface DecideInput {
  key: string;
  decision: Decision;
  reason: string;
}

const parseDecide = (raw: unknown): DecideInput => {
  const { key, decision: value, reason } = object(raw);
  return { key: text(key, "key"), decision: decision(value), reason: text(reason, "reason", 500) };
};

/** Records the decision, sets the customer's KYC status and publishes it for other tools. */
function decide(ctx: ActionContext, input: DecideInput) {
  const record = ctx.record!;
  const kycStatus = input.decision === "approve" ? "verified" : "rejected";
  const data: CaseData = { ...caseData(ctx), decision: input.decision, decisionReason: input.reason, decidedBy: ctx.actor.id };
  const updated = ctx.updateRecord({
    attrs: { status: input.decision === "approve" ? "approved" : "rejected" },
    data: data as unknown as JsonValue,
    note: `${input.decision === "approve" ? "Approved" : "Rejected"}: ${input.reason}`,
  });
  ctx.setCustomerKycStatus(kycStatus);
  const fact: KycStatusFact = { kycStatus, caseKey: record.key, decidedBy: ctx.actor.id };
  ctx.publishFact(record.customerId!, "status", fact as unknown as JsonValue);
  return { status: updated.attrs.status as string, kycStatus, version: updated.version };
}

interface OpenInput {
  key: string;
  customerId: string;
  note: string;
}

defineAction({
  id: "kyc-review.open-case",
  tool: TOOL,
  title: "Open KYC case",
  permission: "kyc-review.case.open",
  parse: (raw): OpenInput => {
    const { key, customerId, note } = object(raw);
    return {
      key: key === undefined ? `kyc-${randomUUID().slice(0, 8)}` : text(key, "key"),
      customerId: text(customerId, "customerId"),
      note: text(note, "note", 500),
    };
  },
  newRecord: (input) => ({
    kind: CASE,
    key: input.key,
    customerId: input.customerId,
    attrs: { status: "pending" },
    data: { note: input.note } satisfies CaseData as unknown as JsonValue,
  }),
  summarize: (input) => `Open KYC case ${input.key} for ${input.customerId}`,
  execute: (ctx) => ({ key: ctx.record!.key, version: ctx.record!.version }),
});

defineAction({
  id: "kyc-review.claim-case",
  tool: TOOL,
  title: "Claim KYC case",
  permission: "kyc-review.case.claim",
  parse: keyInput,
  record: caseRef,
  summarize: (input) => `Claim KYC case ${input.key}`,
  execute: (ctx) => {
    const updated = ctx.updateRecord({ attrs: { status: "claimed", claimedBy: ctx.actor.id }, note: `Claimed by ${ctx.actor.name}` });
    return { status: "claimed", version: updated.version };
  },
});

defineAction({
  id: "kyc-review.decide-case",
  tool: TOOL,
  title: "Approve or reject KYC case",
  permission: "kyc-review.case.decide",
  parse: parseDecide,
  record: caseRef,
  summarize: (input) => `${input.decision === "approve" ? "Approve" : "Reject"} KYC case ${input.key}`,
  execute: decide,
});

defineAction({
  id: "kyc-review.escalate-case",
  tool: TOOL,
  title: "Escalate KYC case",
  permission: "kyc-review.case.escalate",
  parse: (raw) => {
    const { key, reason } = object(raw);
    return { key: text(key, "key"), reason: text(reason, "reason", 500) };
  },
  record: caseRef,
  summarize: (input) => `Escalate KYC case ${input.key}`,
  execute: (ctx, input) => {
    const data: CaseData = { ...caseData(ctx), escalationReason: input.reason };
    const updated = ctx.updateRecord({
      attrs: { status: "escalated" },
      data: data as unknown as JsonValue,
      note: `Escalated: ${input.reason}`,
    });
    return { status: "escalated", version: updated.version };
  },
});

defineAction({
  id: "kyc-review.decide-escalated-case",
  tool: TOOL,
  title: "Decide escalated KYC case",
  permission: "kyc-review.case.decide-escalated",
  parse: parseDecide,
  record: caseRef,
  summarize: (input) => `${input.decision === "approve" ? "Approve" : "Reject"} escalated KYC case ${input.key}`,
  execute: decide,
});

// Opened by the system seed for now; the cust_1004 case moves to Jamie once seeds can act as a user.
export const SEED_CASES = [
  { key: "kyc-1001", customerId: "cust_1002", note: "New cards customer: identity check pending" },
  { key: "kyc-1002", customerId: "cust_1004", note: "Fraud flagged a mismatch between ID and address on file" },
  { key: "kyc-1003", customerId: "cust_1006", note: "Customer reapplied after a rejected identity check" },
];

defineSeed({
  id: "kyc-review.pending-cases",
  tool: TOOL,
  description: "Opens a few pending KYC cases",
  steps: SEED_CASES.map((input) => ({ actionId: "kyc-review.open-case", input })),
});
