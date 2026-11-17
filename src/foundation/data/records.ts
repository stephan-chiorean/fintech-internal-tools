import type { Database } from "better-sqlite3";
import { getActivePolicy } from "@/foundation/policy/active";
import type { AttrValue, Policy } from "@/foundation/policy/types";
import { type Decision, type Resource, checkPermission } from "@/foundation/permissions/resolver";
import { customerResource, loadCustomer } from "./customers";
import type { JsonValue } from "./facts";

export type RecordAttrType = "string" | "number" | "boolean";

/** A kind of record a tool owns, e.g. feature-flags/flag. */
export interface RecordKindDefinition {
  tool: string;
  kind: string;
  description: string;
  /** Permission from the policy config needed to read records of this kind and their history. */
  readPermission: string;
  /** The attributes permission conditions may read. Only these can be stored, and all are loaded from storage. */
  attributes: Record<string, RecordAttrType>;
}

/** Attributes the foundation sets from stored data. Tools and action input can never set them. */
export const RESERVED_ATTRS = [
  "recordKind",
  "recordKey",
  "openedBy",
  "productArea",
  "customerId",
  "kycStatus",
  "riskLevel",
  "requestedBy",
  "namespace",
  "field",
] as const;

export interface RecordRef {
  kind: string;
  key: string;
}

export interface ToolRecord {
  id: string;
  tool: string;
  kind: string;
  key: string;
  productArea: string | null;
  customerId: string | null;
  attrs: Record<string, AttrValue>;
  data: JsonValue;
  version: number;
  openedBy: string;
  openedAt: string;
  updatedAt: string;
}

export type HistoryEvent =
  | "created"
  | "updated"
  | "approval-requested"
  | "approved"
  | "rejected"
  | "decision-refused"
  | "denied"
  | "failed";

export interface RecordHistoryEntry {
  id: number;
  recordId: string;
  at: string;
  event: HistoryEvent;
  /** Who made the call (the approver, for decisions). */
  actorId: string;
  /** The requester an approved action ran as. */
  onBehalfOf: string | null;
  actionId: string;
  approvalId: string | null;
  auditId: number;
  /** The record's version, attributes and data after this event. */
  version: number;
  attrs: Record<string, AttrValue>;
  data: JsonValue;
  reasons: string[];
}

const globalForKinds = globalThis as unknown as { __fitRecordKinds?: Map<string, RecordKindDefinition> };
const kinds = (globalForKinds.__fitRecordKinds ??= new Map());

const kindId = (tool: string, kind: string) => `${tool}/${kind}`;

/** Registers a record kind. Re-registering replaces it (hot reload). */
export function defineRecordKind(def: RecordKindDefinition): RecordKindDefinition {
  if (!getActivePolicy().permissions[def.readPermission]) {
    throw new Error(`Record kind ${kindId(def.tool, def.kind)} uses read permission ${def.readPermission}, which is not in the policy config`);
  }
  for (const name of Object.keys(def.attributes)) {
    if ((RESERVED_ATTRS as readonly string[]).includes(name)) {
      throw new Error(`Record kind ${kindId(def.tool, def.kind)}: attribute ${name} is reserved for the foundation`);
    }
  }
  kinds.set(kindId(def.tool, def.kind), def);
  return def;
}

export function getRecordKind(tool: string, kind: string): RecordKindDefinition | undefined {
  return kinds.get(kindId(tool, kind));
}

export const recordId = (tool: string, kind: string, key: string) => `${tool}/${kind}/${key}`;

interface RecordRow {
  id: string;
  tool: string;
  kind: string;
  key: string;
  product_area: string | null;
  customer_id: string | null;
  attrs: string;
  data: string;
  version: number;
  opened_by: string;
  opened_at: string;
  updated_at: string;
}

function toRecord(row: RecordRow): ToolRecord {
  return {
    id: row.id,
    tool: row.tool,
    kind: row.kind,
    key: row.key,
    productArea: row.product_area,
    customerId: row.customer_id,
    attrs: JSON.parse(row.attrs),
    data: JSON.parse(row.data),
    version: row.version,
    openedBy: row.opened_by,
    openedAt: row.opened_at,
    updatedAt: row.updated_at,
  };
}

