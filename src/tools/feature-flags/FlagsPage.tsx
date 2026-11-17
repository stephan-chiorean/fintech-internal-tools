import { listApprovals } from "@/foundation/approvals";
import { getRecordHistory, listToolRecords, type ToolRecord } from "@/foundation/data";
import { EffectBadge, Reasons } from "@/shell/components/Reasons";
import styles from "@/shell/shell.module.css";
import { FlagButton } from "./FlagButton";
import { type FlagData, KIND, TOOL } from "./flags";

function FlagCard({ viewerId, flag, pending }: { viewerId: string; flag: ToolRecord; pending: number }) {
  const data = flag.data as unknown as FlagData;
  const enabled = flag.attrs.enabled === true;
  const history = getRecordHistory(viewerId, TOOL, { kind: KIND, key: flag.key });
  const entries = history.ok ? [...history.entries].reverse() : [];
  const versions = new Set<number>();

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>
        {data.name} · {String(flag.attrs.env)} <EffectBadge effect={enabled ? "on" : "off"} />
      </h2>
      <p className={styles.muted}>
        {data.description} · product area {flag.productArea} · version {flag.version}
        {pending > 0 && ` · ${pending} change(s) waiting for approval`}
      </p>
      <FlagButton
        key={`${viewerId}:${flag.id}:${flag.version}`}
        actionId="feature-flags.toggle"
        input={{ key: flag.key, enabled: !enabled }}
        label={enabled ? "Turn off" : "Turn on"}
      />
      <details>
        <summary>History</summary>
        <ul className={styles.list}>
          {entries.map((entry) => {
            const canRollBack =
              (entry.event === "created" || entry.event === "updated") &&
              entry.version < flag.version &&
              entry.attrs.enabled !== enabled &&
              !versions.has(entry.version);
            versions.add(entry.version);
            return (
              <li key={entry.id}>
                <EffectBadge effect={entry.event} /> v{entry.version} · {entry.attrs.enabled ? "on" : "off"} · by {entry.actorId}
                {entry.onBehalfOf && ` for ${entry.onBehalfOf}`} · {new Date(entry.at).toLocaleString()}
                <Reasons reasons={entry.reasons} />
                {canRollBack && (
                  <FlagButton
                    key={`${viewerId}:${entry.id}:${flag.version}`}
                    actionId="feature-flags.rollback"
                    input={{ key: flag.key, toVersion: entry.version }}
                    label={`Roll back to v${entry.version}`}
                    secondary
                  />
                )}
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}

export function FlagsPage({ viewerId }: { viewerId: string }) {
  const { records, withheld } = listToolRecords(viewerId, TOOL, { kind: KIND });
  const pending = listApprovals(viewerId, { tool: TOOL }).filter((a) => a.status === "pending" && a.record);
  return (
    <div className={styles.stack}>
      <h1>Feature flags</h1>
      <p className={styles.muted}>
        Staging changes apply at once. Prod changes and rollbacks need approval from someone else on call. Every change
        is recorded in the flag&apos;s history.
      </p>
      {records.length === 0 && <p className={styles.muted}>You can&apos;t see any feature flags.</p>}
      {records.map((flag) => (
        <FlagCard
          key={flag.id}
          viewerId={viewerId}
          flag={flag}
          pending={pending.filter((a) => a.record?.key === flag.key).length}
        />
      ))}
      {withheld.count > 0 && <p className={styles.muted}>{withheld.count} flag(s) in other product areas are hidden.</p>}
    </div>
  );
}
