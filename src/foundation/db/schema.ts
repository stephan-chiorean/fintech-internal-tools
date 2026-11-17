/** Bump when the schema changes; older database files are moved aside and recreated. */
export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES teams(id)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  is_contractor INTEGER NOT NULL DEFAULT 0 CHECK (is_contractor IN (0, 1))
);

CREATE TABLE IF NOT EXISTS user_teams (
  user_id TEXT NOT NULL REFERENCES users(id),
  team_id TEXT NOT NULL REFERENCES teams(id),
  PRIMARY KEY (user_id, team_id)
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  product_area TEXT NOT NULL,
  kyc_status TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  ssn TEXT NOT NULL,
  bank_account TEXT NOT NULL,
  dob TEXT NOT NULL,
  address TEXT NOT NULL
);

-- Materialized from policy.config.ts by syncGrants(); never edited by hand or by tools.
CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY,
  -- 'all-teams' grants list their required teams in grant_teams; subject_id is unused.
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'team', 'all-teams')),
  subject_id TEXT NOT NULL,
  role TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  scope_product_area TEXT,
  scope_customer_id TEXT REFERENCES customers(id),
  description TEXT NOT NULL,
  CHECK (scope_product_area IS NULL OR scope_customer_id IS NULL)
);
CREATE INDEX IF NOT EXISTS grants_subject ON grants (subject_type, subject_id);

CREATE TABLE IF NOT EXISTS grant_teams (
  grant_id TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id),
  PRIMARY KEY (grant_id, team_id)
);

CREATE TABLE IF NOT EXISTS customer_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  published_by TEXT NOT NULL REFERENCES users(id),
  published_at TEXT NOT NULL,
  audit_action_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_facts_customer ON customer_facts (customer_id, namespace, key);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  input TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  summary TEXT NOT NULL,
  requested_by TEXT NOT NULL REFERENCES users(id),
  requested_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN (
    'executed', 'approval-requested', 'approved', 'rejected', 'denied', 'failed', 'seeded'
  )),
  customer_id TEXT,
  approval_id TEXT,
  input TEXT NOT NULL,
  reasons TEXT NOT NULL,
  result TEXT
);

-- Records tools own (a flag, a case, a refund). Written only by the action pipeline.
-- product_area, customer_id and attrs are the trusted attributes permission checks read.
CREATE TABLE IF NOT EXISTS tool_records (
  id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  product_area TEXT,
  customer_id TEXT REFERENCES customers(id),
  attrs TEXT NOT NULL,
  data TEXT NOT NULL,
  version INTEGER NOT NULL,
  opened_by TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tool, kind, key)
);

-- Every change to a record and every step of a request about it, append-only.
CREATE TABLE IF NOT EXISTS record_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL REFERENCES tool_records(id),
  at TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN (
    'created', 'updated', 'approval-requested', 'approved', 'rejected', 'decision-refused', 'denied', 'failed'
  )),
  actor_id TEXT NOT NULL,
  on_behalf_of TEXT,
  action_id TEXT NOT NULL,
  approval_id TEXT,
  audit_id INTEGER NOT NULL REFERENCES audit(id),
  version INTEGER NOT NULL,
  attrs TEXT NOT NULL,
  data TEXT NOT NULL,
  reasons TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS record_history_record ON record_history (record_id, id);

CREATE TABLE IF NOT EXISTS seed_runs (
  id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  ran_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS record_history_no_update
BEFORE UPDATE ON record_history
BEGIN
  SELECT RAISE(ABORT, 'record history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS record_history_no_delete
BEFORE DELETE ON record_history
BEGIN
  SELECT RAISE(ABORT, 'record history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_no_update
BEFORE UPDATE ON audit
BEGIN
  SELECT RAISE(ABORT, 'audit log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_no_delete
BEFORE DELETE ON audit
BEGIN
  SELECT RAISE(ABORT, 'audit log is append-only');
END;
`;
