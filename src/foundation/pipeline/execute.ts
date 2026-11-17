import type { Database } from "better-sqlite3";
import { appendAudit, type AuditOutcome } from "@/foundation/audit/log";
import {
  KYC_STATUSES,
  type KycStatus,
  customerResource,
  loadCustomer,
  readCustomerProfile,
  updateKycStatus,
} from "@/foundation/data/customers";
import { insertFact } from "@/foundation/data/facts";
import {
  type HistoryEvent,
  RESERVED_ATTRS,
  type ToolRecord,
  appendHistory,
  getRecordKind,
  insertRecord,
  loadRecord,
  recordId,
  recordResource,
  updateRecordRow,
  validateRecordAttrs,
} from "@/foundation/data/records";
import type { Actor, Resource } from "@/foundation/permissions";
import { checkPermission } from "@/foundation/permissions/resolver";
import type { AttrValue, Policy } from "@/foundation/policy/types";
import type { ActionContext, ActionDefinition, JsonValue } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Def = ActionDefinition<any, JsonValue | void>;

/** Thrown inside the transaction to turn the call into a denial instead of a failure. */
export class PipelineDenial extends Error {}

/** A record the pipeline will create, exactly as permission checks saw it. */
export interface PreparedRecord {
  tool: string;
  kind: string;
  key: string;
  productArea: string | null;
  customerId: string | null;
  attrs: Record<string, AttrValue>;
  data: JsonValue;
}

export interface ResolvedResource {
  resource: Resource;
  customerId: string | null;
  /** The existing record the action targets. */
  record: ToolRecord | null;
  /** The record the action creates. */
  newRecord: PreparedRecord | null;
}

export type BuiltResource = ({ ok: true } & ResolvedResource) | { ok: false; reason: string };

function withoutReserved(attrs: Record<string, AttrValue>, alsoReserved: string[] = []): Record<string, AttrValue> {
  const reserved = new Set<string>([...RESERVED_ATTRS, ...alsoReserved]);
  return Object.fromEntries(Object.entries(attrs).filter(([name]) => !reserved.has(name)));
}

/** The existing record an action targets, if any. Never throws. */
export function targetRecord(db: Database, def: Def, input: unknown): ToolRecord | null {
  try {
    const ref = def.record?.(input);
    return ref ? loadRecord(db, def.tool, ref.kind, ref.key) : null;
  } catch {
    return null;
  }
}

/**
 * Builds the permission resource from stored data. Customer and record data
 * (product area, declared attributes, opener) always come from the database;
 * the action's own `attributes` can only add names nothing else defines.
 */
