import { getCustomerFacts, getCustomerProfile } from "@/foundation/data";
import { EffectBadge } from "@/shell/components/Reasons";
import styles from "@/shell/shell.module.css";
import { CaseActionForm } from "./CaseActionForm";
import { CaseTable } from "./CaseTable";
import { listCases } from "./cases";
import { type KycStatusFact, TOOL } from "./records";

/** Customer page: the customer's KYC status, the last published decision and their cases. */
export function CustomerKyc({ viewerId, customerId }: { viewerId: string; customerId: string }) {
  const profile = getCustomerProfile(viewerId, customerId);
  if (!profile.ok) return <p className={styles.muted}>KYC status is not available to you.</p>;
  const facts = getCustomerFacts(viewerId, customerId, { namespace: TOOL });
  const latest = facts.ok ? facts.facts.find((f) => f.key === "status") : undefined;
  const decision = latest?.value as unknown as KycStatusFact | undefined;
  const cases = listCases(viewerId).records.filter((r) => r.customerId === customerId);

  return (
    <div className={styles.stack}>
      <p>
        KYC status: <EffectBadge effect={profile.profile.kycStatus} />
      </p>
      {decision && latest && (
        <p className={styles.muted}>
          Last decision: {decision.kycStatus} on case {decision.caseKey} by {decision.decidedBy} ·{" "}
          {new Date(latest.publishedAt).toLocaleString()}
        </p>
      )}
      {cases.length > 0 && <CaseTable viewerId={viewerId} cases={cases} />}
      <CaseActionForm
        actionId="kyc-review.open-case"
        input={{ customerId }}
        textField={{ name: "note", label: "Open a KYC case", placeholder: "Why this customer needs review" }}
        buttons={[{ label: "Open case", secondary: true }]}
      />
    </div>
  );
}
