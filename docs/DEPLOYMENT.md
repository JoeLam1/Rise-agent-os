# Deployment

How to run RISE Agent OS for a real brokerage. **Nothing here has been
deployed yet.** These steps were written against the code in this repo and the
local stack, and have not been run against a hosted Supabase project, Vercel or a
worker host. Treat the first deployment as a test of this document.

## What runs where

| Piece | Where | Secrets it holds |
| --- | --- | --- |
| Database, Auth, Storage | Supabase (hosted project) | — |
| Web app (Next.js) | Vercel | Publishable key only |
| AI review worker + health check | A container host (Render, Fly.io, Railway, …) | Service role key, Anthropic key |
| Email | SMTP provider (Postmark, Resend, SES, …) connected to Supabase Auth | SMTP password, stored in Supabase |
| Alerts | Uptime monitor + heartbeat monitor (e.g. Better Stack, Healthchecks.io) | — |

The web app never gets the service role key or the Anthropic key. Every account
above should be owned by the brokerage (or by the SaaS operator later), not by a
person's private account, and none of it may be shared with Pulse.

## 1. Supabase project

1. Create a project in a US region (e.g. `us-east-1`). Use the **Pro plan**: it
   includes daily backups and doesn't pause idle projects.
2. Apply the schema from this repo:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push        # applies supabase/migrations in order
   ```
   This creates every table, RLS policy and function, plus the private
   `transaction-documents` storage bucket. Migrations are append-only; never
   edit one that has been pushed.
3. **Auth → Sign In / Providers → Email**:
   - Enable email sign-ups.
   - **Confirm email: on.** This is required. Invitations are only accepted once
     an address is confirmed (`20261021000100_invitations.sql`). With it off,
     anyone could sign up with an invited address and join that brokerage.
   - Minimum password length: 8.
4. **Auth → Multi-Factor**: enable **TOTP (authenticator app)**, both enroll and
   verify. Brokers' decisions and all admin actions require it
   (`20261021000200_mfa.sql`).
5. **Auth → URL Configuration**:
   - Site URL: the production app URL, e.g. `https://app.example-brokerage.com`.
     Email links are built from it.
   - Redirect URLs: the same URL.
6. **Auth → Emails → SMTP**: connect the brokerage's SMTP provider. Supabase's
   built-in email only sends a few messages an hour, and only to team members.
   Set the sender to a real address on the brokerage's domain, with SPF/DKIM set up.
7. **Auth → Emails → Templates**: paste in the templates from `supabase/templates/`:

   | Template | Subject | File |
   | --- | --- | --- |
   | Confirm signup | Confirm your email for RISE Agent OS | `confirmation.html` |
   | Magic link | Your RISE Agent OS sign-in link | `magic_link.html` |
   | Reset password | Reset your RISE Agent OS password | `recovery.html` |

   The links point at `/auth/confirm` with a `token_hash`. The default templates
   don't, and email links won't work without these.
8. **Auth → Rate limits**: allow enough emails per hour for invites and resets
   (for example, 30 per hour to start).
9. Note the project URL, the **publishable** key and the **service role** key
   (Project Settings → API). The service role key goes only to the worker host.

## 2. Web app on Vercel

1. Import the GitHub repository. Framework: Next.js. Production branch: `main`.
2. Environment variables (Production and Preview):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
   Nothing else. Never add the service role key or an Anthropic key here.
3. Add the brokerage's domain and make sure it matches the Supabase Site URL.
4. Preview deployments point at the production database unless you give them
   a separate Supabase project. For the pilot, either turn previews off or
   protect them with Vercel's deployment protection.

## 3. AI review worker

The worker is a long-running process. One instance is enough for the pilot: runs
are claimed with row locks, so a second instance is safe but not needed.

1. Build from `Dockerfile.worker`. CI builds it on every change and checks that
   it refuses to start without its secrets.
2. Environment:
   ```
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=...
   RISE_ANTHROPIC_API_KEY=...
   ```
   Use an Anthropic API key from an organization owned by the brokerage, with a
   monthly spend limit. Confirm the data terms (no training on inputs, retention)
   before any real document is analyzed.
