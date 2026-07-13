# Product roadmap (Phases 2–9)

Phase 0–1 (foundation, auth, organizations, RBAC, audit, dashboard shell) is the current
iteration — see [implementation-plan.md](implementation-plan.md). Everything below is
planned, not built. Permissions for all of these modules already exist in the reviewed
matrix (`packages/types/src/permissions.ts`), and each module attaches per the patterns in
[architecture.md](architecture.md#where-future-modules-attach).

## Phase 2 — Customers, projects, tasks

First user of MinIO/S3 (file attachments).

Definition of done:

- Customer registry with contacts; projects linked to customers; tasks linked to projects
  with assignee, status and due date
- File attachments stored in object storage, scoped to the organization
- Permissions `customers.*`, `projects.*`, `tasks.*` enforced end-to-end with tests
- List/detail UI with loading/empty/error states, i18n (en/sv)

## Phase 3 — Personnel

Definition of done:

- Employee records with employment data; sensitive fields (personnummer, salary) readable
  only with `personnel.read_sensitive`
- Audit log entries for every read of sensitive data
- GDPR impact assessed for the fields stored (feeds Phase 9 retention work)

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
