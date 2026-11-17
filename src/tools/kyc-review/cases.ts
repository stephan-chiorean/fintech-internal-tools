import { getCustomerProfile, listToolRecords, type ToolRecord } from "@/foundation/data";
import { CASE, type CaseData, TOOL } from "./records";

export const caseData = (record: ToolRecord) => (record.data ?? {}) as unknown as CaseData;
export const caseStatus = (record: ToolRecord) => String(record.attrs.status ?? "pending");
export const claimedBy = (record: ToolRecord) => (typeof record.attrs.claimedBy === "string" ? record.attrs.claimedBy : null);
export const caseHref = (key: string) => `/kyc-review/${encodeURIComponent(key)}`;

/** The KYC cases the viewer may read, newest first. */
export function listCases(viewerId: string) {
  const result = listToolRecords(viewerId, TOOL, { kind: CASE });
  return { ...result, records: [...result.records].sort((a, b) => b.openedAt.localeCompare(a.openedAt)) };
}

/** The customer's name as the shared profile shows it to the viewer. */
export function customerName(viewerId: string, customerId: string | null): string {
  if (!customerId) return "—";
  const profile = getCustomerProfile(viewerId, customerId);
  return profile.ok ? profile.profile.name : customerId;
}
