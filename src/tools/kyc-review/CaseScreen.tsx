import Link from "next/link";
import { getCustomerProfile, getRecordHistory } from "@/foundation/data";
import { EffectBadge, Reasons } from "@/shell/components/Reasons";
import styles from "@/shell/shell.module.css";
import { CaseActionForm } from "./CaseActionForm";
import { caseData, caseStatus, claimedBy } from "./cases";
import { CASE, TOOL } from "./records";

const FIELD_LABELS = { ssn: "SSN", bankAccount: "Bank account", dob: "Date of birth", address: "Address" } as const;

/** A KYC case: the customer's shared (masked) profile, the case, its actions and its history. */
export function CaseScreen({ viewerId, caseKey }: { viewerId: string; caseKey: string }) {
  const history = getRecordHistory(viewerId, TOOL, { kind: CASE, key: caseKey });
  if (!history.ok) {
    return (
      <div className={styles.stack}>
        <h1>KYC case {caseKey}</h1>
        <Reasons reasons={history.decision.reasons} />
      </div>
    );
  }
  const { record, entries } = history;
  const status = caseStatus(record);
  const data = caseData(record);
  const profile = record.customerId ? getCustomerProfile(viewerId, record.customerId) : null;

  return (
    <div className={styles.stack}>
      <h1>
        KYC case {record.key} <EffectBadge effect={status} />
      </h1>
      <div className={styles.grid}>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Customer</h2>
          {!profile ? (
            <p className={styles.muted}>No customer.</p>
          ) : !profile.ok ? (
            <Reasons reasons={profile.decision.reasons} />
          ) : (
            <dl className={styles.fields}>
              <dt>Name</dt>
              <dd>
                <Link href={`/customers/${profile.profile.id}`}>{profile.profile.name}</Link>
              </dd>
              <dt>KYC status</dt>
              <dd>
                <EffectBadge effect={profile.profile.kycStatus} />
              </dd>
              {(Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[]).map((field) => {
                const masked = profile.profile.fields[field];
                return (
                  <div key={field}>
                    <dt>
                      {FIELD_LABELS[field]} <EffectBadge effect={masked.level} />
                    </dt>
                    <dd className={masked.value === null ? styles.muted : undefined}>{masked.value ?? masked.reason}</dd>
                  </div>
                );
              })}
            </dl>
          )}
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Case</h2>
          <dl className={styles.fields}>
            <dt>Opened by</dt>
            <dd>
              {record.openedBy} · {new Date(record.openedAt).toLocaleString()}
            </dd>
            <dt>Note</dt>
            <dd>{data.note}</dd>
            <dt>Claimed by</dt>
            <dd>{claimedBy(record) ?? "—"}</dd>
            {data.escalationReason && (
              <>
                <dt>Escalation reason</dt>
                <dd>{data.escalationReason}</dd>
              </>
            )}
            {data.decision && (
              <>
                <dt>Decision</dt>
                <dd>
                  {data.decision} by {data.decidedBy}: {data.decisionReason}
                </dd>
              </>
            )}
          </dl>
          {status === "pending" && (
            <CaseActionForm actionId="kyc-review.claim-case" input={{ key: record.key }} buttons={[{ label: "Claim" }]} />
          )}
          {status === "claimed" && (
            <>
              <CaseActionForm
                actionId="kyc-review.decide-case"
                input={{ key: record.key }}
                textField={{ name: "reason", label: "Reason", placeholder: "ID matches records" }}
                buttons={[{ label: "Approve", decision: "approve" }, { label: "Reject", decision: "reject", secondary: true }]}
              />
              <CaseActionForm
                actionId="kyc-review.escalate-case"
                input={{ key: record.key }}
                textField={{ name: "reason", label: "Escalation reason" }}
                buttons={[{ label: "Escalate", secondary: true }]}
              />
            </>
          )}
          {status === "escalated" && (
            <CaseActionForm
              actionId="kyc-review.decide-escalated-case"
              input={{ key: record.key }}
              textField={{ name: "reason", label: "Reason" }}
              buttons={[{ label: "Approve", decision: "approve" }, { label: "Reject", decision: "reject", secondary: true }]}
            />
          )}
        </section>
      </div>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>History</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>When</th>
              <th>Event</th>
              <th>Who</th>
              <th>Action</th>
              <th>Status after</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{new Date(entry.at).toLocaleString()}</td>
                <td>
                  <EffectBadge effect={entry.event} />
                </td>
                <td>{entry.actorId}</td>
                <td>
                  {entry.actionId} <span className={styles.muted}>(audit #{entry.auditId})</span>
                </td>
                <td>{String(entry.attrs.status ?? "")}</td>
                <td>
                  <Reasons reasons={entry.reasons} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
