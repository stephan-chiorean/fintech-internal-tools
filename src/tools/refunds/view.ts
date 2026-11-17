import { type ApprovalView, listApprovals } from "@/foundation/approvals";
import { type RecordHistoryEntry, type ToolRecord, getRecordHistory, getToolRecord, listToolRecords } from "@/foundation/data";
import { REFUND_KIND, REFUNDS_TOOL, type RefundData, refundRef } from "./records";

export type RefundState = "requested" | "pending-approval" | "rejected" | "issued";

export interface RefundView {
  key: string;
  customerId: string;
  amountCents: number;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  state: RefundState;
  /** The pending approval to issue it, if any. */
  pendingApprovalId: string | null;
  history: RecordHistoryEntry[];
}

/** Where a refund is in its lifecycle, from its stored status and its request history. */
export function refundState(record: ToolRecord, history: RecordHistoryEntry[]): { state: RefundState; pendingApprovalId: string | null } {
  if (record.attrs.status === "issued") return { state: "issued", pendingApprovalId: null };
  const last = history.findLast((e) => e.event === "approval-requested" || e.event === "rejected" || e.event === "approved");
  if (last?.event === "approval-requested") return { state: "pending-approval", pendingApprovalId: last.approvalId };
  if (last?.event === "rejected") return { state: "rejected", pendingApprovalId: null };
  return { state: "requested", pendingApprovalId: null };
}

function toView(viewerId: string, record: ToolRecord): RefundView {
  const read = getRecordHistory(viewerId, REFUNDS_TOOL, refundRef(record.key));
  const history = read.ok ? read.entries : [];
  return {
    key: record.key,
    customerId: record.customerId ?? "",
    amountCents: Number(record.attrs.amountCents),
    reason: (record.data as unknown as RefundData | null)?.reason ?? "",
    requestedBy: record.openedBy,
    requestedAt: record.openedAt,
    ...refundState(record, history),
    history,
  };
}

/** A customer's refunds the viewer may read, newest first. */
export function customerRefunds(viewerId: string, customerId: string): { refunds: RefundView[]; withheld: number } {
  const { records, withheld } = listToolRecords(viewerId, REFUNDS_TOOL, { kind: REFUND_KIND });
  const refunds = records
    .filter((r) => r.customerId === customerId)
    .map((r) => toView(viewerId, r))
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  return { refunds, withheld: withheld.count };
}

/** Pending refund approvals the viewer could approve right now. */
export function refundsAwaitingMyApproval(viewerId: string): { approval: ApprovalView; refund: RefundView }[] {
  return listApprovals(viewerId, { tool: REFUNDS_TOOL, canDecide: true }).flatMap((approval) => {
    if (!approval.record) return [];
    const read = getToolRecord(viewerId, REFUNDS_TOOL, approval.record);
    return read.ok ? [{ approval, refund: toView(viewerId, read.record) }] : [];
  });
}

/** The viewer's own view of each pending refund approval (could they decide it, and why). */
export function refundApprovalsById(viewerId: string): Map<string, ApprovalView> {
  return new Map(listApprovals(viewerId, { tool: REFUNDS_TOOL }).map((a) => [a.id, a]));
}
