"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/foundation/pipeline";
import { submitToolAction } from "@/shell/actions";
import styles from "@/shell/shell.module.css";

/** Runs one feature-flags action through the shared pipeline and shows the outcome. */
export function FlagButton({
  actionId,
  input,
  label,
  secondary,
}: {
  actionId: "feature-flags.toggle" | "feature-flags.rollback";
  input: Record<string, string | number | boolean>;
  label: string;
  secondary?: boolean;
}) {
  const [result, formAction, pending] = useActionState(
    async (): Promise<ActionResult | null> => submitToolAction(actionId, input),
    null,
  );
  return (
    <form action={formAction} className={styles.row}>
      <button type="submit" disabled={pending} className={secondary ? styles.secondary : undefined}>
        {label}
      </button>
      {result && (
        <span>
          <strong>{result.outcome}</strong>: {result.error ?? result.reasons[0]}
        </span>
      )}
    </form>
  );
}
