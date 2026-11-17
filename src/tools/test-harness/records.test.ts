import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import { decideApproval, listApprovals } from "@/foundation/approvals";
import { getCustomerProfile, getRecordHistory, getToolRecord, listToolRecords } from "@/foundation/data";
import { getEffectiveGrants } from "@/foundation/permissions";
import { defineAction, runAction } from "@/foundation/pipeline";
import { auditCount, freshDb, withExtraGrants } from "@/foundation/testing";
import type { GrantDefinition } from "@/foundation/policy/types";
import "./action";
import "./records";

const CASE_GRANTS: GrantDefinition<string>[] = [
  { id: "t-payments-case-workers", to: { team: "payments-eng" }, role: "test-harness-case-worker", scope: { productArea: "payments" }, description: "test" },
  { id: "t-payments-case-approvers", to: { team: "payments-oncall" }, role: "test-harness-case-approver", params: { maxAmountCents: 500_000 }, scope: { productArea: "payments" }, description: "test" },
  { id: "t-case-auditors", to: { allTeams: ["compliance", "kyc-review"] }, role: "test-harness-case-auditor", description: "test" },
  { id: "t-kyc-setters", to: { team: "kyc-review" }, role: "test-harness-kyc-setter", description: "test" },
  { id: "t-t1-kyc-setters", to: { team: "support-t1" }, role: "test-harness-kyc-setter", description: "test" },
];

const ref = (key: string) => ({ kind: "case", key });
const open = (actorId: string, key: string, productArea: string, env: "staging" | "prod", extra: Record<string, unknown> = {}) =>
  runAction(actorId, "test-harness.open-case", { key, productArea, env, amountCents: 1_000, ...extra });
const update = (actorId: string, key: string, amountCents = 2_000) =>
  runAction(actorId, "test-harness.update-case", { key, amountCents, note: `by ${actorId}` });
const events = (key: string) => {
  const history = getRecordHistory("avery", "test-harness", ref(key));
  if (!history.ok) throw new Error(history.decision.reasons[0]);
  return history.entries.map((e) => `${e.event}:${e.actorId}`);
};
const stored = (db: Database, key: string) =>
  JSON.parse((db.prepare("SELECT attrs FROM tool_records WHERE key = ?").get(key) as { attrs: string }).attrs);

// Tries to set trusted attributes from input. The pipeline must ignore all of them.
defineAction({
  id: "test-harness.spoof-case",
  tool: "test-harness",
  title: "Spoof",
  permission: "test-harness.case.update",
  parse: (raw) => raw as { key: string },
  record: (input) => ({ kind: "case", key: input.key }),
  attributes: () => ({ env: "staging", status: "open", productArea: "payments", openedBy: "nobody", claimedBy: "priya", requestedBy: "x" }),
  summarize: () => "spoof",
  execute: () => null,
});
defineAction({
  id: "test-harness.spoof-decide",
  tool: "test-harness",
  title: "Spoof decide",
  permission: "test-harness.case.decide",
  parse: (raw) => raw as { key: string },
  record: (input) => ({ kind: "case", key: input.key }),
  attributes: () => ({ status: "claimed", claimedBy: "priya", openedBy: "system" }),
  summarize: () => "spoof",
  execute: () => null,
});

