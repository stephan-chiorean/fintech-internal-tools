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
  const userExists = db.prepare("SELECT 1 FROM users WHERE id = ?");
  const teamExists = db.prepare("SELECT 1 FROM teams WHERE id = ?");

  db.transaction(() => {
    db.prepare("DELETE FROM grants").run();
    for (const grant of policy.grants) {
      const [subjectType, subjectId] =
        "user" in grant.to ? (["user", grant.to.user] as const) : (["team", grant.to.team] as const);
      const exists = subjectType === "user" ? userExists.get(subjectId) : teamExists.get(subjectId);
      if (!exists) throw new Error(`Grant ${grant.id}: unknown ${subjectType} ${subjectId}`);
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
    }
  })();
}
