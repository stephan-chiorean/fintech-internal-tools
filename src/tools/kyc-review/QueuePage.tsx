import { Reasons } from "@/shell/components/Reasons";
import styles from "@/shell/shell.module.css";
import { CaseTable } from "./CaseTable";
import { caseStatus, listCases } from "./cases";

export function QueuePage({ viewerId }: { viewerId: string }) {
  const { records, withheld } = listCases(viewerId);
  return (
    <div className={styles.stack}>
      <h1>KYC review</h1>
      {records.length === 0 && withheld.count > 0 && withheld.decision ? (
        <Reasons reasons={withheld.decision.reasons} />
      ) : (
        <>
          <h2>Queue</h2>
          <CaseTable viewerId={viewerId} cases={records.filter((r) => caseStatus(r) === "pending")} showClaim />
          <h2>In review</h2>
          <CaseTable viewerId={viewerId} cases={records.filter((r) => ["claimed", "escalated"].includes(caseStatus(r)))} />
          <h2>Decided</h2>
          <CaseTable viewerId={viewerId} cases={records.filter((r) => ["approved", "rejected"].includes(caseStatus(r)))} />
        </>
      )}
    </div>
  );
}
