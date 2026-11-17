import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "better-sqlite3";
import { listApprovals } from "@/foundation/approvals";
import { getCustomerFacts, getRecordHistory, listToolRecords } from "@/foundation/data";
import { SEED_CUSTOMERS } from "@/foundation/db/seed";
import { auditCount, freshDb, withoutGrants } from "@/foundation/testing";

// The five security checks for the Refunds actions, through the shell's server actions.
// Only Next.js request APIs are mocked: the signed-in user and cache revalidation.
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/shell/session", () => ({
  getCurrentUserId: async () => session.userId,
  setCurrentUserId: async (id: string | null) => {
    session.userId = id;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { decideApproval, submitToolAction } = await import("@/shell/actions");
const { CustomerRefunds, RefundsDashboardCard } = await import("./RefundsSlots");

const signInAs = (userId: string | null) => {
  session.userId = userId;
};
const request = (key: string, amountCents: number, customerId = "cust_1001") =>
  submitToolAction("refunds.request", { key, customerId, amountCents, reason: "e2e" });
const submit = (key: string) => submitToolAction("refunds.issue", { key });
const refundCount = () => listToolRecords("morgan", "refunds").records.length;

describe("refunds security checks", () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
    signInAs(null);
  });

  it("1. denies unauthorized calls and writes nothing", async () => {
    const facts = () => db.prepare("SELECT COUNT(*) AS n FROM customer_facts").get();
    const before = { refunds: refundCount(), facts: facts() };
    for (const user of ["alex", "priya", null]) {
      signInAs(user);
      expect((await request(`rf_${user ?? "anon"}`, 1_000)).outcome).toBe("denied");
    }
    signInAs("taylor");
    const otherOpener = await submit("rf_seed_jordan_4200");
    expect(otherOpener.outcome).toBe("denied");
    expect(refundCount()).toBe(before.refunds);
    expect(facts()).toEqual(before.facts);
    expect(db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE tool = 'refunds'").get()).toEqual({ n: 3 });
  });

  it("2. fails an approval when the approver lost permission after the request", async () => {
    signInAs("jordan");
    await request("rf_lost", 84_000);
    const { approvalId } = await submit("rf_lost");
    withoutGrants(db, ["refunds-ops-refund-approvers"]);
    signInAs("chris");
    const result = await decideApproval(approvalId!, "approve");
    expect(result.outcome).toBe("denied");
    expect(db.prepare("SELECT status FROM approvals WHERE id = ?").get(approvalId)).toEqual({ status: "pending" });
  });

  it("3. blocks self-approval on the server", async () => {
    signInAs("chris");
    await request("rf_self", 84_000);
    const { outcome, approvalId } = await submit("rf_self");
    expect(outcome).toBe("approval-requested");
    for (const decision of ["approve", "reject"] as const) {
      const result = await decideApproval(approvalId!, decision);
      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("no-self-approval");
    }
  });

  it("4. never returns masked fields' raw values in responses or rendered refunds", async () => {
    const sensitive = SEED_CUSTOMERS.flatMap((c) => [c.ssn, c.bankAccount, c.dob, c.address]);
    const check = (response: unknown) => {
      const json = typeof response === "string" ? response : JSON.stringify(response);
      for (const value of sensitive) expect(json).not.toContain(value);
    };
    signInAs("jordan");
    check(await request("rf_mask", 84_000));
    const issued = await submit("rf_mask");
    check(issued);
    for (const user of ["chris", "alex", "jordan"]) {
      signInAs(user);
      check(listApprovals(user, { tool: "refunds" }));
      check(listToolRecords(user, "refunds"));
      check(getRecordHistory(user, "refunds", { kind: "refund", key: "rf_mask" }));
      check(getCustomerFacts(user, "cust_1001", { namespace: "refunds" }));
      check(renderToStaticMarkup(<CustomerRefunds viewerId={user} customerId="cust_1001" />));
      check(renderToStaticMarkup(<RefundsDashboardCard viewerId={user} />));
    }
    signInAs("chris");
    check(await decideApproval(issued.approvalId!, "approve"));
    check(db.prepare("SELECT input, reasons, result FROM audit WHERE tool = 'refunds'").all());
  });

  it("5. writes exactly one audit row per refunds mutation", async () => {
    const steps: [string | null, () => Promise<unknown>][] = [
      ["jordan", () => request("rf_audit", 84_000)],
      ["jordan", () => submit("rf_audit")],
      ["alex", () => request("rf_audit_alex", 1_000)],
      ["taylor", () => submit("rf_audit")],
      ["jordan", () => submitToolAction("refunds.request", { amountCents: -5 })],
      ["jordan", () => submitToolAction("refunds.issue", { key: "rf_missing" })],
      [null, () => request("rf_anon", 1_000)],
    ];
    for (const [user, step] of steps) {
      signInAs(user);
      const before = auditCount(db);
      await step();
      expect(auditCount(db) - before).toBe(1);
    }

    const approvalId = listApprovals("jordan", { tool: "refunds" }).find((a) => a.record?.key === "rf_audit")!.id;
    const seeded4200 = listApprovals("jordan", { tool: "refunds" }).find((a) => a.record?.key === "rf_seed_jordan_4200")!.id;
    const decisions: [string, string][] = [
      ["jordan", approvalId],
      ["alex", approvalId],
      ["chris", seeded4200],
      ["chris", approvalId],
      ["chris", approvalId],
    ];
    for (const [user, id] of decisions) {
      signInAs(user);
      const before = auditCount(db);
      await decideApproval(id, "approve");
      expect(auditCount(db) - before).toBe(1);
    }
  });

  it("renders the dashboard card and customer refunds through the shell slots", () => {
    const card = renderToStaticMarkup(<RefundsDashboardCard viewerId="chris" />);
    expect(card).toContain("Refunds waiting for my approval:</strong> 1");
    expect(card).toContain("$2,500.00");
    expect(card).not.toContain("$4,200.00");
    expect(card).toContain("Deny");

    const page = renderToStaticMarkup(<CustomerRefunds viewerId="chris" customerId="cust_1001" />);
    expect(page).toContain("$4,200.00");
    expect(page).toContain("pending-approval");
    expect(page).toContain("Approval requested");
    expect(renderToStaticMarkup(<CustomerRefunds viewerId="alex" customerId="cust_1001" />)).not.toContain(">Approve<");
  });
});
