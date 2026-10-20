# Sprint 003 — Ready for a RISE pilot

_Plan, delivery and test report. Dates: 2026-10-20._

## Goal
Close the gaps between a working build and a first pilot with real brokers:
automatic end-to-end testing, self-service account flows, stronger sign-in for
the people who approve documents, and a written, checkable way to deploy and
watch production.

## Plan and status
| # | Item | Status |
| --- | --- | --- |
| 1 | Browser walkthrough in CI against a local Supabase stack | Done (PR #5) |
| 2 | Email invitations (invite, accept on confirmed address, revoke) | Done (PR #6) |
| 3 | Password reset and set-password page; email links verified server-side | Done (PR #6) |
| 4 | Email confirmation required, locally as in production | Done (PR #6) |
| 5 | Two-step sign-in (TOTP) required for broker decisions and admin actions | Done (PR #7) |
| 6 | Deployment guide: hosted Supabase, Vercel, worker host, backups, alerts | Written (`docs/DEPLOYMENT.md`); **not yet run** |
| 7 | Worker container image, built and smoke-tested in CI | Done (`Dockerfile.worker`) |
| 8 | Health check with heartbeat alerting | Done (`npm run health`); not yet scheduled anywhere |
| 9 | Live AI run on fictional contracts | Done in a separate thread (see below) |
| 10 | Actual hosted deployment | **Not done**: needs the brokerage's own accounts |

## Decisions made
- **Invitations are accepted only on a confirmed email address.** The database
  creates the membership when `auth.users.email_confirmed_at` is set, so signing
  up with someone else's address doesn't get you into their brokerage. This
  means hosted Auth must keep "Confirm email" on, and local config now does too.
- **Inviting someone who already has a confirmed account adds them at once**;
  everyone else gets an emailed link. Invitations expire after 14 days. Inviting
  the same address again replaces the open invitation.
- **Email links carry a `token_hash` and land on `/auth/confirm`**, which
  verifies them on the server. That works in any browser, unlike links that
  depend on a code stored by the browser that asked for them.
- **Two-step sign-in is enforced in Postgres.** `decide_review`, `set_ai_review`,
  `add_org_member`, `invite_member` and `revoke_invitation` require a session at
  assurance level `aal2`. The level is read from the signed JWT. Agents' work
  doesn't need it. It's required for every brokerage, with no per-brokerage switch
  yet.
- **Service credentials stay on the worker host.** The health check runs there
  next to the worker, not in GitHub Actions. Its heartbeat ping is what lets an
  outside service alert when the host itself is down. `CLAUDE.md` says so.
- **Test data can't be cleaned out of production**, because documents and the
  audit log are immutable. So the deployment guide asks for a staging project
  for walkthroughs.

## Live AI run (fictional contracts)
The live model test ran in the project thread "Live AI review run", using
PR #4's harness on 2026-10-20. Model: `claude-opus-5-5`.

| Document | Result | Quotes verified | Time | Cost |
| --- | --- | --- | --- | --- |
| Complete agreement | 7 present, 2 need attention | 17 of 17 | 23 s | ~$0.07 |
| Incomplete agreement (blanks) | 4 missing, 5 need attention | 11 of 11 | 20 s | ~$0.05 |
| Image-only "scan" | Declined before any model call (no text layer) | — | — | $0 |

In the complete agreement, the "needs attention" on price and deposits was
correct: the fictional figures don't add up to the price. This is one small run,
not an evaluation. Output quality across real NJ forms is still unmeasured.

## Test report
Run on 2026-10-20 in the build container. The local Supabase stack used
Postgres 17, Auth with confirmations and TOTP on, and Mailpit for email.
The DB tests used throwaway Postgres 16.

| Check | Result |
| --- | --- |
| `npm run lint`, `npm run typecheck` | Pass |
| `npm run test:unit` | 28 / 28 (23 before + 5 health rules) |
| `npm run test:db` | 84 / 84 (66 before + 13 invitations + 5 two-step sign-in) |
| `npm run build` | Pass |
| `npm run test:e2e` on a fresh local stack | 29 / 29 steps (22 before + 7 new) |
| CI (`check`, `e2e`) on PRs #5, #6, #7 | Green |
| `npm run health` against the local stack | Passes; exits 1 and reports when the app is unreachable |
| Worker image | Builds and refuses to start without secrets, in CI. The local Docker build couldn't reach npm through the container's proxy. |

New end-to-end steps:
1. Admin can't manage members until two-step sign-in is on, then turns it on.
2. Broker can't approve without two-step sign-in, then turns it on.
3. Admin invites someone without an account. They open the emailed link, set
   a password and are in the brokerage. The invitation leaves the pending list.
4. Admin revokes an invitation.
5. Forgotten password: reset link by email, new password works and the old one
   doesn't.
6. Signing in again asks for the authenticator code. A wrong code is refused,
   and a password-only session can't open app pages.
7. A broken or used email link is refused.

Every sign-up in the walkthrough now confirms its address through Mailpit.

## Not done / known gaps
- **No hosted deployment yet.** `docs/DEPLOYMENT.md` hasn't been run against
  real Supabase, Vercel or worker-host accounts. Those need to be created by
  the brokerage.
- **Lost phone:** recovering two-step sign-in is a manual step in the Supabase
  dashboard. There are no recovery codes yet.
- **Storage backups** are described but not set up or tested. A restore drill
  hasn't been done.
- **No error tracker** in the web app (e.g. Sentry).
- **No admin view of members' two-step status**, and members can't be removed
  or have their roles changed in the app yet.
- **Checklist v0** still needs sign-off from the broker of record and NJ counsel
  before AI review is turned on for real documents.
