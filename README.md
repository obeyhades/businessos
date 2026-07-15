# BusinessOS

Operational platform for small and medium-sized businesses: personnel, bookkeeping support,
quotes/invoicing, calendar/tasks, email and voice notes — built as a modular monolith that
grows module by module.

**Current state (Phase 7):** on top of the Phase 1 foundation (authentication,
organizations, memberships, roles/permissions, invitations, audit log, dashboard shell), the
Phase 2 customer/project/task modules, the Phase 3 personnel module, the Phase 4
quotes & invoicing module, the Phase 5 bookkeeping ledger and the Phase 6 calendar, Phase 7
ships **email**. It adds **shared (team) and personal (owner-only) mailboxes** — one per
(org, address); a personal mailbox and its threads are invisible to everyone but the owner —
and **threaded conversations**: messages with a direction (`INBOUND`/`OUTBOUND`), a status
(`DRAFT`/`QUEUED`/`SENT`/`FAILED`/`RECEIVED`) and RFC 5322 headers
(Message-ID/In-Reply-To/References), physical folders `INBOX`/`ARCHIVE`/`TRASH` on the thread
with **`SENT`/`DRAFTS` as computed views**, plus star, read/unread, per-org labels and search.
**Outbound** compose/reply drafts send through the **existing outbox → RabbitMQ → SMTP
pipeline**; the worker marks the message `SENT` on delivery or `FAILED` on dead-letter.
**Inbound** mail arrives through an authenticated webhook (`POST /v1/email/inbound`, shared
secret `INBOUND_EMAIL_SECRET`) that **derives the tenant from the destination mailbox**,
dedupes by RFC Message-ID and **threads strictly by References/In-Reply-To** — the seam
future provider inbound-parse adapters (SendGrid/Mailgun/Postmark) plug into. Inbound threads
**auto-link to a matching customer** (recording `email.received` on the customer's timeline)
and **email → task** turns a conversation into a task linked back to the thread;
`email.received`/`email.sent` events are emitted as an integration seam. Everything is gated
by `email.read` / `email.send`. (This is **not** a full IMAP/SMTP client — attachment
upload/download UI and real IMAP/OAuth mailbox connect are noted future work.)

The earlier **Phase 6 calendar & tasks** module remains: **team and personal calendars** and
**events** with attendees/RSVP, reminders, business-context links and `DEFAULT`/`PRIVATE`
visibility; **recurrence** stored as a rule and **expanded server-side per query**, with
**per-occurrence exceptions**; a **worker reminder-sweep** that emails attendees idempotently;
and **agenda** and **free/busy** (busy blocks, times only) views — all gated by
`calendar.read` / `calendar.manage`. The **Phase 5 bookkeeping support** — a double-entry
ledger with chart of accounts, fiscal periods, balanced immutable posted vouchers,
reversal-only correction, auto-drafts from invoices/payments (never auto-posted), trial
balance / general ledger and CSV exports — also remains, gated by `accounting.read` /
`accounting.manage` / `accounting.post`. **Bookkeeping is _support_, not a certified
accounting product** — not reviewed against bokföringslagen, VAT reporting, SIE export or tax
law. Everything from Phase 8 on is planned, not built — see
[docs/product-roadmap.md](docs/product-roadmap.md).

| Phase | Scope                                                                             | Status  |
| ----- | --------------------------------------------------------------------------------- | ------- |
| 0–1   | Foundation, auth, orgs, RBAC, audit, dashboard                                    | Done    |
| 2     | Customers, contacts, projects, tasks, comments, attachments, activity, search     | Done    |
| 3     | Personnel (employees, sensitive tier, certs, absences, docs, onboarding)          | Done    |
| 4     | Quotes & invoicing (products, quotes, invoices, payments, credit notes, PDF)      | Done    |
| 5     | Bookkeeping support (accounts, fiscal periods, vouchers, reports, CSV export)     | Done    |
| 6     | Calendar & tasks (team/personal calendars, events, recurrence, reminders, agenda) | Done    |
| 7     | Email (mailboxes, threads, send pipeline, inbound webhook, labels, email → task)  | Done    |
| 8     | Voice notes                                                                       | Next    |
| 9     | External integrations, data retention, org export                                 | Planned |

## Architecture

Modular monolith (Fastify API) + separate background worker, one PostgreSQL database,
RabbitMQ for async jobs, MinIO for files (used from Phase 2 for attachments), Mailpit for
local email.

```
┌─────────┐  HTTP (cookie session)  ┌─────────┐        ┌────────────┐
│   web   │ ──────────────────────▶ │   api   │ ─────▶ │ PostgreSQL │
│ Next.js │                         │ Fastify │        │            │
└─────────┘                         └─────────┘        └─────┬──────┘
                                         │ writes outbox     │ polls outbox
                                         ▼                   ▼
                                    outbox table  ◀───── ┌────────┐
                                                         │ worker │
                                                         └───┬────┘
                                                             │ publish/consume
                                                             ▼
                                                        ┌──────────┐   email.send   ┌─────────┐
                                                        │ RabbitMQ │ ─────────────▶ │ Mailpit │
                                                        └──────────┘                └─────────┘
                                                        (MinIO for file storage from Phase 2)
```

Details in [docs/architecture.md](docs/architecture.md).

## Prerequisites

- Node.js ≥ 22 (developed on Node 24)
- pnpm 10 (`corepack enable && corepack prepare pnpm@10 --activate`)
- Docker Desktop (Postgres, RabbitMQ, MinIO, Mailpit run in containers)

## Setup

```bash
cp .env.example .env        # defaults work for local development
docker compose up -d        # Postgres :5432, RabbitMQ :5672, MinIO :9000, Mailpit :1025/:8025
pnpm install
pnpm db:migrate             # apply Prisma migrations
pnpm db:seed                # demo organization + users (idempotent)
pnpm dev                    # web (:3100), api (:3001), worker — via turbo
```

More detail (including Windows notes and troubleshooting) in
[docs/local-development.md](docs/local-development.md).

## Root scripts

| Script                  | What it does                                                         |
| ----------------------- | -------------------------------------------------------------------- |
| `pnpm dev`              | Runs `dev` in every app via turbo (web, api, worker) in watch mode   |
| `pnpm build`            | Production build of all apps and packages                            |
| `pnpm lint`             | ESLint across the workspace                                          |
| `pnpm typecheck`        | `tsc --noEmit` across the workspace                                  |
| `pnpm test`             | Unit tests (Vitest)                                                  |
| `pnpm test:integration` | Integration tests against the Docker Postgres test database          |
| `pnpm test:e2e`         | Playwright end-to-end tests (requires the full stack)                |
| `pnpm format`           | Prettier — write                                                     |
| `pnpm format:check`     | Prettier — check only (CI mode)                                      |
| `pnpm db:generate`      | `prisma generate` (run after schema changes)                         |
| `pnpm db:migrate`       | `prisma migrate dev` — create/apply migrations locally               |
| `pnpm db:deploy`        | `prisma migrate deploy` — apply committed migrations (CI/production) |
| `pnpm db:seed`          | Seed the demo organization and users                                 |
| `pnpm db:studio`        | Prisma Studio database browser                                       |
| `pnpm generate:openapi` | Writes the OpenAPI spec to `apps/api/openapi.json`                   |

## Demo credentials

Seeded by `pnpm db:seed` into the organization **Demo Hantverk AB**. The seed also loads
Phase 2 demo data: customers (**Lindqvist Fastigheter AB**, **Berg & Söner Bygg**,
**Solgården Restaurang**), their contacts, projects, tasks in various statuses, comments and
a populated activity feed — enough to exercise the list/detail/timeline/search UI.

Phase 3 demo data adds four employees — **Olivia Ohlsson** (Operations Manager),
**Erik Eklund** (Carpenter), **Fatima Nilsson** (Electrician, `ON_LEAVE`) and **Johan Berg**
(Apprentice, `ONBOARDING`) — with a manager hierarchy and populated sensitive fields
(personnummer etc.). It also seeds one certification expiring in ~25 days (Erik's _Hot Work
Permit_), a pending vacation absence for Erik, an onboarding template _Field employee
onboarding_ (4 items) and the onboarding tasks generated for Johan. Sign in as
`owner@`/`admin@` to see the sensitive block; `MANAGER`/`READONLY` roles see the directory
only, and `accountant@`/the `EMPLOYEE` accounts have no personnel access at all.

Phase 4 demo data adds a **product catalogue** — _Consulting hour_ (1 200.00 SEK), _Site
visit_ (2 500.00 SEK) and _Materials_ (400.00 SEK) — one `DRAFT` quote, and **eight invoices
spanning every status**: `DRAFT`, `OPEN` (`INV-0001`), `SENT` (`INV-0002`), `PARTIALLY_PAID`
(`INV-0003`), `PAID` (`INV-0004`), `OVERDUE` (`INV-0005`), `CANCELLED` (`INV-0006`) and
`CREDITED` (`INV-0007`), with payments and a credit note (`CN-0001`). All amounts are in SEK.
Invoicing is gated by `invoices.read` / `invoices.manage`: `owner@` and `accountant@` have
both (full access), while the `EMPLOYEE` accounts have none. Money is shown in major units in
the UI but stored and sent as integer minor units (öre).

Phase 5 demo data adds the bookkeeping ledger: a **BAS-lite chart of 13 accounts** (e.g. `1930`
_Företagskonto / bank_, `1510` _Kundfordringar_, `2610` _Utgående moms 25%_, `3001` _Försäljning
inom Sverige_), a **fiscal year for the current year with 12 monthly periods where January is
`LOCKED`** to demonstrate period locking, the **account mapping** used to auto-draft vouchers
(sales `3001`, output VAT `2610`, receivable `1510`, bank `1930`), and **demo vouchers** — two
`POSTED` (`V-00001` opening-balance share capital, `V-00002` office rent with input VAT) plus one
balanced `DRAFT` (bank fees) for the accountant to review and post. The `VOUCHER` number sequence
(`V-`, zero-padded to 5) is advanced past the seeded numbers. Bookkeeping is gated by
`accounting.read` / `accounting.manage` / `accounting.post`: `owner@`, `admin@` and `accountant@`
can post, `READONLY` reads only, and the `EMPLOYEE` accounts have no access. All figures are
fictional and **not reviewed for compliance**.

Phase 6 demo data seeds a default **team calendar** ("Team") with three events that exercise the
calendar surface: **Customer kickoff** (a single event tomorrow, linked to a customer, with two
attendees and a 30-minute reminder), **Daily standup** (a **weekly Mon/Wed recurring** event with
a 10-minute reminder whose occurrence two Mondays out is **cancelled** via a per-occurrence
exception), and **Focus time** (a **`PRIVATE`** block visible only to its owner). Sign in as
`owner@` to see all three including the private block and the recurring series; other roles see
the private event only as an anonymous busy block in free/busy. Calendar is gated by
`calendar.read` / `calendar.manage` — `owner@`/`admin@` manage, the `EMPLOYEE` accounts read and
RSVP, and `accountant@` has no calendar access.

Phase 7 demo data seeds a **shared mailbox** `info@demo.businessos.local` ("Demo Hantverk
Support"), two labels (**Sales**, **Support**) and **three conversations** exercising the
mailbox surface: an **unread inbound customer question** ("Question about my quote",
auto-linked to a demo customer), a **sent** welcome mail, and a **draft** follow-up — the
draft-only thread appears under **Drafts**, not Inbox (computed folder views). Email is gated
by `email.read` / `email.send`: `owner@`/`admin@` have both, `READONLY` reads only, and the
`EMPLOYEE` accounts and `accountant@` have **no email access**. The inbound webhook can be
exercised locally with curl against `POST /v1/email/inbound` using the `x-inbound-secret`
header (`INBOUND_EMAIL_SECRET`, default `dev-inbound-secret`).

| Email                              | Password             | Role       | Notes               |
| ---------------------------------- | -------------------- | ---------- | ------------------- |
| `owner@demo.businessos.local`      | `OwnerDemo123!`      | OWNER      | also platform admin |
| `admin@demo.businessos.local`      | `AdminDemo123!`      | ADMIN      |                     |
| `accountant@demo.businessos.local` | `AccountantDemo123!` | ACCOUNTANT |                     |
| `erik@demo.businessos.local`       | `EmployeeDemo123!`   | EMPLOYEE   |                     |
| `fatima@demo.businessos.local`     | `EmployeeDemo123!`   | EMPLOYEE   |                     |

## Local service UIs

| Service             | URL                    | Credentials                            |
| ------------------- | ---------------------- | -------------------------------------- |
| Mailpit (email)     | http://localhost:8025  | none                                   |
| RabbitMQ management | http://localhost:15672 | `businessos` / `businessos`            |
| MinIO console       | http://localhost:9001  | `businessos` / `businessos-dev-secret` |

File attachments (Phase 2), employee documents (Phase 3), **invoice PDFs (Phase 4)** and
**voucher receipts (Phase 5)** use
the S3-compatible object store configured via `S3_*` in
`.env` (defaults in `.env.example`): `S3_ENDPOINT` (`http://localhost:9000`),
`S3_ACCESS_KEY` (`businessos`), `S3_SECRET_KEY` (`businessos-dev-secret`), `S3_BUCKET`
(`businessos`), `S3_REGION` (`us-east-1`). In production `S3_SECRET_KEY` is a real secret.
The **worker also requires the same `S3_*` variables** as of Phase 4, so it can fetch the
finalized invoice PDF from storage and attach it to the outgoing email. Phase 7 adds
**`INBOUND_EMAIL_SECRET`** (default `dev-inbound-secret`) — the shared secret the
inbound-email webhook requires in its `x-inbound-secret` header; a real secret in production.

## Testing

```bash
pnpm test                 # unit
pnpm test:integration     # needs docker compose up (uses businessos_test database)
pnpm test:e2e             # needs the full stack (db migrated + seeded)
```

## Known limitations

- **Invoicing is a technical foundation, NOT verified for compliance.** The Phase 4 money
  model, VAT lines, rounding and invoice numbering/immutability are engineering foundations
  only — **not** reviewed against Swedish momslagen/EU VAT rules or bokföringslagen. Do not
  present output as compliant invoicing until a professional review passes.
  See [docs/legal-review-required.md](docs/legal-review-required.md).
- **Bookkeeping is support only and NOT legally compliant.** Phase 5 (double-entry ledger,
  vouchers, reports, CSV export) is built as a technical foundation; nothing has been reviewed
  against bokföringslagen, Bokföringsnämnden (BFN) standards, VAT reporting, SIE/e-accounting
  export, archiving requirements or tax law. Do not present output as compliant bookkeeping.
  See [docs/legal-review-required.md](docs/legal-review-required.md).
- **Single-worker outbox.** The outbox relay assumes exactly one worker instance; running
  more than one can double-publish. Upgrade path documented in
  [ADR-0005](docs/decisions/adr-0005-transactional-outbox.md).
- **Email delivery is local-only.** All outgoing mail — including the Phase 7 mailbox
  module's — goes to Mailpit; no production SMTP provider is wired up (planned with the
  Phase 9 provider swap, along with SPF/DKIM deliverability). Inbound mail only enters via
  the authenticated webhook (`POST /v1/email/inbound`) — there is no IMAP/OAuth mailbox
  connection, and no provider inbound adapter is configured yet.
- **Web runs on port 3100.** The dev server is pinned to `3100` (via the `apps/web` `dev`
  script) to avoid the common port-3000 conflict. If you change the web port, keep
  `WEB_ORIGIN` and `APP_BASE_URL` in `.env` on the same port — the API's CORS/origin
  allow-list rejects mismatched origins, which surfaces in the UI as a generic
  "Something went wrong" error.
