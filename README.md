# Fintech Internal Tools

A prototype that rebuilds a fintech client's Microsoft Power Apps internal tools as modules on one shared foundation.

## What it does

The client runs three internal tools on Power Apps (a KYC review queue, a refunds dashboard and a feature-flag admin panel) and plans 10+ more. This repo shows they can all run as modules in one application, sharing permissions, customer data, an action pipeline, approvals, audit and a common shell.

**Status:** the shared foundation and shell are built, including tool-owned records with history, seeds and decision guardrails for the planned tools. The Feature Flags tool is built; a test-only harness tool exercises the pipeline. The database is created and seeded with fake data at `.data/app.db` on first run (delete it to reset). A database from an older schema version is moved aside automatically and recreated.

## How to run it

Requires Node.js 20.19+, 22.12+ or 24+ (`.nvmrc` pins 24). No Docker, no external services.

```bash
npm install && npm run dev   # http://localhost:3000
```

Checks (CI runs all three on every PR):

```bash
npm test           # Vitest
npm run typecheck  # next typegen && tsc --noEmit
npm run lint       # ESLint
```

## What to try

Switch users with the picker in the header (mock sign-in, no passwords).

- **Masking:** open Customers → Dana Whitfield as Jordan (Tier 1: SSN and bank account last 4), Alex (BPO contractor: everything sensitive hidden) and Riley (KYC: SSN last 4; full SSN only for customers with pending KYC, such as Omar Haddad).
- **Scope:** as Priya (payments engineering), only payments customers appear. As Jamie (fraud), Sam Okafor's full details show because of a grant scoped to that one customer.
- **Pipeline:** as Jordan, post a $50 test adjustment on Dana's page (runs directly), then $200 (creates an approval). As Alex, any adjustment is denied with the reason shown.
- **Approvals:** as Taylor (Tier 2, approves up to $500), approve Jordan's request on Approvals. Try approving your own request as Taylor, or approving as Alex: both are blocked by guardrails.
- **Audit:** as Morgan (compliance), open Audit log to see one row per action, approval decision and denial. The table can't be updated or deleted.
- **KYC review:** as Riley, claim a case from the KYC review card on the dashboard, open it, then approve or reject it with a reason (the customer's KYC status changes and is published for other tools) or escalate it. Escalated cases are decided by Avery (compliance and KYC review). Riley can't decide a case someone else claimed, and nobody decides a case they opened. Jordan can't see the queue; Morgan sees a case customer's PII masked differently from Riley. Seeded cases are opened by the system for now.
- **Feature flags:** as Priya, open Feature flags and turn off `payments.instant-payouts` in staging (applies at once), then turn it on in prod (creates an approval). The cards flag is hidden from her. As Marcus, approve it from the dashboard card; a prod change Marcus requests himself is blocked from his own approval. Each flag's history lists every change, request and refused attempt, with rollback buttons that follow the same rules.
- **Explanations:** the dashboard lists each signed-in user's grants and where they come from (direct or inherited through the team tree).

## What Power Apps capability each part replaces

| Part | Replaces in Power Apps | Status |
| --- | --- | --- |
| Shared shell (`src/shell/`) | Separate apps, each with its own navigation and layout | Built |
| Permissions (shared policy config) | Per-app sharing and security roles | Built |
| Shared customer data | Tables and connectors set up per app | Built |
| Action pipeline | Direct writes and Power Automate flows set up per app | Built |
| Approvals | Power Automate approval flows | Built |
| Audit log | Per-app or table-level auditing | Built |
| Tool modules (`src/tools/`) | Individual canvas or model-driven apps | KYC review and feature flags built; refunds next |

## How the foundation works

| Part | Where | What it does |
| --- | --- | --- |
| Database | `src/foundation/db/` | SQLite schema and seed: team tree, users, customers, grants, customer facts, tool records and their history, approvals, audit, seed runs. Triggers abort any `UPDATE` or `DELETE` on `audit` and `record_history`. A `user_version` schema version moves stale files aside. |
| Policy | `src/foundation/policy/policy.config.ts` | The single place for permissions: roles (with parameters such as "approve up to $X"), grants to users, teams or members of all of several teams (optionally scoped to a product area or one customer), conditions on resource data and on the acting user, field masking (`full`/`last4`/`hidden`) and guardrails (no self-approval, contractors never approve, nobody decides a record they opened). Validated at startup. |
| Permissions | `src/foundation/permissions/` | Resolves direct grants plus grants inherited from ancestor teams (recursive CTE), applies scope, conditions and guardrails, and returns allow / approval-required / deny with human-readable reasons; denials name the failed limit. |
| Shared data | `src/foundation/data/` | Customer profiles with each sensitive field masked for the viewer; customer facts and tool records (with history) that tools read across tools with the same checks. |
| Pipeline | `src/foundation/pipeline/` | `runAction` is the only write path: execute, request approval or deny, with exactly one audit row per call. Action writes, record history and their audit row commit in one transaction. Record attributes used by checks come from storage, never from input. Tool seeds run once per database through the same path. |
| Approvals | `src/foundation/approvals/` | Single-use. At decision time the approver's permission (and the requester's) is checked again against current policy, data and team membership. Every attempt is recorded in the target record's history. |
| Shell | `src/shell/` | Mock user switcher, navigation, dashboard, customers, approvals and audit pages, and `dashboard`/`customer` slots tools register into. |

