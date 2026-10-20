# Architecture — RISE Agent OS

_Describes what is built through Sprint 002. The AI review section is at the end._

## Overview
```
Browser ──► Next.js 16 (App Router, server components + server actions)
              │  @supabase/ssr, publishable key + user session cookie
              ▼
           Supabase
              ├─ Auth (email/password)
              ├─ PostgREST ──► Postgres (RLS on every table, security-definer workflow functions)
              └─ Storage ──► private bucket `transaction-documents` (RLS on storage.objects)
```
The Next.js server never holds elevated database privileges. Every query and
upload runs as the signed-in user, so **Postgres RLS is the security boundary**
for tenant isolation, role scoping and document access. UI checks only decide
what to render.

## Tenancy model
- `organizations` is the tenant. `memberships(org_id, user_id, role)` links users
  to tenants with a role: `agent`, `broker`, `admin`.
- Every business table carries `org_id`. Children reference parents with a
  composite foreign key `(org_id, parent_id) → parent(org_id, id)`, so a row can
  never point at a parent in a different tenant, even if RLS were misconfigured.
- Helper functions in a non-exposed `private` schema (`is_org_member`,
  `has_org_role`, `can_access_transaction`, `can_access_document`,
  `can_access_storage_path`) are `security definer` so policies don't recurse.
- URLs are `/o/<org-slug>/...`. A slug the user isn't a member of returns 404,
  because RLS hides the organization row.

## Data model
| Table | Purpose | Client writes |
| --- | --- | --- |
| organizations | Tenants | via `create_organization()` |
| profiles | Name/email mirror of `auth.users` | update own `full_name` |
| memberships | User ↔ org with role | admins only (RLS) / `add_org_member()` |
| transactions | Deals | insert/update under RLS; no delete |
| documents | Logical document within a transaction | insert/update title, kind; no delete |
| document_versions | Immutable file versions (path, sha256, size, mime) | `add_document_version()` only |
| reviews | Pre-signature / post-execution review of one version | `request_review()`, `decide_review()`, `withdraw_review()` only |
| analysis_runs | Engine output per review (`engine`, `is_mock`, `status`, `result` JSON) | none (written by functions and the service-role worker) |
| audit_log | Append-only event log | none (written by triggers) |

## Access rules (enforced by RLS)
- Agents: their own transactions and everything under them.
- Brokers/admins: everything in their org; audit log read.
- Admins: membership management (not their own row).
- Anonymous: nothing (`anon` has no table privileges).

## Document storage
- Bucket `transaction-documents` is private, 10 MB limit, allow-listed MIME types.
- Object key: `<org_id>/<transaction_id>/<document_id>/<uuid>-<safe-name>`.
  Storage policies parse the key and allow SELECT/INSERT only when the user can
  access that document's transaction. There are no UPDATE/DELETE policies, so
  stored files can't be overwritten or removed through the API.
- Upload flow (server action `uploadDocument`):
  1. Validate size, allow-listed type, and magic bytes matching the type.
  2. Compute SHA-256 on the server.
  3. Upload with the user's session (`upsert: false`).
  4. Call `add_document_version()`, which checks the path belongs to the
     document, the object exists, and its size matches, then assigns the next
     version number under a row lock.
- Downloads: `/o/<org>/documents/<versionId>/download` looks up the version as
  the user and returns a 60-second signed URL.

## Review workflow
```
request_review()            decide_review() (broker/admin, not requester)
      │                          ┌──► approved
      ▼                          ├──► changes_requested (note required)
pending_analysis ──► ready_for_broker ──► rejected (note required)
      │                    │
      └──► withdrawn ◄─────┘ withdraw_review() (requester or broker)
```
- Transitions are enforced by a trigger for every writer, including
  `service_role`. Decided reviews can't change; decision fields can't be edited
  without a transition.
- One open review per (version, review type) — partial unique index.
- Sprint 001 analysis: `request_review()` writes a deterministic mock run
  (`engine = 'mock'`, every item `not_evaluated`, explicit disclaimer) and moves
  the review to `ready_for_broker`. Clients can't write analysis rows, so they
  can't plant fake "AI" results.

