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

## Where future modules attach

Each later phase adds a module directory under `apps/api/src/modules/`, tables with
`organizationId` in the Prisma schema, permissions in the (already reviewed) matrix in
`packages/types`, and — where async work is needed — new event types plus a queue bound to
`businessos.events`:

- **Customers/projects/tasks (Phase 2)** — first user of MinIO (file attachments);
  permissions `customers.*`, `projects.*`, `tasks.*` already exist in the matrix.
- **Personnel (Phase 3)** — sensitive fields gated by a dedicated
  `personnel.read_sensitive` permission.
- **Quotes/invoicing (Phase 4)** and **bookkeeping (Phase 5)** — money as integer minor
  units and per-organization currency are locked in now (see
  [data-model.md](data-model.md)); PDF/email delivery rides the existing outbox →
  `email.send` path.
- **Calendar (6), email module (7), voice notes (8)** — voice notes store audio in MinIO
  and process transcriptions as queued jobs.
- **Integrations (9)** — outbound webhooks are natural consumers of the existing topic
  exchange.
