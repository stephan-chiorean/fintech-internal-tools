import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "better-sqlite3";
import { getRecordHistory, getToolRecord, listToolRecords } from "@/foundation/data";
import { SEED_CUSTOMERS } from "@/foundation/db/seed";
import { auditCount, freshDb, removeFromTeam } from "@/foundation/testing";

// The five server-side security checks, run through the shell's server action like the UI does.
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/shell/session", () => ({
  getCurrentUserId: async () => session.userId,
  setCurrentUserId: async (id: string | null) => {
    session.userId = id;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { fetchCustomerFacts, fetchCustomerProfile, submitToolAction } = await import("@/shell/actions");

const as = (userId: string | null) => {
  session.userId = userId;
};
const claim = (key: string) => submitToolAction("kyc-review.claim-case", { key });
const decide = (key: string, decision = "approve") => submitToolAction("kyc-review.decide-case", { key, decision, reason: "checked" });
const escalate = (key: string) => submitToolAction("kyc-review.escalate-case", { key, reason: "unsure" });
const decideEscalated = (key: string) =>
  submitToolAction("kyc-review.decide-escalated-case", { key, decision: "approve", reason: "checked" });
const status = (key: string) => {
  const result = getToolRecord("avery", "kyc-review", { kind: "case", key });
  return result.ok ? result.record.attrs.status : null;
};
const kycFacts = (db: Database) => db.prepare("SELECT COUNT(*) AS n FROM customer_facts WHERE namespace = 'kyc-review'").get();

describe("KYC review security checks", () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
    as(null);
  });

  it("denies an unauthorized call", async () => {
    as("jordan");
    for (const result of [await claim("kyc-1001"), await decide("kyc-1001"), await decideEscalated("kyc-1001")]) {
      expect(result.outcome).toBe("denied");
    }
    as(null);
    expect((await claim("kyc-1001")).reasons[0]).toContain('unknown user "anonymous"');
    expect(status("kyc-1001")).toBe("pending");
    expect(kycFacts(db)).toEqual({ n: 0 });
  });

  it("denies a decision when the claimant lost access after claiming", async () => {
    as("riley");
    expect((await claim("kyc-1001")).outcome).toBe("executed");
    removeFromTeam(db, "riley", "kyc-review");
    expect((await decide("kyc-1001")).outcome).toBe("denied");
    expect((await escalate("kyc-1001")).outcome).toBe("denied");
    expect(status("kyc-1001")).toBe("claimed");
    expect(kycFacts(db)).toEqual({ n: 0 });
  });

  it("blocks deciding a case you opened on the server, even for Avery", async () => {
    as("avery");
    expect((await submitToolAction("kyc-review.open-case", { key: "kyc-avery", customerId: "cust_1002", note: "re-check" })).outcome).toBe(
      "executed",
    );
    as("riley");
    await claim("kyc-avery");
    await escalate("kyc-avery");
    as("avery");
    const result = await decideEscalated("kyc-avery");
    expect(result.outcome).toBe("denied");
    expect(result.reasons[0]).toContain("no-deciding-own-record");
    expect(status("kyc-avery")).toBe("escalated");
  });

  it("never returns raw PII in KYC responses, records, history, facts or audit", async () => {
    const sensitive = SEED_CUSTOMERS.flatMap((c) => [c.ssn, c.bankAccount, c.dob, c.address]);
    const check = (response: unknown) => {
      const json = JSON.stringify(response);
      for (const value of sensitive) expect(json).not.toContain(value);
    };
    as("riley");
    check(await claim("kyc-1002"));
    check(await escalate("kyc-1002"));
    as("avery");
    check(await decideEscalated("kyc-1002"));
    check(await fetchCustomerFacts("cust_1004"));
    check(listToolRecords("avery", "kyc-review"));
    check(getRecordHistory("avery", "kyc-review", { kind: "case", key: "kyc-1002" }));
    check(db.prepare("SELECT input, reasons, result FROM audit").all());
    // The case screen's PII comes only from the shared profile, masked for the viewer.
    as("morgan");
    const profile = await fetchCustomerProfile("cust_1004");
    expect(profile.ok && profile.profile.fields.ssn.value).not.toBe(SEED_CUSTOMERS.find((c) => c.id === "cust_1004")!.ssn);
  });

  it("writes exactly one audit row per KYC call", async () => {
    const steps: [string, () => Promise<unknown>][] = [
      ["riley", () => claim("kyc-1001")],
      ["avery", () => claim("kyc-1001")],
      ["riley", () => decide("kyc-1001")],
      ["riley", () => claim("kyc-1002")],
      ["riley", () => escalate("kyc-1002")],
      ["riley", () => decideEscalated("kyc-1002")],
      ["avery", () => decideEscalated("kyc-1002")],
      ["jordan", () => claim("kyc-1003")],
      ["riley", () => submitToolAction("kyc-review.decide-case", { key: "kyc-1003" })],
      ["riley", () => claim("kyc-missing")],
    ];
    for (const [user, step] of steps) {
      as(user);
      const before = auditCount(db);
      await step();
      expect(auditCount(db) - before).toBe(1);
    }
  });
});
