# Architecture

BusinessOS is a modular monolith: one API process, one background worker, one PostgreSQL
database. Modules are separated by directory convention and service boundaries, not by
network boundaries — extraction into services later is possible because modules only talk
to each other through service functions and domain events.

## Monorepo layout

```
apps/
  web        Next.js 15 (App Router) — UI only; no database access, talks to the API
             through the typed client in packages/api-client
  api        Fastify 5 + Zod + Prisma — REST API, OpenAPI generation, session auth, RBAC
  worker     Node service — outbox relay, RabbitMQ consumers (email), retry/DLQ handling
packages/
  types      shared domain types: role/permission matrix, event names, zod contracts
             (request/response schemas shared by api, web and api-client)
  db         Prisma schema, migrations, seed, generated client
  config     zod-validated environment loading (apps refuse to boot on bad config)
  storage    S3/MinIO object-storage wrapper (attachments, employee + invoice PDFs)
  api-client typed fetch client over the API contracts
  ui         shared React components
  tsconfig   shared strict TypeScript configs
  eslint-config shared flat ESLint config
infrastructure/  docker-compose init scripts
docs/            this documentation, ADRs in docs/decisions/
```

## Module boundaries

Inside `apps/api/src/modules/` each module owns its routes, service and (where needed)
helpers:

- `health` — liveness/readiness probes
- `auth` — register, login, logout, password reset, session introspection
- `me` — profile and password of the authenticated user
- `organizations` — CRUD on the active organization, org switching
- `members` — membership listing, role changes, removal
- `invitations` — invite lifecycle (create, list, revoke, preview, accept)
- `audit` / `audit-logs` — audit recording service and read API
- `admin` — platform-operator surface (failed jobs)
- `outbox` — helper to enqueue domain events/commands inside a transaction
- `customers` / `contacts` — customer registry and per-customer contacts (Phase 2)
- `projects` / `tasks` — projects linked to customers, tasks linked to both (Phase 2)
- `comments` / `attachments` — polymorphic notes and files over customers/projects/tasks (Phase 2)
- `activity` / `search` — user-facing timeline feed and org-wide permission-scoped search (Phase 2)
- `employees` — employee directory + sensitive tier, onboarding template application, per-employee activity (Phase 3)
- `employee-notes` / `certifications` / `absences` / `employee-documents` — restricted notes, qualifications, leave workflow, and categorized documents (Phase 3)
- `onboarding-templates` — reusable onboarding/offboarding checklists that generate tasks (Phase 3)
- `products` / `quotes` / `invoices` / `payments` / `credit-notes` (`billing`) — catalogue, quote/invoice lifecycle, deterministic money, numbering (Phase 4)
- `accounting` — chart of accounts, fiscal years/periods, vouchers (journal entries), voucher attachments and reports (Phase 5)

Hard rules enforced by structure:

- `apps/web` has **no** Prisma or database dependency.
- Business logic lives in `service.ts` files, not in route handlers or React components.
- Route handlers validate with zod schemas from `packages/types` (allow-lists), call
  services, and map to DTOs via serializer allow-lists.

## Request lifecycle

1. **Cookie session** — every request passes an `onRequest` hook that reads the
   `bos_session` HttpOnly cookie, hashes the raw token (SHA-256) and looks up the session
   row. Expired or unknown tokens leave the request anonymous.
2. **Auth context** — a valid session populates `request.currentUser`,
   `request.currentSession` and, if the session has an `activeOrganizationId`,
   `request.membership` (re-checked against the database on every request, so removals and
   role changes take effect immediately).
3. **Permission preHandler** — routes declare one of `requireAuth`,
   `requirePermission('<perm>')` or `requirePlatformAdmin`. `requirePermission` checks
   the code-defined role→permission matrix in `packages/types/src/permissions.ts`.
4. **Service** — the handler calls a service function with the tenant context from
   `orgContext(request)`; domain changes, audit rows and outbox messages are written in a
   single Prisma transaction.
5. **Prisma** — one PostgreSQL database; responses are serialized through zod response
   schemas (fields not in the schema never leave the API).

## Tenancy model

