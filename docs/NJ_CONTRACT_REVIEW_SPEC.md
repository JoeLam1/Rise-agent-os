# NJ Contract Review — Specification

_Draft v0.1. Sprint 001 ships only the workflow and a placeholder ("mock")
analysis. This document specifies the Sprint 002 engine. **The NJ checklist
below is a starting point written by engineering and must be validated by RISE's
broker of record and New Jersey counsel before any engine output is shown to
brokers as more than a draft.** Nothing in this document is legal advice._

## 1. Purpose
Help a broker review an agent's New Jersey residential real estate document
faster and more consistently by pointing at what's present, missing or worth a
closer look, with evidence from the document. The broker always reads the
document and makes the decision. The engine never approves, rejects, or tells
anyone what the law requires in their specific situation.

## 2. Scope
In scope for Sprint 002:
- Document kinds: `purchase_agreement` first; `listing_agreement`, `addendum`,
  `lease` later.
- Review types: `pre_signature` (draft before signing) and `post_execution`
  (fully signed copy).
- Input formats: text-based PDF first; scanned PDF/images via OCR later; DOCX later.

Out of scope: commercial contracts, other states, drafting or editing contract
language, contacting any party, calendaring deadlines automatically.

## 3. Behavior contract
For each checklist item the engine returns one of:

| Status | Meaning | Evidence required |
| --- | --- | --- |
| `present` | The item is found in the document | ≥1 quote with page number |
| `missing` | The engine looked and did not find it | Where it looked (sections/pages) in `note` |
| `needs_attention` | Found, but something looks incomplete or inconsistent | Quote(s) plus a neutral `note` |
| `not_evaluated` | The engine couldn't assess it (unreadable page, unsupported layout, low confidence) | Reason in `note` |

Rules:
- Abstain (`not_evaluated`) rather than guess. Low confidence never becomes `present`.
- Quotes must be verbatim from the document; the worker verifies each quote
  appears in the extracted text and drops any that don't.
- Notes are descriptive ("closing date field is blank"), never advisory
  ("you must…", "this contract is invalid").
- Output must validate against `src/lib/analysis/schema.ts` (`schema_version: 1`).
  Invalid output is stored as a `failed` run and the review still reaches the
  broker, marked as having no analysis.

## 4. Checklist v0 (to be validated)
IDs are stable and already used by the Sprint 001 mock.

### Pre-signature
| ID | Item | Notes for validation |
| --- | --- | --- |
| `nj.attorney_review_clause` | Attorney review clause present | NJ contracts for 1–4 family residential and vacant lots prepared by licensees are expected to include an attorney review clause (commonly cited: N.J.A.C. 11:5-6.2). Counsel to confirm wording requirements and applicability. |
| `nj.consumer_information_statement` | Consumer Information Statement acknowledgment | Commonly cited: N.J.A.C. 11:5-6.9. Confirm when and how acknowledgment must appear. |
| `core.parties_and_property` | Parties, property address, block and lot | |
| `core.price_and_deposits` | Purchase price, deposits and due dates | Check arithmetic consistency across fields. |
| `core.mortgage_contingency` | Mortgage contingency terms and commitment date | |
| `core.inspection_contingency` | Inspection contingency terms and deadlines | |
| `core.closing_date` | Closing date | |
| `disclosure.lead_paint` | Lead-based paint disclosure (pre-1978 housing) | Federal requirement for target housing; engine needs year built or must return `not_evaluated`. |
| `disclosure.seller_property_condition` | Seller property condition disclosure | Counsel to confirm current NJ requirements and form. |

### Post-execution
| ID | Item | Notes |
| --- | --- | --- |
| `exec.signatures_complete` | All parties signed and dated | Signature detection on scanned pages is unreliable; abstain when unsure. |
| `nj.attorney_review_period` | Attorney review period start and end recorded | Engine extracts dates if present; it does not compute legal deadlines. |
| `exec.deposit_receipt` | Deposit receipt documented | |
| `exec.deadlines_calendared` | Contingency deadlines calendared | Extract dates for the broker; no automatic calendaring. |
| `exec.changes_since_presignature` | Changes since pre-signature review identified | Compare against the latest approved pre-signature version of the same document, if any. |

## 5. Processing pipeline (Sprint 002)
1. `request_review()` inserts the review (`pending_analysis`) and a `queued` run.
2. A server-side worker claims the run (`running`), downloads the file with a
   service credential, and verifies its SHA-256 against `document_versions`.
3. Text extraction (and OCR when needed), page-aware.
4. Item evaluation by an LLM with the checklist, extracted text and strict JSON
   output; quotes are verified against extracted text.
5. Schema validation; store `completed` (or `failed` with `error`).
6. Review moves to `ready_for_broker` either way, so a failed analysis never
   blocks broker review.

## 6. Privacy and security
- Documents contain client personal data. Only the worker reads them, server-side.
- Model provider must be configured for zero data retention / no training on inputs.
- Prompts and outputs are stored only in `analysis_runs`, scoped by org with RLS.
- No document content in application logs.

## 7. Evaluation plan
- Build a test corpus of **fictional** NJ contracts (synthetic parties and
  properties) covering complete, incomplete and inconsistent cases. No real
  client documents in the repo or in CI.
- Per-item precision/recall on `present`/`missing`, abstention rate, and quote
  validity (target: 100% of quotes verbatim).
- Broker review of a sample of outputs before enabling for RISE, with sign-off
  from the broker of record.
- Track engine version per run so results are reproducible and comparable.

## 8. UI requirements
- Show engine name and version on every analysis; keep the mock badge for mock runs.
- Show quotes with page numbers next to each item.
- Keep the notice that the decision must be based on the broker's own review.
- Never display an overall "pass/fail" or "approved" from the engine.
