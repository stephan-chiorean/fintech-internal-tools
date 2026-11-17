import { getDb } from "@/foundation/db";
import { getActivePolicy } from "@/foundation/policy/active";
import { loadActor, loadDirectory, loadEffectiveGrants } from "./grants";
import { type CheckInput, type Decision, checkPermission } from "./resolver";

export type { Actor, DirectoryTeam, DirectoryUser, EffectiveGrant, GrantSource } from "./grants";
export { describeSource } from "./grants";
export type { CheckInput, Decision, MatchedGrant, Resource } from "./resolver";

/** Checks a permission against the shared database and the active policy config. */
export function check(input: CheckInput): Decision {
  return checkPermission(getDb(), getActivePolicy(), input);
}

export function getActor(actorId: string) {
  return loadActor(getDb(), actorId);
}

export function getEffectiveGrants(actorId: string) {
  return loadEffectiveGrants(getDb(), actorId);
}

/** Users and teams, for the sign-in switcher and team names. Not sensitive. */
export function getDirectory() {
  return loadDirectory(getDb());
}
