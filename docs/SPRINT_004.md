# Sprint 004 — Member management and sign-in recovery

_Plan, delivery and test report. Date: 2026-10-20._

## Goal
Let a brokerage's admin run their own team, and give brokers and admins a
self-service way back in when they lose the phone with their authenticator
app. None of this needs hosted accounts, so it runs alongside the deployment
setup.

## Plan and status
| # | Item | Status |
| --- | --- | --- |
| 1 | Change a member's role (admin, two-step sign-in, never leaves zero admins) | Done |
| 2 | Remove a member; their work stays with the brokerage | Done |
| 3 | Members page shows who has two-step sign-in | Done |
| 4 | Backup codes: create on the Security page, use from the sign-in code screen | Done |
| 5 | Close the direct-write path on `memberships` that skipped two-step sign-in | Done |

## Decisions made
- **Fixed a gap from Sprint 001.** Admins could still write `memberships`
  directly under RLS, without two-step sign-in and without the last-admin rule.
  Those grants and policies are gone; every membership change goes through a
  function.
- **The last admin can't be demoted or removed.** Another admin has to be
  appointed first.
- **Removing someone keeps their work.** Transactions, documents, reviews and
  audit entries stay with the brokerage, and the removed person loses access.
  Reassigning their open transactions to another agent isn't built yet.
- **Backup codes reset, they don't sign you in.** A code (after the password)
  removes the lost authenticator, and the person sets up a new one before doing
  anything that needs two-step sign-in. That keeps the codes simple and avoids
  Supabase's experimental recovery-code feature.
- **Admins can't reset someone else's two-step sign-in in the app.** Without
  backup codes it stays the manual dashboard step in `docs/DEPLOYMENT.md`.

## Test report
Run on 2026-10-20 in the build container: local Supabase stack, and throwaway
Postgres 16 for the DB tests.

| Check | Result |
| --- | --- |
| `npm run lint`, `npm run typecheck`, `npm run build` | Pass |
| `npm run test:unit` | 28 / 28 |
| `npm run test:db` | 94 / 94 (84 before + 10 new in `tests/db/members.test.ts`) |
| `npm run test:e2e` on a fresh local stack | 31 / 31 steps (29 before + 2 new) |

New DB tests:
- Nobody, including admins, can write `memberships` directly.
- Only an admin of that brokerage, with two-step sign-in, can change a role or
  remove someone. It's audited.
- The last admin can't step down; with a second admin, they can.
- A removed agent sees nothing, and their transaction is still there for the broker.
- Two-step status is visible to admins only.
- `auth.mfa_factors` and the backup codes can't be read by signed-in users.
- Backup codes:
  - need a two-step session to create, and only hashes are stored;
  - a valid code works once, removes the authenticator, cancels the other
    codes and is audited;
  - another person's code does nothing;
  - five wrong codes lock the form.

New end-to-end steps:
1. Admin sees who has two-step sign-in. The only admin can't step down. They
   change the invited member to broker, then remove them, and the audit log
   shows it.
2. Broker creates backup codes and signs in on a new device. They choose "Lost
   your phone?" and a wrong code is refused. A real code removes the old
   authenticator; they set up a new one and open the broker dashboard.

## Not done / known gaps
- Reassigning a removed agent's transactions.
- Backup codes on a hosted Supabase project haven't been tried. The function
  deletes from `auth.mfa_factors`, which works on the local stack. There's a
  line for it in the deployment checklist.
- Hosted deployment is still waiting on the brokerage's accounts.
