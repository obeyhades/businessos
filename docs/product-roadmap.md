# Product roadmap (Phases 2–9)

Phase 0–1 (foundation, auth, organizations, RBAC, audit, dashboard shell), Phase 2
(customers, projects, tasks, comments, attachments, activity, search) and Phase 3
(personnel) are **done** — see [implementation-plan.md](implementation-plan.md).
**Phase 4 (Quotes & invoicing) is next.** Everything from Phase 4 on is planned, not built.
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

## Phase 4 — Quotes & invoicing

Definition of done:

- Quote → invoice lifecycle with sequential per-organization numbering
- Money as integer minor units + currency per document (convention locked in
  [data-model.md](data-model.md)); VAT lines modeled
- PDF generation and delivery via the existing outbox → email path
- **Professional review of invoice/VAT rules before real use**
  ([legal-review-required.md](legal-review-required.md))

## Phase 5 — Bookkeeping support

Definition of done:

- Chart of accounts, verifications, append-only posted entries; `accounting.post` as a
  distinct permission
- Export formats (e.g. SIE) evaluated
- **Explicitly labeled non-compliant until legal/accounting review passes**
  ([legal-review-required.md](legal-review-required.md))

## Phase 6 — Calendar

Definition of done:

- Org-shared and personal calendars; events linkable to projects/customers
- Task due dates surfaced; permissions `calendar.*` enforced

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
