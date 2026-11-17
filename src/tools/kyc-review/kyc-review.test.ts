import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import { getCustomerFacts, getCustomerProfile, getRecordHistory, getToolRecord, listToolRecords } from "@/foundation/data";
import { runAction } from "@/foundation/pipeline";
import { auditCount, freshDb, withExtraGrants } from "@/foundation/testing";
import { CASE, SEED_CASES, TOOL } from "./records";
import "./records";

const ref = (key: string) => ({ kind: CASE, key });
const claim = (actorId: string, key: string) => runAction(actorId, "kyc-review.claim-case", { key });
const decide = (actorId: string, key: string, decision: "approve" | "reject", reason = `${decision} by ${actorId}`) =>
  runAction(actorId, "kyc-review.decide-case", { key, decision, reason });
const escalate = (actorId: string, key: string, reason = "Name on ID doesn't match") =>
  runAction(actorId, "kyc-review.escalate-case", { key, reason });
const decideEscalated = (actorId: string, key: string, decision: "approve" | "reject", reason = `${decision} by ${actorId}`) =>
  runAction(actorId, "kyc-review.decide-escalated-case", { key, decision, reason });
const open = (actorId: string, key: string, customerId: string) =>
  runAction(actorId, "kyc-review.open-case", { key, customerId, note: `opened by ${actorId}` });

const stored = (key: string) => {
  const result = getToolRecord("avery", TOOL, ref(key));
  if (!result.ok) throw new Error(result.decision.reasons[0]);
  return result.record;
};
const kycStatus = (customerId: string) => {
  const result = getCustomerProfile("avery", customerId);
  if (!result.ok) throw new Error(result.decision.reasons[0]);
  return result.profile.kycStatus;
};
const kycFacts = (viewerId: string, customerId: string) => {
  const result = getCustomerFacts(viewerId, customerId, { namespace: TOOL });
  return result.facts.map((f) => f.value);
};

// Jamie isn't a KYC reviewer. This makes her one, so the opener guardrail is what stops her.
const JAMIE_AS_REVIEWER = [{ id: "t-jamie-kyc-reviewer", to: { user: "jamie" }, role: "kyc-reviewer", description: "test" }];

