"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/foundation/pipeline";
import { submitToolAction } from "@/shell/actions";
import { EffectBadge, Reasons } from "@/shell/components/Reasons";
import styles from "@/shell/shell.module.css";

export interface CaseButton {
  label: string;
  /** Sent as the action's `decision` input. */
  decision?: "approve" | "reject";
  secondary?: boolean;
}

/** One KYC action form. Always submits through the shared pipeline; the policy decides. */
export function CaseActionForm({
  actionId,
  input,
  textField,
  buttons,
}: {
  actionId: string;
  input: Record<string, string>;
  textField?: { name: "reason" | "note"; label: string; placeholder?: string };
  buttons: CaseButton[];
}) {
  const [result, formAction, pending] = useActionState(async (_prev: ActionResult | null, formData: FormData) => {
    const payload: Record<string, unknown> = { ...input };
    if (textField) payload[textField.name] = String(formData.get(textField.name) ?? "");
    const decision = formData.get("decision");
    if (decision) payload.decision = String(decision);
    return submitToolAction(actionId, payload);
  }, null);

  return (
    <div className={styles.stack}>
      <form action={formAction} className={styles.form}>
        {textField && (
          <label>
            {textField.label}
            <input name={textField.name} maxLength={500} placeholder={textField.placeholder} required />
          </label>
        )}
        {buttons.map((button) => (
          <button
            key={button.label}
            type="submit"
            name={button.decision ? "decision" : undefined}
            value={button.decision}
            className={button.secondary ? "secondary" : undefined}
            disabled={pending}
          >
            {button.label}
          </button>
        ))}
      </form>
      {result && (
        <div className={styles.row}>
          <EffectBadge effect={result.outcome} />
          <Reasons reasons={result.error ? [result.error, ...result.reasons] : result.reasons} />
        </div>
      )}
    </div>
  );
}
