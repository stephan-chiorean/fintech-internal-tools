import { beforeEach, describe, expect, it } from "vitest";
import { decideApproval, listApprovals } from "@/foundation/approvals";
import { getRecordHistory, getToolRecord, listToolRecords } from "@/foundation/data";
import { runAction } from "@/foundation/pipeline";
import { freshDb } from "@/foundation/testing";
import "./flags";

const PROD = "payments.instant-payouts.prod";
const STAGING = "payments.instant-payouts.staging";
const CARDS = "cards.virtual-cards.prod";

const toggle = (actorId: string, key: string, enabled: boolean) => runAction(actorId, "feature-flags.toggle", { key, enabled });
const rollback = (actorId: string, key: string, toVersion: number) => runAction(actorId, "feature-flags.rollback", { key, toVersion });
const enabled = (key: string) => {
  const result = getToolRecord("marcus", "feature-flags", { kind: "flag", key });
  if (!result.ok) throw new Error(result.decision.reasons[0]);
  return result.record.attrs.enabled;
};
const history = (key: string) => {
  const result = getRecordHistory("marcus", "feature-flags", { kind: "flag", key });
  if (!result.ok) throw new Error(result.decision.reasons[0]);
  return result.entries;
};

describe("feature flags", () => {
  beforeEach(() => {
    freshDb();
  });

  it("seeds a payments flag in prod and staging and a cards flag in prod", () => {
    expect(listToolRecords("marcus", "feature-flags").records.map((r) => r.key)).toEqual([PROD, STAGING]);
    expect(history(PROD)).toMatchObject([{ event: "created", actorId: "system", attrs: { env: "prod", enabled: false } }]);
    expect(listToolRecords("priya", "feature-flags").withheld.count).toBe(1);
  });

  it("applies Priya's staging toggle at once", () => {
    const result = toggle("priya", STAGING, false);
    expect(result.outcome).toBe("executed");
    expect(enabled(STAGING)).toBe(false);
  });

  it("holds Priya's prod toggle until Marcus approves it", () => {
    const { outcome, approvalId } = toggle("priya", PROD, true);
    expect(outcome).toBe("approval-requested");
    expect(enabled(PROD)).toBe(false);
    expect(listApprovals("marcus", { tool: "feature-flags", canDecide: true }).map((a) => a.id)).toEqual([approvalId]);
    expect(decideApproval("marcus", approvalId!, "approve").outcome).toBe("approved");
    expect(enabled(PROD)).toBe(true);
  });

  it("doesn't let Marcus approve his own prod toggle", () => {
    const { outcome, approvalId } = toggle("marcus", PROD, true);
    expect(outcome).toBe("approval-requested");
    expect(listApprovals("marcus", { tool: "feature-flags", canDecide: true })).toEqual([]);
    const result = decideApproval("marcus", approvalId!, "approve");
    expect(result.outcome).toBe("denied");
    expect(result.reasons[0]).toContain('guardrail "no-self-approval"');
    expect(enabled(PROD)).toBe(false);
  });

  it("doesn't let Priya toggle cards flags", () => {
    const result = toggle("priya", CARDS, false);
    expect(result.outcome).toBe("denied");
    expect(result.reasons.join("\n")).toContain("scoped to product area payments, but the resource is in cards");
    expect(listApprovals("priya")).toEqual([]);
  });

  it("needs approval for a prod rollback, and applies it once approved", () => {
    decideApproval("marcus", toggle("priya", PROD, true).approvalId!, "approve");
    const { outcome, approvalId } = rollback("priya", PROD, 1);
    expect(outcome).toBe("approval-requested");
    expect(enabled(PROD)).toBe(true);
    expect(decideApproval("priya", approvalId!, "approve").outcome).toBe("denied");
    expect(decideApproval("marcus", approvalId!, "approve").outcome).toBe("approved");
    expect(enabled(PROD)).toBe(false);
  });

  it("rolls back staging directly and keeps the same scope rules", () => {
    toggle("priya", STAGING, false);
    expect(rollback("priya", STAGING, 1).outcome).toBe("executed");
    expect(enabled(STAGING)).toBe(true);
    expect(rollback("priya", CARDS, 1).outcome).toBe("denied");
  });

  it("records the complete history of every change and request", () => {
    toggle("priya", STAGING, false);
    const request = toggle("priya", PROD, true).approvalId!;
    decideApproval("priya", request, "approve");
    decideApproval("marcus", request, "approve");
    const reject = rollback("priya", PROD, 1).approvalId!;
    decideApproval("marcus", reject, "reject");
    toggle("alex", PROD, false);

    expect(history(STAGING).map((e) => [e.event, e.actorId, e.version])).toEqual([
      ["created", "system", 1],
      ["updated", "priya", 2],
    ]);
    expect(history(PROD).map((e) => [e.event, e.actorId, e.onBehalfOf, e.version, e.attrs.enabled])).toEqual([
      ["created", "system", null, 1, false],
      ["approval-requested", "priya", null, 1, false],
      ["decision-refused", "priya", null, 1, false],
      ["approved", "marcus", "priya", 1, false],
      ["updated", "marcus", "priya", 2, true],
      ["approval-requested", "priya", null, 2, true],
      ["rejected", "marcus", null, 2, true],
      ["denied", "alex", null, 2, true],
    ]);
    expect(history(PROD).every((e) => Number.isInteger(e.auditId))).toBe(true);
  });
});
