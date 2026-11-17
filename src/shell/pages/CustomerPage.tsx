import { getCustomerFacts, getCustomerProfile } from "@/foundation/data";
import type { MaskedField } from "@/foundation/policy";
import { EffectBadge, Reasons } from "@/shell/components/Reasons";
import { Slot } from "@/shell/components/Slot";
import styles from "@/shell/shell.module.css";

const FIELD_LABELS: Record<MaskedField, string> = {
  ssn: "SSN",
  bankAccount: "Bank account",
  dob: "Date of birth",
  address: "Address",
};

export function CustomerPage({ viewerId, customerId }: { viewerId: string; customerId: string }) {
  const result = getCustomerProfile(viewerId, customerId);
  if (!result.ok) {
    return (
      <div className={styles.stack}>
        <h1>Customer unavailable</h1>
        <Reasons reasons={result.decision.reasons} />
      </div>
    );
  }
  const { profile } = result;
  const facts = getCustomerFacts(viewerId, customerId);

  return (
    <div className={styles.stack}>
      <h1>{profile.name}</h1>
      <p className={styles.muted}>
        {profile.id} · {profile.email} · {profile.productArea} · KYC {profile.kycStatus} · risk {profile.riskLevel}
      </p>

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Sensitive fields</h2>
          <dl className={styles.fields}>
            {(Object.keys(FIELD_LABELS) as MaskedField[]).map((field) => (
              <div key={field}>
                <dt>
                  {FIELD_LABELS[field]} <EffectBadge effect={profile.fields[field].level} />
                </dt>
                <dd title={profile.fields[field].reason}>
                  {profile.fields[field].value ?? <span className={styles.muted}>hidden</span>}
                </dd>
                <dd className={styles.muted}>{profile.fields[field].reason}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Facts from tools</h2>
          {facts.facts.length === 0 && <p className={styles.muted}>No facts you can read.</p>}
          <ul className={styles.list}>
            {facts.facts.map((fact) => (
              <li key={fact.id}>
                <strong>
                  {fact.namespace}/{fact.key}
                </strong>
                : <code>{JSON.stringify(fact.value)}</code>
                <div className={styles.muted}>
                  by {fact.publishedBy} at {new Date(fact.publishedAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
          {facts.withheld.map((w) => (
            <div key={w.namespace} className={styles.muted}>
              {w.count} fact(s) from {w.namespace} withheld.
              <Reasons reasons={w.decision.reasons} />
            </div>
          ))}
        </section>
      </div>

      <h2>Tools</h2>
      <Slot name="customer" props={{ viewerId, customerId }} />
    </div>
  );
}