- Every tenant-owned table carries `organizationId`.
- The active organization is resolved **exclusively from the server-side session**
  (`sessions.active_organization_id`). Client-supplied organization IDs are only accepted
  on `POST /v1/organizations/switch`, where they are validated against an actual
  membership row before the session is updated.
- Queries in org-scoped modules always filter by the session-resolved `organizationId`;
  integration tests assert cross-tenant reads/writes fail.
- Shared schema (no schema-per-tenant); Postgres row-level security was considered and
  deferred — see [ADR-0004](decisions/adr-0004-shared-schema-tenancy.md).

## Outbox and event flow

Domain events and commands are written to the `outbox_messages` table **in the same
transaction** as the domain change (ADR-0005), then relayed to RabbitMQ by the worker.

```
api tx: domain change + audit_logs + outbox_messages
                                        │
                    worker outbox relay (poll 1s, batch 50, confirm-publish)
                                        ▼
              businessos.events (topic exchange, routing key = message type)
                    │
                    ├── routing key email.send ──▶ email.send queue ──▶ email consumer ──▶ SMTP (Mailpit)
                    │                                   │ failure, attempt < 5
                    │                                   ▼
                    │                    email.send.retry queue (per-message TTL,
                    │                    backoff 5s·2^(n−1); dead-letters back to
                    │                    businessos.events with key email.send)
                    │                                   │ failure, attempt ≥ 5
                    │                                   ▼
                    └── (other event types have        businessos.dlx (topic) ──▶ businessos.dead-letter queue
                         no consumers yet in Phase 1)        + failed_jobs row (visible in admin API,
                                                               retryable via POST /v1/admin/failed-jobs/:id/retry)
```

Properties:

- **At-least-once delivery** — consumers are idempotent via the `processed_messages`
  ledger (`(messageId, consumer)` primary key).
- **Single relay instance** — the polling relay assumes one worker; multiple workers
  require `SELECT … FOR UPDATE SKIP LOCKED` (documented upgrade path, ADR-0005).
- Message envelope: `{ id, type, payload, occurredAt }`; `type` doubles as the AMQP
  routing key. Event types are defined in `packages/types/src/events.ts`.

## Phase 2 — activity timeline, object storage, search

### Activity timeline

Phase 2 introduces two append-only logs that must not be confused:

- **`audit_logs`** (Phase 1) — the **security** record: who did what, with IP and user
  agent, for compliance and forensics. Written for every mutation.
- **`activities`** (Phase 2) — the **user-facing** feed shown on customer/project/task
  timelines and the dashboard. It records product-meaningful moments
  (`customer.created`, `task.completed`, `task.status_changed`, `task.assigned`,
  `comment.added`, `attachment.added`) with a human-readable `metadata` payload.

Both are written inside the same Prisma transaction as the change they describe (via
`recordAudit` and `recordActivity` in the respective services). Activity rows carry a
**denormalized ownership chain**: `resolveEntityRef` walks task → project → customer once,
and the resolved `customer_id`/`project_id` are copied onto the row. A customer timeline is
then a single indexed read (`(organization_id, customer_id, created_at DESC)`) instead of a
fan-out join across projects and tasks.

Completing a task (first transition to `DONE`) additionally emits a **`task.completed`
domain event** through the transactional outbox, so future consumers (notifications,
reporting) can react without the API knowing about them. It rides the same
`outbox_messages` → `businessos.events` path as Phase 1 events; it has no consumer yet.

### Object storage flow

File attachments are the first user of MinIO/S3, wrapped by the `ObjectStorage` class
(`apps/api/src/lib/storage.ts`). Clients never talk to storage directly:

```
upload:   client ──multipart──▶ API validates (size ≤ 25 MB, content-type allow-list)
                              ──▶ ObjectStorage.put(key, bytes) ──▶ MinIO
                              ──▶ file_attachments row + audit + activity (one tx)
download: client ──▶ API ──▶ ObjectStorage.getDownloadUrl(key) ──▶ presigned GET (5 min)
                              ──▶ { url, expiresInSeconds }; client fetches bytes from MinIO
```

