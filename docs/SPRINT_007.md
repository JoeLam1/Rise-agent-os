# Sprint 007 — Each brokerage's own clock, and a faster database

_Plan, delivery and test report. Date: 2026-10-30._

## Goal
Two items left open by earlier sprints that don't depend on the hosted
accounts:
- every brokerage was assumed to be in New Jersey's time zone (a known gap
  in Sprint 006), which blocks brokerages elsewhere;
- the hosted project's performance advisor flagged 16 foreign keys without an
  index, 7 RLS policies that re-check the signed-in user on every row, and a
  table with no primary key.

## Plan and status
| # | Item | Status |
| --- | --- | --- |
| 1 | `organizations.time_zone`, changed by an admin in Settings, audited | Done |
| 2 | "Today" for key dates and every timestamp shown use the brokerage's zone | Done |
| 3 | Index every foreign key the advisor flagged | Done |
| 4 | RLS policies evaluate `auth.uid()` once per statement | Done |
| 5 | Primary key on `private.mfa_backup_code_failures` | Done |

## Decisions made
- **The default stays Eastern.** Existing brokerages keep `America/New_York`,
  so nothing changes for RISE.
- **Settings offers the US zones;** the database accepts any region/city zone
  that Postgres knows (`pg_timezone_names`) and rejects abbreviations like
  `EST` and `UTC`, which don't follow daylight saving the way a brokerage does.
- **Changing the zone needs an admin with two-step sign-in,** like turning on
  AI review, and the audit entry records the old and new zone.
- **Key dates don't move.** They are the calendar dates people typed from the
  contract. Only which day counts as "today" changes.
- **Policies are altered in place** (`alter policy`), with the same rules as
  before. Only `auth.uid()` became `(select auth.uid())`.
- **Existing single-column indexes are kept.** The advisor lists several as
  unused, but the hosted project has no traffic yet, so "unused" means
  nothing. Revisit after the pilot has real usage.

## Not done / known gaps
- Email reminders for upcoming key dates still need the hosted email sender.
- The comparison still reads text only (no OCR for scanned copies).
- Hosting steps (Auth settings, Vercel, worker host) are waiting on Joe's app
  URL and choice of email provider.

## Test report
Run on 2026-10-30 in the build container. The local Supabase stack used
Postgres 17, Auth with confirmations and TOTP on, and Mailpit for email. The
DB tests used throwaway Postgres 16.

| Check | Result |
| --- | --- |
| `npm run lint`, `npm run typecheck` | Pass |
| `npm run test:unit` | 50 / 50 (49 before + 1 time zone) |
| `npm run test:db` | 115 / 115 (107 before + 8 time zone and advisor checks) |
| `npm run build` | Pass |
| `npm run test:e2e` on a fresh local stack (migration applied by `supabase start`), AI steps on (stub worker) | 36 / 36 steps (35 before + 1 new) |

**Coverage:**
- Only an admin of that brokerage, with two-step sign-in, can change the
  zone; clients can't write the column; bad names are refused; the change is
  audited with old and new values; the other brokerage is unaffected.
- The advisor checks read the catalog: with this migration removed, both
  fail (verified), so they guard against regressions in future migrations.
- An agent still sees only their own transaction after the policy changes,
  and every earlier RLS test passes unchanged.
- The browser walkthrough changes the zone in Settings, sees it saved and
  audited, then sets it back.

After the walkthrough the Settings form's button width was tightened (one
CSS class); lint, typecheck and build were re-run after that change, not the
walkthrough.
