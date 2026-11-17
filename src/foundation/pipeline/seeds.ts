import type { Database } from "better-sqlite3";
import { appendAudit } from "@/foundation/audit/log";
import type { Actor } from "@/foundation/permissions";
import { getActivePolicy } from "@/foundation/policy/active";
import { buildResource, errorMessage, executeWithAudit } from "./execute";
import { getAction } from "./registry";
import { runActionOn } from "./run-action";

/** One action call a seed makes. */
export interface SeedStep {
  actionId: string;
  input: unknown;
  /**
   * The user the step acts as. The step then runs through that user's
   * permission checks, so it can execute or request approval like their own
   * call; it is denied (and the seed fails) if they couldn't make it.
   * Without it, the step runs as the system actor without permission checks.
   */
  as?: string;
}

/** Starting data for a tool, created by running the tool's own actions. */
export interface SeedDefinition {
  /** Prefixed with the tool id, e.g. "feature-flags.demo-flags". */
  id: string;
  tool: string;
  description: string;
  steps: SeedStep[];
}

/** The actor seeds run as. Not a user: nobody can sign in as it, and it has no grants. */
export const SYSTEM_ACTOR: Actor = { id: "system", name: "System seed", isContractor: false, teams: [] };

const globalForSeeds = globalThis as unknown as { __fitSeeds?: Map<string, SeedDefinition>; __fitSeedDb?: Database };
const seeds = (globalForSeeds.__fitSeeds ??= new Map());

/**
 * Runs a seed once per database, all steps in one transaction. Each step writes
 * one audit row with outcome "seeded". A step without `as` goes through the
 * action's parse, resource checks and execute as the system actor, skipping
 * permission checks. A step with `as` runs through the pipeline as that user,
 * with their permission checks.
 */
function runSeed(db: Database, seed: SeedDefinition): void {
  if (db.prepare("SELECT 1 FROM seed_runs WHERE id = ?").get(seed.id)) return;
  const policy = getActivePolicy();
  const reasons = [`System seed "${seed.id}": ${seed.description}. Runs once per database, without permission checks.`];
  try {
    db.transaction(() => {
      for (const step of seed.steps) {
        const def = getAction(step.actionId);
        if (!def || def.tool !== seed.tool) throw new Error(`action ${step.actionId} is not an action of ${seed.tool}`);
        if (step.as !== undefined) {
          const result = runActionOn(db, step.as, step.actionId, step.input, {
            reasons: [`Seed "${seed.id}" acting as ${step.as}: ${seed.description}. Runs once per database, with ${step.as}'s permission checks.`],
          });
          if (result.outcome !== "executed" && result.outcome !== "approval-requested") {
            throw new Error(`${step.actionId} as ${step.as}: ${result.error ?? result.reasons[0]}`);
          }
          continue;
        }
        const input = def.parse(step.input);
        const built = buildResource(db, def, input, {}, SYSTEM_ACTOR.id);
        if (!built.ok) throw new Error(built.reason);
        const execution = executeWithAudit(db, policy, {
          def,
          actor: SYSTEM_ACTOR,
          input,
          built,
          approvalId: null,
          outcome: "seeded",
          reasons,
          systemSeed: true,
        });
        if (execution.status !== "done") throw new Error(`${step.actionId}: ${execution.error}`);
      }
      db.prepare("INSERT INTO seed_runs (id, tool, ran_at) VALUES (?, ?, ?)").run(seed.id, seed.tool, new Date().toISOString());
    })();
  } catch (error) {
    const message = errorMessage(error);
    appendAudit(db, {
      actorId: SYSTEM_ACTOR.id,
      actionId: `${seed.tool}.seed`,
      tool: seed.tool,
      outcome: "failed",
      input: { seed: seed.id },
      reasons: [`Failed: system seed "${seed.id}": ${message}`],
    });
    console.error(`System seed ${seed.id} failed: ${message}`);
  }
}

/** Registers a tool's seed. Runs it now if a database is open, and on every new database. */
export function defineSeed(seed: SeedDefinition): SeedDefinition {
  if (!seed.id.startsWith(`${seed.tool}.`)) throw new Error(`Seed ${seed.id} must be prefixed with its tool id ${seed.tool}`);
  seeds.set(seed.id, seed);
  const db = globalForSeeds.__fitSeedDb;
  if (db?.open) runSeed(db, seed);
  return seed;
}

/** Runs every registered seed that hasn't run on this database. Called when a database opens. */
export function runPendingSeeds(db: Database): void {
  globalForSeeds.__fitSeedDb = db;
  for (const seed of seeds.values()) runSeed(db, seed);
}
