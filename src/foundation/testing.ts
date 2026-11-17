import type { Database } from "better-sqlite3";
import { resetDbForTests } from "@/foundation/db";
import { setPolicyForTests } from "@/foundation/policy/active";
import { policy } from "@/foundation/policy/policy.config";
import type { GrantDefinition, Policy } from "@/foundation/policy/types";

/** Test helpers. Never import from app code. */
export function freshDb(): Database {
  return resetDbForTests();
}

export function auditCount(db: Database): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM audit").get() as { n: number }).n;
}

export function withExtraGrants(db: Database, grants: GrantDefinition<string>[]): void {
  setPolicyForTests(db, { ...(policy as Policy), grants: [...policy.grants, ...grants] });
}

export function withoutGrants(db: Database, grantIds: string[]): void {
  setPolicyForTests(db, { ...(policy as Policy), grants: policy.grants.filter((g) => !grantIds.includes(g.id)) });
}

export function removeFromTeam(db: Database, userId: string, teamId: string): void {
  db.prepare("DELETE FROM user_teams WHERE user_id = ? AND team_id = ?").run(userId, teamId);
}