export function loadRecord(db: Database, tool: string, kind: string, key: string): ToolRecord | null {
  const row = db.prepare("SELECT * FROM tool_records WHERE id = ?").get(recordId(tool, kind, key)) as RecordRow | undefined;
  return row ? toRecord(row) : null;
}

/** Throws unless every attribute is declared by the kind and has the declared type (or is null). */
export function validateRecordAttrs(def: RecordKindDefinition, attrs: Record<string, AttrValue>): void {
  for (const [name, value] of Object.entries(attrs)) {
    const type = def.attributes[name];
    if (!type) throw new Error(`attribute ${name} is not declared by record kind ${kindId(def.tool, def.kind)}`);
    if (value !== null && typeof value !== type) throw new Error(`attribute ${name} must be a ${type}`);
  }
}

/** Inserts a record. Only the action pipeline calls this, inside its transaction. */
export function insertRecord(
  db: Database,
  record: {
    tool: string;
    kind: string;
    key: string;
    productArea: string | null;
    customerId: string | null;
    attrs: Record<string, AttrValue>;
    data: JsonValue;
    openedBy: string;
  },
): ToolRecord {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tool_records (id, tool, kind, key, product_area, customer_id, attrs, data, version, opened_by, opened_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).run(
    recordId(record.tool, record.kind, record.key),
    record.tool,
    record.kind,
    record.key,
    record.productArea,
    record.customerId,
    JSON.stringify(record.attrs),
    JSON.stringify(record.data ?? null),
    record.openedBy,
    now,
    now,
  );
  return loadRecord(db, record.tool, record.kind, record.key)!;
}

/** Merges attributes and replaces data (if given). Only the action pipeline calls this. */
export function updateRecordRow(
  db: Database,
  record: ToolRecord,
  change: { attrs?: Record<string, AttrValue>; data?: JsonValue },
): ToolRecord {
  const attrs = { ...record.attrs, ...change.attrs };
  const data = change.data === undefined ? record.data : change.data;
  db.prepare("UPDATE tool_records SET attrs = ?, data = ?, version = version + 1, updated_at = ? WHERE id = ?").run(
    JSON.stringify(attrs),
    JSON.stringify(data ?? null),
    new Date().toISOString(),
    record.id,
  );
  return loadRecord(db, record.tool, record.kind, record.key)!;
}

