import type { AttrValue, Condition } from "@/foundation/policy/types";

const OP_LABEL = { eq: "=", neq: "≠", lt: "<", lte: "≤", gt: ">", gte: "≥", in: "in" } as const;

export interface ConditionResult {
  passed: boolean;
  /** Human-readable explanation, e.g. "amountCents 75000 ≤ maxAmountCents (50000) is false". */
  explanation: string;
  /** The comparisons that failed, e.g. "amountCents 75000 ≤ maxAmountCents (50000)". */
  failures: string[];
}

function format(value: AttrValue | AttrValue[] | undefined): string {
  if (value === undefined) return "missing";
  return Array.isArray(value) ? `[${value.join(", ")}]` : String(value);
}

function compare(op: keyof typeof OP_LABEL, actual: AttrValue | undefined, expected: AttrValue | AttrValue[]): boolean {
  if (actual === undefined) return false;
  switch (op) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    default: {
      if (typeof actual !== "number" || typeof expected !== "number") return false;
      if (op === "lt") return actual < expected;
      if (op === "lte") return actual <= expected;
      if (op === "gt") return actual > expected;
      return actual >= expected;
    }
  }
}

/** Evaluates a condition on resource attributes, role params and the acting user's id. */
export function evaluateCondition(
  condition: Condition,
  attrs: Record<string, AttrValue>,
  params: Record<string, number | string>,
  actorId?: string,
): ConditionResult {
  if ("all" in condition) {
    const results = condition.all.map((c) => evaluateCondition(c, attrs, params, actorId));
    return {
      passed: results.every((r) => r.passed),
      explanation: results.map((r) => r.explanation).join(" and "),
      failures: results.flatMap((r) => (r.passed ? [] : r.failures)),
    };
  }
  if ("any" in condition) {
    const results = condition.any.map((c) => evaluateCondition(c, attrs, params, actorId));
    const passed = results.some((r) => r.passed);
    return {
      passed,
      explanation: `(${results.map((r) => r.explanation).join(" or ")})`,
      failures: passed ? [] : results.flatMap((r) => r.failures),
    };
  }

  const actual = Object.hasOwn(attrs, condition.attr) ? attrs[condition.attr] : undefined;
  let passed: boolean;
  let expectedLabel: string;
  if ("actor" in condition) {
    // Fails closed: an unset attribute never matches, and never counts as "not the actor".
    expectedLabel = `actor (${actorId ?? "unknown"})`;
    passed =
      typeof actual === "string" && actual !== "" && actorId !== undefined && compare(condition.op, actual, actorId);
  } else {
    const expected = "param" in condition ? params[condition.param] : condition.value;
    expectedLabel = "param" in condition ? `${condition.param} (${format(expected)})` : format(expected);
    passed = expected !== undefined && compare(condition.op, actual, expected);
  }
  const comparison = `${condition.attr} ${format(actual)} ${OP_LABEL[condition.op]} ${expectedLabel}`;
  return { passed, explanation: `${comparison} is ${passed}`, failures: passed ? [] : [comparison] };
}
