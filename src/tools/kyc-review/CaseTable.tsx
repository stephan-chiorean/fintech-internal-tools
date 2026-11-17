import Link from "next/link";
import type { ToolRecord } from "@/foundation/data";
import { EffectBadge } from "@/shell/components/Reasons";
import styles from "@/shell/shell.module.css";
import { CaseActionForm } from "./CaseActionForm";
import { caseHref, caseStatus, claimedBy, customerName } from "./cases";

export function CaseTable({ viewerId, cases, showClaim = false }: { viewerId: string; cases: ToolRecord[]; showClaim?: boolean }) {
  if (cases.length === 0) return <p className={styles.muted}>None.</p>;
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Case</th>
          <th>Customer</th>
          <th>Status</th>
          <th>Opened by</th>
          <th>Claimed by</th>
          {showClaim && <th />}
        </tr>
      </thead>
      <tbody>
        {cases.map((record) => (
          <tr key={record.id}>
            <td>
              <Link href={caseHref(record.key)}>{record.key}</Link>
            </td>
            <td>{customerName(viewerId, record.customerId)}</td>
            <td>
              <EffectBadge effect={caseStatus(record)} />
            </td>
            <td>{record.openedBy}</td>
            <td>{claimedBy(record) ?? "—"}</td>
            {showClaim && (
              <td>
                <CaseActionForm actionId="kyc-review.claim-case" input={{ key: record.key }} buttons={[{ label: "Claim" }]} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
