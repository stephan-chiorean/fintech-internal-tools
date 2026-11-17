import type { Database } from "better-sqlite3";
import type { MaskLevel, MaskedField, Policy } from "@/foundation/policy/types";
import { type Decision, type Resource, checkPermission } from "@/foundation/permissions/resolver";

export interface CustomerRow {
  id: string;
  name: string;
  email: string;
  product_area: string;
  kyc_status: string;
  risk_level: string;
  ssn: string;
  bank_account: string;
  dob: string;
  address: string;
}

export interface MaskedValue {
  /** `null` when hidden. Sensitive raw values never leave the foundation unmasked. */
  value: string | null;
  level: MaskLevel;
  reason: string;
}

export interface CustomerProfile {
  id: string;
  name: string;
  email: string;
  productArea: string;
  kycStatus: string;
  riskLevel: string;
  fields: Record<MaskedField, MaskedValue>;
}

export type ProfileResult = { ok: true; profile: CustomerProfile } | { ok: false; decision: Decision };

const RAW_FIELD: Record<MaskedField, "ssn" | "bank_account" | "dob" | "address"> = {
  ssn: "ssn",
  bankAccount: "bank_account",
  dob: "dob",
  address: "address",
};

export const KYC_STATUSES = ["pending", "verified", "rejected"] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

/** Sets a customer's KYC status. Only the action pipeline calls this, inside its transaction. */
export function updateKycStatus(db: Database, customerId: string, status: KycStatus): void {
  db.prepare("UPDATE customers SET kyc_status = ? WHERE id = ?").run(status, customerId);
}

export const MASKED_FIELDS = Object.keys(RAW_FIELD) as MaskedField[];

export function loadCustomer(db: Database, customerId: string): CustomerRow | null {
  return (db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as CustomerRow | undefined) ?? null;
}

/** The non-sensitive customer data permission conditions can use. */
export function customerResource(row: CustomerRow, extraAttrs: Resource["attrs"] = {}): Resource {
  return {
    customerId: row.id,
    productArea: row.product_area,
    attrs: {
      customerId: row.id,
      productArea: row.product_area,
      kycStatus: row.kyc_status,
      riskLevel: row.risk_level,
      ...extraAttrs,
    },
  };
}

/** Keeps the last 4 letters/digits and replaces the rest, keeping separators. */
export function maskLast4(value: string): string {
  let keep = 4;
  return value
    .split("")
    .reverse()
    .map((ch) => {
      if (!/[a-z0-9]/i.test(ch)) return ch;
      return keep-- > 0 ? ch : "•";
    })
    .reverse()
    .join("");
}

function maskField(db: Database, policy: Policy, actorId: string, field: MaskedField, row: CustomerRow): MaskedValue {
  const rule = policy.fieldMasking[field];
  const resource = customerResource(row, { field });
  for (const reveal of rule.reveal) {
    const decision = checkPermission(db, policy, { actorId, permission: reveal.permission, resource });
    if (decision.effect === "allow") {
      const raw = row[RAW_FIELD[field]];
      const matched = decision.matchedGrants[0];
      return {
        value: reveal.level === "full" ? raw : maskLast4(raw),
        level: reveal.level,
        reason: `${reveal.permission} via grant "${matched?.grantId}" (${matched?.source})`,
      };
    }
  }
  const level = rule.default;
  return {
    value: level === "hidden" ? null : level === "last4" ? maskLast4(row[RAW_FIELD[field]]) : row[RAW_FIELD[field]],
    level,
    reason: `No grant gives ${rule.reveal.map((r) => r.permission).join(" or ")} for this customer`,
  };
}

export function readCustomerProfile(db: Database, policy: Policy, actorId: string, customerId: string): ProfileResult {
  const row = loadCustomer(db, customerId);
  if (!row) {
    return {
      ok: false,
      decision: {
        effect: "deny",
        actorId,
        permission: "customer.read",
        reasons: [`Denied: customer "${customerId}" does not exist.`],
        matchedGrants: [],
      },
    };
  }
  const decision = checkPermission(db, policy, {
    actorId,
    permission: "customer.read",
    resource: customerResource(row),
  });
  if (decision.effect !== "allow") return { ok: false, decision };

  const fields = Object.fromEntries(
    MASKED_FIELDS.map((field) => [field, maskField(db, policy, actorId, field, row)]),
  ) as Record<MaskedField, MaskedValue>;
  return {
    ok: true,
    profile: {
      id: row.id,
      name: row.name,
      email: row.email,
      productArea: row.product_area,
      kycStatus: row.kyc_status,
      riskLevel: row.risk_level,
      fields,
    },
  };
}

export function listReadableCustomers(db: Database, policy: Policy, actorId: string): CustomerProfile[] {
  const ids = db.prepare("SELECT id FROM customers ORDER BY id").all() as { id: string }[];
  return ids.flatMap(({ id }) => {
    const result = readCustomerProfile(db, policy, actorId, id);
    return result.ok ? [result.profile] : [];
  });
}
