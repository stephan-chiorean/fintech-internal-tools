import type { AttrValue, Condition } from "@/foundation/policy/types";

const OP_LABEL = { eq: "=", neq: "≠", lt: "<", lte: "≤", gt: ">", gte: "≥", in: "in" } as const;

export interface ConditionResult {
  passed: boolean;
  /** Human-readable explanation, e.g. "amountCents 75000 ≤ maxAmountCents (50000) is false". */
  explanation: string;
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

export function evaluateCondition(
  condition: Condition,
  attrs: Record<string, AttrValue>,
  params: Record<string, number | string>,
): ConditionResult {
  if ("all" in condition) {
    const results = condition.all.map((c) => evaluateCondition(c, attrs, params));
    return {
      passed: results.every((r) => r.passed),
      explanation: results.map((r) => r.explanation).join(" and "),
    };
  }
  if ("any" in condition) {
    const results = condition.any.map((c) => evaluateCondition(c, attrs, params));
    return {
      passed: results.some((r) => r.passed),
      explanation: `(${results.map((r) => r.explanation).join(" or ")})`,
    };
  }

  const actual = Object.hasOwn(attrs, condition.attr) ? attrs[condition.attr] : undefined;
  let expected: AttrValue | AttrValue[] | undefined;
  let expectedLabel: string;
  if ("param" in condition) {
    expected = params[condition.param];
    expectedLabel = `${condition.param} (${format(expected)})`;
  } else {
    expected = condition.value;
    expectedLabel = format(expected);
  }
  const passed = expected !== undefined && compare(condition.op, actual, expected);
  return {
    passed,
    explanation: `${condition.attr} ${format(actual)} ${OP_LABEL[condition.op]} ${expectedLabel} is ${passed}`,
  };
}