/** Appends one history row. The table rejects updates and deletes with triggers. */
export function appendHistory(
  db: Database,
  entry: {
    record: ToolRecord;
    event: HistoryEvent;
    actorId: string;
    onBehalfOf?: string | null;
    actionId: string;
    approvalId?: string | null;
    auditId: number;
    reasons?: string[];
  },
): number {
  const result = db
    .prepare(
      `INSERT INTO record_history (record_id, at, event, actor_id, on_behalf_of, action_id, approval_id, audit_id, version, attrs, data, reasons)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.record.id,
      new Date().toISOString(),
      entry.event,
      entry.actorId,
      entry.onBehalfOf ?? null,
      entry.actionId,
      entry.approvalId ?? null,
      entry.auditId,
      entry.record.version,
      JSON.stringify(entry.record.attrs),
      JSON.stringify(entry.record.data ?? null),
      JSON.stringify(entry.reasons ?? []),
    );
  return Number(result.lastInsertRowid);
}

/**
 * The permission resource for a record, built only from stored data: the kind's
 * declared attributes (null when unset), the record's identity and opener, and
 * its customer's data when it belongs to one.
 */
export function recordResource(db: Database, record: ToolRecord): Resource {
  const def = getRecordKind(record.tool, record.kind);
  const declared = Object.fromEntries(Object.keys(def?.attributes ?? {}).map((name) => [name, null]));
  const customer = record.customerId ? loadCustomer(db, record.customerId) : null;
  const base: Resource = customer ? customerResource(customer) : { attrs: {} };
  return {
    customerId: customer?.id,
    productArea: record.productArea ?? undefined,
    attrs: {
      ...declared,
      ...record.attrs,
      ...base.attrs,
      productArea: record.productArea,
      recordKind: record.kind,
      recordKey: record.key,
      openedBy: record.openedBy,
    },
  };
}

export type RecordReadResult = { ok: true; record: ToolRecord; decision: Decision } | { ok: false; decision: Decision };

const denial = (actorId: string, permission: string, reason: string): Decision => ({
  effect: "deny",
  actorId,
  permission,
  reasons: [`Denied: ${reason}.`],
  matchedGrants: [],
});

/** Checks the kind's read permission (and customer.read for a customer's record) on stored data. */
function checkRead(db: Database, policy: Policy, actorId: string, record: ToolRecord): Decision {
  const def = getRecordKind(record.tool, record.kind);
  if (!def) return denial(actorId, "unknown", `record kind ${kindId(record.tool, record.kind)} is not registered`);
  const resource = recordResource(db, record);
  if (record.customerId) {
    const customer = checkPermission(db, policy, { actorId, permission: "customer.read", resource });
    if (customer.effect !== "allow") return customer;
  }
  const decision = checkPermission(db, policy, { actorId, permission: def.readPermission, resource });
  return decision.effect === "allow" ? decision : { ...decision, effect: "deny" };
}

export function readRecord(db: Database, policy: Policy, actorId: string, tool: string, ref: RecordRef): RecordReadResult {
  const record = loadRecord(db, tool, ref.kind, ref.key);
  if (!record) return { ok: false, decision: denial(actorId, "unknown", `record ${recordId(tool, ref.kind, ref.key)} does not exist`) };
  const decision = checkRead(db, policy, actorId, record);
  return decision.effect === "allow" ? { ok: true, record, decision } : { ok: false, decision };
}

export interface RecordListResult {
  records: ToolRecord[];
  /** How many matching records the viewer may not read, with one example decision. */
  withheld: { count: number; decision: Decision | null };
}

export function readRecords(
  db: Database,
  policy: Policy,
  actorId: string,
  tool: string,
  options: { kind?: string; status?: string } = {},
): RecordListResult {
  const rows = db
    .prepare(
      `SELECT * FROM tool_records WHERE tool = ? AND (? IS NULL OR kind = ?)
         AND (? IS NULL OR json_extract(attrs, '$.status') = ?) ORDER BY kind, key`,
    )
    .all(tool, options.kind ?? null, options.kind ?? null, options.status ?? null, options.status ?? null) as RecordRow[];
  const records: ToolRecord[] = [];
  const withheld: RecordListResult["withheld"] = { count: 0, decision: null };
  for (const record of rows.map(toRecord)) {
    const decision = checkRead(db, policy, actorId, record);
    if (decision.effect === "allow") records.push(record);
    else {
      withheld.count += 1;
      withheld.decision ??= decision;
    }
  }
  return { records, withheld };
}

interface HistoryRow {
  id: number;
  record_id: string;
  at: string;
  event: HistoryEvent;
  actor_id: string;
  on_behalf_of: string | null;
  action_id: string;
  approval_id: string | null;
  audit_id: number;
  version: number;
  attrs: string;
  data: string;
  reasons: string;
}

export function loadHistory(db: Database, id: string): RecordHistoryEntry[] {
  const rows = db.prepare("SELECT * FROM record_history WHERE record_id = ? ORDER BY id").all(id) as HistoryRow[];
  return rows.map((row) => ({
    id: row.id,
    recordId: row.record_id,
    at: row.at,
    event: row.event,
    actorId: row.actor_id,
    onBehalfOf: row.on_behalf_of,
    actionId: row.action_id,
    approvalId: row.approval_id,
    auditId: row.audit_id,
    version: row.version,
    attrs: JSON.parse(row.attrs),
    data: JSON.parse(row.data),
    reasons: JSON.parse(row.reasons),
  }));
}

export type HistoryReadResult =
  | { ok: true; record: ToolRecord; entries: RecordHistoryEntry[]; decision: Decision }
  | { ok: false; decision: Decision };

/** A record's history, oldest first. Needs the same read permission as the record. */
export function readRecordHistory(db: Database, policy: Policy, actorId: string, tool: string, ref: RecordRef): HistoryReadResult {
  const result = readRecord(db, policy, actorId, tool, ref);
  if (!result.ok) return result;
  return { ok: true, record: result.record, entries: loadHistory(db, result.record.id), decision: result.decision };
}
