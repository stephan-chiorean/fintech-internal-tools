import { defineSeed } from "@/foundation/pipeline";

const pending = (as: string, key: string, customerId: string, amountCents: number, reason: string) => [
  { actionId: "refunds.request", input: { key, customerId, amountCents, reason }, as },
  { actionId: "refunds.issue", input: { key }, as },
];

/** Three refunds waiting for approval, requested by real users through their own permission checks. */
defineSeed({
  id: "refunds.demo-refunds",
  tool: "refunds",
  description: "Pending refunds: $4,200 by Jordan, $1,250 by Chris and exactly $2,500 by Taylor",
  steps: [
    ...pending("jordan", "rf_seed_jordan_4200", "cust_1001", 420_000, "Duplicate annual plan charge"),
    ...pending("chris", "rf_seed_chris_1250", "cust_1005", 125_000, "Card fee charged in error"),
    ...pending("taylor", "rf_seed_taylor_2500", "cust_1003", 250_000, "Loan origination fee reversal"),
  ],
});
