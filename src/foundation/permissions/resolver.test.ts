import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/foundation/db";
import { customerResource, loadCustomer } from "@/foundation/data/customers";
import { policy } from "@/foundation/policy/policy.config";
import type { Policy } from "@/foundation/policy/types";
import { validatePolicy } from "@/foundation/policy/validate";
import { freshDb, withExtraGrants } from "@/foundation/testing";
import { check, getEffectiveGrants } from "./index";
import type { Resource } from "./resolver";

const customer = (id: string, attrs: Resource["attrs"] = {}) => customerResource(loadCustomer(getDb(), id)!, attrs);

describe("permission resolver", () => {
  beforeEach(() => {
    freshDb();
  });

  describe("team inheritance", () => {
    it("gives Tier 2 the grants of Tier 1 and Basic Support through the team tree", () => {
      const grants = getEffectiveGrants("taylor").map((g) => g.id);
      expect(grants).toEqual(["support-t2-approvers", "support-t1-agents", "basic-support-agents"]);
      const inherited = getEffectiveGrants("taylor").find((g) => g.id === "basic-support-agents")!;
      expect(inherited.source).toMatchObject({ type: "team", teamId: "basic-support", memberOf: "support-t2", depth: 2 });
    });

    it("gives BPO contractors Basic Support grants but not Tier 1 grants", () => {
      expect(getEffectiveGrants("alex").map((g) => g.id)).toEqual(["basic-support-agents"]);
      expect(check({ actorId: "alex", permission: "customer.read", resource: customer("cust_1001") }).effect).toBe("allow");
      expect(check({ actorId: "alex", permission: "customer.ssn.last4", resource: customer("cust_1001") }).effect).toBe("deny");
    });

    it("gives payments on-call the payments engineering grants", () => {
      expect(getEffectiveGrants("marcus").map((g) => g.id)).toEqual(["payments-oncall-approvers", "payments-eng-engineers"]);
    });

    it("combines grants from every team a user belongs to", () => {
      expect(getEffectiveGrants("avery").map((g) => g.id).sort()).toEqual(["compliance-auditors", "kyc-review-reviewers"]);
    });

    it("does not give a parent team the grants of its children", () => {
      expect(getEffectiveGrants("priya").map((g) => g.id)).toEqual(["payments-eng-engineers"]);
    });
  });

  describe("scope", () => {
    it("applies a product-area grant only inside that product area", () => {
      expect(check({ actorId: "priya", permission: "customer.read", resource: customer("cust_1001") }).effect).toBe("allow");
      const cards = check({ actorId: "priya", permission: "customer.read", resource: customer("cust_1002") });
      expect(cards.effect).toBe("deny");
      expect(cards.reasons.join("\n")).toContain("scoped to product area payments, but the resource is in cards");
    });

    it("applies a single-customer grant only to that customer", () => {
      expect(check({ actorId: "jamie", permission: "customer.ssn.full", resource: customer("cust_1004") }).effect).toBe("allow");
      const other = check({ actorId: "jamie", permission: "customer.ssn.full", resource: customer("cust_1001") });
      expect(other.effect).toBe("deny");
      expect(other.reasons.join("\n")).toContain("scoped to customer cust_1004, but the resource is customer cust_1001");
    });
  });

  describe("conditions on resource data", () => {
    it("lets KYC reviewers see full SSNs only while KYC is pending", () => {
      expect(check({ actorId: "riley", permission: "customer.ssn.full", resource: customer("cust_1002") }).effect).toBe("allow");
      const verified = check({ actorId: "riley", permission: "customer.ssn.full", resource: customer("cust_1001") });
      expect(verified.effect).toBe("deny");
      expect(verified.reasons.join("\n")).toContain("kycStatus verified = pending is false");
    });

    it("routes adjustments to allow, approval-required or deny by amount", () => {
      const adjust = (amountCents: number) =>
        check({ actorId: "jordan", permission: "test-harness.adjust", resource: customer("cust_1001", { amountCents }) }).effect;
      expect(adjust(10_000)).toBe("allow");
      expect(adjust(10_001)).toBe("approval-required");
      expect(adjust(1_000_000)).toBe("approval-required");
      expect(adjust(1_000_001)).toBe("deny");
    });

    it("compares against parameterized role limits", () => {
      const approve = (actorId: string, customerId: string, amountCents: number) =>
        check({
          actorId,
          permission: "test-harness.adjust.approve",
          resource: customer(customerId, { amountCents, requestedBy: "jordan" }),
        });
      expect(approve("taylor", "cust_1002", 50_000).effect).toBe("allow");
      const overLimit = approve("taylor", "cust_1002", 50_001);
      expect(overLimit.effect).toBe("deny");
      expect(overLimit.reasons.join("\n")).toContain("amountCents 50001 ≤ maxAmountCents (50000) is false");
      expect(approve("marcus", "cust_1001", 500_000).effect).toBe("allow");
      expect(approve("marcus", "cust_1002", 1_000).effect).toBe("deny");
    });

    it("fails closed when a condition's attribute is missing", () => {
      expect(check({ actorId: "jordan", permission: "test-harness.adjust", resource: customer("cust_1001") }).effect).toBe("deny");
    });
  });

  describe("guardrails", () => {
    it("blocks self-approval even when a grant allows it", () => {
      const decision = check({
        actorId: "taylor",
        permission: "test-harness.adjust.approve",
        resource: customer("cust_1001", { amountCents: 20_000, requestedBy: "taylor" }),
      });
      expect(decision.effect).toBe("deny");
      expect(decision.guardrail).toBe("no-self-approval");
      expect(decision.matchedGrants.map((g) => g.grantId)).toEqual(["support-t2-approvers"]);
      expect(decision.reasons[0]).toContain("Guardrails override all grants");
    });

    it("blocks contractors from approving even with an explicit grant", () => {
      withExtraGrants(getDb(), [
        { id: "alex-approver", to: { user: "alex" }, role: "adjustment-approver", params: { maxAmountCents: 1_000_000 }, description: "misconfigured" },
      ]);
      const decision = check({
        actorId: "alex",
        permission: "test-harness.adjust.approve",
        resource: customer("cust_1001", { amountCents: 100, requestedBy: "jordan" }),
      });
      expect(decision.effect).toBe("deny");
      expect(decision.guardrail).toBe("contractors-never-approve");
      expect(decision.matchedGrants.map((g) => g.grantId)).toEqual(["alex-approver"]);
    });

    it("denies approval checks that have no requester", () => {
      const decision = check({
        actorId: "taylor",
        permission: "test-harness.adjust.approve",
        resource: customer("cust_1001", { amountCents: 100 }),
      });
      expect(decision.effect).toBe("deny");
      expect(decision.guardrail).toBe("no-self-approval");
    });

    it("does not apply approval guardrails to non-approval permissions", () => {
      expect(check({ actorId: "alex", permission: "customer.read", resource: customer("cust_1001") }).effect).toBe("allow");
    });
  });

  describe("decision explanations", () => {
    it("explains which grant allowed the call and how it was inherited", () => {
      const decision = check({ actorId: "jordan", permission: "customer.read", resource: customer("cust_1001") });
      expect(decision.reasons[0]).toBe("Allowed: Jordan Kim has customer.read.");
      expect(decision.reasons[1]).toBe(
        'Matched: grant "basic-support-agents" (role support-agent, granted to team Basic Support, inherited through membership in Support Tier 1) gives customer.read (allow).',
      );
    });

    it("explains approval-required decisions with the approval permission", () => {
      const decision = check({ actorId: "jordan", permission: "test-harness.adjust", resource: customer("cust_1001", { amountCents: 20_000 }) });
      expect(decision.reasons[0]).toContain("needs approval by someone with test-harness.adjust.approve");
      expect(decision.reasons.join("\n")).toContain("amountCents 20000 ≤ 10000 is false");
    });

    it("explains denials with no matching grant", () => {
      const decision = check({ actorId: "chris", permission: "audit.read", resource: { attrs: {} } });
      expect(decision).toMatchObject({ effect: "deny", reasons: ["Denied: no grant gives Chris Novak audit.read here."] });
    });

    it("denies unknown users and unknown permissions", () => {
      expect(check({ actorId: "mallory", permission: "customer.read", resource: { attrs: {} } }).reasons[0]).toContain('unknown user "mallory"');
      expect(check({ actorId: "jordan", permission: "customer.delete", resource: { attrs: {} } }).reasons[0]).toContain("not defined in the policy config");
    });
  });

  describe("policy validation", () => {
    it("accepts the shipped config", () => {
      expect(() => validatePolicy(policy as Policy)).not.toThrow();
    });

    it("rejects grants with missing role params and roles with unknown permissions", () => {
      const broken: Policy = {
        ...(policy as Policy),
        roles: { ...policy.roles, bad: { description: "", permissions: [{ permission: "nope" }] } },
        grants: [{ id: "x", to: { team: "fraud" }, role: "adjustment-approver", description: "" }],
      };
      expect(() => validatePolicy(broken)).toThrow(/unknown permission nope[\s\S]*needs number param maxAmountCents/);
    });
  });
});
