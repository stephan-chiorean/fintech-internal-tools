import { listAuditEntries } from "@/foundation/audit";
import { EffectBadge, Reasons } from "@/shell/components/Reasons";
import styles from "@/shell/shell.module.css";

export function AuditPage({ viewerId }: { viewerId: string }) {
  const result = listAuditEntries(viewerId, { limit: 200 });
  if (!result.ok) {
    return (
      <div className={styles.stack}>
        <h1>Audit log</h1>
        <Reasons reasons={result.decision.reasons} />
      </div>
    );
  }
  return (
    <div className={styles.stack}>
      <h1>Audit log</h1>
      <p className={styles.muted}>Append-only: the database rejects updates and deletes.</p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>#</th>
            <th>When</th>
            <th>Who</th>
            <th>Action</th>
            <th>Outcome</th>
            <th>Customer</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {result.entries.map((e) => (
            <tr key={e.id}>
              <td>{e.id}</td>
              <td>{new Date(e.at).toLocaleString()}</td>
              <td>{e.actorId}</td>
              <td>{e.actionId}</td>
              <td>
                <EffectBadge effect={e.outcome} />
              </td>
              <td>{e.customerId ?? "—"}</td>
              <td>
                <Reasons reasons={e.reasons} title="Details" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
