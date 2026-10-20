# Product Requirements — RISE Agent OS

_Draft v0.1, written for Sprint 001. Owner: Joe. Status: proposed; needs review by RISE leadership._

## 1. Problem
Brokerages run transactions across email, shared drives and paper checklists.
Brokers are responsible for supervising agents' contracts, but have no single
place to see what's pending, what was reviewed, which version was reviewed, and
who approved it. In New Jersey, timing matters: the attorney review period and
contingency deadlines start running at execution.

## 2. Goals
1. One workspace per brokerage for transactions, documents and compliance review.
2. Broker supervision with a clear record: what was reviewed, which exact file
   version, by whom, when, and with what outcome.
3. Assistive contract analysis for NJ residential contracts (Sprint 002+) that
   speeds up broker review without replacing it.
4. Commercial SaaS: many independent brokerages on one platform, fully isolated.

## 3. Non-goals (for now)
- E-signature, sending documents to clients, MLS integration, commission
  accounting, CRM/lead management.
- Any automated legal action or legal advice. Software never approves a contract.
- Consumer-facing (buyer/seller) access.

## 4. Users and roles
| Role | Who | Can |
| --- | --- | --- |
| Agent | Licensed salesperson | Create and manage own transactions, upload documents, request reviews, see own reviews |
| Broker | Broker of record / managing broker | Everything an agent can, across the whole brokerage; decide reviews; read the audit log |
| Admin | Office admin or owner | Broker permissions plus member management |

A person can belong to several brokerages with a different role in each.

## 5. Requirements

### 5.1 Tenancy and access (Sprint 001)
- R1. Every record belongs to exactly one brokerage. No user can read or write
  another brokerage's data through any API path.
- R2. Agents see only transactions where they are the agent. Brokers and admins
  see all transactions in their brokerage.
- R3. Only admins add members or change roles. Users cannot change their own role.

### 5.2 Transactions (Sprint 001)
- R4. Create a transaction with property address, city, state (default NJ),
  side represented, expected close date and notes.
- R5. List transactions, filter by status; open a transaction detail page.
- R6. Status lifecycle: draft → active → under contract → closed, or cancelled.
  Transactions are never deleted.

### 5.3 Documents (Sprint 001)
- R7. Upload PDF, Word, PNG or JPEG files up to 10 MB to a transaction.
- R8. Files are private: no public URLs; downloads use short-lived signed links
  issued only to users who can see the transaction.
- R9. Each upload creates a new numbered version with its SHA-256 hash, size,
  uploader and time. Versions can't be edited, replaced or deleted.

### 5.4 Review (Sprint 001 workflow, Sprint 002 analysis)
- R10. Agents request a **pre-signature** or **post-execution** review on a
  specific document version.
- R11. Each review gets an analysis run. In Sprint 001 it is a clearly labelled
  mock that evaluates nothing.
- R12. Brokers work two queues (pre-signature, post-execution), oldest first.
- R13. A broker or admin decides: approve, request changes (note required),
  or reject (note required). Decisions are final; a new upload starts a new review.
- R14. Nobody decides a review they requested.
- R15. The requester or a broker can withdraw an open review.

### 5.5 Audit (Sprint 001)
- R16. Every create/update of organizations, memberships, transactions,
  documents, versions, reviews and analysis runs is written to an append-only
  audit log by the database, with actor and time.
- R17. Brokers and admins can read their brokerage's audit log; agents cannot.

### 5.6 NJ contract analysis (Sprint 002)
See `NJ_CONTRACT_REVIEW_SPEC.md`.

## 6. Constraints
- No real client records in development, tests, demos or docs.
- Independent from Pulse: no shared code, data or infrastructure.
- Stack: Next.js App Router, TypeScript, Tailwind, shadcn/ui, Supabase.

## 7. Success measures (pilot with RISE)
- Brokers can see every open review in one place, and every decision is traceable to a file hash.
- Zero cross-tenant access findings in security testing.
- Median time from review request to broker decision (baseline in pilot, target set after).

## 8. Open questions for RISE
1. Should a broker who is also the transaction's agent be allowed to decide it if no other broker exists? (Currently: no; an admin must.)
2. Which document types require pre-signature review by brokerage policy?
3. Retention period for documents and audit records after closing.
4. Who at RISE validates the NJ checklist in the review spec (broker of record, counsel)?
