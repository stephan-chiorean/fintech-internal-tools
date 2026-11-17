# Fintech Internal Tools

Prototype for a fintech client that runs its internal tools on Microsoft Power Apps. It shows those tools can be built as modules on one shared foundation.

## Architecture

- One Next.js application (App Router, TypeScript). SQLite for storage, fake data only. No Docker, no external services.
- Each internal tool is a module in `src/tools/<tool>/` that runs inside the shared shell in `src/shell/`.
- The shared foundation in `src/foundation/` provides permissions, shared customer data, the action pipeline, approvals and audit.
- Tools build on the foundation and never modify it.

## Rules

- Every write goes through the shared action pipeline. Never write to the database directly from a tool.
- Permissions come only from the shared policy config. Never check permissions in tool code.
- A tool reads another tool's data only through the shared foundation, with the same permission checks.
- Never weaken a guardrail: no self-approval, contractors never approve.
- The audit log is append-only.

## Building a tool

A tool lives in `src/tools/<tool>/`, uses only the foundation's public entry points (`@/foundation/pipeline`, `@/foundation/data`, `@/foundation/approvals`, `@/shell/extensions`) and is registered in `src/tools/index.ts`. ESLint blocks tools from importing `better-sqlite3`, `@/foundation/db`, `@/foundation/permissions`, policy internals or any private `@/foundation/*/*` path. `src/tools/test-harness/` is the reference example.

- **Policy.** Add the tool's permissions, roles, grants, conditions and masking rules to `src/foundation/policy/policy.config.ts`. Prefix permission ids with the tool id (`refunds.issue`). Give an action an `approvalPermission` when some requests need a second person; use role `params` for limits ("approve up to $X") and `when` conditions on customer or action attributes. Guardrails at the bottom of the file override every grant; never weaken or bypass them.
- **Writes: the action pipeline.** Declare each write with `defineAction` from `@/foundation/pipeline`: `id` (`<tool>.<verb>`), `permission`, `parse` (validate untrusted input), `customerId`, `attributes` (values conditions read, e.g. `amountCents`), `summarize` and a synchronous `execute(ctx, input)`. Call it from the UI through the shell's `submitToolAction(actionId, input)` server action, never a server action of your own that skips the pipeline. `runAction` checks the policy, then executes, creates a single-use approval or denies, and writes exactly one audit row. Inside `execute`, write only through `ctx` (`ctx.publishFact`, `ctx.getCustomerProfile`); never check permissions yourself.
- **Tool records.** A tool's own data (a flag, a case, a refund) is a record. Declare each kind with `defineRecordKind({ tool, kind, readPermission, attributes })` from `@/foundation/data`; `attributes` lists the values conditions read (`env`, `status`, `amountCents`, `claimedBy`), and only those can be stored. An action targets an existing record with `record: (input) => ({ kind, key })` or creates one with `newRecord: (input) => ({ kind, key, productArea | customerId, attrs, data })`, which the pipeline checks and then stores itself. Product area, declared attributes, `openedBy`, `recordKind` and customer data always come from storage; action `attributes` can never set them, so a limit that must not be spoofed has to be a stored attribute. Inside `execute`, change the target with `ctx.updateRecord({ attrs, data, note })`. A `newRecord` action that needs approval has no record (or history) until it is approved; its request and decision attempts are in the audit log. Every change and every request step (requested, each approve/reject attempt including refused ones, outcome, denied or failed calls) is appended to the record's history, and each entry is linked to its audit row. Read with `listToolRecords(viewerId, tool, { kind, status })`, `getToolRecord` and `getRecordHistory`; each record is checked against the kind's read permission (plus `customer.read` for a customer's record), so `when` conditions on `recordKind` or `status` limit what each user sees.
- **Conditions on the acting user, decisions and grants.** `{ attr: "claimedBy", op: "eq", actor: "id" }` compares a stored attribute with the acting user (it fails closed when the attribute is unset). Mark a permission that decides a record with `isDecision`: the `no-deciding-own-record` guardrail then blocks the record's opener or requester. Grant `to: { allTeams: ["compliance", "kyc-review"] }` for users who must be in every listed team. Denials name the failed limit in their first line.
- **Approvals.** `listApprovals(viewerId, { tool, canDecide })` from `@/foundation/approvals` feeds dashboard cards (each view carries the target `record`). Decide from the UI through the shell's `decideApproval(approvalId, decision)` server action.
- **Seeds.** `defineSeed({ id, tool, description, steps: [{ actionId, input, as? }] })` from `@/foundation/pipeline` runs the tool's own actions once per database, all in one transaction. Each step is audited as `seeded`. A step without `as` runs as the `system` actor, which skips permission checks. A step with `as: "<userId>"` runs through the pipeline as that user with their permission checks, so it executes or requests approval exactly as their own call would (e.g. a pending request by Jordan); if they couldn't make the call, the seed fails and rolls back.
- **KYC status.** An action with a customer can call `ctx.setCustomerKycStatus(status)`. The pipeline also requires `customer.kycStatus.update` for the acting user on the action's resource.
- **Shared customer data and facts.** Read customers with `getCustomerProfile(viewerId, customerId)` / `listCustomers(viewerId)` from `@/foundation/data`; sensitive fields arrive already masked (`full`, `last4`, `hidden`), so render what you get. Share data with other tools by publishing facts (`ctx.publishFact(customerId, key, value)`, stored under your tool's namespace) and read other tools' facts with `getCustomerFacts(viewerId, customerId, { namespace })`, which applies the same `customer.read` and `facts.read` checks. Never read another tool's tables.
- **Shell slots.** Call `registerTool({ id, name, description, nav?, slots })` from `@/shell/extensions` in the tool's `index.tsx`. Slots are `dashboard` (gets `viewerId`) and `customer` (gets `viewerId`, `customerId`); `nav` adds a link to the shell navigation. The shell owns sign-in, layout and the approvals and audit pages.
- **Shared UI.** Reuse `RecordTable` (list table), `HistoryTimeline` (a record's history) and `ApprovalButtons` (approve/deny controls) from `src/shell/components/`; `src/tools/refunds/` shows them together.
- **Tests.** Colocate Vitest tests. Use `freshDb()` and the helpers in `src/foundation/testing.ts`, and assert pipeline outcomes and audit rows rather than poking the database.

## Run and test

Requires Node.js 20.19+, 22.12+ or 24+ (`.nvmrc` pins 24).

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # Vitest, tests live next to code as *.test.ts(x)
npm run typecheck  # next typegen && tsc --noEmit
npm run lint       # ESLint
```

## Pull requests

- Every PR passes `npm test`, `npm run typecheck` and `npm run lint`. CI (`.github/workflows/ci.yml`) runs all three on every PR.
- Every PR updates the README sections it affects.
- Keep this file short and extend it as the repo grows.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
