"use client";

import { useActionState } from "react";
import type { ApprovalDecisionResult } from "@/foundation/approvals";
import { decideApproval } from "@/shell/actions";
import styles from "@/shell/shell.module.css";

export function ApprovalButtons({ approvalId }: { approvalId: string }) {
  const [result, formAction, pending] = useActionState(
    async (_prev: ApprovalDecisionResult | null, formData: FormData) =>
      decideApproval(approvalId, formData.get("decision") === "approve" ? "approve" : "reject"),
    null,
  );
  return (
    <form action={formAction} className={styles.row}>
      <button type="submit" name="decision" value="approve" disabled={pending}>
        Approve
      </button>
      <button type="submit" name="decision" value="reject" disabled={pending} className={styles.secondary}>
        Reject
      </button>
      {result && (
        <span>
          <strong>{result.outcome}</strong>: {result.error ?? result.reasons[0]}
        </span>
      )}
    </form>
  );
}
