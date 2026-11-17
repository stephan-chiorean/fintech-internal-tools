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

const { decideApproval, submitToolAction } = await import("@/shell/actions");

const PROD = "payments.instant-payouts.prod";
const signInAs = (userId: string | null) => {
  session.userId = userId;
};
const toggle = (key: string, enabled: boolean) => submitToolAction("feature-flags.toggle", { key, enabled });
const flagState = (db: Database, key: string) =>
  (db.prepare("SELECT json_extract(attrs, '$.enabled') AS enabled, version FROM tool_records WHERE key = ?").get(key) as {
    enabled: number;
    version: number;
  });

describe("feature flags security checks (server actions end to end)", () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
    signInAs(null);
  });

  it("denies an unauthorized call", async () => {
    signInAs("alex");
    expect((await toggle(PROD, true)).outcome).toBe("denied");
    signInAs("jordan");
    expect((await submitToolAction("feature-flags.create", { name: "x", productArea: "payments", env: "staging", enabled: true, description: "" })).outcome).toBe("denied");
    signInAs(null);
    expect((await toggle(PROD, true)).reasons[0]).toContain('unknown user "anonymous"');
    expect(flagState(db, PROD)).toEqual({ enabled: 0, version: 1 });
  });

  it("fails an approval when the approver lost permission after the request", async () => {
    signInAs("priya");
    const { approvalId } = await toggle(PROD, true);
    withoutGrants(db, ["payments-oncall-flag-approvers"]);
    signInAs("marcus");
    expect((await decideApproval(approvalId!, "approve")).outcome).toBe("denied");
    expect(db.prepare("SELECT status FROM approvals").get()).toEqual({ status: "pending" });
    expect(flagState(db, PROD)).toEqual({ enabled: 0, version: 1 });
  });

  it("blocks self-approval on the server", async () => {
    signInAs("marcus");
    const { approvalId } = await toggle(PROD, true);
    const result = await decideApproval(approvalId!, "approve");
    expect(result.outcome).toBe("denied");
    expect(result.reasons[0]).toContain("no-self-approval");
    expect(flagState(db, PROD).enabled).toBe(0);
  });

  it("never returns masked fields' raw values in responses", async () => {
    const sensitive = SEED_CUSTOMERS.flatMap((c) => [c.ssn, c.bankAccount, c.dob, c.address]);
    const responses: unknown[] = [];
    signInAs("priya");
    responses.push(await toggle("payments.instant-payouts.staging", false), await toggle(PROD, true));
    signInAs("marcus");
    responses.push(await decideApproval((responses[1] as { approvalId: string }).approvalId, "approve"));
    responses.push(db.prepare("SELECT input, reasons, result FROM audit").all(), db.prepare("SELECT * FROM record_history").all());
    const json = JSON.stringify(responses);
    for (const value of sensitive) expect(json).not.toContain(value);
  });

  it("writes exactly one audit row per sensitive mutation", async () => {
    const steps: [string, () => Promise<unknown>][] = [
      ["priya", () => toggle("payments.instant-payouts.staging", false)],
      ["priya", () => toggle(PROD, true)],
      ["priya", () => toggle("cards.virtual-cards.prod", false)],
      ["priya", () => submitToolAction("feature-flags.rollback", { key: PROD, toVersion: 0 })],
      ["priya", () => submitToolAction("feature-flags.rollback", { key: "payments.instant-payouts.staging", toVersion: 1 })],
    ];
    for (const [user, step] of steps) {
      signInAs(user);
      const before = auditCount(db);
      await step();
      expect(auditCount(db) - before).toBe(1);
    }

    signInAs("priya");
    const { approvalId } = await toggle(PROD, true);
    for (const user of ["priya", "alex", "marcus", "marcus"]) {
      signInAs(user);
      const before = auditCount(db);
      await decideApproval(approvalId!, "approve");
      expect(auditCount(db) - before).toBe(1);
    }
  });
});
