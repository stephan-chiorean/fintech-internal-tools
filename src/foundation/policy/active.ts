import type { Database } from "better-sqlite3";
import { policy as configuredPolicy } from "./policy.config";
import { syncGrants } from "./sync";
import type { Policy } from "./types";

const globalForPolicy = globalThis as unknown as { __fitPolicy?: Policy };

export function getActivePolicy(): Policy {
  return globalForPolicy.__fitPolicy ?? configuredPolicy;
}

/** Swaps in a different policy and re-syncs grants. Tests only (e.g. to revoke a grant). */
export function setPolicyForTests(db: Database, next: Policy): void {
  syncGrants(db, next);
  globalForPolicy.__fitPolicy = next;
}

export function resetPolicyForTests(): void {
  globalForPolicy.__fitPolicy = undefined;
}
