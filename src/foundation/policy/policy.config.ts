import { definePolicy } from "./types";

/**
 * The only source of permissions. Tools name permissions from this file in
 * their action definitions; they never check permissions themselves.
 */
export const policy = definePolicy({
  permissions: {
    "customer.read": { description: "View a customer's profile (sensitive fields masked)" },
    "customer.ssn.last4": { description: "See the last 4 digits of a customer's SSN" },
    "customer.ssn.full": { description: "See a customer's full SSN" },
    "customer.bankAccount.last4": { description: "See the last 4 digits of a customer's bank account" },
    "customer.bankAccount.full": { description: "See a customer's full bank account" },
    "customer.dob.full": { description: "See a customer's date of birth" },
    "customer.address.full": { description: "See a customer's address" },
    "facts.read": { description: "Read facts other tools published about a customer" },
    "audit.read": { description: "Read the audit log" },
    "test-harness.adjust": {
      description: "Post a test balance adjustment (test harness only)",
      approvalPermission: "test-harness.adjust.approve",
    },
    "test-harness.adjust.approve": {
      description: "Approve a test balance adjustment (test harness only)",
      isApproval: true,
    },
  },

  roles: {
    "support-agent": {
      description: "Look up customers to answer support tickets",
      permissions: [
        { permission: "customer.read" },
        { permission: "customer.bankAccount.last4" },
        { permission: "customer.address.full" },
        { permission: "facts.read", when: { attr: "namespace", op: "in", value: ["test-harness"] } },
      ],
    },
    "support-tier1": {
      description: "Verify identity and post small adjustments",
      permissions: [
        { permission: "customer.ssn.last4" },
        { permission: "customer.dob.full" },
        { permission: "test-harness.adjust", when: { attr: "amountCents", op: "lte", value: 10_000 } },
        {
          permission: "test-harness.adjust",
          effect: "approval-required",
          when: { attr: "amountCents", op: "lte", value: 1_000_000 },
        },
      ],
    },
    "adjustment-approver": {
      description: "Approve adjustments up to a limit",
      params: { maxAmountCents: "number" },
      permissions: [
        {
          permission: "test-harness.adjust.approve",
          when: { attr: "amountCents", op: "lte", param: "maxAmountCents" },
        },
      ],
    },
    "payments-engineer": {
      description: "Debug payment issues for customers",
      permissions: [{ permission: "customer.read" }, { permission: "facts.read" }],
    },
    "refunds-specialist": {
      description: "Handle refunds and post adjustments",
      permissions: [
        { permission: "customer.read" },
        { permission: "customer.bankAccount.full" },
        { permission: "test-harness.adjust", when: { attr: "amountCents", op: "lte", value: 10_000 } },
        {
          permission: "test-harness.adjust",
          effect: "approval-required",
          when: { attr: "amountCents", op: "lte", value: 1_000_000 },
        },
      ],
    },
    "kyc-reviewer": {
      description: "Review customer identity checks",
      permissions: [
        { permission: "customer.read" },
        { permission: "customer.ssn.last4" },
        { permission: "customer.ssn.full", when: { attr: "kycStatus", op: "eq", value: "pending" } },
        { permission: "customer.dob.full" },
        { permission: "customer.address.full" },
        { permission: "facts.read" },
      ],
    },
    "compliance-auditor": {
      description: "Audit activity across tools",
      permissions: [
        { permission: "customer.read" },
        { permission: "customer.ssn.last4" },
        { permission: "customer.bankAccount.last4" },
        { permission: "facts.read" },
        { permission: "audit.read" },
      ],
    },
    "fraud-analyst": {
      description: "Investigate risky customers",
      permissions: [
        { permission: "customer.read" },
        { permission: "facts.read", when: { attr: "riskLevel", op: "in", value: ["medium", "high"] } },
      ],
    },
    "pii-investigator": {
      description: "Full access to sensitive fields for an investigation",
      permissions: [
        { permission: "customer.ssn.full" },
        { permission: "customer.bankAccount.full" },
        { permission: "customer.dob.full" },
        { permission: "customer.address.full" },
      ],
    },
  },

  grants: [
    { id: "basic-support-agents", to: { team: "basic-support" }, role: "support-agent", description: "All support staff can look up customers" },
    { id: "support-t1-agents", to: { team: "support-t1" }, role: "support-tier1", description: "Tier 1 verifies identity and posts small adjustments" },
    { id: "support-t2-approvers", to: { team: "support-t2" }, role: "adjustment-approver", params: { maxAmountCents: 50_000 }, description: "Tier 2 leads approve adjustments up to $500" },
    { id: "payments-eng-engineers", to: { team: "payments-eng" }, role: "payments-engineer", scope: { productArea: "payments" }, description: "Payments engineers see payments customers" },
    { id: "payments-oncall-approvers", to: { team: "payments-oncall" }, role: "adjustment-approver", params: { maxAmountCents: 500_000 }, scope: { productArea: "payments" }, description: "On-call approves payments adjustments up to $5,000" },
    { id: "refunds-ops-specialists", to: { team: "refunds-ops" }, role: "refunds-specialist", description: "Refunds ops handles refunds" },
    { id: "kyc-review-reviewers", to: { team: "kyc-review" }, role: "kyc-reviewer", description: "KYC reviewers check identities" },
    { id: "compliance-auditors", to: { team: "compliance" }, role: "compliance-auditor", description: "Compliance audits all activity" },
    { id: "fraud-analysts", to: { team: "fraud" }, role: "fraud-analyst", description: "Fraud investigates risky customers" },
    { id: "jamie-case-cust-1004", to: { user: "jamie" }, role: "pii-investigator", scope: { customerId: "cust_1004" }, description: "Jamie's open fraud case on Sam Okafor" },
  ],

  fieldMasking: {
    ssn: {
      default: "hidden",
      reveal: [
        { level: "full", permission: "customer.ssn.full" },
        { level: "last4", permission: "customer.ssn.last4" },
      ],
    },
    bankAccount: {
      default: "hidden",
      reveal: [
        { level: "full", permission: "customer.bankAccount.full" },
        { level: "last4", permission: "customer.bankAccount.last4" },
      ],
    },
    dob: { default: "hidden", reveal: [{ level: "full", permission: "customer.dob.full" }] },
    address: { default: "hidden", reveal: [{ level: "full", permission: "customer.address.full" }] },
  },

  guardrails: [
    {
      id: "no-self-approval",
      description: "Nobody can approve their own request.",
      appliesTo: "approval-permissions",
      rule: { kind: "actor-is-requester" },
    },
    {
      id: "contractors-never-approve",
      description: "Contractors can never approve requests.",
      appliesTo: "approval-permissions",
      rule: { kind: "actor-attribute", attribute: "isContractor", equals: true },
    },
  ],
});

export type PermissionName = keyof typeof policy.permissions;
export type RoleName = keyof typeof policy.roles;
