import type { Database } from "better-sqlite3";
import type { Policy } from "./types";
import { validatePolicy } from "./validate";

/** Replaces the grants table with the grants in the policy config. */
export function syncGrants(db: Database, policy: Policy): void {
  validatePolicy(policy);
  const insert = db.prepare(
    `INSERT INTO grants (id, subject_type, subject_id, role, params, scope_product_area, scope_customer_id, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertTeam = db.prepare("INSERT INTO grant_teams (grant_id, team_id) VALUES (?, ?)");
  const userExists = db.prepare("SELECT 1 FROM users WHERE id = ?");
  const teamExists = db.prepare("SELECT 1 FROM teams WHERE id = ?");

  db.transaction(() => {
    db.prepare("DELETE FROM grant_teams").run();
    db.prepare("DELETE FROM grants").run();
    for (const grant of policy.grants) {
      const [subjectType, subjectId] =
        "user" in grant.to
          ? (["user", grant.to.user] as const)
          : "team" in grant.to
            ? (["team", grant.to.team] as const)
            : (["all-teams", grant.to.allTeams.join("+")] as const);
      const teams = "allTeams" in grant.to ? grant.to.allTeams : subjectType === "team" ? [subjectId] : [];
      for (const team of teams) if (!teamExists.get(team)) throw new Error(`Grant ${grant.id}: unknown team ${team}`);
      if (subjectType === "user" && !userExists.get(subjectId)) throw new Error(`Grant ${grant.id}: unknown user ${subjectId}`);
      insert.run(
        grant.id,
        subjectType,
        subjectId,
        grant.role,
        JSON.stringify(grant.params ?? {}),
        grant.scope && "productArea" in grant.scope ? grant.scope.productArea : null,
        grant.scope && "customerId" in grant.scope ? grant.scope.customerId : null,
        grant.description,
      );
      if (subjectType === "all-teams") for (const team of new Set(teams)) insertTeam.run(grant.id, team);
    }
  })();
}
