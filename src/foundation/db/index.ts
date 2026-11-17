import BetterSqlite3, { type Database } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { runPendingSeeds } from "@/foundation/pipeline/seeds";
import { resetPolicyForTests } from "@/foundation/policy/active";
import { policy } from "@/foundation/policy/policy.config";
import { syncGrants } from "@/foundation/policy/sync";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema";
import { seed } from "./seed";

export type { Database };

const DEFAULT_PATH = path.join(process.cwd(), ".data", "app.db");

const globalForDb = globalThis as unknown as { __fitDb?: Database };

/** Moves a database file from an older schema aside (fake data only) so a fresh one is created. */
function moveAsideIfStale(file: string): void {
  if (file === ":memory:" || !fs.existsSync(file)) return;
  const old = new BetterSqlite3(file);
  const version = old.pragma("user_version", { simple: true }) as number;
  const hasData = !!old.prepare("SELECT 1 FROM sqlite_master WHERE name = 'teams'").get();
  old.close();
  if (!hasData || version >= SCHEMA_VERSION) return;
  const stale = `${file}.v${version}-${Date.now()}`;
  for (const suffix of ["", "-wal", "-shm"]) {
    if (fs.existsSync(file + suffix)) fs.renameSync(file + suffix, stale + suffix);
  }
  console.warn(`Database schema v${version} is older than v${SCHEMA_VERSION}; moved it to ${stale} and created a fresh one.`);
}

/** Opens a database, creating the schema, seed data, policy grants and tool seeds if it is empty. */
export function openDatabase(file: string): Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  moveAsideIfStale(file);
  const db = new BetterSqlite3(file);
  db.pragma("foreign_keys = ON");
  if (file !== ":memory:") db.pragma("journal_mode = WAL");
  const isEmpty = !db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'teams'").get();
  db.exec(SCHEMA_SQL);
  if (isEmpty) {
    seed(db);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
  syncGrants(db, policy);
  runPendingSeeds(db);
  return db;
}

/** The shared database. Foundation modules only: tools never import this. */
export function getDb(): Database {
  if (!globalForDb.__fitDb) {
    globalForDb.__fitDb = openDatabase(process.env.DATABASE_PATH || DEFAULT_PATH);
  }
  return globalForDb.__fitDb;
}

/** Replaces the shared database with a fresh in-memory one. Tests only. */
export function resetDbForTests(): Database {
  globalForDb.__fitDb?.close();
  resetPolicyForTests();
  globalForDb.__fitDb = openDatabase(":memory:");
  return globalForDb.__fitDb;
}