describe("KYC review", () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  it("seeds pending cases through the pipeline as the system", () => {
    const { records } = listToolRecords("riley", TOOL, { kind: CASE, status: "pending" });
    expect(records.map((r) => r.key).sort()).toEqual(SEED_CASES.map((c) => c.key).sort());
    expect(records.every((r) => r.openedBy === "system")).toBe(true);
    expect(db.prepare("SELECT outcome, actor_id AS actor FROM audit WHERE tool = 'kyc-review'").all()).toEqual(
      SEED_CASES.map(() => ({ outcome: "seeded", actor: "system" })),
    );
  });

  it("Riley claims and approves a case, which publishes the customer's KYC status", () => {
    expect(claim("riley", "kyc-1001").outcome).toBe("executed");
    expect(stored("kyc-1001").attrs).toEqual({ status: "claimed", claimedBy: "riley" });

    const approved = decide("riley", "kyc-1001", "approve", "Passport matches the application");
    expect(approved.outcome).toBe("executed");
    expect(approved.result).toMatchObject({ status: "approved", kycStatus: "verified" });
    expect(stored("kyc-1001").attrs.status).toBe("approved");
    expect(stored("kyc-1001").data).toMatchObject({ decision: "approve", decisionReason: "Passport matches the application", decidedBy: "riley" });
    expect(kycStatus("cust_1002")).toBe("verified");
    // Other tools read the decision through the shared facts API (Morgan: compliance).
    expect(kycFacts("morgan", "cust_1002")).toEqual([{ kycStatus: "verified", caseKey: "kyc-1001", decidedBy: "riley" }]);
  });

  it("requires a reason to decide or escalate", () => {
    claim("riley", "kyc-1001");
    const invalid = [
      runAction("riley", "kyc-review.decide-case", { key: "kyc-1001", decision: "approve", reason: " " }),
      runAction("riley", "kyc-review.escalate-case", { key: "kyc-1001" }),
      runAction("riley", "kyc-review.decide-case", { key: "kyc-1001", decision: "maybe", reason: "x" }),
    ];
    for (const result of invalid) {
      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("invalid input");
    }
    expect(stored("kyc-1001").attrs.status).toBe("claimed");
  });

  it("only the analyst who claimed a case decides or escalates it, and only once", () => {
    claim("riley", "kyc-1001");
    expect(claim("avery", "kyc-1001").outcome).toBe("denied");
    expect(decide("avery", "kyc-1001", "approve").outcome).toBe("denied");
    expect(escalate("avery", "kyc-1001").outcome).toBe("denied");
    expect(decide("riley", "kyc-1002", "approve").outcome).toBe("denied"); // pending, nobody claimed it
    expect(decide("riley", "kyc-1001", "reject").outcome).toBe("executed");
    expect(decide("riley", "kyc-1001", "approve").outcome).toBe("denied");
    expect(kycStatus("cust_1002")).toBe("rejected");
  });

  it("Riley escalates a case and Avery decides it", () => {
    claim("riley", "kyc-1002");
    expect(escalate("riley", "kyc-1002").outcome).toBe("executed");
    expect(stored("kyc-1002").attrs).toEqual({ status: "escalated", claimedBy: "riley" });

    expect(decide("riley", "kyc-1002", "approve").outcome).toBe("denied");
    expect(decideEscalated("riley", "kyc-1002", "approve").outcome).toBe("denied");
    expect(decideEscalated("morgan", "kyc-1002", "approve").outcome).toBe("denied"); // compliance only

    const decided = decideEscalated("avery", "kyc-1002", "reject", "Address doesn't exist");
    expect(decided.outcome).toBe("executed");
    expect(stored("kyc-1002").attrs.status).toBe("rejected");
    expect(stored("kyc-1002").data).toMatchObject({ decision: "reject", decisionReason: "Address doesn't exist", decidedBy: "avery" });
    expect(kycStatus("cust_1004")).toBe("rejected");
    // Fraud (another tool's users) reads the published status for this high-risk customer.
    expect(kycFacts("jamie", "cust_1004")).toEqual([{ kycStatus: "rejected", caseKey: "kyc-1002", decidedBy: "avery" }]);
  });

  it("escalated cases go only to people in both compliance and kyc-review", () => {
    claim("riley", "kyc-1002");
    escalate("riley", "kyc-1002");
    const avery = decideEscalated("avery", "kyc-1002", "approve");
    expect(avery.reasons.join("\n")).toContain("kyc-escalation-deciders");
    // Avery claimed it herself: she can't also decide her own escalation.
    claim("avery", "kyc-1003");
    escalate("avery", "kyc-1003");
    expect(decideEscalated("avery", "kyc-1003", "approve").outcome).toBe("denied");
  });

  it("Jamie can't decide the case Jamie opened", () => {
    expect(open("jamie", "kyc-jamie", "cust_1004").outcome).toBe("executed");
    expect(stored("kyc-jamie").openedBy).toBe("jamie");
    withExtraGrants(db, JAMIE_AS_REVIEWER);

    expect(claim("jamie", "kyc-jamie").outcome).toBe("executed");
    for (const decision of ["approve", "reject"] as const) {
      const result = decide("jamie", "kyc-jamie", decision);
      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("no-deciding-own-record");
    }
    expect(stored("kyc-jamie").attrs.status).toBe("claimed");
    expect(kycStatus("cust_1004")).toBe("pending");
    // The same reviewer grant lets her decide a case someone else opened.
    claim("jamie", "kyc-1001");
    expect(decide("jamie", "kyc-1001", "approve").outcome).toBe("executed");
  });

  it("Jordan can't see the queue or work it", () => {
    const list = listToolRecords("jordan", TOOL, { kind: CASE });
    expect(list.records).toEqual([]);
    expect(list.withheld.count).toBe(SEED_CASES.length);
    expect(getToolRecord("jordan", TOOL, ref("kyc-1001")).ok).toBe(false);
    expect(getRecordHistory("jordan", TOOL, ref("kyc-1001")).ok).toBe(false);
    expect(claim("jordan", "kyc-1001").outcome).toBe("denied");
    expect(open("jordan", "kyc-jordan", "cust_1001").outcome).toBe("denied");
    // Morgan (compliance only) doesn't see the queue either.
    expect(listToolRecords("morgan", TOOL, { kind: CASE }).records).toEqual([]);
  });

  it("Riley and Morgan see a case customer's PII differently, as the foundation masks it", () => {
    const riley = getCustomerProfile("riley", "cust_1002");
    const morgan = getCustomerProfile("morgan", "cust_1002");
    if (!riley.ok || !morgan.ok) throw new Error("expected both to read the profile");
    expect(riley.profile.fields.ssn).toMatchObject({ level: "full", value: "902-34-7710" });
    expect(morgan.profile.fields.ssn.level).not.toBe("full");
    expect(morgan.profile.fields.ssn.value).not.toBe("902-34-7710");
    const levels = (p: typeof riley.profile) => Object.values(p.fields).map((f) => f.level);
    expect(levels(riley.profile)).not.toEqual(levels(morgan.profile));

    // Riley's full SSN is only for pending customers: approving the case masks it.
    claim("riley", "kyc-1001");
    decide("riley", "kyc-1001", "approve");
    const after = getCustomerProfile("riley", "cust_1002");
    expect(after.ok && after.profile.fields.ssn.level).toBe("last4");
  });

  it("records the complete history of a case, each entry linked to its audit row", () => {
    claim("riley", "kyc-1002");
    claim("avery", "kyc-1002");
    escalate("riley", "kyc-1002", "Selfie doesn't match ID");
    decideEscalated("riley", "kyc-1002", "approve");
    decideEscalated("avery", "kyc-1002", "approve", "Second ID confirms identity");

    const history = getRecordHistory("riley", TOOL, ref("kyc-1002"));
    if (!history.ok) throw new Error(history.decision.reasons[0]);
    expect(history.entries.map((e) => [e.event, e.actorId, e.actionId, e.attrs.status])).toEqual([
      ["created", "system", "kyc-review.open-case", "pending"],
      ["updated", "riley", "kyc-review.claim-case", "claimed"],
      ["denied", "avery", "kyc-review.claim-case", "claimed"],
      ["updated", "riley", "kyc-review.escalate-case", "escalated"],
      ["denied", "riley", "kyc-review.decide-escalated-case", "escalated"],
      ["updated", "avery", "kyc-review.decide-escalated-case", "approved"],
    ]);
    expect(history.entries.map((e) => e.version)).toEqual([1, 2, 2, 3, 3, 4]);
    expect(history.entries[3].reasons).toContain("Escalated: Selfie doesn't match ID");
    expect(history.entries[5].reasons).toContain("Approved: Second ID confirms identity");
    expect(history.entries[5].data).toMatchObject({ escalationReason: "Selfie doesn't match ID", decidedBy: "avery" });

    const audit = db.prepare("SELECT id, actor_id AS actorId, action_id AS actionId FROM audit WHERE id = ?");
    for (const entry of history.entries) {
      expect(audit.get(entry.auditId)).toEqual({ id: entry.auditId, actorId: entry.actorId, actionId: entry.actionId });
    }
    expect(auditCount(db)).toBeGreaterThanOrEqual(history.entries.length);
  });
});
