# BusinessOS

Operational platform for small and medium-sized businesses: personnel, bookkeeping support,
quotes/invoicing, calendar/tasks, email and voice notes — built as a modular monolith that
grows module by module.

**Current state (Phase 1):** authentication, organizations, memberships, roles/permissions,
invitations, audit log and the dashboard shell are implemented. Everything else is planned,
not built — see [docs/product-roadmap.md](docs/product-roadmap.md).

| Phase | Scope                                             | Status      |
| ----- | ------------------------------------------------- | ----------- |
| 0–1   | Foundation, auth, orgs, RBAC, audit, dashboard    | In progress |
| 2     | Customers, projects, tasks, file attachments      | Planned     |
| 3     | Personnel                                         | Planned     |
| 4     | Quotes & invoicing                                | Planned     |
| 5     | Bookkeeping support                               | Planned     |
| 6     | Calendar                                          | Planned     |
| 7     | Email module                                      | Planned     |
| 8     | Voice notes                                       | Planned     |
| 9     | External integrations, data retention, org export | Planned     |

## Architecture

Modular monolith (Fastify API) + separate background worker, one PostgreSQL database,
RabbitMQ for async jobs, MinIO for files (Phase 2+), Mailpit for local email.

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

Seeded by `pnpm db:seed` into the organization **Demo Hantverk AB**:

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

## Testing

```bash
pnpm test                 # unit
pnpm test:integration     # needs docker compose up (uses businessos_test database)
pnpm test:e2e             # needs the full stack (db migrated + seeded)
```

## Known limitations

- **Bookkeeping is not implemented and NOT legally compliant.** Phase 5 will be a technical
  foundation only; nothing has been reviewed against bokföringslagen, tax law or GAAP.
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
