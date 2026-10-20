# CLAUDE.md — working rules for RISE Agent OS

Read this before changing code. Also read `AGENTS.md` (Next.js 16 notes: this
is not the Next.js in most training data; check `node_modules/next/dist/docs`).

## What this is
A multi-tenant operating platform for real estate brokerages. First customer:
RISE Real Estate Partners (NJ). Long-term: commercial SaaS for many independent
brokerages. Product context: `docs/PRD.md`. System design: `docs/ARCHITECTURE.md`.

## Non-negotiables
- **Tenant isolation is enforced in Postgres, not in the app.** Every business
  table has `org_id`, RLS enabled, and composite `(org_id, id)` foreign keys.
  New tables follow the same pattern and get cross-tenant tests in `tests/db`.
- **The app uses only the publishable key plus the user's session.** No
  service-role key in request paths. Service credentials and the AI provider key
  live only on the worker host: the analysis worker (`scripts/analysis-worker.ts`)
  and its read-only health check (`scripts/health-check.ts`).
- **Compliance writes go through `security definer` functions** (`add_document_version`,
  `request_review`, `decide_review`, `withdraw_review`). Clients have no direct
  INSERT/UPDATE on `document_versions`, `reviews`, `analysis_runs`, `audit_log`.
- **Document versions, storage objects and the audit log are immutable.** Never
  add an UPDATE/DELETE path for them.
- **No live legal actions.** The software never sends, signs, files or
  transmits anything to a party outside the brokerage.
- **No fictional results.** Mock analysis must say it is mock, evaluate nothing,
  and never produce a finding or approval. AI results show only quotes verified
  against the document text and are labelled as a draft. Only a human broker approves.
- **No real client data** in code, fixtures, seeds, tests, screenshots or docs.
  Use obviously fictional names and `*.test` emails.
- **Independent from Pulse.** Do not import, copy, call or share infrastructure
  or credentials with any Pulse project.
- **Report real test results.** Say what ran, what passed, what didn't run.
  Don't call something production-ready unless it has been tested end to end.

## Commands
```
npm run dev          # Next.js dev server (needs .env.local, see .env.example)
npm run lint
npm run typecheck    # next typegen + tsc
npm run test:unit    # vitest, src/**/*.test.ts
npm run test:db      # boots a throwaway Postgres (or uses DATABASE_URL) and runs tests/db
npm run build
npm run test:e2e     # browser walkthrough against a running app + local Supabase
npm run worker       # AI review worker (server-side; needs service key + RISE_ANTHROPIC_API_KEY)
npm run health       # production health check (worker host; exits 1 on a problem)
npx supabase start   # full local Supabase (requires Docker; in a cloud container start `dockerd` first)
```

## Conventions
- Migrations: `supabase/migrations/<timestamp>_<name>.sql`, append-only. Never
  edit a migration that has been applied to a shared environment.
- Data access: server components and server actions call `src/lib/data/*` and
  `supabase.rpc(...)` with the request-scoped client from `src/lib/supabase/server.ts`.
- Authorization in the UI (`src/lib/domain/roles.ts`) only mirrors the database
  for display. The database decides.
- UI components: shadcn/ui in `src/components/ui` (new-york style).
- Keep `docs/` current when behavior changes; each sprint has a `docs/SPRINT_00N.md`.
