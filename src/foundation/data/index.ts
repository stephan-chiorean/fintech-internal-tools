import { getDb } from "@/foundation/db";
import { getActivePolicy } from "@/foundation/policy/active";
import { type ProfileResult, listReadableCustomers, readCustomerProfile } from "./customers";
import { type FactsResult, readCustomerFacts } from "./facts";
import { type RecordRef, readRecord, readRecordHistory, readRecords } from "./records";

export type { CustomerProfile, KycStatus, MaskedValue, ProfileResult } from "./customers";
export { KYC_STATUSES } from "./customers";
export type { CustomerFact, FactsResult, JsonValue } from "./facts";
export { defineRecordKind } from "./records";
export type {
  HistoryEvent,
  HistoryReadResult,
  RecordAttrType,
  RecordHistoryEntry,
  RecordKindDefinition,
  RecordListResult,
  RecordReadResult,
  RecordRef,
  ToolRecord,
} from "./records";

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

/** A tool's records the viewer may read (the kind's read permission on each record's stored data). */
export function listToolRecords(actorId: string, tool: string, options?: { kind?: string; status?: string }) {
  return readRecords(getDb(), getActivePolicy(), actorId, tool, options);
}

export function getToolRecord(actorId: string, tool: string, ref: RecordRef) {
  return readRecord(getDb(), getActivePolicy(), actorId, tool, ref);
}

/** A record's full history: every change and every request, decision and refusal about it. */
export function getRecordHistory(actorId: string, tool: string, ref: RecordRef) {
  return readRecordHistory(getDb(), getActivePolicy(), actorId, tool, ref);
}
