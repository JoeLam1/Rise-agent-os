# RISE Agent OS

A multi-tenant operating platform for real estate agents and brokers. The first
customer is RISE Real Estate Partners in New Jersey; the platform is built to
serve many independent brokerages, each isolated from the others.

**Status: Sprint 001 (foundation). Not production-ready.** Contract analysis is
a labelled placeholder; the NJ contract review engine is Sprint 002. See
[`docs/SPRINT_001.md`](docs/SPRINT_001.md) for what was built, what was tested,
and the known gaps.

## What Sprint 001 includes
- Email/password auth (Supabase Auth), brokerages (organizations), and roles:
  agent, broker, admin.
- Tenant-isolated Postgres schema with Row Level Security on every table.
- Agent dashboard and broker dashboard.
- Transactions: create, list (filter by status), detail, status changes.
- Private document upload with immutable, hashed, numbered versions.
- Pre-signature and post-execution review queues with **mock** analysis.
- Broker decisions (approve / request changes / reject) with an enforced
  state machine, a no-self-approval rule, and an append-only audit log.
- Database tests for cross-tenant access, unauthorized approvals and document security.

## Docs
| Doc | What it covers |
| --- | --- |
| [`docs/PRD.md`](docs/PRD.md) | Product requirements |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design, tenancy and security model, Sprint 002 seams |
| [`docs/NJ_CONTRACT_REVIEW_SPEC.md`](docs/NJ_CONTRACT_REVIEW_SPEC.md) | Spec for the NJ contract review engine (Sprint 002) |
| [`docs/SPRINT_001.md`](docs/SPRINT_001.md) | Sprint plan, delivery and test report |
| [`CLAUDE.md`](CLAUDE.md) | Engineering rules for anyone (human or AI) working in this repo |

## Running locally
Requirements: Node 22+, Docker (for the local Supabase stack).

```bash
npm install
npx supabase start            # starts Postgres, Auth, Storage, applies migrations
cp .env.example .env.local    # paste the API URL and publishable/anon key from `npx supabase status`
npm run dev                   # http://localhost:3000
```

Then sign up, create a brokerage (you become its admin), have colleagues sign
up, and add them from **Members** as agents or brokers. Local email
confirmation is off in `supabase/config.toml`.

## Tests
```bash
npm run test:unit   # domain logic
npm run test:db     # RLS and workflow tests against PostgreSQL
npm run lint && npm run typecheck && npm run build
npm run test:e2e    # browser walkthrough; needs `npx supabase start` and the app on :3000
```
`test:db` starts a throwaway PostgreSQL cluster from local binaries (or uses
`DATABASE_URL`), loads a small Supabase compatibility shim
(`tests/db/supabase-shim.sql`) and every migration, and runs each request the way
PostgREST does (`authenticated` role plus JWT claims). It tests database
policy, not the Supabase Storage or Auth servers.

## Project layout
```
supabase/migrations/   schema, RLS, storage policies, workflow functions
src/app/               Next.js routes (/login, /orgs, /o/[org]/...)
src/app/actions/       server actions
src/lib/               supabase clients, auth helpers, data access, domain logic
src/components/        shadcn/ui components and app components
tests/db/              database security tests
docs/                  product and engineering docs
```

This project is independent of Pulse and shares no code or infrastructure with it.
