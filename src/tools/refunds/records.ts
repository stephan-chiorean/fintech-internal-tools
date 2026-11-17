import { defineRecordKind } from "@/foundation/data";

export const REFUNDS_TOOL = "refunds";
export const REFUND_KIND = "refund";

/** A refund for a customer. `status` is "requested" until an approved `refunds.issue` sets "issued". */
export const refundKind = defineRecordKind({
  tool: REFUNDS_TOOL,
  kind: REFUND_KIND,
  description: "A customer refund and its request, approval and issue history",
  readPermission: "refunds.refund.read",
  attributes: { status: "string", amountCents: "number" },
});

export interface RefundData {
  reason: string;
}

export const refundRef = (key: string) => ({ kind: REFUND_KIND, key });

export const formatCents = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
