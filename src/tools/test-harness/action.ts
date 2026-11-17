import { defineAction, InvalidInputError } from "@/foundation/pipeline";

export interface AdjustInput {
  customerId: string;
  amountCents: number;
  note: string;
}

function parseAdjustInput(raw: unknown): AdjustInput {
  if (typeof raw !== "object" || raw === null) throw new InvalidInputError("expected an object");
  const { customerId, amountCents, note } = raw as Record<string, unknown>;
  if (typeof customerId !== "string" || customerId.length === 0) throw new InvalidInputError("customerId is required");
  if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 100_000_000) {
    throw new InvalidInputError("amountCents must be a whole number of cents between 1 and 100,000,000");
  }
  if (typeof note !== "string" || note.length > 200) throw new InvalidInputError("note must be a string of at most 200 characters");
  return { customerId, amountCents, note };
}

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

/**
 * Test-only action that exercises the pipeline end to end: permission check,
 * approval routing, a write (a published fact) and a masked read.
 */
export const adjustAction = defineAction({
  id: "test-harness.adjust",
  tool: "test-harness",
  title: "Test adjustment",
  permission: "test-harness.adjust",
  parse: parseAdjustInput,
  customerId: (input) => input.customerId,
  attributes: (input) => ({ amountCents: input.amountCents }),
  summarize: (input) => `Test adjustment of ${dollars(input.amountCents)} for ${input.customerId}${input.note ? `: ${input.note}` : ""}`,
  execute: (ctx, input) => {
    const factId = ctx.publishFact(input.customerId, "last-adjustment", {
      amountCents: input.amountCents,
      note: input.note,
      approvalId: ctx.approvalId,
    });
    const profile = ctx.getCustomerProfile(input.customerId);
    return {
      factId,
      customer: profile.ok
        ? { id: profile.profile.id, name: profile.profile.name, ssn: profile.profile.fields.ssn.value }
        : null,
    };
  },
});
