import { describe, expect, it } from "vitest";
import { decideApproval, listApprovals } from "@/foundation/approvals";
import { openDatabase } from "@/foundation/db";
import { auditCount, freshDb } from "@/foundation/testing";
import "@/tools/test-harness/action";
import "@/tools/test-harness/records";
import { defineSeed, runPendingSeeds } from "./seeds";

defineSeed({
  id: "test-harness.demo-case",
  tool: "test-harness",
  description: "A demo case",
  steps: [
    { actionId: "test-harness.open-case", input: { key: "seeded", productArea: "payments", env: "prod", amountCents: 100 } },
    { actionId: "test-harness.adjust", input: { customerId: "cust_1001", amountCents: 100, note: "seeded" } },
    { actionId: "test-harness.set-kyc", input: { customerId: "cust_1002", status: "verified" } },
  ],
});

describe("tool seeds", () => {
  it("runs once on a fresh database through the pipeline, audited as a system seed", () => {
    const db = freshDb();
    expect(db.prepare("SELECT opened_by, product_area FROM tool_records").all()).toEqual([{ opened_by: "system", product_area: "payments" }]);
    expect(db.prepare("SELECT actor_id, action_id, outcome FROM audit").all()).toEqual([
      { actor_id: "system", action_id: "test-harness.open-case", outcome: "seeded" },
      { actor_id: "system", action_id: "test-harness.adjust", outcome: "seeded" },
      { actor_id: "system", action_id: "test-harness.set-kyc", outcome: "seeded" },
    ]);
    expect(db.prepare("SELECT published_by FROM customer_facts").all()).toEqual([{ published_by: "system" }]);
    expect(db.prepare("SELECT kyc_status FROM customers WHERE id = 'cust_1002'").get()).toEqual({ kyc_status: "verified" });
    expect(db.prepare("SELECT event, actor_id FROM record_history").all()).toEqual([{ event: "created", actor_id: "system" }]);
    runPendingSeeds(db);
    expect(auditCount(db)).toBe(3);
  });

  it("does not run again when an existing database reopens", () => {
    const file = `${process.env.TMPDIR ?? "/tmp"}/fit-seed-${Date.now()}.db`;
    openDatabase(file).close();
    const db = openDatabase(file);
    expect(auditCount(db)).toBe(3);
    db.close();
  });

  it("rolls back a failing seed and audits one failure", () => {
    const db = freshDb();
    defineSeed({
      id: "test-harness.broken",
      tool: "test-harness",
      description: "Broken",
      steps: [
        { actionId: "test-harness.open-case", input: { key: "first", productArea: "payments", env: "staging", amountCents: 1 } },
        { actionId: "test-harness.open-case", input: { key: "first", productArea: "payments", env: "staging", amountCents: 1 } },
      ],
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM tool_records WHERE key = 'first'").get()).toEqual({ n: 0 });
    const last = db.prepare("SELECT outcome, reasons FROM audit ORDER BY id DESC LIMIT 1").get() as { outcome: string; reasons: string };
    expect(last.outcome).toBe("failed");
    expect(last.reasons).toContain("already exists");
    expect(db.prepare("SELECT id FROM seed_runs").all()).toEqual([{ id: "test-harness.demo-case" }]);
  });

  it("runs a step as a named user through that user's permission checks, audited as a seed", () => {
    const db = freshDb();
    defineSeed({
      id: "test-harness.as-users",
      tool: "test-harness",
      description: "Requests made by real users",
      steps: [
        { actionId: "test-harness.adjust", input: { customerId: "cust_1001", amountCents: 5_000, note: "small" }, as: "jordan" },
        { actionId: "test-harness.adjust", input: { customerId: "cust_1001", amountCents: 40_000, note: "large" }, as: "jordan" },
      ],
    });
    const rows = db
      .prepare("SELECT actor_id, outcome, approval_id, reasons FROM audit WHERE input LIKE '%cust_1001%' AND actor_id = 'jordan'")
      .all() as { actor_id: string; outcome: string; approval_id: string | null; reasons: string }[];
    expect(rows.map((r) => [r.outcome, r.approval_id !== null])).toEqual([
      ["seeded", false],
      ["seeded", true],
    ]);
    expect(rows.every((r) => r.reasons.includes('Seed \\"test-harness.as-users\\" acting as jordan'))).toBe(true);
    expect(db.prepare("SELECT published_by FROM customer_facts WHERE published_by = 'jordan'").all()).toHaveLength(1);

    const [pending] = listApprovals("taylor", { tool: "test-harness", canDecide: true });
    expect(pending).toMatchObject({ requestedBy: "jordan", summary: expect.stringContaining("$400.00") });
    expect(decideApproval("jordan", pending.id, "approve").outcome).toBe("denied");
    expect(decideApproval("taylor", pending.id, "approve").outcome).toBe("approved");
  });

  it("fails and rolls back a step the named user isn't allowed to make", () => {
    const db = freshDb();
    defineSeed({
      id: "test-harness.as-contractor",
      tool: "test-harness",
      description: "A contractor adjustment",
      steps: [
        { actionId: "test-harness.open-case", input: { key: "as-alex", productArea: "payments", env: "staging", amountCents: 1 }, as: "alex" },
      ],
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM tool_records WHERE key = 'as-alex'").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit WHERE actor_id = 'alex'").get()).toEqual({ n: 0 });
    const last = db.prepare("SELECT actor_id, outcome, reasons FROM audit ORDER BY id DESC LIMIT 1").get() as { actor_id: string; outcome: string; reasons: string };
    expect(last).toMatchObject({ actor_id: "system", outcome: "failed" });
    expect(last.reasons).toContain("as alex");
    expect(db.prepare("SELECT id FROM seed_runs WHERE id = 'test-harness.as-contractor'").all()).toEqual([]);
  });
});
