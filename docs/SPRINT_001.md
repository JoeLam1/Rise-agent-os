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
| `npm run test:e2e` against a local Supabase stack | 16 / 16 steps passed (see below) |

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

### End-to-end walkthrough
`tests/e2e/walkthrough.mjs` drives the built app in Chromium against
`npx supabase start` (real Supabase Auth, PostgREST, Storage and Postgres 17,
migrations applied by the CLI) on a freshly reset database. Run on 2026-10-20:
all 16 steps passed.

1. Admin signs up and creates a brokerage
2. Broker, agent and a user from another brokerage sign up
3. Admin adds the broker and agent as members
4. Agent creates a transaction
5. Upload refused when a file labelled PDF isn't one
6. Agent uploads v1, then v2 of a document
7. Download returns byte-for-byte the uploaded file (SHA-256 matches the one shown)
8. Agent requests a pre-signature review; the page shows the mock disclaimer and no approve button
9. A second open pre-signature review on the same version is refused
10. Broker sees it on the dashboard and in the pre-signature queue
11. "Request changes" without a note is refused
12. Broker approves with a note; the decision form is replaced by the recorded decision
13. Audit log shows organization, membership, transaction, document, version, review, analysis run, ready-for-broker and approved events
14. Agent is redirected away from the audit log and broker dashboard
15. The other brokerage's user gets 404 for the org, transaction and review pages, and for the file download
16. Signed-out visitors are sent to login

## Not tested yet (known gaps)
- E2E isn't in CI yet (CI has no Supabase stack); it runs locally with the steps
  at the top of `tests/e2e/walkthrough.mjs`.
- Post-execution queue, withdraw, reject and multi-brokerage membership are
  covered by DB tests but not by the browser walkthrough.
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
