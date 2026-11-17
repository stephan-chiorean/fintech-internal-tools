import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import { freshDb } from "@/foundation/testing";
import { insertFact } from "./facts";
import { getCustomerFacts } from "./index";

function publish(db: Database, customerId: string, namespace: string, key: string) {
  insertFact(db, { customerId, namespace, key, value: { from: namespace }, publishedBy: "riley", auditActionId: `${namespace}.x` });
}

describe("cross-tool customer facts", () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
    publish(db, "cust_1002", "test-harness", "last-adjustment");
    publish(db, "cust_1002", "kyc", "decision");
    publish(db, "cust_1001", "kyc", "decision");
  });

  it("returns facts from every namespace the viewer may read", () => {
    const result = getCustomerFacts("riley", "cust_1002");
    expect(result.facts.map((f) => `${f.namespace}/${f.key}`).sort()).toEqual(["kyc/decision", "test-harness/last-adjustment"]);
    expect(result.withheld).toEqual([]);
  });

  it("withholds namespaces the viewer's facts.read condition excludes, with reasons", () => {
    const result = getCustomerFacts("alex", "cust_1002");
    expect(result.facts.map((f) => f.namespace)).toEqual(["test-harness"]);
    expect(result.withheld).toHaveLength(1);
    expect(result.withheld[0]).toMatchObject({ namespace: "kyc", count: 1 });
    expect(result.withheld[0].decision.reasons.join("\n")).toContain("namespace kyc in [test-harness] is false");
    expect(JSON.stringify(result)).not.toContain('"from":"kyc"');
  });

  it("applies conditions on customer data to fact reads", () => {
    expect(getCustomerFacts("jamie", "cust_1002").facts).toHaveLength(2);
    expect(getCustomerFacts("jamie", "cust_1001").facts).toHaveLength(0);
  });

  it("returns nothing without customer.read on the customer", () => {
    const result = getCustomerFacts("priya", "cust_1002");
    expect(result).toMatchObject({ ok: false, facts: [], withheld: [] });
    expect(result.decision.effect).toBe("deny");
  });

  it("filters by namespace", () => {
    expect(getCustomerFacts("riley", "cust_1002", { namespace: "kyc" }).facts.map((f) => f.namespace)).toEqual(["kyc"]);
  });
});
