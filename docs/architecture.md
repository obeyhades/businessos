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
- `customers` / `contacts` — customer registry and per-customer contacts (Phase 2)
- `projects` / `tasks` — projects linked to customers, tasks linked to both (Phase 2)
- `comments` / `attachments` — polymorphic notes and files over customers/projects/tasks (Phase 2)
- `activity` / `search` — user-facing timeline feed and org-wide permission-scoped search (Phase 2)
- `employees` — employee directory + sensitive tier, onboarding template application, per-employee activity (Phase 3)
- `employee-notes` / `certifications` / `absences` / `employee-documents` — restricted notes, qualifications, leave workflow, and categorized documents (Phase 3)
- `onboarding-templates` — reusable onboarding/offboarding checklists that generate tasks (Phase 3)

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

## Where future modules attach

Each later phase adds a module directory under `apps/api/src/modules/`, tables with
`organizationId` in the Prisma schema, permissions in the (already reviewed) matrix in
`packages/types`, and — where async work is needed — new event types plus a queue bound to
`businessos.events`:

- **Customers/projects/tasks (Phase 2)** — first user of MinIO (file attachments);
  permissions `customers.*`, `projects.*`, `tasks.*` already exist in the matrix.
- **Personnel (Phase 3, done)** — sensitive fields gated by a dedicated
  `personnel.read_sensitive` permission (see the Phase 3 section above).
- **Quotes/invoicing (Phase 4)** and **bookkeeping (Phase 5)** — money as integer minor
  units and per-organization currency are locked in now (see
  [data-model.md](data-model.md)); PDF/email delivery rides the existing outbox →
  `email.send` path.
- **Calendar (6), email module (7), voice notes (8)** — voice notes store audio in MinIO
  and process transcriptions as queued jobs.
- **Integrations (9)** — outbound webhooks are natural consumers of the existing topic
  exchange.