- Uploads stream through the API so validation happens server-side before anything is
  stored; the client-declared size is never trusted (the byte length is measured from the
  buffer and `@fastify/multipart` truncation is checked).
- Object keys are namespaced per organization (`org/<orgId>/<uuid>/<safe-name>`), so keys
  never collide and are trivially attributable to a tenant.
- Downloads are **presigned GET URLs** valid for 5 minutes with a forced
  `Content-Disposition` filename — the bucket itself stays private.
- Writes are transactional-ish: the object is `put` first, then the metadata row; if the
  row write fails the object is deleted to avoid orphans. On delete, the row goes first and
  the object is removed best-effort.
- `forcePathStyle` is required for MinIO. Configuration comes from the `S3_*` env vars (see
  [security.md](security.md#secrets-and-configuration)).

### Org-wide search

`GET /v1/search` queries customers, projects and tasks in one call. It requires only a
session, but **each entity type is searched only if the caller holds its `*.read`
permission** (`hasPermission(role, 'customers.read')`, etc.). A role that cannot read tasks
gets no task hits — search never becomes a side channel around the permission matrix. The
result budget is split evenly across the permitted types.

## Phase 3 — personnel

### Sensitive-data serialization gate

The personnel module reuses everything above, and adds one architectural element: a
**serialization gate** for the two-tier employee model. Directory fields (`personnel.read`)
and sensitive personal fields (`personnel.read_sensitive`) live in one `employees` row; the
tier split is not a database concern but a serialization one. `toEmployeeDto`
(`apps/api/src/lib/mappers-personnel.ts`) attaches the `sensitive` block only when the route
passes `includeSensitive: true`, which it computes from the caller's role. The list endpoint
always passes `false`; the detail endpoint passes the permission check and, when it grants
access, writes an `employee.sensitive_viewed` audit row. Symmetrically, write handlers reject
sensitive-field mutations from callers lacking `read_sensitive`. See
[security.md](security.md#personnel-sensitive-data-handling-phase-3).

### Onboarding automation

Onboarding/offboarding checklists are **templates that generate real tasks**, so onboarding
work shows up in the same task lists and timelines as everything else — no separate checklist
subsystem.

```
OnboardingTemplate (name, type, items[])            apply
   item{ title, description, dueOffsetDays } ──────────────▶ POST /v1/employees/:id/apply-template
                                                                    │  (one Prisma transaction)
                                                                    ▼
   for each template item:  Task{ employeeId, title, description,
                                  dueDate = (employee.startDate ?? now) + dueOffsetDays,
                                  assignee = explicit ?? manager's user ?? actor }
                                                                    │
                                              + audit onboarding_template.applied
                                              + activity employee.onboarding_started
```

- Each item's `dueOffsetDays` is added to the employee's `startDate` (or now, if unset) to
  date the generated task; the assignee falls back explicit → the employee's manager's linked
  user → the acting user, and is dropped if that user is not an org member.
- The generated `tasks` carry `employeeId`, so they are ordinary tasks that also appear on the
  employee's record. Applying a template returns `{ createdTaskCount }`.

### Personnel activities on the shared timeline

Personnel events feed the **same `activities` table** as Phase 2, using the new
`activities.employee_id` denormalization column (index `(organization_id, employee_id,
created_at DESC)`). `recordActivity` is called with an `{ employeeId }` ref, so an employee
timeline (`GET /v1/employees/:id/activity`) is a single indexed read, exactly like the
customer/project/task timelines. Phase 3 activity types: `employee.created`,
`employee.status_changed`, `employee.onboarding_started`, `certification.added`,
`absence.requested`, `absence.approved`, `absence.rejected`, `document.added`, `note.added`.
No new outbox event types were added in Phase 3.

## Quotes & invoicing (Phase 4)

Phase 4 adds the products/quotes/invoices/payments/credit-notes modules. The design centers
on **deterministic money**, **concurrency-safe numbering** and **immutability after
finalize**.

### Deterministic money (Phase 4)

All monetary values are integer minor units (öre; 100 minor = 1 SEK) end to end — on the
wire, in the database (`BigInt`), and in every calculation. The server, never the UI, does
the arithmetic (`apps/api/src/lib/money.ts`):

- Intermediate math uses **decimal.js**, never IEEE floats.
- Rounding is **HALF_UP at the line level**: each line's net, discount and tax are rounded
  to whole minor units, and document totals are the exact sum of the already-rounded line
  amounts. Totals therefore never drift from what a customer sees per line.
- `computeLine` produces `line_net_minor` / `line_tax_minor` / `line_total_minor` from
  quantity × unit price, discount %, then tax %. `computeTotals` sums those and emits a
  per-rate VAT breakdown (`tax_lines`: `{ ratePercent, baseMinor, taxMinor }[]`).
- The client formats amounts for display via `formatMinor(amountMinor, currency, locale)`
  from `@businessos/types` (currency-aware `Intl`), and converts a typed major price to
  minor (× 100, rounded) before sending `unitPriceMinor`.

### Concurrency-safe document numbering

Quote, invoice and credit-note numbers come from the per-org `number_sequences` table via
`allocateNumber` (`apps/api/src/modules/billing/numbering.ts`). The sequence row is upserted,
then updated with an atomic `{ next: { increment: 1 } }` that takes a **row-level write
lock**. Because allocation runs **inside the finalize transaction**, two concurrent
finalizations for the same org+kind serialize on that lock and receive distinct, gap-free
values — no duplicate numbers, no skipped numbers. Numbers are formatted `prefix` +
zero-padded counter (e.g. `INV-0001`).

### Invoice immutability after finalize

A draft invoice is fully editable. **Finalize** (`POST /v1/invoices/:id/finalize`) runs one
transaction that: allocates the invoice number, sets `status = OPEN` and `finalized_at`,
writes an `invoice.finalized` audit + activity, and enqueues the `invoice.finalized` outbox
event; then, outside the transaction, it renders and stores the PDF. From that point the
invoice and its line items are **immutable** — the money snapshot columns are frozen, edits
and deletes are rejected, and the only corrections are **credit notes**. This mirrors the
bookkeeping-immutability principle (and is why finalize is an explicit, irreversible step).

### Quote → invoice conversion

An accepted quote can be **converted** (`POST /v1/quotes/:id/convert`) into a new **draft**
invoice that copies its line items; the quote's `converted_invoice_id` links the two. The
new invoice is an ordinary draft (editable, not yet numbered) until finalized.

### PDF generation and emailing

On finalize the API renders a self-contained invoice PDF with **pdfkit**
(`apps/api/src/lib/invoice-pdf.ts`) and stores it in object storage through the shared
`@businessos/storage` wrapper (MinIO locally), recording `pdf_storage_key`. `GET
/v1/invoices/:id/pdf-url` returns a short-lived presigned URL. **Send**
(`POST /v1/invoices/:id/send`) emits `invoice.sent` on the outbox; the worker's email
consumer fetches the PDF from storage and attaches it to the outgoing mail — the same
outbox → RabbitMQ → email path used since Phase 1, now carrying an attachment.

### Overdue sweep worker job

`apps/worker/src/overdue-sweep.ts` periodically scans issued-but-unpaid invoices
(`OPEN` / `SENT` / `PARTIALLY_PAID`) past `due_date`, re-checks each inside a transaction,
and flips still-unpaid ones to `OVERDUE` with an audit + activity row. A later payment or
credit moves an invoice back out of `OVERDUE` via the API's status recomputation
(`apps/api/src/modules/invoices/status.ts`). It runs as a single instance, first ~5 s after
boot then on its configured interval.

### New domain events

Phase 4 adds these outbox event types (published like all others through the transactional
outbox):

- `quote.accepted` — a quote was accepted
- `invoice.finalized` — an invoice was numbered and frozen; **this is the accounting-draft
  hook Phase 5 consumes** to generate journal entries
- `invoice.sent` — triggers the PDF-attaching email
- `payment.registered` — a payment was recorded
- `invoice.overdue` — audit/activity emitted by the sweep (worker-local, not an outbox event)

## Bookkeeping (Phase 5)

Phase 5 adds the `accounting` module (`apps/api/src/modules/accounting/`: `accounts`,
`fiscal`, `vouchers`, `attachments`, `reports` route files plus a shared `service.ts`) and one
worker consumer. It is a **double-entry ledger** built on the money and numbering machinery
Phase 4 established.

### Voucher posting & immutability (Phase 5)

A voucher (verifikation) is a journal entry: a dated document with ≥2 lines, each a debit or a
credit. Its lifecycle mirrors invoice finalize — an editable draft becomes an immutable posted
record:

- **DRAFT** — fully editable and **may be unbalanced**; the covering fiscal period is recorded
  only informationally.
- **POST** (`POST /v1/accounting/vouchers/:id/post`) — one transaction that **row-locks the
  voucher** (`lockVoucherForUpdate`, so two concurrent posts serialize instead of both
  allocating a number), re-sums the persisted lines (stored totals are never trusted) and
  enforces the rules: **balanced** (Σ debit = Σ credit), **≥2 lines**, **non-zero**, and a
  **covering `OPEN` fiscal period** (`assertPostablePeriod` → `no_fiscal_period` /
  `period_locked`). It then allocates a per-org `VOUCHER` number
  (`allocateNumber`, prefix `V-`), sets `status = POSTED` + `posted_at`, writes a
  `voucher.posted` audit, and enqueues the `voucher.posted` outbox event. From here the entry
  is **immutable** — edits and deletes are rejected (`voucher_immutable`).
- **REVERSE** (`POST /v1/accounting/vouchers/:id/reverse`) — the only correction. It creates a
  new **posted** voucher whose lines swap debit and credit, links it to the original via the
  `reverses_voucher_id` self-relation (`@unique`, so a voucher reverses at most once), sets the
  original to `REVERSED`, and enqueues `voucher.reversed`. The original and its reversal net to
  zero; **posted rows are never edited or deleted.**

This reuses Phase 4's concurrency-safe numbering (the `VOUCHER` `NumberSequenceKind`, row-lock
inside the transaction — see [above](#concurrency-safe-document-numbering)) and the same
integer-minor-unit money model.

### Reports (Phase 5)

Trial balance and general ledger are computed from `voucher_lines` grouped by account. Only
**reporting statuses** count: `POSTED` and `REVERSED` always (the reversal is itself posted, so
excluding `REVERSED` would leave it uncancelled), plus `DRAFT` when `?includeDrafts=true`. The
general ledger derives an opening balance (net of everything before `from`) and a per-account
**running balance**. **CSV** (`/exports/trial-balance.csv`, `/exports/journal.csv`) is the
first export format; SIE and other e-accounting formats are deferred.

### Event-driven accounting drafts (Phase 5)

The ledger is fed semi-automatically. The worker binds a new **`accounting.draft`** queue to
`businessos.events` for two existing Phase 4 events, and turns each into a **DRAFT voucher** an
accountant then reviews and posts:

```
api tx (Phase 4): invoice.finalized / payment.registered → outbox
                                     │  worker outbox relay → businessos.events
                                     ▼
   routing keys invoice.finalized, payment.registered ──▶ accounting.draft queue
                                     │
                          accounting.draft consumer (apps/worker/src/consumers/accounting.ts)
                                     ▼
   invoice → Dr Accounts receivable (gross) / Cr Sales (net) / Cr Output VAT (tax)
   payment → Dr Bank / Cr Accounts receivable          (accounts from AccountMapping)
                                     │
                          DRAFT voucher + audit voucher.created + activity invoice.accounting_drafted
```

- The accounts come from the org's **`AccountMapping`** (configurable rules). If the mapping is
  incomplete or a mapped account is inactive/missing, the draft is skipped
  (`mapping_incomplete`) — nothing is fabricated.
- **Never auto-posted.** Generation stops at `DRAFT`; posting is always a human, permissioned
  (`accounting.post`) action. Ledger integrity comes from the API's post/balance/period rules,
  not from this consumer.
- **Idempotent** via `(source_type, source_id)` on the voucher **plus** the shared
  `processed_messages` ledger (`consumer = 'accounting.draft'`). Unlike the email consumer there
  is **no retry ladder**: a hard failure is recorded to `failed_jobs` and acked (dropped) so a
  bad message cannot loop — the accountant can always create the voucher by hand.

### Integration seam: `voucher.posted` / `voucher.reversed`

Posting and reversing emit `voucher.posted` and `voucher.reversed` to the transactional outbox.
**No internal consumer binds them yet** — exactly how `invoice.finalized` began before Phase 5
consumed it. They are the **designed interface for future accounting-system integrations**
(export/sync to external bookkeeping or fiscal-reporting systems): a downstream consumer binds
its own queue to these routing keys on `businessos.events` without the accounting module knowing
about it.

## Calendar & tasks (Phase 6)

Phase 6 adds the `calendar` module (`apps/api/src/modules/calendar/`: `calendars.routes`,
`events.routes`, `agenda.routes`, a shared `service.ts` and `mappers.ts`) and one worker job.
Events are stored as **UTC instants**; recurrence is a rule on the master event, expanded
server-side. Two permissions gate everything — `calendar.read` and `calendar.manage`.

### Server-side recurrence expansion (Phase 6)

A recurring event is stored **once** — the master `calendar_events` row carries the rule
(`recurrence_freq`/`interval`/`by_weekday`/`count`/`until`); no per-occurrence rows exist.
Every range query (list, agenda, free/busy, reminder sweep) expands the rule **on demand**
through a pure, deterministic, bounded expander
(`packages/types/src/calendar/recurrence.ts`, `expandOccurrences`) and applies the tenant
`where`, privacy filter and per-occurrence exceptions in the service
(`materializeOccurrences`). See [ADR-0007](decisions/adr-0007-server-side-recurrence-expansion.md).

Properties of the expander:

- **Pure and deterministic** — no clock, no I/O; the same spec + window always yields the same
  occurrences. It is unit-testable in isolation and identical on the API and in the worker.
- **Bounded** — a hard cap (`MAX_OCCURRENCES = 3660`) prevents runaway loops on unbounded
  series, and the DB prefilters to series whose window could overlap `[from, to]` before any
  expansion runs.
- **UTC calendar units** — occurrences recur on UTC day/week/month/year steps **preserving the
  start's UTC time-of-day**, and **impossible days are skipped** (Jan 31 + 1 month, Feb 29 in a
  non-leap year) rather than rolled forward, matching RRULE semantics.
- **Series-wide `count`/`until`** — expansion always iterates from the series start and then
  filters to the query window, so `count`/`until` count the whole series regardless of where the
  window falls.

**DST limitation (documented design decision).** Recurrence is **UTC-exact**, so an event does
**not** keep a fixed _local_ wall-clock time across a daylight-saving transition — a 09:00
Europe/Stockholm daily event shifts by an hour in UTC-observed local time when the clocks
change. This keeps expansion simple and exact; **DST-correct local recurrence** (anchoring to a
timezone so the wall-clock time is preserved) is a documented future enhancement. The `timezone`
column is stored for that future work and for display/all-day intent today.

### Per-occurrence exceptions (Phase 6)

A single occurrence of a series can diverge without splitting the series. Each
`event_exceptions` row is keyed by the **original, rule-generated `occurrence_start`** and is
either a `CANCELLED` (drop that occurrence) or an `OVERRIDE` (retitle/restatus/move it). During
materialization the expander produces the rule occurrences, then exceptions are applied by
`occurrence_start`: cancellations are dropped, overrides replace the fields — and an override
that **moved an occurrence** can pull it into the window from just outside it or push it out.
The occurrence endpoints (`/occurrences/cancel`, `/occurrences/override`) upsert on the unique
`(event_id, occurrence_start)` and reject non-recurring events (`not_recurring`).

### Event privacy and business-context links (Phase 6)

`visibility = PRIVATE` restricts an event to its **organizer and attendees**. This is enforced
in the service, not the UI: `visibilityWhere(userId)` narrows the range/agenda queries at the
database, and `canSeeEvent` gates the single GET (returning 404, not 403, to others — existence
is not revealed). Events carry the same denormalized `customer_id`/`project_id`/`task_id` ref
chain as Phase 2 activities; a linked event records an `event.scheduled` (or `event.cancelled`)
**activity** on that entity's timeline, reusing `recordActivity`.

### Reminder-sweep worker job (Phase 6)

`apps/worker/src/reminder-sweep.ts` is a periodic job (interval `REMINDER_SWEEP_SECONDS`,
default 60, min 15; first run ~7 s after boot) that fires event reminders. Each sweep looks
ahead a fixed horizon (`LOOKAHEAD_MS`, 30 days — covering the 4-week max lead time with
headroom), expands each event's upcoming occurrences with the **same** recurrence expander the
API uses, applies exceptions, and for every reminder whose fire time has passed enqueues an
`email.send` outbox message to each **non-declined** attendee. It rides the existing outbox →
RabbitMQ → email path (the same `email.send` message type used since Phase 1), carrying a
`kind: 'event_reminder'` payload.

- **Idempotent by construction.** Before enqueuing, the sweep **claims** a `sent_reminders` row
  on the unique `(reminder_id, occurrence_start)`; the claim and the attendee emails are written
  in **one transaction**, so a duplicate claim (unique-violation `P2002`) rolls the whole batch
  back and is skipped. It therefore never double-notifies across restarts or overlapping sweeps
  — the same "claim-row-plus-work-in-one-tx" pattern used elsewhere, here backed by a dedicated
  ledger rather than `processed_messages`.
- **Single instance**, like the overdue sweep and the outbox relay.

### Agenda and free/busy (Phase 6)

- **Agenda** (`GET /v1/agenda`) merges a user's own event occurrences (organizer or attendee)
  with their **due tasks** (assigned, not `DONE`, `due_date` in range) into one time-sorted
  list — a discriminated union of `event` and `task` items — so "what's on my plate" spans both
  subsystems without a new store.
- **Free/busy** (`GET /v1/calendar/free-busy`) returns **busy blocks only — start/end times,
  never titles or details** — for any org member, excluding cancelled occurrences and events the
  member declined. It is the deliberately minimal, privacy-preserving cross-member view (see
  [security.md](security.md#calendar-privacy-and-rbac-phase-6)).

### Integration seam: `calendar.event.*`

Creating, updating and cancelling an event emits `calendar.event.created` /
`calendar.event.updated` / `calendar.event.cancelled` to the transactional outbox. **No internal
consumer binds them yet** — exactly like `invoice.finalized` before Phase 5 and
`voucher.posted` today. They are the **designed interface for future external calendar-sync
integrations** (Google Calendar, Microsoft 365): a downstream consumer binds its own queue to
these routing keys on `businessos.events` without the calendar module knowing about it.

## Where future modules attach

Each later phase adds a module directory under `apps/api/src/modules/`, tables with
`organizationId` in the Prisma schema, permissions in the (already reviewed) matrix in
`packages/types`, and — where async work is needed — new event types plus a queue bound to
`businessos.events`:

- **Customers/projects/tasks (Phase 2)** — first user of MinIO (file attachments);
  permissions `customers.*`, `projects.*`, `tasks.*` already exist in the matrix.
- **Personnel (Phase 3, done)** — sensitive fields gated by a dedicated
  `personnel.read_sensitive` permission (see the Phase 3 section above).
- **Quotes/invoicing (Phase 4)** and **bookkeeping (Phase 5, done)** — money as integer minor
  units and per-organization currency, and concurrency-safe document numbering, are shared by
  both (see [data-model.md](data-model.md) and the [Phase 5 section above](#bookkeeping-phase-5)).
  Bookkeeping consumes the Phase 4 `invoice.finalized` / `payment.registered` events to draft
  vouchers and emits `voucher.posted` / `voucher.reversed` as a seam for future accounting-system
  integrations.
- **Calendar (6, done)** — team/personal calendars, events with attendees/RSVP, reminders,
  recurrence expanded server-side, per-occurrence exceptions and a reminder-sweep worker job;
  emits `calendar.event.*` as a seam for future external calendar-sync integrations (see the
  [Phase 6 section above](#calendar--tasks-phase-6)).
- **Email module (7), voice notes (8)** — voice notes store audio in MinIO
  and process transcriptions as queued jobs.
- **Integrations (9)** — outbound webhooks are natural consumers of the existing topic
  exchange.
