import type { CustomerSlotProps, DashboardSlotProps } from "@/shell/extensions";
import { ApprovalButtons } from "@/shell/components/ApprovalButtons";
import { HistoryTimeline } from "@/shell/components/HistoryTimeline";
import { RecordTable, type RecordColumn } from "@/shell/components/RecordTable";
import { EffectBadge, Reasons } from "@/shell/components/Reasons";
import styles from "@/shell/shell.module.css";
import { RequestRefundForm, SubmitForApprovalButton } from "./RefundForms";
import { formatCents } from "./records";
import { type RefundView, customerRefunds, refundApprovalsById, refundsAwaitingMyApproval } from "./view";

const baseColumns: RecordColumn<RefundView>[] = [
  { header: "Amount", cell: (r) => formatCents(r.amountCents) },
  { header: "Reason", cell: (r) => r.reason },
  { header: "Requested by", cell: (r) => r.requestedBy },
  { header: "Requested", cell: (r) => new Date(r.requestedAt).toLocaleString() },
];

const history = (r: RefundView) => (
  <details>
    <summary>History ({r.history.length})</summary>
    <HistoryTimeline entries={r.history} />
  </details>
);

export function RefundsDashboardCard({ viewerId }: DashboardSlotProps) {
  const waiting = refundsAwaitingMyApproval(viewerId);
  return (
    <div className={styles.stack}>
      <p>
        <strong>Refunds waiting for my approval:</strong> {waiting.length}
      </p>
      <RecordTable
        rows={waiting}
        rowKey={(w) => w.approval.id}
        empty="No refunds are waiting for your approval."
        columns={[
          { header: "Customer", cell: (w) => <a href={`/customers/${w.refund.customerId}`}>{w.refund.customerId}</a> },
          ...baseColumns.map((c) => ({ header: c.header, cell: (w: (typeof waiting)[number]) => c.cell(w.refund) })),
          { header: "Decide", cell: (w) => <ApprovalButtons approvalId={w.approval.id} rejectLabel="Deny" /> },
        ]}
      />
    </div>
  );
}

export function CustomerRefunds({ viewerId, customerId }: CustomerSlotProps) {
  const refunds = customerRefunds(viewerId, customerId);
  const approvals = refundApprovalsById(viewerId);
  const decide = (r: RefundView) => {
    if (r.state === "pending-approval" && r.pendingApprovalId) {
      const decision = approvals.get(r.pendingApprovalId)?.viewerDecision;
      if (decision?.effect === "allow") return <ApprovalButtons approvalId={r.pendingApprovalId} rejectLabel="Deny" />;
      if (decision) return <Reasons reasons={decision.reasons} />;
    }
    if ((r.state === "requested" || r.state === "rejected") && r.requestedBy === viewerId) {
      return <SubmitForApprovalButton refundKey={r.key} />;
    }
    return null;
  };
  return (
    <div className={styles.stack}>
      <p className={styles.muted}>
        Refunds move money, so each one needs a second person to approve it. Approvers can never approve their own
        refund, and contractors never approve.
      </p>
      <RecordTable
        rows={refunds}
        rowKey={(r) => r.key}
        empty="No refunds you can view for this customer."
        columns={[
          { header: "Status", cell: (r) => <EffectBadge effect={r.state} /> },
          ...baseColumns,
          { header: "", cell: decide },
        ]}
        expand={history}
      />
      <h4>Request a refund</h4>
      <RequestRefundForm customerId={customerId} />
    </div>
  );
}