describe("tool records", () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
    withExtraGrants(db, CASE_GRANTS);
  });

  describe("trusted attributes come from the stored record, never from input", () => {
    it("ignores env, status and opener set by action attributes", () => {
      expect(open("priya", "p1", "payments", "prod").outcome).toBe("executed");
      const result = runAction("priya", "test-harness.spoof-case", { key: "p1" });
      expect(result.outcome).toBe("approval-requested");
      expect(result.reasons.join("\n")).toContain("env prod = staging is false");
    });

    it("ignores a product area set by action attributes", () => {
      withExtraGrants(db, [...CASE_GRANTS, { id: "t-cards", to: { user: "chris" }, role: "test-harness-case-worker", scope: { productArea: "cards" }, description: "test" }]);
      expect(open("chris", "c1", "cards", "staging").outcome).toBe("executed");
      const result = runAction("priya", "test-harness.spoof-case", { key: "c1" });
      expect(result.outcome).toBe("denied");
      expect(result.reasons.join("\n")).toContain("scoped to product area payments, but the resource is in cards");
    });

    it("ignores a claimer set by action attributes when none is stored", () => {
      open("marcus", "p2", "payments", "staging");
      expect(stored(db, "p2").claimedBy).toBeUndefined();
      const result = runAction("priya", "test-harness.spoof-decide", { key: "p2" });
      expect(result.outcome).toBe("denied");
      expect(result.reasons.join("\n")).toContain("status open = claimed is false");
    });

    it("takes a customer's record's product area from the customer", () => {
      const result = open("priya", "p3", "payments", "staging", { customerId: "cust_1002" });
      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("does not match customer cust_1002 (cards)");
    });

    it("denies creating a record that already exists, and records outside the product area", () => {
      open("priya", "p4", "payments", "staging");
      expect(open("priya", "p4", "payments", "staging").reasons[0]).toContain("already exists");
      expect(open("priya", "c2", "cards", "staging").outcome).toBe("denied");
    });

    it("rejects undeclared attributes from the tool", () => {
      defineAction({
        id: "test-harness.bad-attr",
        tool: "test-harness",
        title: "Bad",
        permission: "test-harness.case.update",
        parse: (raw) => raw as { key: string },
        record: (input) => ({ kind: "case", key: input.key }),
        summarize: () => "bad",
        execute: (ctx) => {
          ctx.updateRecord({ attrs: { openedBy: "marcus" } });
          return null;
        },
      });
      open("priya", "p5", "payments", "staging");
      const result = runAction("priya", "test-harness.bad-attr", { key: "p5" });
      expect(result).toMatchObject({ outcome: "failed" });
      expect(result.error).toContain("not declared");
      expect(getToolRecord("priya", "test-harness", ref("p5"))).toMatchObject({ ok: true, record: { openedBy: "priya", version: 1 } });
    });
  });

  describe("history and request lifecycle", () => {
    it("applies a staging change at once and records it", () => {
      open("priya", "s1", "payments", "staging");
      const result = update("priya", "s1", 3_000);
      expect(result.outcome).toBe("executed");
      expect(stored(db, "s1").amountCents).toBe(3_000);
      expect(events("s1")).toEqual(["created:priya", "updated:priya"]);
    });

    it("records request, refused attempts, approval and the change for a prod change", () => {
      open("priya", "q1", "payments", "prod");
      const { approvalId, outcome } = update("priya", "q1", 4_000);
      expect(outcome).toBe("approval-requested");
      expect(stored(db, "q1").amountCents).toBe(1_000);

      const self = decideApproval("priya", approvalId!, "approve");
      expect(self.outcome).toBe("denied");
      expect(decideApproval("alex", approvalId!, "approve").outcome).toBe("denied");
      expect(decideApproval("marcus", approvalId!, "approve").outcome).toBe("approved");
      expect(decideApproval("marcus", approvalId!, "reject").reasons[0]).toContain("already used");
      expect(stored(db, "q1").amountCents).toBe(4_000);

      const history = getRecordHistory("avery", "test-harness", ref("q1"));
      expect(history.ok && history.entries.map((e) => [e.event, e.actorId, e.onBehalfOf])).toEqual([
        ["created", "priya", null],
        ["approval-requested", "priya", null],
        ["decision-refused", "priya", null],
        ["decision-refused", "alex", null],
        ["approved", "marcus", "priya"],
        ["updated", "marcus", "priya"],
        ["decision-refused", "marcus", null],
      ]);
      const entries = history.ok ? history.entries : [];
      expect(entries[2].reasons.join("\n")).toContain("no-self-approval");
      expect(entries.every((e) => typeof e.auditId === "number")).toBe(true);
      expect(new Set(entries.map((e) => e.auditId)).size).toBe(entries.length - 1);
    });

    it("records rejections and denied direct attempts", () => {
      open("priya", "q2", "payments", "prod");
      const { approvalId } = update("priya", "q2");
      expect(decideApproval("marcus", approvalId!, "reject").outcome).toBe("rejected");
      expect(update("riley", "q2").outcome).toBe("denied");
      expect(events("q2")).toEqual(["created:priya", "approval-requested:priya", "rejected:marcus", "denied:riley"]);
    });

    it("keeps history append-only", () => {
      open("priya", "h1", "payments", "staging");
      expect(() => db.prepare("UPDATE record_history SET actor_id = 'x'").run()).toThrow(/append-only/);
      expect(() => db.prepare("DELETE FROM record_history").run()).toThrow(/append-only/);
    });

    it("writes exactly one audit row per call", () => {
      open("priya", "a1", "payments", "prod");
      const before = auditCount(db);
      const { approvalId } = update("priya", "a1");
      decideApproval("priya", approvalId!, "approve");
      decideApproval("marcus", approvalId!, "approve");
      expect(auditCount(db) - before).toBe(3);
    });

    it("names the approver's failed limit in the denial headline", () => {
      // The limit reads the stored amount, not the amount in the request's input.
      open("priya", "l1", "payments", "prod", { amountCents: 600_000 });
      const { approvalId } = update("priya", "l1", 1);
      const result = decideApproval("marcus", approvalId!, "approve");
      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain('Failed limit: amountCents 600000 ≤ maxAmountCents (500000) (grant "t-payments-case-approvers")');
    });
  });

  describe("conditions on the acting user and the opener guardrail", () => {
    it("lets only the claimer decide", () => {
      open("priya", "d1", "payments", "staging");
      expect(runAction("marcus", "test-harness.claim-case", { key: "d1" }).outcome).toBe("executed");
      expect(runAction("priya", "test-harness.claim-case", { key: "d1" }).reasons.join("\n")).toContain("status claimed = open is false");
      const notClaimer = runAction("priya", "test-harness.decide-case", { key: "d1" });
      expect(notClaimer.outcome).toBe("denied");
      expect(notClaimer.reasons.join("\n")).toContain("claimedBy marcus = actor (priya) is false");
      expect(runAction("marcus", "test-harness.decide-case", { key: "d1" }).outcome).toBe("executed");
      expect(stored(db, "d1").status).toBe("decided");
    });

    it("blocks the opener from deciding their own record even as the claimer", () => {
      open("priya", "d2", "payments", "staging");
      runAction("priya", "test-harness.claim-case", { key: "d2" });
      const result = runAction("priya", "test-harness.decide-case", { key: "d2" });
      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain('guardrail "no-deciding-own-record"');
      expect(result.reasons[0]).toContain("Priya Shah is this record's openedBy");
    });
  });

  describe("reads", () => {
    beforeEach(() => {
      open("priya", "r-open", "payments", "staging");
      open("priya", "r-done", "payments", "staging");
      runAction("marcus", "test-harness.claim-case", { key: "r-done" });
      runAction("marcus", "test-harness.decide-case", { key: "r-done" });
    });

    it("scopes reads by record status", () => {
      const priya = listToolRecords("priya", "test-harness", { kind: "case" });
      expect(priya.records.map((r) => r.key)).toEqual(["r-open"]);
      expect(priya.withheld.count).toBe(1);
      expect(priya.withheld.decision?.reasons.join("\n")).toContain("status decided in [open, claimed] is false");
      expect(listToolRecords("priya", "test-harness", { status: "open" }).records.map((r) => r.key)).toEqual(["r-open"]);
      expect(getRecordHistory("priya", "test-harness", ref("r-done")).ok).toBe(false);
    });

    it("scopes reads by record kind", () => {
      expect(listToolRecords("avery", "test-harness").records.map((r) => r.key)).toEqual(["r-done", "r-open"]);
      expect(listToolRecords("riley", "test-harness").records).toEqual([]);
    });
  });

  describe("grants that need membership in several teams", () => {
    it("applies only to users in all of the teams", () => {
      const avery = getEffectiveGrants("avery").find((g) => g.id === "t-case-auditors");
      expect(avery?.source).toMatchObject({ type: "all-teams", teams: [{ id: "compliance" }, { id: "kyc-review" }] });
      expect(getEffectiveGrants("morgan").map((g) => g.id)).not.toContain("t-case-auditors");
      expect(getEffectiveGrants("riley").map((g) => g.id)).not.toContain("t-case-auditors");
    });
  });

  describe("KYC status updates", () => {
    const kycOf = (id: string) => {
      const result = getCustomerProfile("riley", id);
      return result.ok ? result.profile.kycStatus : null;
    };

    it("updates the customer's KYC status through the pipeline", () => {
      const result = runAction("riley", "test-harness.set-kyc", { customerId: "cust_1002", status: "verified" });
      expect(result.outcome).toBe("executed");
      expect(kycOf("cust_1002")).toBe("verified");
      expect(db.prepare("SELECT outcome FROM audit ORDER BY id DESC LIMIT 1").get()).toEqual({ outcome: "executed" });
    });

    it("needs customer.kycStatus.update as well as the action's permission", () => {
      const result = runAction("jordan", "test-harness.set-kyc", { customerId: "cust_1002", status: "verified" });
      expect(result.outcome).toBe("denied");
      expect(result.error).toContain("customer.kycStatus.update");
      expect(kycOf("cust_1002")).toBe("pending");
    });
  });

  describe("approvals entry points for tools", () => {
    it("filters by tool and to requests the viewer can decide, with the target record", () => {
      open("priya", "v1", "payments", "prod");
      const { approvalId } = update("priya", "v1");
      runAction("jordan", "test-harness.adjust", { customerId: "cust_1001", amountCents: 20_000, note: "" });
      expect(listApprovals("marcus", { canDecide: true }).map((a) => a.id)).toHaveLength(2);
      const flags = listApprovals("marcus", { tool: "test-harness", canDecide: true }).filter((a) => a.record);
      expect(flags).toMatchObject([{ id: approvalId, record: { kind: "case", key: "v1" } }]);
      expect(listApprovals("priya", { canDecide: true })).toEqual([]);
    });
  });
});
