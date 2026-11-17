import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import { decideApproval } from "@/foundation/approvals";
import { getCustomerFacts, getRecordHistory, getToolRecord, listToolRecords } from "@/foundation/data";
import { runAction } from "@/foundation/pipeline";
import { freshDb, withExtraGrants } from "@/foundation/testing";
import "./index";
import { refundRef } from "./records";
import { customerRefunds, refundsAwaitingMyApproval } from "./view";

const SEEDED = { jordan4200: "rf_seed_jordan_4200", chris: "rf_seed_chris_1250", taylor2500: "rf_seed_taylor_2500" };

/** Requests a refund and submits it for approval, as the UI does. */
function requestRefund(actorId: string, key: string, amountCents: number, customerId = "cust_1001") {
  const requested = runAction(actorId, "refunds.request", { key, customerId, amountCents, reason: "Charged twice" });
  if (requested.outcome !== "executed") return { requested, issued: null };
  return { requested, issued: runAction(actorId, "refunds.issue", { key }) };
}

const pendingApproval = (key: string) => {
  const history = getRecordHistory("chris", "refunds", refundRef(key));
  if (!history.ok) throw new Error(history.decision.reasons[0]);
  return history.entries.findLast((e) => e.event === "approval-requested")!.approvalId!;
};
const status = (key: string) => {
  const read = getToolRecord("chris", "refunds", refundRef(key));
  if (!read.ok) throw new Error(read.decision.reasons[0]);
  return read.record.attrs.status;
};

