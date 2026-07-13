# Product roadmap (Phases 2–9)

Phase 0–1 (foundation, auth, organizations, RBAC, audit, dashboard shell), Phase 2
(customers, projects, tasks, comments, attachments, activity, search), Phase 3
(personnel), Phase 4 (quotes & invoicing), Phase 5 (bookkeeping support) and Phase 6
(calendar & tasks) are **done** — see [implementation-plan.md](implementation-plan.md).
**Phase 7 (Email module) is next.** Everything from Phase 7 on is planned, not built.
Permissions for all of these modules already exist in the reviewed matrix
(`packages/types/src/permissions.ts`), and each module attaches per the patterns in
[architecture.md](architecture.md#where-future-modules-attach).

## Phase 2 — Customers, projects, tasks — **Done**

First user of MinIO/S3 (file attachments).

Delivered:

- Customer registry with contacts; projects linked to customers; tasks linked to
  customers/projects with assignee, status, priority and due date
- Threaded comments and file attachments (25 MB / content-type allow-list, signed 5-minute
  downloads) polymorphic over customers/projects/tasks, scoped to the organization
- User-facing activity timelines (denormalized customer chain) and org-wide,
  permission-scoped search; `task.completed` domain event on the outbox
- Permissions `customers.*`, `projects.*`, `tasks.*` enforced end-to-end with tests
- List/detail UI with loading/empty/error states, i18n (en/sv)

## Phase 3 — Personnel — **Done**

Delivered:

- Employee records with a **two-tier sensitivity model** — directory fields
  (`personnel.read`) separated from sensitive personal data (personnummer, date of birth,
  home address, emergency contact — `personnel.read_sensitive`, OWNER/ADMIN only); the
  sensitive block is omitted from serialization for everyone else and never appears in the
  list
- `employee.sensitive_viewed` **audit entry on every sensitive detail read**; sensitive
  writes and internal notes also gated by `personnel.read_sensitive`; sensitive documents
  return 404 to directory-only viewers; pino redaction of the personal fields
- Certifications with an expiry dashboard query, an absence-request workflow
  (request → review/cancel), and categorized employee documents on MinIO/S3
- **Onboarding templates that generate real, dated tasks** linked to the employee, feeding
  the shared activity timeline via the denormalized `employee_id`
- Permissions `personnel.read`, `personnel.read_sensitive`, `personnel.manage` enforced
  end-to-end; search extended to `kind: 'employee'` (directory fields only)

GDPR note: the stored fields are special-category personal data and still **require legal/DPO
review** (lawful basis, retention, right-to-erasure) — feeds the Phase 9 retention/export
work. See [legal-review-required.md](legal-review-required.md).

## Phase 4 — Quotes & invoicing — **Done**

Delivered:

- Product catalogue feeding quotes and invoices; quote lifecycle
  `DRAFT → SENT → ACCEPTED → convert`, and a converted quote produces a new **draft invoice**
- Invoices editable only while draft; **finalize** assigns a sequential, concurrency-safe
  per-organization number, freezes the document (**immutable** — corrections via credit
  notes only) and generates a PDF; then send (email with PDF attached), payments (partial
  allowed, **overpayment rejected**) and credit notes (full/partial, **over-credit
  rejected**, full → `CREDITED`)
- **Deterministic money**: integer minor units + currency per document, decimal.js with
  HALF_UP line-level rounding, VAT modeled as per-rate `tax_lines` — never floating point
- PDF (pdfkit → MinIO via `@businessos/storage`) delivered through the existing outbox →
  email path; an overdue sweep flags unpaid past-due invoices
- New domain events `quote.accepted`, `invoice.finalized`, `invoice.sent`,
  `payment.registered`; **`invoice.finalized` is the accounting-draft hook Phase 5 consumes**
- Permissions `invoices.read` / `invoices.manage` enforced end-to-end
- **Professional review of invoice/VAT rules still required before real use** — the money/VAT
  machinery is a technical foundation only ([legal-review-required.md](legal-review-required.md))

## Phase 5 — Bookkeeping support — **Done**

Delivered:

- **Double-entry ledger**: chart of accounts (typed ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE,
  per-org unique code), fiscal years and periods (`OPEN`/`LOCKED`/`CLOSED`), and vouchers
  (verifikationer) with ≥2 debit/credit lines — money as integer minor units (`BigInt`)
- **Voucher lifecycle** `DRAFT → POST → REVERSED`: a draft may be unbalanced; **posting**
  enforces balance (Σ debit = Σ credit), ≥2 lines, non-zero, a covering `OPEN` period, assigns a
  concurrency-safe per-org number (`V-` sequence) and makes the entry **immutable**; corrections
  are made only by a **reversing voucher** (debit/credit swapped, nets to zero) — posted entries
  are never edited or deleted. Reconciliation status on posted vouchers
- **`accounting.post` as a distinct permission** (separate from `accounting.read` /
  `accounting.manage`); OWNER/ADMIN/ACCOUNTANT post, READONLY reads, MANAGER/EMPLOYEE none
- **Configurable rules (`AccountMapping`)** + a worker consumer that turns the Phase 4
  **`invoice.finalized`** and **`payment.registered`** events into **DRAFT vouchers** an
  accountant reviews and posts — idempotent, **never auto-posted**
- **Reports**: trial balance and general ledger (running balances); **CSV exports** as the first
  export format (SIE and other e-accounting formats deferred)
- **Integration seam**: `voucher.posted` / `voucher.reversed` domain events emitted to the
  outbox for future accounting-system integrations (no internal consumer binds them yet)
- **Explicitly labeled bookkeeping _support_, non-compliant until legal/accounting review
  passes** — not certified for bokföringslagen / BFN, VAT reporting, SIE export, archiving or
  tax filing ([legal-review-required.md](legal-review-required.md))

## Phase 6 — Calendar & tasks — **Done**

Delivered:

- **Team (shared) and personal (owner-only) calendars**, one default per org; events with
  title/time/location, all-day, timezone, status (`CONFIRMED`/`TENTATIVE`/`CANCELLED`) and
  **`DEFAULT` vs `PRIVATE` visibility** (a private event is visible only to its organizer and
  attendees — enforced on the range list, single GET and agenda)
- **Attendees + RSVP** (`NEEDS_ACTION`/`ACCEPTED`/`DECLINED`/`TENTATIVE`); the organizer is
  auto-added as an accepted attendee and cannot be removed. **Business-context links** to
  customer/project/task that post to that entity's activity timeline
- **Recurrence** (freq/interval/byWeekday/count/until) stored as a rule on the event and
  **expanded server-side per query** by a pure, deterministic, bounded expander over UTC calendar
  units; **per-occurrence exceptions** cancel or override (retitle/move) a single occurrence
- **Reminders** with a **worker reminder-sweep** that emails non-declined attendees through the
  existing outbox → email pipeline, **idempotent** via the `sent_reminders` unique
  `(reminderId, occurrenceStart)`
- **Agenda** (a user's events merged with their due tasks) and **free/busy** (busy blocks, times
  only, never details) for any org member
- **Integration seam**: `calendar.event.created/updated/cancelled` domain events emitted to the
  outbox for future external calendar-sync (no internal consumer binds them yet)
- Permissions `calendar.read` / `calendar.manage` enforced end-to-end (OWNER/ADMIN/MANAGER
  manage, EMPLOYEE/READONLY read, ACCOUNTANT none)

**Future work:** **DST-correct local recurrence** (today recurrence is UTC-exact, so an event
does not keep a fixed _local_ wall-clock time across a daylight-saving transition — see
[architecture.md](architecture.md#server-side-recurrence-expansion-phase-6)) and **external
calendar sync** (Google Calendar / Microsoft 365), which the `calendar.event.*` seam is designed
to feed.

## Phase 7 — Email module

Definition of done:

- Sending real (non-transactional) email from the platform with per-org sender identity
- `email.read`/`email.send` permissions enforced; deliverability (SPF/DKIM) documented
- Current email pipeline (Mailpit-only transactional mail) upgraded to a production SMTP
  provider

## Phase 8 — Voice notes

Definition of done:

- Audio recording upload to object storage; async transcription as queued jobs on the
  existing RabbitMQ topology; `recordings.*` permissions enforced

## Phase 9 — Integrations & compliance hardening

Definition of done:

- External integrations (webhooks as consumers of `businessos.events`; first-party
  integrations as needed)
- **Data retention policies enforced**; **organization export and deletion implemented**
  (GDPR portability/erasure — currently designed-not-implemented)
- Postgres row-level security re-evaluated (ADR-0004) and a decision recorded
- Multi-worker outbox via `SELECT … FOR UPDATE SKIP LOCKED` if scale requires (ADR-0005)
- Custom role editor evaluated (matrix is code-defined today, ADR-0003)
