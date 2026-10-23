# Sprint 006 — What brokers use every day

_Plan, delivery and test report. Date: 2026-10-23._

## Goal
Give brokers and agents the day-to-day tools a pilot needs, without waiting on
the hosted accounts:
- see what changed between the draft a broker approved and the signed copy;
- keep each transaction's key dates in one place;
- measure how quickly reviews are decided. The PRD (§7) names this as a pilot success measure.

## Plan and status
| # | Item | Status |
| --- | --- | --- |
| 1 | Word-by-word comparison of two versions of a document | Done |
| 2 | Post-execution reviews link to the approved pre-signature version | Done |
| 3 | Key dates per transaction (attorney review end, inspection, mortgage commitment, appraisal, closing, other) | Done |
| 4 | "Due in the next two weeks" on the agent and broker dashboards | Done |
| 5 | Review turnaround on the broker dashboard | Done |

## Decisions made
- **The comparison is plain text, not AI.**
  - It extracts each PDF's text layer and compares words with Myers'
    algorithm (`src/lib/compare/diff.ts`). Each change is shown with eight words
    of context and the page it's on.
  - Curly quotes, dashes and reflowed lines count as unchanged.
  - It says plainly that it can't see images, handwriting, initials or
    signatures. Scans and non-PDFs get a message telling the broker to compare
    the documents directly.
  - Beyond 1,500 word edits it reports the files as different documents rather
    than a wall of changes.
- **The comparison runs with the viewer's session.**
  - The server downloads both files from Storage as the signed-in user, so
    Storage RLS decides access, as it does for downloads.
  - Nothing is stored, and no service key is involved.
- **Which version is "the approved draft".** The most recently approved
  pre-signature review in the same transaction, preferring one on the same
  document.
- **The AI checklist item stays "not evaluated".** Its note now points to the
  comparison. `exec.changes_since_presignature` is not filled in by the AI.
- **Key dates are entered, never computed.**
  - The app shows the dates people type in from the contract. It doesn't work
    out attorney review or contingency deadlines.
  - "Today" is the New Jersey calendar day.
- **Whoever can see a transaction manages its dates**: its agent, or the
  brokerage's brokers and admins. When a date is marked done, the database
  stamps who did it and when; the client's values are ignored.
- **Every key date change is audited.** Adding, changing, completing,
  reopening and removing a date each write an audit entry. A changed due date
  records the old one.
- **Turnaround:**
  - It is the median time from request to decision over the last 30 days,
    plus how long the oldest open review has waited.
  - Withdrawn reviews are left out. Nobody decided them.

## Test report
Run on 2026-10-23 in the build container. The local Supabase stack used
Postgres 17, Auth with confirmations and TOTP on, and Mailpit for email. The
DB tests used throwaway Postgres 16.

| Check | Result |
| --- | --- |
| `npm run lint`, `npm run typecheck` | Pass |
| `npm run test:unit` | 49 / 49 (37 before + 7 comparison + 5 dates and turnaround) |
| `npm run test:db` | 107 / 107 (100 before + 7 key dates) |
| `npm run build` | Pass |
| `npm run test:e2e` on a fresh local stack, AI steps on (stub worker) | 35 / 35 steps (32 before + 3 new) |

**Coverage:**
- The comparison's edit script is checked against a brute-force
  longest-common-subsequence on 300 random inputs.
- Key-date tests cover:
  - visibility by role and across brokerages;
  - no adding to someone else's transaction;
  - "Other" needing a note;
  - the database stamping completion;
  - transaction and author being immutable;
  - the audit entries.

**New end-to-end steps:**
1. The agent adds key dates; "Other" without a note is refused. The date shows
   on the agent and broker dashboards. The broker marks it done, it leaves the
   list, and the audit log records it.
2. After a decision, the broker dashboard shows one decision and a median time.
3. The agent compares v2 with v1. They then upload a signed v3 and request a
   post-execution review. The broker follows the link from that review to the
   comparison with the approved v2 and sees the added text.

## Not done / known gaps
- **No email reminders for upcoming dates yet.** That needs the email sender
  from the hosting setup.
- **The comparison reads text only.** For scanned signed copies, which are
  common, it can't help until OCR is added.
- **One time zone (New Jersey) for every brokerage.** A per-brokerage setting
  is needed before brokerages outside the Eastern time zone.
- **Hosted deployment is still waiting** on confirmation that the Supabase
  project has the schema.
