import { getActivePolicy } from "@/foundation/policy/active";
import type { ActionDefinition, JsonValue } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RegisteredAction = ActionDefinition<any, JsonValue | void>;

const globalForActions = globalThis as unknown as { __fitActions?: Map<string, RegisteredAction> };
const actions = (globalForActions.__fitActions ??= new Map());

/** Registers a tool's action. Re-registering the same id replaces it (hot reload). */
export function defineAction<I, R extends JsonValue | void>(def: ActionDefinition<I, R>): ActionDefinition<I, R> {
  if (!def.id.startsWith(`${def.tool}.`)) throw new Error(`Action ${def.id} must be prefixed with its tool id ${def.tool}`);
  if (!getActivePolicy().permissions[def.permission]) {
    throw new Error(`Action ${def.id} uses permission ${def.permission}, which is not in the policy config`);
  }
  actions.set(def.id, def as RegisteredAction);
  return def;
}

export function getAction(actionId: string): RegisteredAction | undefined {
  return actions.get(actionId);
}

export function listActions(): RegisteredAction[] {
  return [...actions.values()];
}
