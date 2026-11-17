"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/foundation/pipeline";
import { submitToolAction } from "@/shell/actions";
import styles from "@/shell/shell.module.css";

export function HarnessForm({ customerId }: { customerId: string }) {
  const [result, formAction, pending] = useActionState(async (_prev: ActionResult | null, formData: FormData) => {
    const dollars = Number(formData.get("amount"));
    return submitToolAction("test-harness.adjust", {
      customerId,
      amountCents: Math.round(dollars * 100),
      note: String(formData.get("note") ?? ""),
    });
  }, null);

  return (
    <div className={styles.stack}>
      <form action={formAction} className={styles.form}>
        <label>
          Amount ($)
          <input name="amount" type="number" min="0.01" step="0.01" defaultValue="50" required />
        </label>
        <label>
          Note
          <input name="note" maxLength={200} defaultValue="Goodwill credit" />
        </label>
        <button type="submit" disabled={pending}>
          Run action
        </button>
      </form>
      {result && (
        <div>
          <strong>{result.outcome}</strong> (audit #{result.auditId}){result.error && `: ${result.error}`}
          <ul className={styles.list}>
            {result.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
