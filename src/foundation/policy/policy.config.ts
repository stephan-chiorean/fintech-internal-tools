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
    "customer.kycStatus.update": { description: "Change a customer's KYC status (checked by the pipeline when an action sets it)" },
    "test-harness.adjust": {
      description: "Post a test balance adjustment (test harness only)",
      approvalPermission: "test-harness.adjust.approve",
    },
    "test-harness.adjust.approve": {
      description: "Approve a test balance adjustment (test harness only)",
      isApproval: true,
    },
    "feature-flags.read": { description: "See feature flags and their history" },
    "feature-flags.create": { description: "Create a feature flag (granted to nobody; flags come from the tool's seed)" },
    "feature-flags.toggle": {
      description: "Turn a feature flag on or off, or roll it back to an earlier version",
      approvalPermission: "feature-flags.toggle.approve",
    },
    "feature-flags.toggle.approve": { description: "Approve a feature flag change", isApproval: true },
    "test-harness.case.read": { description: "Read test cases and their history (test harness only)" },
    "test-harness.case.open": { description: "Open a test case (test harness only)" },
    "test-harness.case.update": {
      description: "Change a test case (test harness only)",
      approvalPermission: "test-harness.case.update.approve",
    },
    "test-harness.case.update.approve": { description: "Approve a test case change (test harness only)", isApproval: true },
    "test-harness.case.claim": { description: "Claim an open test case (test harness only)" },
    "test-harness.case.decide": { description: "Decide a claimed test case (test harness only)", isDecision: true },
    "test-harness.kyc.set": { description: "Set a customer's KYC status (test harness only)" },
    "kyc-review.case.read": { description: "See KYC cases and their history" },
    "kyc-review.case.open": { description: "Open a KYC case for a customer" },
    "kyc-review.case.claim": { description: "Claim a pending KYC case" },
    "kyc-review.case.decide": { description: "Approve or reject a claimed KYC case", isDecision: true },
    "kyc-review.case.escalate": { description: "Escalate a claimed KYC case" },
    "kyc-review.case.decide-escalated": { description: "Approve or reject an escalated KYC case", isDecision: true },
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
      description: "Review customer identity checks: claim pending KYC cases, then approve, reject or escalate the ones you claimed",
      permissions: [
        { permission: "customer.read" },
        { permission: "customer.ssn.last4" },
        { permission: "customer.ssn.full", when: { attr: "kycStatus", op: "eq", value: "pending" } },
        { permission: "customer.dob.full" },
        { permission: "customer.address.full" },
        { permission: "facts.read" },
        { permission: "customer.kycStatus.update" },
        { permission: "kyc-review.case.read" },
        { permission: "kyc-review.case.open" },
        { permission: "kyc-review.case.claim", when: { attr: "status", op: "eq", value: "pending" } },
        {
          permission: "kyc-review.case.decide",
          when: { all: [{ attr: "status", op: "eq", value: "claimed" }, { attr: "claimedBy", op: "eq", actor: "id" }] },
        },
        {
          permission: "kyc-review.case.escalate",
          when: { all: [{ attr: "status", op: "eq", value: "claimed" }, { attr: "claimedBy", op: "eq", actor: "id" }] },
        },
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
    "kyc-escalation-decider": {
      description: "Decide escalated KYC cases someone else claimed",
      permissions: [
        { permission: "kyc-review.case.read" },
        {
          permission: "kyc-review.case.decide-escalated",
          when: { all: [{ attr: "status", op: "eq", value: "escalated" }, { attr: "claimedBy", op: "neq", actor: "id" }] },
        },
      ],
    },
    "kyc-case-opener": {
      description: "Flag a customer for KYC review",
      permissions: [{ permission: "kyc-review.case.open" }],
    },
    "flag-engineer": {
      description: "Change feature flags: staging directly, prod with approval",
      permissions: [
        { permission: "feature-flags.read" },
        { permission: "feature-flags.toggle", when: { attr: "env", op: "eq", value: "staging" } },
        { permission: "feature-flags.toggle", effect: "approval-required", when: { attr: "env", op: "eq", value: "prod" } },
      ],
    },
    "flag-approver": {
      description: "Approve prod feature flag changes",
      permissions: [
        { permission: "feature-flags.read" },
        { permission: "feature-flags.toggle.approve", when: { attr: "env", op: "eq", value: "prod" } },
      ],
    },
    // Test-harness case roles. The policy grants none of them; tests add grants (see test-harness/records.test.ts).
    "test-harness-case-worker": {
      description: "Work test cases (test harness only)",
      permissions: [
        { permission: "test-harness.case.read", when: { attr: "status", op: "in", value: ["open", "claimed"] } },
        { permission: "test-harness.case.open" },
        { permission: "test-harness.case.update", when: { attr: "env", op: "eq", value: "staging" } },
        { permission: "test-harness.case.update", effect: "approval-required", when: { attr: "env", op: "eq", value: "prod" } },
        { permission: "test-harness.case.claim", when: { attr: "status", op: "eq", value: "open" } },
        {
          permission: "test-harness.case.decide",
          when: { all: [{ attr: "status", op: "eq", value: "claimed" }, { attr: "claimedBy", op: "eq", actor: "id" }] },
        },
      ],
    },
    "test-harness-case-approver": {
      description: "Approve test case changes up to a limit (test harness only)",
      params: { maxAmountCents: "number" },
      permissions: [
        { permission: "test-harness.case.read" },
        { permission: "test-harness.case.update.approve", when: { attr: "amountCents", op: "lte", param: "maxAmountCents" } },
      ],
    },
    "test-harness-case-auditor": {
      description: "Read every test case in any status (test harness only)",
      permissions: [{ permission: "test-harness.case.read", when: { attr: "recordKind", op: "eq", value: "case" } }],
    },
    "test-harness-kyc-setter": {
      description: "Set KYC status through the test harness (test harness only)",
      permissions: [{ permission: "test-harness.kyc.set" }],
    },
  },

  grants: [
    { id: "basic-support-agents", to: { team: "basic-support" }, role: "support-agent", description: "All support staff can look up customers" },
    { id: "support-t1-agents", to: { team: "support-t1" }, role: "support-tier1", description: "Tier 1 verifies identity and posts small adjustments" },
    { id: "support-t2-approvers", to: { team: "support-t2" }, role: "adjustment-approver", params: { maxAmountCents: 50_000 }, description: "Tier 2 leads approve adjustments up to $500" },
    { id: "payments-eng-engineers", to: { team: "payments-eng" }, role: "payments-engineer", scope: { productArea: "payments" }, description: "Payments engineers see payments customers" },
    { id: "payments-oncall-approvers", to: { team: "payments-oncall" }, role: "adjustment-approver", params: { maxAmountCents: 500_000 }, scope: { productArea: "payments" }, description: "On-call approves payments adjustments up to $5,000" },
    { id: "payments-eng-flag-engineers", to: { team: "payments-eng" }, role: "flag-engineer", scope: { productArea: "payments" }, description: "Payments engineers change payments flags (prod needs approval)" },
    { id: "payments-oncall-flag-approvers", to: { team: "payments-oncall" }, role: "flag-approver", scope: { productArea: "payments" }, description: "Payments on-call approves prod payments flag changes" },
    { id: "refunds-ops-specialists", to: { team: "refunds-ops" }, role: "refunds-specialist", description: "Refunds ops handles refunds" },
    { id: "kyc-review-reviewers", to: { team: "kyc-review" }, role: "kyc-reviewer", description: "KYC reviewers check identities" },
    { id: "compliance-auditors", to: { team: "compliance" }, role: "compliance-auditor", description: "Compliance audits all activity" },
    { id: "fraud-analysts", to: { team: "fraud" }, role: "fraud-analyst", description: "Fraud investigates risky customers" },
    { id: "kyc-escalation-deciders", to: { allTeams: ["compliance", "kyc-review"] }, role: "kyc-escalation-decider", description: "People in both compliance and KYC review decide escalated KYC cases" },
    { id: "fraud-kyc-openers", to: { team: "fraud" }, role: "kyc-case-opener", description: "Fraud can flag customers for KYC review" },
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
    {
      id: "no-deciding-own-record",
      description: "Nobody can decide a record they opened or requested.",
      appliesTo: "decision-permissions",
      rule: { kind: "actor-matches-attribute", attributes: ["openedBy", "requestedBy"] },
    },
  ],
});

export type PermissionName = keyof typeof policy.permissions;
export type RoleName = keyof typeof policy.roles;