describe("refunds", () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  it("seeds three pending refunds requested by Jordan ($4,200), Chris and Taylor ($2,500)", () => {
    const pending = db
      .prepare("SELECT requested_by, status FROM approvals WHERE tool = 'refunds' ORDER BY requested_at")
      .all();
    expect(pending).toEqual([
      { requested_by: "jordan", status: "pending" },
      { requested_by: "chris", status: "pending" },
      { requested_by: "taylor", status: "pending" },
    ]);
    const amounts = Object.fromEntries(
      listToolRecords("chris", "refunds").records.map((r) => [r.key, [r.openedBy, r.attrs.amountCents, r.attrs.status]]),
    );
    expect(amounts).toEqual({
      [SEEDED.jordan4200]: ["jordan", 420_000, "requested"],
      [SEEDED.chris]: ["chris", 125_000, "requested"],
      [SEEDED.taylor2500]: ["taylor", 250_000, "requested"],
    });
    const audit = db.prepare("SELECT DISTINCT outcome FROM audit WHERE tool = 'refunds'").all();
    expect(audit).toEqual([{ outcome: "seeded" }]);
  });

  it("Chris approves an $840 refund and it is issued", () => {
    const { requested, issued } = requestRefund("jordan", "rf_840", 84_000);
    expect(requested.outcome).toBe("executed");
    expect(issued!.outcome).toBe("approval-requested");
    expect(status("rf_840")).toBe("requested");

    const decision = decideApproval("chris", issued!.approvalId!, "approve");
    expect(decision.outcome).toBe("approved");
    expect(status("rf_840")).toBe("issued");
  });

  it("denies Chris on $4,200, naming his $2,500 limit", () => {
    const decision = decideApproval("chris", pendingApproval(SEEDED.jordan4200), "approve");
    expect(decision.outcome).toBe("denied");
    expect(decision.reasons[0]).toContain("Failed limit");
    expect(decision.reasons[0]).toContain("amountCents 420000 ≤ maxAmountCents (250000)");
    expect(decision.reasons[0]).toContain('grant "refunds-ops-refund-approvers"');
    expect(status(SEEDED.jordan4200)).toBe("requested");
    expect(db.prepare("SELECT status FROM approvals WHERE id = ?").get(pendingApproval(SEEDED.jordan4200))).toEqual({ status: "pending" });
  });

  it("allows Chris on exactly $2,500", () => {
    expect(decideApproval("chris", pendingApproval(SEEDED.taylor2500), "approve").outcome).toBe("approved");
    expect(status(SEEDED.taylor2500)).toBe("issued");
  });

  it("never lets Chris approve his own refund", () => {
    const decision = decideApproval("chris", pendingApproval(SEEDED.chris), "approve");
    expect(decision.outcome).toBe("denied");
    expect(decision.reasons[0]).toContain('guardrail "no-self-approval"');
    expect(status(SEEDED.chris)).toBe("requested");
  });

  it("never lets Alex approve, even with an approver grant, but lets him view", () => {
    const { issued } = requestRefund("jordan", "rf_alex", 84_000);
    expect(decideApproval("alex", issued!.approvalId!, "approve").outcome).toBe("denied");
    withExtraGrants(db, [{ id: "t-alex-approver", to: { user: "alex" }, role: "refunds-approver", params: { maxAmountCents: 1_000_000 }, description: "test" }]);
    const decision = decideApproval("alex", issued!.approvalId!, "approve");
    expect(decision.outcome).toBe("denied");
    expect(decision.reasons[0]).toContain('guardrail "contractors-never-approve"');
    expect(decideApproval("alex", issued!.approvalId!, "reject").outcome).toBe("denied");
    expect(status("rf_alex")).toBe("requested");

    expect(listToolRecords("alex", "refunds").records.map((r) => r.key)).toContain("rf_alex");
    expect(getRecordHistory("alex", "refunds", refundRef("rf_alex")).ok).toBe(true);
    expect(requestRefund("alex", "rf_by_alex", 1_000).requested.outcome).toBe("denied");
  });

  it("keeps a complete history: request, every refused attempt, approval and issue, each linked to its audit row", () => {
    const { requested, issued } = requestRefund("jordan", "rf_history", 84_000);
    const approvalId = issued!.approvalId!;
    decideApproval("jordan", approvalId, "approve");
    decideApproval("alex", approvalId, "approve");
    decideApproval("taylor", approvalId, "approve");
    const approved = decideApproval("chris", approvalId, "approve");
    decideApproval("chris", approvalId, "approve");
    runAction("jordan", "refunds.issue", { key: "rf_history" });

    const history = getRecordHistory("taylor", "refunds", refundRef("rf_history"));
    if (!history.ok) throw new Error("unreadable");
    expect(history.entries.map((e) => [e.event, e.actorId, e.onBehalfOf])).toEqual([
      ["created", "jordan", null],
      ["approval-requested", "jordan", null],
      ["decision-refused", "jordan", null],
      ["decision-refused", "alex", null],
      ["decision-refused", "taylor", null],
      ["approved", "chris", "jordan"],
      ["updated", "chris", "jordan"],
      ["decision-refused", "chris", null],
      ["denied", "jordan", null],
    ]);
    expect(history.entries[0].auditId).toBe(requested.auditId);
    expect(history.entries[1].auditId).toBe(issued!.auditId);
    expect(history.entries[5].auditId).toBe(approved.auditId);
    expect(history.entries.at(-1)!.attrs).toMatchObject({ status: "issued", amountCents: 84_000 });
    for (const entry of history.entries) {
      expect(db.prepare("SELECT action_id FROM audit WHERE id = ?").get(entry.auditId)).toBeTruthy();
    }
    expect(history.entries.at(-1)!.reasons.join(" ")).toContain("Denied");
  });

  it("records a rejection and lets the requester resubmit", () => {
    const { issued } = requestRefund("jordan", "rf_reject", 84_000);
    expect(decideApproval("chris", issued!.approvalId!, "reject").outcome).toBe("rejected");
    expect(customerRefunds("jordan", "cust_1001").refunds.find((r) => r.key === "rf_reject")!.state).toBe("rejected");
    expect(runAction("taylor", "refunds.issue", { key: "rf_reject" }).outcome).toBe("denied");
    expect(runAction("jordan", "refunds.issue", { key: "rf_reject" }).outcome).toBe("approval-requested");
    expect(customerRefunds("jordan", "cust_1001").refunds.find((r) => r.key === "rf_reject")!.state).toBe("pending-approval");
  });

  it("lets Tier 1, Tier 2 and refunds ops request, but only the opener can submit a refund for approval", () => {
    for (const [user, key] of [["jordan", "rf_t1"], ["taylor", "rf_t2"], ["chris", "rf_ops"]]) {
      expect(requestRefund(user, key, 1_000).issued?.outcome).toBe("approval-requested");
    }
    expect(runAction("taylor", "refunds.request", { key: "rf_noissue", customerId: "cust_1001", amountCents: 1_000, reason: "x" }).outcome).toBe("executed");
    const other = runAction("jordan", "refunds.issue", { key: "rf_noissue" });
    expect(other.outcome).toBe("denied");
    expect(other.reasons.join("\n")).toContain("openedBy");
    expect(runAction("priya", "refunds.request", { customerId: "cust_1001", amountCents: 1_000, reason: "x" }).outcome).toBe("denied");
  });

  it("never issues a refund twice", () => {
    const first = requestRefund("jordan", "rf_twice", 84_000).issued!;
    const second = runAction("jordan", "refunds.issue", { key: "rf_twice" });
    expect(decideApproval("chris", first.approvalId!, "approve").outcome).toBe("approved");
    const again = decideApproval("chris", second.approvalId!, "approve");
    expect(again.outcome).toBe("denied");
    expect(again.reasons[0]).toContain("status issued = requested");
    expect(db.prepare("SELECT COUNT(*) AS n FROM customer_facts WHERE key = 'refund.issued'").get()).toEqual({ n: 1 });
  });

  it("publishes each customer's refund history as facts other tools read through the foundation", () => {
    const { issued } = requestRefund("jordan", "rf_fact", 84_000, "cust_1002");
    decideApproval("chris", issued!.approvalId!, "approve");
    const facts = getCustomerFacts("riley", "cust_1002", { namespace: "refunds" }).facts;
    expect(facts.map((f) => [f.key, f.value])).toEqual([
      ["refund.issued", { refund: "rf_fact", amountCents: 84_000, approvalId: issued!.approvalId! }],
      ["refund.requested", { refund: "rf_fact", amountCents: 84_000, reason: "Charged twice" }],
    ]);
    const kycHistory = getRecordHistory("riley", "refunds", refundRef("rf_fact"));
    expect(kycHistory.ok).toBe(false);
    const priya = getCustomerFacts("priya", "cust_1002");
    expect(priya.ok).toBe(false);
  });

  it("lists refunds waiting for my approval: only those I could approve now", () => {
    const keys = (user: string) => refundsAwaitingMyApproval(user).map((w) => w.refund.key);
    expect(keys("chris")).toEqual([SEEDED.taylor2500]);
    requestRefund("jordan", "rf_dash", 84_000);
    expect(keys("chris").sort()).toEqual(["rf_dash", SEEDED.taylor2500].sort());
    for (const user of ["jordan", "taylor", "alex"]) expect(keys(user)).toEqual([]);
  });

  it("shows a customer's refunds only to users who may view them", () => {
    expect(customerRefunds("alex", "cust_1001").refunds.map((r) => [r.key, r.state])).toEqual([[SEEDED.jordan4200, "pending-approval"]]);
    expect(customerRefunds("priya", "cust_1001").refunds).toEqual([]);
    expect(customerRefunds("priya", "cust_1001").withheld).toBe(3);
  });
});
