# Fintech Internal Tools

A prototype that rebuilds a fintech client's Microsoft Power Apps internal tools as modules on one shared foundation.

## What it does

The client runs three internal tools on Power Apps (a KYC review queue, a refunds dashboard and a feature-flag admin panel) and plans 10+ more. This repo shows they can all run as modules in one application, sharing permissions, customer data, an action pipeline, approvals, audit and a common shell.

**Status:** the shared foundation and shell are built. No real tools yet; a test-only harness tool exercises the pipeline. The database is created and seeded with fake data at `.data/app.db` on first run (delete it to reset).

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
| Tool modules (`src/tools/`) | Individual canvas or model-driven apps | Test harness only |

## How the foundation works

| Part | Where | What it does |
| --- | --- | --- |
| Database | `src/foundation/db/` | SQLite schema and seed: team tree, users, customers, grants, customer facts, approvals, audit. Triggers abort any `UPDATE` or `DELETE` on `audit`. |
| Policy | `src/foundation/policy/policy.config.ts` | The single place for permissions: roles (with parameters such as "approve up to $X"), grants to users or teams (optionally scoped to a product area or one customer), conditions on resource data, field masking (`full`/`last4`/`hidden`) and guardrails. Validated at startup. |
| Permissions | `src/foundation/permissions/` | Resolves direct grants plus grants inherited from ancestor teams (recursive CTE), applies scope, conditions and guardrails, and returns allow / approval-required / deny with human-readable reasons. |
| Shared data | `src/foundation/data/` | Customer profiles with each sensitive field masked for the viewer; customer facts that tools publish and read across tools with the same checks. |
| Pipeline | `src/foundation/pipeline/` | `runAction` is the only write path: execute, request approval or deny, with exactly one audit row per call. Action writes and their audit row commit in one transaction. |
| Approvals | `src/foundation/approvals/` | Single-use. At decision time the approver's permission (and the requester's) is checked again against current policy, data and team membership. |
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
- **System fonts instead of `next/font/google`.** That way the app doesn't download fonts at build or dev time.

## Results

- Foundation and shell: `npm test`, `npm run typecheck` and `npm run lint` pass. Tests cover team inheritance, scope, conditions, guardrails, decision explanations, masking, cross-tool facts, approval recheck and single use, audit immutability, and end-to-end checks that call the shell's server actions directly.
- No real tools built yet.

## What's mocked and what production would need

| Area | Prototype | Production would need |
| --- | --- | --- |
| Data | SQLite with fake data | A managed database, real customer data, migrations and backups |
| Identity | Mock user switcher (cookie) | SSO (e.g. Microsoft Entra ID) mapped to the policy config |
| Hosting | Local `npm run dev` | A hosted deployment with environments and secrets management |