3. Restart policy: always. The worker exits on fatal errors, and runs it was
   holding are reclaimed after 15 minutes.
4. AI review stays off for each brokerage until an admin turns it on in
   Settings. Don't turn it on for real documents until:
   - the worker is running,
   - the data terms are confirmed,
   - the broker of record and NJ counsel have signed off on checklist v0.

## 4. Backups

- **Database:** the Pro plan keeps daily backups for 7 days. Add Point-in-Time
  Recovery if losing up to a day of data is not acceptable. PITR is recommended
  once real transactions are stored.
- **Documents (Storage):** database backups don't include the files in Storage.
  Copy the `transaction-documents` bucket to storage the brokerage controls
  (another S3-compatible bucket), on a schedule, using Supabase Storage's S3
  endpoint and a tool such as `rclone sync`. Objects are never modified or
  deleted by the app, so the copy only grows. *Not set up or tested yet.*
- **Restore drill:** before the pilot, restore a backup into a scratch project
  and check that a document downloads and its SHA-256 matches
  `document_versions.sha256`.

## 5. Monitoring and alerts

1. **Uptime:** point an uptime monitor at `https://<app>/login`, expecting HTTP 200.
2. **Health check + heartbeat:** on the worker host, run the health check every
   10 minutes as a scheduled job, with the worker's environment plus:
   ```
   APP_URL=https://<app>
   HEARTBEAT_URL=https://hc-ping.com/<check-id>     # or your provider's ping URL
   ```
   Command: `npx tsx --tsconfig tsconfig.json scripts/health-check.ts`, or `npm run health`.

   It checks that the app answers, the database answers, no AI review has
   waited over 10 minutes, none has been running over 20 minutes, and no more
   than 5 failed in the last day.
   - Each run pings the heartbeat URL, or `<url>/fail` when something is wrong.
   - The heartbeat service alerts if a run fails, or if pings stop (host down).
   - Set its period to 10 minutes and its grace time to 10 minutes.
3. **Logs:** the worker writes one line per run to stdout (claimed, completed,
   or failed with an error class) and the host keeps them. The lines carry run
   IDs, never document text.
4. **Errors in the web app:** Vercel's runtime logs. A dedicated error tracker
   (e.g. Sentry) is not wired in yet.

## 6. First admin and brokerage

1. Open the app, create an account with the broker of record's email, and
   confirm it from the email.
2. Create the brokerage. You become its admin.
3. Turn on two-step sign-in (**Security**, top right). The app asks for it
   before you can invite anyone.
4. Invite brokers and agents from **Members**.

## 7. Account recovery

- **Forgotten password:** self-service from the sign-in page.
- **Lost phone (two-step sign-in):** if the person saved their backup codes
  (Security page), they sign in with their password, choose "Lost your phone?
  Use a backup code", and set up a new authenticator app. The audit log of each
  brokerage they belong to records it.
- **Lost phone and no backup codes:**
  1. Someone with access to the Supabase dashboard confirms the person's
     identity outside the app (in person, or by phone at a known number).
  2. They delete the person's MFA factor under **Authentication → Users → the
     user → Factors**.
  3. Record who did it and why. The person then sets up two-step sign-in again.

## Checklist before real client data

- [ ] Confirm email on; TOTP enabled; Site URL and templates set; SMTP working (send yourself an invite)
- [ ] Vercel has only the two `NEXT_PUBLIC_` variables
- [ ] Worker running; `npm run health` passes; heartbeat and uptime alerts reach a person
- [ ] On staging, a backup code really resets two-step sign-in (it deletes the user's row in
      `auth.mfa_factors`; verified on the local stack, not yet on a hosted project)
- [ ] Database backups on (PITR decided); Storage copy scheduled; one restore drill done
- [ ] Anthropic data terms confirmed; spend limit set
- [ ] Broker of record and NJ counsel sign-off on checklist v0 (before AI review is turned on)
- [ ] Full walkthrough repeated by hand with fictional data on a **staging** project set up the same
      way. Not on production: documents and the audit log are immutable, so test data can't be removed there.
