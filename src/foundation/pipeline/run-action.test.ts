import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import { auditCount, freshDb } from "@/foundation/testing";
import "@/tools/test-harness/action";
import { defineAction } from "./registry";
import { runAction } from "./run-action";

const adjust = (customerId: string, amountCents: number) => ({ customerId, amountCents, note: "test" });
const facts = (db: Database) => (db.prepare("SELECT COUNT(*) AS n FROM customer_facts").get() as { n: number }).n;
const lastAudit = (db: Database) =>
  db.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 1").get() as { outcome: string; actor_id: string; approval_id: string | null };

defineAction({
  id: "test-harness.explode",
  tool: "test-harness",
  title: "Fails after writing",
  permission: "test-harness.adjust",
  parse: (raw) => raw as { customerId: string; amountCents: number },
  customerId: (input) => input.customerId,
  attributes: (input) => ({ amountCents: input.amountCents }),
  summarize: () => "explode",
  execute: (ctx, input) => {
    ctx.publishFact(input.customerId, "partial", true);
    throw new Error("boom");
  },
});

describe("runAction", () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  it("executes allowed actions and writes one executed audit row", () => {
    const result = runAction("jordan", "test-harness.adjust", adjust("cust_1001", 5_000));
    expect(result.outcome).toBe("executed");
    expect(result.result).toMatchObject({ customer: { id: "cust_1001", ssn: "•••-••-4821" } });
    expect(facts(db)).toBe(1);
    expect(auditCount(db)).toBe(1);
    expect(lastAudit(db)).toMatchObject({ outcome: "executed", actor_id: "jordan" });
  });

  it("creates a pending approval instead of executing when approval is required", () => {
    const result = runAction("jordan", "test-harness.adjust", adjust("cust_1001", 20_000));
    expect(result.outcome).toBe("approval-requested");
    expect(result.approvalId).toBeTruthy();
    expect(facts(db)).toBe(0);
    expect(db.prepare("SELECT status, requested_by FROM approvals").get()).toEqual({ status: "pending", requested_by: "jordan" });
    expect(lastAudit(db)).toMatchObject({ outcome: "approval-requested", approval_id: result.approvalId });
  });

  it("denies without a grant and explains why", () => {
    const result = runAction("alex", "test-harness.adjust", adjust("cust_1001", 100));
    expect(result.outcome).toBe("denied");
    expect(result.reasons[0]).toBe("Denied: no grant gives Alex Rivera test-harness.adjust here.");
    expect(facts(db)).toBe(0);
    expect(lastAudit(db).outcome).toBe("denied");
  });

  it("denies and audits unknown actions, invalid input, unknown users and unknown customers", () => {
    expect(runAction("jordan", "nope.do", {}).reasons[0]).toContain('unknown action "nope.do"');
    expect(runAction("jordan", "test-harness.adjust", { customerId: "cust_1001", amountCents: -1, note: "" }).reasons[0]).toContain("invalid input");
    expect(runAction("mallory", "test-harness.adjust", adjust("cust_1001", 100)).reasons[0]).toContain('unknown user "mallory"');
    expect(runAction("jordan", "test-harness.adjust", adjust("cust_9999", 100)).reasons[0]).toContain('customer "cust_9999" does not exist');
    expect(auditCount(db)).toBe(4);
  });

  it("rolls back a failing action's writes and writes one failed audit row", () => {
    const result = runAction("jordan", "test-harness.explode", { customerId: "cust_1001", amountCents: 100 });
    expect(result).toMatchObject({ outcome: "failed", error: "boom" });
    expect(facts(db)).toBe(0);
    expect(auditCount(db)).toBe(1);
    expect(lastAudit(db).outcome).toBe("failed");
  });

  it("does not let action attributes override customer data used by conditions", () => {
    defineAction({
      id: "test-harness.spoof",
      tool: "test-harness",
      title: "Spoof",
      permission: "customer.ssn.full",
      parse: (raw) => raw as { customerId: string },
      customerId: (input) => input.customerId,
      attributes: () => ({ kycStatus: "pending" }),
      summarize: () => "spoof",
      execute: () => null,
    });
    expect(runAction("riley", "test-harness.spoof", { customerId: "cust_1001" }).outcome).toBe("denied");
  });
});