export function buildResource(
  db: Database,
  def: Def,
  input: unknown,
  extra: Resource["attrs"] = {},
  actorId?: string,
): BuiltResource {
  const actionAttrs = def.attributes?.(input) ?? {};

  if (def.record) {
    const ref = def.record(input);
    const record = loadRecord(db, def.tool, ref.kind, ref.key);
    if (!record) return { ok: false, reason: `record ${recordId(def.tool, ref.kind, ref.key)} does not exist` };
    const base = recordResource(db, record);
    return {
      ok: true,
      resource: { ...base, attrs: { ...withoutReserved(actionAttrs), ...base.attrs, ...extra } },
      customerId: record.customerId,
      record,
      newRecord: null,
    };
  }

  if (def.newRecord) {
    const proposal = def.newRecord(input);
    const kind = getRecordKind(def.tool, proposal.kind);
    if (!kind) return { ok: false, reason: `record kind ${def.tool}/${proposal.kind} is not registered` };
    const attrs = proposal.attrs ?? {};
    try {
      validateRecordAttrs(kind, attrs);
    } catch (error) {
      return { ok: false, reason: errorMessage(error) };
    }
    if (loadRecord(db, def.tool, proposal.kind, proposal.key)) {
      return { ok: false, reason: `record ${recordId(def.tool, proposal.kind, proposal.key)} already exists` };
    }
    let productArea = proposal.productArea ?? null;
    if (proposal.customerId) {
      const customer = loadCustomer(db, proposal.customerId);
      if (!customer) return { ok: false, reason: `customer "${proposal.customerId}" does not exist` };
      if (productArea && productArea !== customer.product_area) {
        return { ok: false, reason: `product area ${productArea} does not match customer ${customer.id} (${customer.product_area})` };
      }
      productArea = customer.product_area;
    }
    const prepared: PreparedRecord = {
      tool: def.tool,
      kind: proposal.kind,
      key: proposal.key,
      productArea,
      customerId: proposal.customerId ?? null,
      attrs,
      data: proposal.data ?? null,
    };
    const now = new Date().toISOString();
    const base = recordResource(db, {
      ...prepared,
      id: recordId(def.tool, prepared.kind, prepared.key),
      version: 0,
      openedBy: (typeof extra.requestedBy === "string" ? extra.requestedBy : actorId) ?? "",
      openedAt: now,
      updatedAt: now,
    });
    return {
      ok: true,
      resource: { ...base, attrs: { ...withoutReserved(actionAttrs), ...base.attrs, ...extra } },
      customerId: prepared.customerId,
      record: null,
      newRecord: prepared,
    };
  }

  const customerId = def.customerId?.(input);
  if (!customerId) {
    return { ok: true, resource: { attrs: { ...withoutReserved(actionAttrs), ...extra } }, customerId: null, record: null, newRecord: null };
  }
  const row = loadCustomer(db, customerId);
  if (!row) return { ok: false, reason: `customer "${customerId}" does not exist` };
  const base = customerResource(row);
  return {
    ok: true,
    resource: { ...base, attrs: { ...withoutReserved(actionAttrs), ...base.attrs, ...extra } },
    customerId,
    record: null,
    newRecord: null,
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface PendingHistory {
  event: HistoryEvent;
  record: ToolRecord;
  reasons: string[];
}

function makeContext(
  db: Database,
  policy: Policy,
  def: Def,
  actor: Actor,
  approvalId: string | null,
  built: ResolvedResource,
  target: { record: ToolRecord | null },
  history: PendingHistory[],
): ActionContext {
  return {
    actor,
    actionId: def.id,
    tool: def.tool,
    approvalId,
    get record() {
      return target.record;
    },
    updateRecord: (change) => {
      if (!target.record) throw new Error(`${def.id} has no target record to update`);
      const kind = getRecordKind(target.record.tool, target.record.kind);
      if (!kind) throw new Error(`record kind ${target.record.tool}/${target.record.kind} is not registered`);
      validateRecordAttrs(kind, change.attrs ?? {});
      target.record = updateRecordRow(db, target.record, change);
      history.push({ event: "updated", record: target.record, reasons: change.note ? [change.note] : [] });
      return target.record;
    },
    publishFact: (customerId, key, value) =>
      insertFact(db, { customerId, namespace: def.tool, key, value, publishedBy: actor.id, auditActionId: def.id }),
    getCustomerProfile: (customerId) => readCustomerProfile(db, policy, actor.id, customerId),
    setCustomerKycStatus: (status: KycStatus) => {
      if (!built.customerId) throw new Error(`${def.id} has no customer to update`);
      if (!KYC_STATUSES.includes(status)) throw new Error(`unknown KYC status "${status}"`);
      const decision = checkPermission(db, policy, {
        actorId: actor.id,
        permission: "customer.kycStatus.update",
        resource: built.resource,
      });
      if (decision.effect !== "allow") throw new PipelineDenial(decision.reasons[0]);
      updateKycStatus(db, built.customerId, status);
    },
  };
}

export type ExecutionResult =
  | { status: "done"; auditId: number; result: JsonValue | void }
  | { status: "denied" | "failed"; auditId: number; error: string };

/**
 * Runs the action, its audit row and its record history in one transaction. If
 * anything throws, the transaction rolls back and a single denied/failed audit
 * row (plus a history entry for an existing target record) is written instead.
 */
export function executeWithAudit(
  db: Database,
  policy: Policy,
  args: {
    def: Def;
    /** The user the action runs as (the requester, for approved requests). */
    actor: Actor;
    /** The user who made this call, if not `actor` (the approver). */
    auditActorId?: string;
    input: unknown;
    built: ResolvedResource;
    approvalId: string | null;
    outcome: AuditOutcome;
    reasons: string[];
    /** Runs first inside the transaction, e.g. to consume an approval. */
    before?: () => void;
    /** A lifecycle event to record on the target record before its changes, e.g. "approved". */
    historyEvent?: HistoryEvent;
    /** The history event recorded when the call is denied inside the transaction. */
    deniedEvent?: HistoryEvent;
  },
): ExecutionResult {
  const { def, actor, input, built, approvalId, outcome, reasons } = args;
  const callerId = args.auditActorId ?? actor.id;
  const onBehalfOf = callerId === actor.id ? null : actor.id;
  const audit = { actorId: callerId, actionId: def.id, tool: def.tool, customerId: built.customerId, approvalId, input };
  const writeHistory = (entries: PendingHistory[], auditId: number) => {
    for (const entry of entries) {
      appendHistory(db, { ...entry, actorId: callerId, onBehalfOf, actionId: def.id, approvalId, auditId });
    }
  };
  try {
    return db.transaction((): ExecutionResult => {
      args.before?.();
      const history: PendingHistory[] = [];
      const target = { record: built.record ? loadRecord(db, built.record.tool, built.record.kind, built.record.key) : null };
      if (built.newRecord) {
        target.record = insertRecord(db, { ...built.newRecord, openedBy: actor.id });
        history.push({ event: "created", record: target.record, reasons });
      }
      if (args.historyEvent && target.record) history.push({ event: args.historyEvent, record: target.record, reasons });
      const result = def.execute(makeContext(db, policy, def, actor, approvalId, built, target, history), input);
      const auditId = appendAudit(db, { ...audit, outcome, reasons, result });
      writeHistory(history, auditId);
      return { status: "done", auditId, result };
    })();
  } catch (error) {
    const denied = error instanceof PipelineDenial;
    const message = errorMessage(error);
    const failureReasons = [denied ? `Denied: ${message}` : `Failed: ${message}`, ...reasons];
    return db.transaction((): ExecutionResult => {
      const auditId = appendAudit(db, { ...audit, outcome: denied ? "denied" : "failed", reasons: failureReasons });
      const record = built.record ? loadRecord(db, built.record.tool, built.record.kind, built.record.key) : null;
      if (record) {
        writeHistory([{ event: denied ? (args.deniedEvent ?? "denied") : "failed", record, reasons: failureReasons }], auditId);
      }
      return { status: denied ? "denied" : "failed", auditId, error: message };
    })();
  }
}
