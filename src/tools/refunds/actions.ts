import { defineAction, InvalidInputError } from "@/foundation/pipeline";
import { REFUND_KIND, REFUNDS_TOOL, type RefundData, formatCents } from "./records";

const KEY_PATTERN = /^rf_[a-z0-9_]{1,40}$/;

function object(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) throw new InvalidInputError("expected an object");
  return raw as Record<string, unknown>;
}

function refundKey(value: unknown): string {
  if (typeof value !== "string" || !KEY_PATTERN.test(value)) {
    throw new InvalidInputError("key must look like rf_ followed by 1 to 40 lowercase letters, digits or underscores");
  }
  return value;
}

export interface RequestRefundInput {
  key: string;
  customerId: string;
  amountCents: number;
  reason: string;
}

export function parseRequestRefund(raw: unknown): RequestRefundInput {
  const { key, customerId, amountCents, reason } = object(raw);
  if (typeof customerId !== "string" || customerId.length === 0 || customerId.length > 50) {
    throw new InvalidInputError("customerId is required");
  }
  if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 100_000_000) {
    throw new InvalidInputError("amountCents must be a whole number of cents between 1 and 100,000,000");
  }
  if (typeof reason !== "string" || reason.trim().length === 0 || reason.length > 200) {
    throw new InvalidInputError("reason must be 1 to 200 characters");
  }
  return {
    key: key === undefined ? `rf_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}` : refundKey(key),
    customerId,
    amountCents,
    reason: reason.trim(),
  };
}

/** Creates the refund record (status "requested"). Moves no money. */
export const requestRefund = defineAction({
  id: "refunds.request",
  tool: REFUNDS_TOOL,
  title: "Request refund",
  permission: "refunds.request",
  parse: parseRequestRefund,
  newRecord: (input) => ({
    kind: REFUND_KIND,
    key: input.key,
    customerId: input.customerId,
    attrs: { status: "requested", amountCents: input.amountCents },
    data: { reason: input.reason } satisfies RefundData,
  }),
  summarize: (input) => `Request a ${formatCents(input.amountCents)} refund for ${input.customerId}: ${input.reason}`,
  execute: (ctx, input) => {
    ctx.publishFact(input.customerId, "refund.requested", {
      refund: input.key,
      amountCents: input.amountCents,
      reason: input.reason,
    });
    return { key: input.key };
  },
});

/**
 * Issues a requested refund. The policy makes this approval-required for the
 * refund's opener only, so it always runs after a second person approves.
 */
export const issueRefund = defineAction({
  id: "refunds.issue",
  tool: REFUNDS_TOOL,
  title: "Issue refund",
  permission: "refunds.issue",
  parse: (raw) => ({ key: refundKey(object(raw).key) }),
  record: (input) => ({ kind: REFUND_KIND, key: input.key }),
  summarize: (input) => `Issue refund ${input.key}`,
  execute: (ctx, input) => {
    const record = ctx.record!;
    if (record.attrs.status !== "requested") throw new Error(`refund ${input.key} is ${record.attrs.status}, not requested`);
    const updated = ctx.updateRecord({ attrs: { status: "issued" }, note: "Refund issued." });
    ctx.publishFact(record.customerId!, "refund.issued", {
      refund: input.key,
      amountCents: record.attrs.amountCents,
      approvalId: ctx.approvalId,
    });
    return { key: input.key, status: "issued", version: updated.version };
  },
});
