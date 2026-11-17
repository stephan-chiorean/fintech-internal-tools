import { listApprovals } from "@/foundation/approvals";
import { ApprovalButtons } from "@/shell/components/ApprovalButtons";
import { EffectBadge, Reasons } from "@/shell/components/Reasons";
import styles from "@/shell/shell.module.css";

export function ApprovalsPage({ viewerId }: { viewerId: string }) {
  const approvals = listApprovals(viewerId);
  return (
    <div className={styles.stack}>
      <h1>Approvals</h1>
      <p className={styles.muted}>
        Requests you made and requests you could decide. Every decision re-checks permissions and guardrails on the
        server.
      </p>
      {approvals.length === 0 && <p className={styles.muted}>Nothing here.</p>}
      {approvals.map((a) => (
        <section key={a.id} className={styles.card}>
          <h2 className={styles.cardTitle}>
            {a.summary} <EffectBadge effect={a.status} />
          </h2>
          <p className={styles.muted}>
            {a.actionId} · requested by {a.requestedBy} at {new Date(a.requestedAt).toLocaleString()}
            {a.decidedBy && ` · ${a.status} by ${a.decidedBy}`}
          </p>
          {a.status === "pending" && a.viewerDecision && (
            <>
              <Reasons reasons={a.viewerDecision.reasons} />
              {a.viewerDecision.effect === "allow" && <ApprovalButtons approvalId={a.id} />}
            </>
          )}
        </section>
      ))}
    </div>
  );
}
