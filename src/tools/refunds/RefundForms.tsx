"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/foundation/pipeline";
import { Reasons } from "@/shell/components/Reasons";
import { submitToolAction } from "@/shell/actions";
import styles from "@/shell/shell.module.css";

function Outcome({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <div>
      <strong>{result.outcome}</strong> (audit #{result.auditId}){result.error && `: ${result.error}`}
      <Reasons reasons={result.reasons} />
    </div>
  );
}

const submitForApproval = (key: string) => submitToolAction("refunds.issue", { key });

/** Requests a refund (creates it), then asks for approval to issue it. Both calls go through the pipeline. */
export function RequestRefundForm({ customerId }: { customerId: string }) {
  const [result, formAction, pending] = useActionState(async (_prev: ActionResult | null, formData: FormData) => {
    const requested = await submitToolAction("refunds.request", {
      customerId,
      amountCents: Math.round(Number(formData.get("amount")) * 100),
      reason: String(formData.get("reason") ?? ""),
    });
    if (requested.outcome !== "executed") return requested;
    return submitForApproval((requested.result as { key: string }).key);
  }, null);

  return (
    <div className={styles.stack}>
      <form action={formAction} className={styles.form}>
        <label>
          Amount ($)
          <input name="amount" type="number" min="0.01" step="0.01" defaultValue="840" required />
        </label>
        <label>
          Reason
          <input name="reason" maxLength={200} defaultValue="Charged twice" required />
        </label>
        <button type="submit" disabled={pending}>
          Request refund
        </button>
      </form>
      <Outcome result={result} />
    </div>
  );
}

/** Asks for approval again, e.g. after a rejection or a failed submission. */
export function SubmitForApprovalButton({ refundKey }: { refundKey: string }) {
  const [result, formAction, pending] = useActionState(async () => submitForApproval(refundKey), null);
  return (
    <form action={formAction} className={styles.stack}>
      <button type="submit" disabled={pending} className={styles.secondary}>
        Submit for approval
      </button>
      <Outcome result={result} />
    </form>
  );
}
