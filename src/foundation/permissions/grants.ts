import type { Database } from "better-sqlite3";

export interface Actor {
  id: string;
  name: string;
  isContractor: boolean;
  teams: string[];
}

export type GrantSource =
  | { type: "user" }
  /** `teamId` holds the grant; the actor is a member of `memberOf`, `depth` levels below it. */
  | { type: "team"; teamId: string; teamName: string; memberOf: string; memberOfName: string; depth: number }
  /** The grant requires membership in every one of `teams`, and the actor has it. */
  | { type: "all-teams"; teams: { id: string; name: string }[] };

export interface EffectiveGrant {
  id: string;
  role: string;
  params: Record<string, number | string>;
  scope: { productArea: string } | { customerId: string } | null;
  description: string;
  source: GrantSource;
}

interface GrantRow {
  id: string;
  subject_type: "user" | "team";
  role: string;
  params: string;
  scope_product_area: string | null;
  scope_customer_id: string | null;
  description: string;
  team_id: string | null;
  team_name: string | null;
  member_of: string | null;
  member_of_name: string | null;
  depth: number | null;
}

// Walks from each of the user's teams up through its ancestors, so a grant to
// basic-support reaches members of support-t1 and support-t2.
const EFFECTIVE_GRANTS_SQL = `
WITH RECURSIVE membership(team_id, member_of, depth) AS (
  SELECT team_id, team_id, 0 FROM user_teams WHERE user_id = @actorId
  UNION
  SELECT t.parent_id, m.member_of, m.depth + 1
  FROM membership m JOIN teams t ON t.id = m.team_id
  WHERE t.parent_id IS NOT NULL AND m.depth < 32
)
SELECT g.*, m.team_id, ht.name AS team_name, m.member_of, mt.name AS member_of_name, m.depth
FROM grants g
JOIN membership m ON g.subject_type = 'team' AND g.subject_id = m.team_id
JOIN teams ht ON ht.id = m.team_id
JOIN teams mt ON mt.id = m.member_of
UNION ALL
SELECT g.*, NULL, NULL, NULL, NULL, NULL
FROM grants g
WHERE g.subject_type = 'user' AND g.subject_id = @actorId
ORDER BY depth, id
`;

// Every team the user belongs to, directly or through a child team.
const MEMBERSHIP_SQL = `
WITH RECURSIVE membership(team_id, depth) AS (
  SELECT team_id, 0 FROM user_teams WHERE user_id = @actorId
  UNION
  SELECT t.parent_id, m.depth + 1
  FROM membership m JOIN teams t ON t.id = m.team_id
  WHERE t.parent_id IS NOT NULL AND m.depth < 32
)
SELECT DISTINCT team_id FROM membership
`;

const ALL_TEAMS_GRANTS_SQL = `
SELECT g.*, gt.team_id, t.name AS team_name
FROM grants g
JOIN grant_teams gt ON gt.grant_id = g.id
JOIN teams t ON t.id = gt.team_id
WHERE g.subject_type = 'all-teams'
ORDER BY g.id, gt.team_id
`;

export function loadActor(db: Database, actorId: string): Actor | null {
  const row = db.prepare("SELECT id, name, is_contractor FROM users WHERE id = ?").get(actorId) as
    | { id: string; name: string; is_contractor: number }
    | undefined;
  if (!row) return null;
  const teams = db
    .prepare("SELECT team_id FROM user_teams WHERE user_id = ? ORDER BY team_id")
    .all(actorId) as { team_id: string }[];
  return { id: row.id, name: row.name, isContractor: row.is_contractor === 1, teams: teams.map((t) => t.team_id) };
}

/** All grants that reach the actor directly or through the team tree, nearest path first. */
export function loadEffectiveGrants(db: Database, actorId: string): EffectiveGrant[] {
  const rows = db.prepare(EFFECTIVE_GRANTS_SQL).all({ actorId }) as GrantRow[];
  const seen = new Set<string>();
  const grants: EffectiveGrant[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    grants.push({
      id: row.id,
      role: row.role,
      params: JSON.parse(row.params),
      scope: grantScope(row),
      description: row.description,
      source:
        row.subject_type === "user"
          ? { type: "user" }
          : {
              type: "team",
              teamId: row.team_id!,
              teamName: row.team_name!,
              memberOf: row.member_of!,
              memberOfName: row.member_of_name!,
              depth: row.depth!,
            },
    });
  }
  return [...grants, ...loadAllTeamsGrants(db, actorId)];
}

function grantScope(row: Pick<GrantRow, "scope_product_area" | "scope_customer_id">): EffectiveGrant["scope"] {
  if (row.scope_product_area) return { productArea: row.scope_product_area };
  if (row.scope_customer_id) return { customerId: row.scope_customer_id };
  return null;
}

/** Grants that require membership in several teams at once, kept only if the actor is in all of them. */
function loadAllTeamsGrants(db: Database, actorId: string): EffectiveGrant[] {
  const memberOf = new Set((db.prepare(MEMBERSHIP_SQL).all({ actorId }) as { team_id: string }[]).map((r) => r.team_id));
  const rows = db.prepare(ALL_TEAMS_GRANTS_SQL).all() as (GrantRow & { team_id: string; team_name: string })[];
  const byGrant = new Map<string, { row: GrantRow; teams: { id: string; name: string }[] }>();
  for (const row of rows) {
    const entry = byGrant.get(row.id) ?? { row, teams: [] };
    entry.teams.push({ id: row.team_id, name: row.team_name });
    byGrant.set(row.id, entry);
  }
  return [...byGrant.values()]
    .filter(({ teams }) => teams.every((t) => memberOf.has(t.id)))
    .map(({ row, teams }) => ({
      id: row.id,
      role: row.role,
      params: JSON.parse(row.params),
      scope: grantScope(row),
      description: row.description,
      source: { type: "all-teams", teams },
    }));
}

export function describeSource(source: GrantSource): string {
  if (source.type === "user") return "granted to the user directly";
  if (source.type === "all-teams") return `granted to members of all of ${source.teams.map((t) => t.name).join(" and ")}`;
  if (source.depth === 0) return `granted to team ${source.teamName}`;
  return `granted to team ${source.teamName}, inherited through membership in ${source.memberOfName}`;
}

export interface DirectoryUser extends Actor {
  title: string;
}

export interface DirectoryTeam {
  id: string;
  name: string;
  parentId: string | null;
}

export function loadDirectory(db: Database): { users: DirectoryUser[]; teams: DirectoryTeam[] } {
  const users = db.prepare("SELECT id, name, title, is_contractor FROM users ORDER BY name").all() as {
    id: string;
    name: string;
    title: string;
    is_contractor: number;
  }[];
  const memberships = db.prepare("SELECT user_id, team_id FROM user_teams ORDER BY team_id").all() as {
    user_id: string;
    team_id: string;
  }[];
  const teams = db.prepare("SELECT id, name, parent_id FROM teams ORDER BY id").all() as {
    id: string;
    name: string;
    parent_id: string | null;
  }[];
  return {
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      title: u.title,
      isContractor: u.is_contractor === 1,
      teams: memberships.filter((m) => m.user_id === u.id).map((m) => m.team_id),
    })),
    teams: teams.map((t) => ({ id: t.id, name: t.name, parentId: t.parent_id })),
  };
}