How a tool plugs in is documented in `AGENTS.md` ("Building a tool"). ESLint blocks tools from importing the database or permission internals.

## How it was built with Devin

- Devin created the repo, scaffolded the app, added the checks and CI, and wrote this README and `AGENTS.md`, all in one PR.
- The architecture rules in `AGENTS.md` (every write through the action pipeline, permissions only from the policy config, no self-approval, append-only audit) are also saved as a Devin rule, so every session follows them.
- Devin Review runs automatically on every PR to this repo.

## Key decisions and tradeoffs

- **One Next.js app, not one app per tool.** Tools share one deploy, one shell and one foundation. The tradeoff is that tools must follow the foundation's rules instead of doing their own thing.
- **SQLite with fake data.** Runs anywhere with `npm install` and needs no database server. It isn't a production database.
- **Typecheck runs `next typegen` first.** Next.js generates global route types such as `LayoutProps`, so `tsc` needs them before it runs on a fresh checkout or in CI.
- **Policy in code, materialized into SQLite.** `policy.config.ts` is typed and reviewed like code; grants are synced into the `grants` table so the resolver can join them with the team tree in one query. The tradeoff is that changing access needs a deploy.
- **Synchronous `better-sqlite3`.** Actions run inside one transaction with their audit row, so a failed action leaves only a `failed` audit entry. Action `execute` functions must be synchronous.
- **Approvals execute as the requester.** The approved action runs with the requester's identity and the audit row records the approver, so both are rechecked and attributable.
- **Generic tool records instead of tables per tool.** Tools never touch the database, so the foundation stores their records, attributes and history. Attributes that permission checks read must be declared, which keeps them trusted, but it means a tool can't add its own indexes or columns.
- **System fonts instead of `next/font/google`.** That way the app doesn't download fonts at build or dev time.

## Results

- Foundation and shell: `npm test`, `npm run typecheck` and `npm run lint` pass. Tests cover team inheritance, all-teams grants, scope, conditions (including on the acting user), guardrails, decision explanations and failed limits, masking, cross-tool facts, tool records (trusted attributes can't be set from input, history and request lifecycle, reads scoped by kind and status), seeds, KYC status updates, approval recheck and single use, audit and history immutability, and end-to-end checks that call the shell's server actions directly.
- KYC review: tests cover claim and approve, escalate and decide, the opener guardrail, queue access, PII masking per viewer, complete case history, and five server-side security checks (unauthorized calls, access lost after claiming, no deciding a case you opened, no raw PII in responses, one audit row per call).
- Feature flags (`src/tools/feature-flags/`): tests cover staging toggles applying at once, prod toggles and rollbacks waiting for payments on-call approval, no self-approval, product-area scope (Priya can't touch cards flags), complete history, and the five end-to-end security checks through the shell's server actions.

## What's mocked and what production would need

| Area | Prototype | Production would need |
| --- | --- | --- |
| Data | SQLite with fake data | A managed database, real customer data, migrations and backups |
| Identity | Mock user switcher (cookie) | SSO (e.g. Microsoft Entra ID) mapped to the policy config |
| Hosting | Local `npm run dev` | A hosted deployment with environments and secrets management |
