import { getDb } from "@/foundation/db";
import { getActivePolicy } from "@/foundation/policy/active";
import { type ProfileResult, listReadableCustomers, readCustomerProfile } from "./customers";
import { type FactsResult, readCustomerFacts } from "./facts";

export type { CustomerProfile, MaskedValue, ProfileResult } from "./customers";
export type { CustomerFact, FactsResult, JsonValue } from "./facts";

/** A customer's profile with each sensitive field masked by the viewer's permissions. */
export function getCustomerProfile(actorId: string, customerId: string): ProfileResult {
  return readCustomerProfile(getDb(), getActivePolicy(), actorId, customerId);
}

export function listCustomers(actorId: string) {
  return listReadableCustomers(getDb(), getActivePolicy(), actorId);
}

/** Facts published by any tool, filtered by the viewer's permissions. */
export function getCustomerFacts(actorId: string, customerId: string, options?: { namespace?: string }): FactsResult {
  return readCustomerFacts(getDb(), getActivePolicy(), actorId, customerId, options);
}
