import Link from "next/link";
import { listApprovals } from "@/foundation/approvals";
import { describeSource, getActor, getDirectory, getEffectiveGrants } from "@/foundation/permissions";
import { policy } from "@/foundation/policy";
import { Slot } from "@/shell/components/Slot";
import styles from "@/shell/shell.module.css";

export function Dashboard({ viewerId }: { viewerId: string }) {
  const actor = getActor(viewerId)!;
  const { teams } = getDirectory();
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? id;
  const grants = getEffectiveGrants(viewerId);
  const toDecide = listApprovals(viewerId).filter((a) => a.status === "pending" && a.viewerDecision?.effect === "allow");

  return (
    <div className={styles.stack}>
      <h1>Welcome, {actor.name}</h1>
      <p className={styles.muted}>
        Teams: {actor.teams.map(teamName).join(", ") || "none"}
        {actor.isContractor && " · Contractor"}
      </p>

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Approvals waiting for you</h2>
          <p className={styles.bigNumber}>{toDecide.length}</p>
          <Link href="/approvals">Open approvals</Link>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Your access</h2>
          {grants.length === 0 ? (
            <p className={styles.muted}>No grants.</p>
          ) : (
            <ul className={styles.list}>
              {grants.map((grant) => (
                <li key={grant.id}>
                  <strong>{grant.role}</strong>
                  {Object.keys(grant.params).length > 0 && ` (${JSON.stringify(grant.params)})`} —{" "}
                  {policy.roles[grant.role as keyof typeof policy.roles]?.description}
                  <div className={styles.muted}>
                    {describeSource(grant.source)}
                    {grant.scope && ` · scoped to ${"productArea" in grant.scope ? `product area ${grant.scope.productArea}` : `customer ${grant.scope.customerId}`}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <h2>From your tools</h2>
      <Slot name="dashboard" props={{ viewerId }} />
    </div>
  );
}
