# BusinessOS

Operational platform for small and medium-sized businesses: personnel, bookkeeping support,
quotes/invoicing, calendar/tasks, email and voice notes — built as a modular monolith that
grows module by module.

**Current state (Phase 5):** on top of the Phase 1 foundation (authentication,
organizations, memberships, roles/permissions, invitations, audit log, dashboard shell), the
Phase 2 customer/project/task modules, the Phase 3 personnel module and the Phase 4
quotes & invoicing module, Phase 5 ships **bookkeeping support** — a **double-entry ledger**.
It adds a typed **chart of accounts**, **fiscal years and periods** (`OPEN`/`LOCKED`/`CLOSED`),
and **vouchers** (verifikationer): journal entries with ≥2 debit/credit lines. A voucher starts
as an editable `DRAFT` (may be unbalanced); **posting** it requires balance (Σ debit = Σ credit),
≥2 lines, a non-zero amount and a covering `OPEN` period, assigns a concurrency-safe
per-organization number and makes the entry **immutable** — corrections are made only by a
**reversing voucher**, never by editing posted entries. The worker turns finalized invoices and
registered payments into **DRAFT vouchers** (via a configurable account mapping) that an
accountant reviews and posts — **never auto-posted**. **Reports** cover trial balance and general
ledger with **CSV exports**, and `voucher.posted` / `voucher.reversed` events are emitted as a
seam for future accounting-system integrations. Money stays integer minor units (öre), like
invoicing. Everything is gated by `accounting.read` / `accounting.manage` / `accounting.post`.
**Bookkeeping is _support_, not a certified accounting product** — not reviewed against
bokföringslagen, VAT reporting, SIE export or tax law. Everything from Phase 6 on is planned, not
built — see [docs/product-roadmap.md](docs/product-roadmap.md).

| Phase | Scope                                                                         | Status  |
| ----- | ----------------------------------------------------------------------------- | ------- |
| 0–1   | Foundation, auth, orgs, RBAC, audit, dashboard                                | Done    |
| 2     | Customers, contacts, projects, tasks, comments, attachments, activity, search | Done    |
| 3     | Personnel (employees, sensitive tier, certs, absences, docs, onboarding)      | Done    |
| 4     | Quotes & invoicing (products, quotes, invoices, payments, credit notes, PDF)  | Done    |
| 5     | Bookkeeping support (accounts, fiscal periods, vouchers, reports, CSV export) | Done    |
| 6     | Calendar                                                                      | Next    |
| 7     | Email module                                                                  | Planned |
| 8     | Voice notes                                                                   | Planned |
| 9     | External integrations, data retention, org export                             | Planned |

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
finalized invoice PDF from storage and attach it to the outgoing email.

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
- **Email is local-only.** All email goes to Mailpit; no production SMTP provider is wired up.
- **Web runs on port 3100.** The dev server is pinned to `3100` (via the `apps/web` `dev`
  script) to avoid the common port-3000 conflict. If you change the web port, keep
  `WEB_ORIGIN` and `APP_BASE_URL` in `.env` on the same port — the API's CORS/origin
  allow-list rejects mismatched origins, which surfaces in the UI as a generic
  "Something went wrong" error.
