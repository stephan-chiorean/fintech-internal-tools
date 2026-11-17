import type { RecordHistoryEntry } from "@/foundation/data";
import { getActor } from "@/foundation/permissions";
import { EffectBadge, Reasons } from "@/shell/components/Reasons";
import styles from "@/shell/shell.module.css";

const EVENT_LABELS: Record<RecordHistoryEntry["event"], string> = {
  created: "Created",
  updated: "Updated",
  "approval-requested": "Approval requested",
  approved: "Approved",
  rejected: "Rejected",
  "decision-refused": "Decision refused",
  denied: "Call denied",
  failed: "Call failed",
};

const BADGES: Partial<Record<RecordHistoryEntry["event"], string>> = {
  "approval-requested": "pending",
  "decision-refused": "denied",
  created: "executed",
  updated: "executed",
};

const nameOf = (id: string) => getActor(id)?.name ?? id;

/** A record's history, oldest first: every change, request, decision and refusal, each linked to its audit row. */
export function HistoryTimeline({ entries }: { entries: RecordHistoryEntry[] }) {
  if (entries.length === 0) return <p className={styles.muted}>No history.</p>;
  return (
    <ol className={styles.timeline}>
      {entries.map((entry) => (
        <li key={entry.id} data-event={entry.event}>
          <div className={styles.row}>
            <EffectBadge effect={BADGES[entry.event] ?? entry.event} />
            <strong>{EVENT_LABELS[entry.event]}</strong>
            <span>
              by {nameOf(entry.actorId)}
              {entry.onBehalfOf && ` on behalf of ${nameOf(entry.onBehalfOf)}`}
            </span>
            <span className={styles.muted}>
              {new Date(entry.at).toLocaleString()} · audit #{entry.auditId}
            </span>
          </div>
          <Reasons reasons={entry.reasons} title="Details" />
        </li>
      ))}
    </ol>
  );
}
