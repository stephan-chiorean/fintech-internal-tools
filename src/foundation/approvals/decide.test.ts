import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import { runAction } from "@/foundation/pipeline";
import { auditCount, freshDb, removeFromTeam, withExtraGrants, withoutGrants } from "@/foundation/testing";
import "@/tools/test-harness/action";
import { decideApproval, listApprovals } from "./index";

const request = (actorId: string, customerId: string, amountCents: number) => {
  const result = runAction(actorId, "test-harness.adjust", { customerId, amountCents, note: "big refund" });
  if (result.outcome !== "approval-requested") throw new Error(`expected approval request, got ${result.outcome}`);
  return result.approvalId!;
};
const status = (db: Database, id: string) => (db.prepare("SELECT status FROM approvals WHERE id = ?").get(id) as { status: string }).status;
const facts = (db: Database) => (db.prepare("SELECT COUNT(*) AS n FROM customer_facts").get() as { n: number }).n;

describe("approvals", () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  it("executes the action as the requester once approved, auditing the approver", () => {
    const id = request("jordan", "cust_1001", 20_000);
    const result = decideApproval("taylor", id, "approve");
    expect(result.outcome).toBe("approved");
    expect(status(db, id)).toBe("approved");
    expect(db.prepare("SELECT published_by FROM customer_facts").get()).toEqual({ published_by: "jordan" });
    expect(db.prepare("SELECT actor_id, outcome, approval_id FROM audit ORDER BY id DESC LIMIT 1").get()).toEqual({
      actor_id: "taylor",
      outcome: "approved",
      approval_id: id,
    });
  });

  it("is single-use: a second approve or a reject after approval is denied", () => {
    const id = request("jordan", "cust_1001", 20_000);
    expect(decideApproval("taylor", id, "approve").outcome).toBe("approved");
    const again = decideApproval("marcus", id, "approve");
    expect(again.outcome).toBe("denied");
    expect(again.reasons[0]).toContain("already used");
    expect(decideApproval("taylor", id, "reject").outcome).toBe("denied");
    expect(facts(db)).toBe(1);
  });

  it("rejects without executing, and a rejected approval cannot be approved", () => {
    const id = request("jordan", "cust_1001", 20_000);
    expect(decideApproval("taylor", id, "reject").outcome).toBe("rejected");
    expect(decideApproval("taylor", id, "approve").outcome).toBe("denied");
    expect(facts(db)).toBe(0);
  });

  describe("re-checks the approver at approval time", () => {
    it("denies when the approver's grant was removed from the policy after the request", () => {
      const id = request("jordan", "cust_1001", 20_000);
      withoutGrants(db, ["support-t2-approvers"]);
      const result = decideApproval("taylor", id, "approve");
      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("no grant gives Taylor Brooks test-harness.adjust.approve");
      expect(status(db, id)).toBe("pending");
      expect(facts(db)).toBe(0);
    });

    it("denies when the approver left the team that gave them approval rights", () => {
      const id = request("jordan", "cust_1001", 20_000);
      removeFromTeam(db, "marcus", "payments-oncall");
      expect(decideApproval("marcus", id, "approve").outcome).toBe("denied");
    });

    it("applies the approver's limit and scope to current data", () => {
      expect(decideApproval("taylor", request("jordan", "cust_1001", 60_000), "approve").reasons[0]).toContain(
        "no grant gives Taylor Brooks",
      );
      expect(decideApproval("marcus", request("jordan", "cust_1002", 60_000), "approve").outcome).toBe("denied");
      expect(decideApproval("marcus", request("jordan", "cust_1001", 60_000), "approve").outcome).toBe("approved");
    });

    it("denies when the requester lost the permission to request", () => {
      const id = request("chris", "cust_1001", 20_000);
      withoutGrants(db, ["refunds-ops-specialists"]);
      const result = decideApproval("taylor", id, "approve");
      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("requester no longer has test-harness.adjust");
    });
  });

  describe("guardrails", () => {
    it("blocks self-approval", () => {
      const id = request("taylor", "cust_1001", 20_000);
      const result = decideApproval("taylor", id, "approve");
      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain('guardrail "no-self-approval"');
      expect(status(db, id)).toBe("pending");
    });

    it("blocks contractors even with an approver grant", () => {
      withExtraGrants(db, [
        { id: "bpo-approvers", to: { team: "support-bpo" }, role: "adjustment-approver", params: { maxAmountCents: 1_000_000 }, description: "misconfigured" },
      ]);
      const result = decideApproval("alex", request("jordan", "cust_1001", 20_000), "approve");
      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain('guardrail "contractors-never-approve"');
    });
  });

  it("writes exactly one audit row per decision, including denials", () => {
    const id = request("jordan", "cust_1001", 20_000);
    const before = auditCount(db);
    decideApproval("alex", id, "approve");
    decideApproval("jordan", id, "approve");
    decideApproval("taylor", id, "approve");
    decideApproval("taylor", id, "approve");
    decideApproval("taylor", "missing", "approve");
    expect(auditCount(db) - before).toBe(5);
  });

  it("lists approvals the viewer requested or could decide, with a decision preview", () => {
    const id = request("jordan", "cust_1001", 20_000);
    expect(listApprovals("taylor").map((a) => [a.id, a.viewerDecision?.effect])).toEqual([[id, "allow"]]);
    expect(listApprovals("jordan").map((a) => a.id)).toEqual([id]);
    expect(listApprovals("riley")).toEqual([]);
  });
});
