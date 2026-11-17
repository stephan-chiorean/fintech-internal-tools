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

## Run and test

Requires Node.js 20.9+ (`.nvmrc` pins 24).

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
