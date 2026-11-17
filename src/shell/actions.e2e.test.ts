import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "better-sqlite3";
import { SEED_CUSTOMERS } from "@/foundation/db/seed";
import { auditCount, freshDb, withoutGrants } from "@/foundation/testing";

// The only things mocked are Next.js request APIs: the signed-in user and cache revalidation.
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/shell/session", () => ({
  getCurrentUserId: async () => session.userId,
  setCurrentUserId: async (id: string | null) => {
    session.userId = id;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { decideApproval, fetchCustomerFacts, fetchCustomerProfile, submitToolAction } = await import("./actions");

const signInAs = (userId: string) => {
  session.userId = userId;
};
const adjust = (customerId: string, amountCents: number) =>
  submitToolAction("test-harness.adjust", { customerId, amountCents, note: "e2e" });

describe("server actions end to end", () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
    session.userId = null;
  });

  it("denies an unauthorized call", async () => {
    signInAs("alex");
    const result = await adjust("cust_1001", 1_000);
    expect(result.outcome).toBe("denied");
    expect(db.prepare("SELECT COUNT(*) AS n FROM customer_facts").get()).toEqual({ n: 0 });

    session.userId = null;
    expect((await adjust("cust_1001", 1_000)).reasons[0]).toContain('unknown user "anonymous"');
  });

  it("fails an approval when the approver lost permission after the request", async () => {
    signInAs("jordan");
    const { approvalId } = await adjust("cust_1001", 20_000);
    withoutGrants(db, ["support-t2-approvers"]);
    signInAs("taylor");
    const result = await decideApproval(approvalId!, "approve");
    expect(result.outcome).toBe("denied");
    expect(db.prepare("SELECT status FROM approvals").get()).toEqual({ status: "pending" });
  });

  it("blocks self-approval on the server", async () => {
    signInAs("taylor");
    const { outcome, approvalId } = await adjust("cust_1001", 20_000);
    expect(outcome).toBe("approval-requested");
    const result = await decideApproval(approvalId!, "approve");
    expect(result.outcome).toBe("denied");
    expect(result.reasons[0]).toContain("no-self-approval");
  });

  it("never returns masked fields' raw values in responses", async () => {
    const sensitive = SEED_CUSTOMERS.flatMap((c) => [c.ssn, c.bankAccount, c.dob, c.address]);
    const check = (response: unknown, allowed: string[] = []) => {
      const json = JSON.stringify(response);
      for (const value of sensitive) if (!allowed.includes(value)) expect(json).not.toContain(value);
    };

    signInAs("alex");
    check(await fetchCustomerProfile("cust_1001"), [SEED_CUSTOMERS[0].address]);
    check(await fetchCustomerFacts("cust_1001"));
    signInAs("jordan");
    const action = await adjust("cust_1001", 5_000);
    expect(action.outcome).toBe("executed");
    check(action, []);
    check(await fetchCustomerProfile("cust_1001"), [SEED_CUSTOMERS[0].address, SEED_CUSTOMERS[0].dob]);
    signInAs("priya");
    check(await fetchCustomerProfile("cust_1002"));
    signInAs("morgan");
    const audit = db.prepare("SELECT input, reasons, result FROM audit").all();
    check(audit);
  });

  it("writes exactly one audit row per sensitive mutation", async () => {
    const steps: [string, () => Promise<unknown>][] = [
      ["jordan", () => adjust("cust_1001", 5_000)],
      ["jordan", () => adjust("cust_1001", 20_000)],
      ["alex", () => adjust("cust_1001", 5_000)],
      ["jordan", () => submitToolAction("test-harness.adjust", { bad: true })],
      ["jordan", () => submitToolAction("unknown.action", {})],
    ];
    for (const [user, step] of steps) {
      signInAs(user);
      const before = auditCount(db);
      await step();
      expect(auditCount(db) - before).toBe(1);
    }

    signInAs("jordan");
    const { approvalId } = await adjust("cust_1001", 30_000);
    for (const user of ["jordan", "alex", "taylor", "taylor"]) {
      signInAs(user);
      const before = auditCount(db);
      await decideApproval(approvalId!, "approve");
      expect(auditCount(db) - before).toBe(1);
    }
  });
});