## Audit log
Row triggers on organizations, memberships, transactions, documents,
document_versions, reviews and analysis_runs write `<entity>.created`,
`<entity>.updated` and `review.<state>` events with actor (`auth.uid()`) and
relevant metadata (e.g. version hash, from/to state, decision note). Update and
delete on `audit_log` raise an error for every role.

## App structure
- `src/proxy.ts` (Next 16's replacement for middleware) refreshes the session and
  redirects signed-out users. Optimistic only.
- `src/lib/auth.ts` — `requireUser`, `requireOrg(slug)`, `requireBroker`, `requireAdmin`.
- `src/lib/data/queries.ts` — read queries; `src/app/actions/*` — mutations.
- `src/lib/domain/*` — pure logic (role mirrors, state machine, upload validation), unit-tested.
- Cache Components is off: every page is per-user and per-tenant.

## Testing approach
- `tests/db/*` run against real PostgreSQL with a shim that reproduces Supabase's
  roles, default grants, `auth.uid()` and `storage.objects`. Each request runs
  in a transaction with `set local role authenticated` and JWT claims, as
  PostgREST does. This covers RLS, triggers and workflow functions.
- `tests/e2e/walkthrough.mjs` drives the real app in a browser against a local
  Supabase stack (Auth, PostgREST, Storage) to cover what the shim can't.

## AI contract review (Sprint 002)
```
request_review() ──► analysis_runs: queued ──► worker claims: running ──► completed ─┐
  (AI on + PDF)       review: pending_analysis                       └──► failed ────┤
                                                                                     ▼
                                              review: ready_for_broker (broker decides either way)
```
- **Opt-in per brokerage.** `organizations.ai_review_enabled`, switched only by
  an admin through `set_ai_review()` (audited as `organization.ai_review_enabled`
  / `_disabled`). While off, or for non-PDF files, `request_review()` keeps the
  Sprint 001 mock path.
- **Worker** (`scripts/analysis-worker.ts`, `npm run worker`) is a separate Node
  process. It is the only code that holds `SUPABASE_SERVICE_ROLE_KEY` and
  `RISE_ANTHROPIC_API_KEY`; the Next.js app still uses only the publishable key.
  Per run it calls `claim_analysis_run()` (`for update skip locked`), downloads
  the file from private Storage, checks size and SHA-256 against
  `document_versions`, runs the engine, then `complete_analysis_run()` or
  `fail_analysis_run()`. Logs carry run ids and error classes, never document text.
- **Worker RPCs are `service_role` only.** No signed-in user can claim a run or
  write a result. `complete_analysis_run()` refuses results that claim to be
  mock, come from another engine version, or lack an items array.
- **Run lifecycle trigger** (`analysis_runs_guard`) allows only
  `queued → running → completed | failed` (plus `queued → failed` and a stale
  `running` reclaim) and makes finished runs immutable for every role.
- **Crash recovery.** A run left `running` for 15 minutes is reclaimed, up to 3
  attempts, then failed so the review still reaches the broker. Withdrawing a
  review fails its queued run.
- **Broker decision** requires analysis to have finished (completed or failed).
  A failed run shows the reason and the broker reviews the document unaided.
- **Engine** (`src/lib/analysis/nj-engine.ts`): extracts page text with
  `unpdf`, refuses PDFs with no text layer or over 100 pages, sends the PDF to
  Claude (`claude-opus-5-5`, adaptive thinking, effort `high`, JSON-schema
  structured output) with checklist v0 (`src/lib/analysis/checklist.ts`).
  Server-side refusal fallback is enabled (`fallbacks: "default"`), so if the
  primary model declines the API retries on its default fallback model; a
  refusal from the whole chain fails the run.
- **Quote verification** (`src/lib/analysis/verify.ts`): every quote must be
  found in the extracted text (whitespace, ligature, quote-mark and case
  insensitive) or it is dropped; `present` / `needs_attention` items left with no
  verified quote become `not_evaluated`. The stored result records how many
  quotes were returned and verified.

