import type { Decision } from "@/foundation/permissions";
import styles from "@/shell/shell.module.css";

export function EffectBadge({ effect }: { effect: Decision["effect"] | string }) {
  return <span className={`${styles.badge} ${styles[`badge-${effect}`] ?? ""}`}>{effect}</span>;
}

/** A decision's explanation: the headline plus the grants that did or did not apply. */
export function Reasons({ reasons, title = "Why" }: { reasons: string[]; title?: string }) {
  if (reasons.length === 0) return null;
  const [headline, ...details] = reasons;
  return (
    <div className={styles.reasons}>
      <p>{headline}</p>
      {details.length > 0 && (
        <details>
          <summary>{title}</summary>
          <ul>
            {details.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
