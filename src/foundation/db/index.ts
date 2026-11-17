import BetterSqlite3, { type Database } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { resetPolicyForTests } from "@/foundation/policy/active";
import { policy } from "@/foundation/policy/policy.config";
import { syncGrants } from "@/foundation/policy/sync";
import { SCHEMA_SQL } from "./schema";
import { seed } from "./seed";

export type { Database };

const DEFAULT_PATH = path.join(process.cwd(), ".data", "app.db");

const globalForDb = globalThis as unknown as { __fitDb?: Database };

/** Opens a database, creating the schema, seed data and policy grants if it is empty. */
export function openDatabase(file: string): Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new BetterSqlite3(file);
  db.pragma("foreign_keys = ON");
  if (file !== ":memory:") db.pragma("journal_mode = WAL");
  const isEmpty = !db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'teams'").get();
  db.exec(SCHEMA_SQL);
  if (isEmpty) seed(db);
  syncGrants(db, policy);
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
