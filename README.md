# Fintech Internal Tools

A prototype that rebuilds a fintech client's Microsoft Power Apps internal tools as modules on one shared foundation.

## What it does

The client runs three internal tools on Power Apps (a KYC review queue, a refunds dashboard and a feature-flag admin panel) and plans 10+ more. This repo shows they can all run as modules in one application, sharing permissions, customer data, an action pipeline, approvals, audit and a common shell.

**Status:** repo setup only. The app has a placeholder home page and no tools yet.

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

- Open http://localhost:3000 to see the placeholder home page listing the planned tools.

## What Power Apps capability each part replaces

| Part | Replaces in Power Apps | Status |
| --- | --- | --- |
| Shared shell (`src/shell/`) | Separate apps, each with its own navigation and layout | Planned |
| Permissions (shared policy config) | Per-app sharing and security roles | Planned |
| Shared customer data | Tables and connectors set up per app | Planned |
| Action pipeline | Direct writes and Power Automate flows set up per app | Planned |
| Approvals | Power Automate approval flows | Planned |
| Audit log | Per-app or table-level auditing | Planned |
| Tool modules (`src/tools/`) | Individual canvas or model-driven apps | Planned |

## How it was built with Devin

- Devin created the repo, scaffolded the app, added the checks and CI, and wrote this README and `AGENTS.md`, all in one PR.
- The architecture rules in `AGENTS.md` (every write through the action pipeline, permissions only from the policy config, no self-approval, append-only audit) are also saved as a Devin rule, so every session follows them.
- Devin Review runs automatically on every PR to this repo.

## Key decisions and tradeoffs

- **One Next.js app, not one app per tool.** Tools share one deploy, one shell and one foundation. The tradeoff is that tools must follow the foundation's rules instead of doing their own thing.
- **SQLite with fake data.** Runs anywhere with `npm install` and needs no database server. It isn't a production database.
- **Typecheck runs `next typegen` first.** Next.js generates global route types such as `LayoutProps`, so `tsc` needs them before it runs on a fresh checkout or in CI.
- **System fonts instead of `next/font/google`.** That way the app doesn't download fonts at build or dev time.

## Results

- Setup: `npm install && npm run dev` serves the placeholder home page, and lint, typecheck and tests pass locally and in CI.
- No tools built yet.

## What's mocked and what production would need

| Area | Prototype | Production would need |
| --- | --- | --- |
| Data | SQLite with fake data | A managed database, real customer data, migrations and backups |
| Identity | None yet | SSO (e.g. Microsoft Entra ID) mapped to the policy config |
| Hosting | Local `npm run dev` | A hosted deployment with environments and secrets management |
