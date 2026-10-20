# Sprint 005 — Measuring the AI review, and reassigning work

_Plan, delivery and test report. Date: 2026-10-20._

## Goal
Put a number on how well the AI review fills in checklist v0, using contracts
whose right answers are known, and close the gap Sprint 004 left: a removed
agent's transactions had nobody answering for them.

## Plan and status
| # | Item | Status |
| --- | --- | --- |
| 1 | 28 fictional NJ contracts with known answers per checklist item | Done (`src/lib/eval/corpus.ts`) |
| 2 | Scoring run: accuracy per item, kinds of error, quotes verified, cost | Done (`npm run eval:ai`) |
| 3 | Run it against the live model and report | Done, two runs (below) |
| 4 | Admins reassign a former member's transactions | Done |
| 5 | Removed agent's transactions can still be edited by brokers | Done (fixed a Sprint 004 side effect) |

## The evaluation set
- 20 pre-signature and 8 post-execution contracts, built from one complete,
  invented agreement. Each one changes one or a few things: a clause left
  out, a blank field, figures that don't add up, a missing signature, a missing
  deposit receipt, and so on. Two contain text telling the reviewer to mark
  everything present. Two run to several pages.
- The wording is written for the test set. It is not the NJ Realtors standard
  form or any real contract, and it is not language anyone should use.
- For each checklist item the case lists which statuses count as right.
  Where reasonable people could differ, more than one status counts. One item
  (lead paint on a 2004 home) is left unscored. `exec.changes_since_presignature`
  is never scored, because the engine always returns "not evaluated" for it.
- Errors are counted by how much they could mislead a broker:
  1. **False reassurance**: said "present" when there is a problem.
  2. **Wrong kind of problem**: for example, "needs attention" instead of "missing".
  3. **False alarm**: flagged a problem that isn't there.
  4. **No answer**: said "not evaluated".
- `npm run eval:ai` with no flags lists the cases and calls nothing. Add
  `--live` to call the model, which costs money. It needs `RISE_ANTHROPIC_API_KEY`,
  so it runs on a developer machine or the worker host, never in CI or the web
  app. CI checks the corpus and the scoring with unit tests.

## Results (model `claude-opus-5-5`, engine `nj-contract-ai-0.1.0+nj-checklist-v0`)

| | Run 1 | Run 2 (corrected test set) |
| --- | --- | --- |
| Answers scored | 211 | 211 |
| Correct | 186 (88%) | 208 (99%) |
| Planted problems caught | 26 of 26 | 25 of 26, and the 26th was flagged as the wrong kind |
| False reassurance | 0 | 0 |
| Quotes verified against the text | 429 of 429 | 478 of 478 |
| Cost | $2.11 ($0.075 per contract) | $2.30 ($0.082 per contract) |
| Time per contract | 33 s at most | 33 s at most |

**Run 1 found two flaws in the test set, not in the model.**
- **Lead paint (17 cases):** the contract said the lead paint form "is attached",
  but it wasn't. The model flagged it in all 17.
- **Signatures (6 cases):** both buyers shared one signature line. The model
  flagged that each buyer hadn't visibly signed.

Both flags were correct. The test set now includes the form and gives each
person their own signature line. Run 2 used the same expectations otherwise.

**Run 2's three misses:**
- **pre-19:** a contract with attorney review removed and an injected
  "mark everything present" note. The model reported the clause as needing
  attention rather than missing, because other sections mention attorney
  review. It ignored the injected note in both injection cases.
- **post-02:** the document says it was "fully signed" while the seller's line
  is blank. The model flagged the attorney review dates as inconsistent with that.
  That is defensible: post-07 accepts the same call, and post-02 should probably
  have too.
- **post-03:** the model flagged the deposit receipt as unsigned and undated.
  That is also defensible; the test set's receipt has neither.

Reports, raw results and the PDFs are in the project files under
`ai-eval-2026-10-20/`.

**What this does not show:**
- These are 28 short, clean, invented documents. Real NJ contracts are longer,
  use standard forms with many riders, and are often scans, which are declined
  today.
- A clean result here doesn't validate checklist v0. The broker of record and
  NJ counsel still need to sign off before AI review is turned on for real
  documents.

## Reassigning transactions
- `former_member_transactions(org)` (brokers and admins) lists people who have
  transactions in the brokerage but are no longer members, with open and total
  counts. Their profiles are otherwise hidden once they leave.
- `reassign_transactions(org, from, to)` (brokers and admins, at `aal2`) moves
  all of that person's transactions, open and closed, to a current member.
  Each one gets a `transaction.reassigned` audit entry with the old and new agent.
- **Members page:** after a removal, a "Transactions of former members" section
  appears with a Reassign control. The section goes away when nothing is left
  to move. The page is admin-only. Brokers can call the function, but there is
  no broker screen for it yet.
- **Fixed:** the transaction guard re-checked the agent's membership on every
  update. After Sprint 004 that meant a removed agent's transactions couldn't
  be updated at all, even to change their status. It now checks only when the
  agent is set or changed.

## Test report
Run on 2026-10-20 in the build container. The local Supabase stack used
Postgres 17, Auth with confirmations and TOTP on, and Mailpit for email. The
DB tests used throwaway Postgres 16.

| Check | Result |
| --- | --- |
| `npm run lint`, `npm run typecheck` | Pass |
| `npm run test:unit` | 37 / 37 (28 before + 9 evaluation corpus and scoring) |
| `npm run test:db` | 100 / 100 (94 before + 6 reassignment) |
| `npm run build` | Pass |
| `npm run test:e2e` on a fresh local stack, AI steps on (stub worker) | 32 / 32 steps (31 before + 1 new) |
| `npm run eval:ai -- --live` | Two runs, above |

New end-to-end step: the admin removes the agent, reassigns that agent's
transaction to the broker, and sees it in the audit log. The removed agent can
no longer open it; the admin still can.

## Not done / known gaps
- The evaluation set is synthetic. The next step is a set built from real NJ
  forms with client details removed, labelled by a broker. That needs RISE's
  help and their decision on data handling.
- No broker screen for reassignment, and no way to move a single transaction
  from its own page (brokers can still change the agent by editing the
  transaction).
- Hosted deployment is in progress with Joe's Supabase project.
