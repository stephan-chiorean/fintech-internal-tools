"use client";

import { useActionState } from "react";
import type { ApprovalDecisionResult } from "@/foundation/approvals";
import { Reasons } from "@/shell/components/Reasons";
import { decideApproval } from "@/shell/actions";
import styles from "@/shell/shell.module.css";

/** Approve and reject (or deny) controls for one approval. The server re-checks every decision and explains refusals. */
export function ApprovalButtons({
  approvalId,
  approveLabel = "Approve",
  rejectLabel = "Reject",
}: {
  approvalId: string;
  approveLabel?: string;
  rejectLabel?: string;
}) {
  const [result, formAction, pending] = useActionState(
    async (_prev: ApprovalDecisionResult | null, formData: FormData) =>
      decideApproval(approvalId, formData.get("decision") === "approve" ? "approve" : "reject"),
    null,
  );
  return (
    <div className={styles.stack}>
      <form action={formAction} className={styles.row}>
        <button type="submit" name="decision" value="approve" disabled={pending}>
          {approveLabel}
        </button>
        <button type="submit" name="decision" value="reject" disabled={pending} className={styles.secondary}>
          {rejectLabel}
        </button>
        {result && <strong>{result.outcome}</strong>}
      </form>
      {result && (result.error ? <p>{result.error}</p> : <Reasons reasons={result.reasons} />)}
    </div>
  );
}
