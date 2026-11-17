import { beforeEach, describe, expect, it } from "vitest";
import { SEED_CUSTOMERS } from "@/foundation/db/seed";
import { freshDb } from "@/foundation/testing";
import { getCustomerProfile, listCustomers } from "./index";
import { maskLast4 } from "./customers";

const levels = (actorId: string, customerId: string) => {
  const result = getCustomerProfile(actorId, customerId);
  if (!result.ok) throw new Error(result.decision.reasons[0]);
  return Object.fromEntries(Object.entries(result.profile.fields).map(([k, v]) => [k, v.level]));
};

describe("customer profile masking", () => {
  beforeEach(() => {
    freshDb();
  });

  it("masks last 4 while keeping separators", () => {
    expect(maskLast4("901-12-4821")).toBe("•••-••-4821");
    expect(maskLast4("021000021-4410023817")).toBe("•••••••••-••••••3817");
  });

  it("masks each field by the viewer's permissions", () => {
    expect(levels("alex", "cust_1001")).toEqual({ ssn: "hidden", bankAccount: "last4", dob: "hidden", address: "full" });
    expect(levels("jordan", "cust_1001")).toEqual({ ssn: "last4", bankAccount: "last4", dob: "full", address: "full" });
    expect(levels("chris", "cust_1001")).toEqual({ ssn: "hidden", bankAccount: "full", dob: "hidden", address: "hidden" });
    expect(levels("morgan", "cust_1001")).toEqual({ ssn: "last4", bankAccount: "last4", dob: "hidden", address: "hidden" });
  });

  it("applies conditions and single-customer scope to masking", () => {
    expect(levels("riley", "cust_1002").ssn).toBe("full");
    expect(levels("riley", "cust_1001").ssn).toBe("last4");
    expect(levels("jamie", "cust_1004")).toEqual({ ssn: "full", bankAccount: "full", dob: "full", address: "full" });
    expect(levels("jamie", "cust_1001")).toEqual({ ssn: "hidden", bankAccount: "hidden", dob: "hidden", address: "hidden" });
  });

  it("returns masked values and never the raw value of a masked field", () => {
    const raw = SEED_CUSTOMERS[0];
    const result = getCustomerProfile("jordan", raw.id);
    expect(result.ok && result.profile.fields.ssn).toMatchObject({ value: "•••-••-4821", level: "last4" });
    expect(result.ok && result.profile.fields.ssn.reason).toContain("customer.ssn.last4");
    const alex = JSON.stringify(getCustomerProfile("alex", raw.id));
    expect(alex).not.toContain(raw.ssn);
    expect(alex).not.toContain(raw.bankAccount);
    expect(alex).not.toContain(raw.dob);
  });

  it("denies the whole profile without customer.read", () => {
    const result = getCustomerProfile("priya", "cust_1002");
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("Omar");
  });

  it("lists only customers the viewer can read", () => {
    expect(listCustomers("priya").map((c) => c.id)).toEqual(["cust_1001", "cust_1004"]);
    expect(listCustomers("jordan")).toHaveLength(6);
  });
});
