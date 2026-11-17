import Link from "next/link";
import { Reasons } from "@/shell/components/Reasons";
import styles from "@/shell/shell.module.css";
import { CaseTable } from "./CaseTable";
import { caseStatus, claimedBy, listCases } from "./cases";

/** Dashboard card: the pending queue and the viewer's claimed cases. */
export function QueueCard({ viewerId }: { viewerId: string }) {
  const { records, withheld } = listCases(viewerId);
  if (records.length === 0 && withheld.count > 0) {
    return (
      <div className={styles.stack}>
        <p className={styles.muted}>You can&apos;t see the KYC queue.</p>
        {withheld.decision && <Reasons reasons={withheld.decision.reasons} />}
      </div>
    );
  }
  const queue = records.filter((r) => caseStatus(r) === "pending");
  const mine = records.filter((r) => claimedBy(r) === viewerId && ["claimed", "escalated"].includes(caseStatus(r)));
  const escalated = records.filter((r) => caseStatus(r) === "escalated");
  return (
    <div className={styles.stack}>
      <h4>Queue ({queue.length})</h4>
      <CaseTable viewerId={viewerId} cases={queue} showClaim />
      <h4>My cases ({mine.length})</h4>
      <CaseTable viewerId={viewerId} cases={mine} />
      <h4>Escalated ({escalated.length})</h4>
      <CaseTable viewerId={viewerId} cases={escalated} />
      <Link href="/kyc-review">All KYC cases</Link>
    </div>
  );
}
