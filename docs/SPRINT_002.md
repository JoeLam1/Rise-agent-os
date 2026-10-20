# Sprint 002 — NJ AI contract review

_Plan, delivery and test report. Dates: started 2026-10-20._

## Goal
Replace the placeholder analysis with a real, opt-in AI checklist for New Jersey
residential contracts, following `docs/NJ_CONTRACT_REVIEW_SPEC.md`, without
weakening any Sprint 001 guarantee: tenant isolation in Postgres, no service key
in the app, immutable records, and only a human broker decides.

## Plan and status
| # | Item | Status |
| --- | --- | --- |
| 1 | Asynchronous analysis runs (queued → running → completed / failed) | Done (`20261020000300_ai_review.sql`) |
| 2 | Service-role-only worker RPCs; lifecycle trigger; finished runs immutable | Done |
| 3 | Per-brokerage opt-in, admin only, audited | Done (Settings page) |
| 4 | Worker process: download, SHA-256 check, analyze, complete or fail | Done (`npm run worker`) |
| 5 | PDF text extraction and NJ checklist engine (Claude) | Done for text-based PDFs |
| 6 | Quote verification against the document text | Done |
| 7 | Review screen: evidence quotes with pages, draft notice, analyzing / failed states | Done |
| 8 | Tests with fictional contracts | Done (model call stubbed; see below) |
| 9 | Live run against the model with fictional contracts | **Not done**: needs an API key in the environment |
| 10 | `exec.changes_since_presignature` comparison | Not built; always `not_evaluated` |
| 11 | Scanned PDFs (OCR), DOCX, images | Not built; such files fail AI analysis or use the mock |

## Decisions made
- **Opt-in per brokerage, off by default.** Sending client documents to an AI
  provider is a data-handling decision for each brokerage's admin. While off,
  reviews use the Sprint 001 mock.
- **A failed analysis never blocks the broker.** The review moves to
  `ready_for_broker` with the failure reason shown. `decide_review()` now
  requires analysis to have *finished* (completed or failed) rather than completed.
- **Quotes or it didn't happen.** Items marked present / needs attention with no
  quote found in the PDF text are downgraded to "Not evaluated", and the result
  shows how many quotes were dropped.
- **The model sees the PDF itself** (layout, checkboxes, signature blocks);
  verification uses text extracted separately with `unpdf`.
- **Model settings:** `claude-opus-5-5`, adaptive thinking, effort `high`,
  JSON-schema structured output, streaming. Server-side refusal fallback is
  enabled (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`): if the
  primary model declines, the API retries on its default fallback model inside
  the same call. The model that answered is stored in the result.
- **No retry button yet.** A failed run is final for that review; the agent can
  withdraw and request again. Crashed workers are recovered automatically
  (reclaimed after 15 minutes, failed after 3 attempts).

## Running the worker
The worker is a separate Node process, never part of the Next.js app.

```bash
export SUPABASE_URL=http://127.0.0.1:54321          # or the hosted project URL
export SUPABASE_SERVICE_ROLE_KEY=...                # server-side only
export ANTHROPIC_API_KEY=...                        # server-side only
npm run worker            # poll every 5 s
npm run worker -- --once  # drain the queue and exit
```

Before turning AI review on for a brokerage with real documents: confirm the
data agreement with the provider (zero retention / no training), and have the
broker of record and NJ counsel sign off on checklist v0.

## Test report
Run on 2026-10-20 in the build container (Node 22, PostgreSQL 16 for DB tests,
local Supabase stack with Postgres 17 for E2E):

| Check | Result |
| --- | --- |
| `npm run lint` | Pass, 0 problems |
| `npm run typecheck` | Pass |
| `npm run test:unit` | 23 / 23 passed (13 Sprint 001 + 10 new) |
| `npm run test:db` | 66 / 66 passed (48 Sprint 001 + 18 new) |
| `npm run build` | Pass (16 routes) |
| `npm run test:e2e` against a local Supabase stack | 22 / 22 steps passed (16 Sprint 001 + 6 new) |
| Live model call | **Not run**: no `ANTHROPIC_API_KEY` in the build environment |

New DB tests (`tests/db/ai-review.test.ts`):
- Only an admin of the brokerage can switch AI review; direct column updates are
  refused; the switch is audited.
- With AI on, a PDF review gets a queued `nj_contract_ai` run and stays
  `pending_analysis`; AI off or a non-PDF gets the mock; a broker can't decide
  while analysis is pending.
- Signed-in users (any role, any brokerage) and anonymous requests can't claim,
  complete or fail runs, or write `analysis_runs` directly.
- claim → complete hands the review to the broker; claim → fail does too, and
  the broker can still decide.
- Results that claim to be mock, name another engine version or lack items are
  refused; finished runs are immutable even for a superuser; mock runs can't be
  touched by the worker; a queued run can't jump to completed.
- Withdrawing cancels the queued run and the worker never picks it up; a crashed
  run is reclaimed and then failed after the attempt limit.
- Another brokerage never sees the runs.

New unit tests (`src/lib/analysis/analysis.test.ts`): quote normalization and
matching, invented and too-short quotes rejected, downgrade of unverified
findings, checklist order and unknown IDs, the comparison item never evaluated,
request parameters (model, thinking, effort, structured output, fallback), PDF /
text-layer guards, refusal, truncation and malformed-output handling.

### End-to-end walkthrough, new steps
Steps 17–22 of `tests/e2e/walkthrough.mjs` run the real worker pipeline
(`tests/e2e/stub-worker.ts`: claim, Storage download, SHA-256 check, `unpdf`
extraction, quote verification, complete / fail RPCs) with the **model call
replaced by a stub** that returns fixed answers, one of them with an invented
quote. The stub's summary says no AI model was called.

17. Agent can't open Settings; admin turns AI review on
18. Agent requests review of a fictional PDF; agent and broker both see "Analyzing the document…" and no Approve button
19. Worker runs; the agent's page refreshes on its own to the draft checklist with the real quote and page number; the invented quote is not shown and its item is "Not evaluated"; "2 of 3 quotes were found"
20. Broker approves with a note
21. A PDF with no text fails analysis with a clear reason, still reaches the broker, who requests changes
22. Audit log shows the AI switch and analysis-run updates

## Not tested yet (known gaps)
- **No live model call has been made.** Output quality, latency and cost are
  unmeasured. Next step: add an API key as an environment secret, run the
  fictional corpus, and score it per spec §7.
- No evaluation corpus yet beyond the E2E fixture.
- Checklist v0 has not been validated by the broker of record or NJ counsel; the
  UI says so on every AI result.
- E2E still isn't in CI (no Supabase stack there).
- Worker deployment (where it runs in production, monitoring, alerting) is not set up.
