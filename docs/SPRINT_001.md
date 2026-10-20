# Sprint 001 — Foundation

_Plan, delivery and test report. Dates: started 2026-10-20._

## Goal
A working, testable foundation: multi-tenant data model with RLS, auth and
roles, transactions, private versioned documents, review queues with mock
analysis, broker decisions and audit logging, plus the seams for Sprint 002's
NJ contract review engine.

## Plan and status
| # | Item | Status |
| --- | --- | --- |
| 1 | Bootstrap Next.js App Router, TypeScript, Tailwind, shadcn/ui, Supabase | Done |
| 2 | Auth, organization membership, role-based access | Done |
| 3 | Tenant-isolated tables with RLS | Done |
| 4 | Agent dashboard and broker dashboard | Done |
| 5 | Transaction create, list, detail | Done |
| 6 | Private document upload, immutable version tracking | Done |
| 7 | Pre-signature and post-execution queues with mock analysis | Done |
| 8 | Broker approval, audit logging, review-state management | Done |
| 9 | Tests: cross-tenant access, unauthorized approvals, document security | Done (database level) |
| 10 | Architecture prepared for Sprint 002 | Done (see ARCHITECTURE.md "Sprint 002 seams", NJ_CONTRACT_REVIEW_SPEC.md) |

## Decisions made
- **No service-role key in the app.** All reads and writes run as the user; RLS
  plus security-definer workflow functions are the boundary.
- **Mock analysis is generated in SQL**, not in the app, so no client can submit
  analysis content. It marks every item `not_evaluated`.
- **No self-approval.** The person who requested a review can't decide it.
- **Decisions are final.** A new upload starts a new review.
- **shadcn/ui components are vendored by hand** (new-york style) because the
  shadcn registry host was unreachable from the build environment; they can be
  refreshed with `npx shadcn add <name> --overwrite` from a normal machine.
- **Cache Components is off** (it was on in the Next.js 16 scaffold); all pages are per-user.

## Test report
Run on 2026-10-20 in the build container (Node 22, PostgreSQL 16):

| Check | Result |
| --- | --- |
| `npm run lint` | Pass, 0 problems |
| `npm run typecheck` | Pass |
| `npm run test:unit` | 13 / 13 passed |
| `npm run test:db` | 48 / 48 passed (3 files); also re-run 3× in a row, all green |
| `npm run build` | Pass (15 routes) |
| Built app smoke test | `/login` renders (screenshot checked); signed-out requests to `/o/...` pages and the download route redirect to `/login` |

What the DB tests cover:
- **Cross-tenant access**: another brokerage's broker sees zero rows in all 8
  tenant tables; can't create transactions, documents, members or audit rows in
  another tenant; can't update or move another tenant's transaction; profiles of
  other tenants are hidden; anonymous requests are refused.
- **Role scoping**: agents can't see colleagues' transactions, documents,
  versions or reviews; can't read the audit log; can't create transactions for
  other agents; can't promote themselves.
- **Unauthorized approvals**: agents, other agents, other brokerages' brokers and
  the requesting broker can't decide; direct table writes to `reviews` and
  `analysis_runs` are refused; notes are required for changes/rejection;
  decisions are final; the state machine holds even for a superuser; one open
  review per version and type.
- **Document security**: versions can't be updated or deleted (even by a
  superuser); clients can't insert versions directly; registration rejects
  foreign paths, missing uploads and size mismatches; storage objects are
  readable only by people who can see the transaction; uploads into other
  tenants' folders and malformed paths are refused; stored objects can't be
  updated or deleted; the bucket is private; the audit log is append-only.

## Not tested yet (known gaps)
- **End-to-end against a running Supabase stack.** Docker isn't available in the
  build container, so `supabase start` wasn't run. Auth sign-up/sign-in, real
  Storage uploads and signed URLs, and PostgREST embedded selects have not been
  exercised. The DB tests use a shim of Supabase's auth/storage schemas, not the
  real servers. **First thing to do on a machine with Docker:** `npx supabase
  start`, then walk through sign-up → create brokerage → add members →
  transaction → upload → request review → decide.
- No browser end-to-end tests (Playwright) yet.
- If the version-registration call fails after a successful upload, the stored
  object is left orphaned (it is still private and tenant-scoped). Needs a cleanup job.
- `npm audit` reports 5 high-severity advisories in ESLint's dependency chain
  (`braces` via `eslint-config-next`); dev-only, not shipped to users. Fix
  requires an upstream release.
- No rate limiting, MFA, invitation emails or password reset UI yet.
- Members can be added only after they sign up (no invitations).

## Not production-ready
This sprint is a foundation for internal testing with fictional data. Before any
real client data: run the end-to-end checks above, add invitations and password
reset, set up hosted Supabase with backups, review storage retention, and
complete a security review.
