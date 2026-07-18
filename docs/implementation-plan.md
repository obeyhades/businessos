# BusinessOS — Implementation Plan

Status: living document. Created before Phase 0/1 implementation, updated as phases complete.

## 0. Repository inspection (pre-work)

The parent directory `C:\Users\abdun\Desktop\AI` was inspected before creating this repository.
It contains unrelated projects (`roda-bilen/`, `roda-bilen-app/`) and loose scripts
(`film-pipeline.ts`, `make-issue.js`, `serve-issue.js`). **Nothing is reusable for BusinessOS.**
This repository (`businessos/`) was therefore created fresh with `git init`.

Local environment verified:

| Tool   | Version          | Notes                                    |
| ------ | ---------------- | ---------------------------------------- |
| Node   | 24.15.0          | ✓                                        |
| pnpm   | 10.33.0          | workspace package manager                |
| git    | 2.46 (Windows)   | ✓                                        |
| Docker | 27.3.1 (Desktop) | daemon must be running for infra + tests |

Known local constraint: port 3000 is often occupied by other dev servers on this machine.
All ports are configurable via environment variables; defaults documented in `.env.example`.

## 1. Goals for Phase 0 + Phase 1

- Phase 0: monorepo foundation, tooling, Docker Compose infra (PostgreSQL, RabbitMQ, MinIO,
  Mailpit), CI, documentation skeleton, health checks.
- Phase 1: authentication, organizations, memberships, roles/permissions, audit logs,
  organization switcher, basic dashboard, tenant-isolation tests.

Everything later (customers, personnel, invoicing, bookkeeping, calendar, email, voice) is
out of scope for this iteration but the data-model and event foundations are designed so
those modules attach without rework.

## 2. Architecture overview

Modular monolith + separate background worker, one PostgreSQL database, RabbitMQ for async
jobs, MinIO for files (used from Phase 2+), Mailpit for local email.

```
apps/
  web      Next.js 15 (App Router) — UI only, talks to API via typed client
  api      Fastify 5 + Zod + Prisma — REST API, OpenAPI spec, session auth, RBAC
  worker   Node service — outbox relay, RabbitMQ consumers (email), DLQ handling
packages/
  types          shared domain types, role/permission matrix, event names
  config         zod-validated environment loading (fail fast at startup)
  api-client     typed fetch client built on the shared zod contracts (see §3)
  ui             shared React components (shadcn-style, Tailwind)
  tsconfig       shared TS configs (strict)
  eslint-config  shared flat ESLint config
infrastructure/  docker-compose + init scripts
docs/            architecture, security, data model, ADRs, this plan
```

Hard rules enforced by structure:

- `apps/web` has **no** database or Prisma dependency; all data access goes through `apps/api`.
- Every tenant-owned table carries `organizationId`; the API resolves the active organization
  from the **server-side session**, never from client-supplied IDs.
- Business logic lives in service modules (`apps/api/src/modules/*/service.ts`), not in route
  handlers and not in React components.

## 3. Major technology decisions and tradeoffs

Full reasoning in `docs/decisions/`. Summary:

| Decision               | Choice                                                                                                                                                                             | Tradeoff                                                                                                                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API framework          | **Fastify 5** (over NestJS)                                                                                                                                                        | Less structure out of the box, but first-class Zod validation + OpenAPI generation from one source of truth, far less boilerplate/decorator magic, faster cold starts. Module discipline is enforced by convention + lint rules instead of DI framework. (ADR-0001) |
| Auth                   | **Opaque server-side sessions** in Postgres, HttpOnly/SameSite=Lax cookie, token stored hashed                                                                                     | Simpler to revoke and audit than JWTs; one DB read per request is acceptable for SMB scale. (ADR-0002)                                                                                                                                                              |
| Password hashing       | **Argon2id** via `argon2`                                                                                                                                                          | Modern default; memory cost tuned conservatively.                                                                                                                                                                                                                   |
| RBAC                   | **Fixed role enum + code-defined permission matrix** in `packages/types`                                                                                                           | Custom roles deferred; matrix is granular per resource+action and trivially testable. DB-driven roles can be added later without schema breakage. (ADR-0003)                                                                                                        |
| Tenancy                | Shared schema, `organizationId` column + service-layer scoping helper + integration tests                                                                                          | Row-level security in Postgres considered; deferred to keep Prisma ergonomics, revisit before production. (ADR-0004)                                                                                                                                                |
| Events                 | **Transactional outbox** table polled by worker → RabbitMQ; consumers idempotent via `processed_messages`                                                                          | Polling adds small latency vs LISTEN/NOTIFY; simpler and portable. (ADR-0005)                                                                                                                                                                                       |
| API client             | Hand-maintained thin client in `packages/api-client`, typed by the SAME zod contracts the server validates with (`packages/types`); OpenAPI JSON still generated for documentation | Types stay synchronized by construction (single schema source) instead of by codegen; responses are runtime-validated in the client. The generated `apps/api/openapi.json` remains available for external consumers/codegen.                                        |
| i18n                   | `next-intl`, `en` + `sv` message files from day one                                                                                                                                | English is the development default. No hardcoded UI strings.                                                                                                                                                                                                        |
| Money (future modules) | Integer minor units (öre/cents), currency code per document                                                                                                                        | Locked in now in `docs/data-model.md` so invoicing/bookkeeping phases don't drift.                                                                                                                                                                                  |
| Tests                  | Vitest (unit + integration against real Postgres), Playwright (e2e)                                                                                                                | Integration tests use a dedicated test database via Docker Compose; Testcontainers used in CI-agnostic form where practical.                                                                                                                                        |

## 4. Phase 1 data model (summary)

See `docs/data-model.md` for details.

- `User` — global identity (email unique, argon2id hash, locale).
- `Organization` — tenant root (name, slug, locale, currency).
- `OrganizationMember` — user↔org with `role` enum (OWNER, ADMIN, ACCOUNTANT, MANAGER, EMPLOYEE, READONLY), unique(userId, organizationId).
- `Session` — opaque token (sha256 hash stored), userId, `activeOrganizationId`, expiry, IP/user-agent metadata.
- `Invitation` — org, email, role, hashed token, expiry, acceptedAt, invitedById.
- `PasswordResetToken` — userId, hashed token, expiry, usedAt.
- `AuditLog` — organizationId (nullable for pre-org events like registration), actorUserId, action, entityType/entityId, metadata JSONB, ip, userAgent.
- `OutboxMessage` — event envelope written in the same transaction as the domain change.
- `ProcessedMessage` — consumer idempotency ledger.
- `FailedJob` — dead-lettered jobs surfaced in the admin UI.

All IDs are UUIDs. All timestamps `timestamptz` in UTC. Soft delete is **not** used in Phase 1
(sessions/invitations/reset tokens expire; audit logs are append-only).

## 5. Security baseline (Phase 1)

- Argon2id password hashing; constant-time token comparison; all long-lived tokens stored hashed.
- HttpOnly, SameSite=Lax, Secure (in production) session cookie.
- CSRF: state-changing requests require an `Origin`/`Referer` allow-list match (plus SameSite=Lax). Documented in `docs/security.md`.
- Rate limiting on auth endpoints (per-IP) via `@fastify/rate-limit`.
- Security headers via `@fastify/helmet`; restricted CORS (credentials only for the configured web origin).
- Zod validation on every route (body, params, query) — no mass assignment (schemas are allow-lists).
- Pino structured JSON logs with redaction of authorization headers, cookies, passwords, tokens.
- Audit log entries for register, login, failed login, logout, password reset, org create, invite create/accept/revoke, role change, member removal, org switch.
- Environment validated with Zod at startup in every app — missing/weak secrets abort boot.

## 6. Delivery plan for this iteration

1. **Phase 0 scaffold** — root workspace, shared packages, Docker Compose, CI, docs.
2. **Verify foundation** — `pnpm install`, compose up, health checks green.
3. **Prisma schema + first migration** (Phase 1 models above) + seed.
4. **API modules** — `auth`, `organizations`, `memberships`, `invitations`, `audit`, `admin (failed jobs)`, `health`, `me`.
5. **Worker** — outbox relay, `email.send` consumer (SMTP → Mailpit), retry/backoff, DLQ → `FailedJob`.
6. **OpenAPI → typed client** generation.
7. **Web** — auth pages, onboarding, dashboard, org switcher, settings (organization, members, profile, audit log), i18n (en/sv), loading/empty/error states.
8. **Tests** — unit (permission matrix, token handling, schemas), integration (tenant isolation, auth flows, outbox), one Playwright e2e (register → create org → dashboard → invite → accept).
9. **Quality gates** — format, lint, typecheck, tests, production build; fix everything caused by this implementation; adversarial review pass on tenant isolation and auth.
10. **Report** — files, migrations, endpoints, pages, known limitations, Phase 2 task list.

## 7. Exact commands (local development)

```bash
# one-time
corepack enable && corepack prepare pnpm@10 --activate   # or: npm i -g pnpm
cp .env.example .env

# infrastructure
docker compose up -d                # Postgres, RabbitMQ, MinIO, Mailpit

# install + database
pnpm install
pnpm db:migrate                     # prisma migrate dev (packages/db)
pnpm db:seed                        # demo organization + users

# development
pnpm dev                            # web (:3000), api (:3001), worker — via turbo
pnpm --filter @businessos/api dev   # individual app

# quality gates (same as CI)
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test                           # unit
pnpm test:integration               # requires docker compose db
pnpm test:e2e                       # playwright, requires full stack
pnpm build

# regenerate the OpenAPI document after API changes (docs artifact)
pnpm generate:openapi
```

## 8. Definition of done for this iteration

Phase 0+1 are complete only when: the stack starts locally via Docker Compose + `pnpm dev`;
register/login/logout/reset, org creation, invitations, org switching and the dashboard work
through the UI; tenant isolation is proven by integration tests; lint/typecheck/tests/build
pass; docs and seed data exist. Anything failing is reported honestly in the final summary.

## 9. Explicitly deferred (tracked for later phases)

- Customers/projects/tasks (Phase 2), personnel (3), quotes/invoicing (4), bookkeeping (5),
  calendar (6), email module (7), voice notes (8), external integrations (9).
- MinIO is provisioned in compose now but first used by file attachments in Phase 2.
- Postgres row-level security evaluation before production (ADR-0004).
- Custom role editor (matrix is code-defined for now).
- Legal/accounting/GDPR review — see `docs/legal-review-required.md`.

## 10. Status (2026-07-13, end of Phase 0+1 iteration)

Phase 0 and Phase 1 are implemented and verified: api + worker + db + seed + full web app
(auth pages, onboarding, dashboard, members, audit log, settings, admin failed-jobs, en/sv
i18n) plus documentation, CI and Dependabot. Test suites: unit (types + api lib),
integration (auth flows, tenant isolation, RBAC, invitations, members, CSRF/security,
health) and one Playwright e2e covering the main workflow. The api-client decision in §3
reflects the implemented approach (shared zod contracts, hand-maintained client, generated
OpenAPI document via `pnpm generate:openapi`).

## 12. Status (2026-07-13, Phase 3)

Phase 3 (Personnel) is implemented on top of Phase 2: the `employees`, `employee-notes`,
`certifications`, `absences`, `employee-documents` and `onboarding-templates` API modules,
backed by seven new models (migration `20260713114021_phase3_personnel`, plus `employee_id`
added to `tasks` and `activities`) and shared zod contracts in `packages/types`. The defining
concept is a **two-tier sensitivity model**: employee records separate directory fields
(`personnel.read`) from sensitive personal data (`personnel.read_sensitive`, OWNER/ADMIN
only), enforced in the serialization layer (`mappers-personnel.ts`) — the sensitive block is
attached only for authorized callers, never appears in the list, and every sensitive detail
read writes an `employee.sensitive_viewed` audit row. Sensitive writes, internal notes and
sensitive documents carry the same gate; the personal fields are added to pino redaction.
Onboarding templates generate real, dated, employee-linked tasks in one transaction, and
personnel events feed the shared `activities` timeline via the denormalized `employee_id`.
The reviewed permission matrix already carried `personnel.*`, so no matrix change was needed.
Docs (data-model, api, architecture, security, README, roadmap) are updated to match; the
stored personal data still requires GDPR/legal review (feeds Phase 9). Phase 4 (Quotes &
invoicing) is next.

## 11. Status (2026-07-13, Phase 2)

Phase 2 is implemented on top of the Phase 1 foundation: the `customers`, `contacts`,
`projects`, `tasks`, `comments`, `attachments`, `activity` and `search` API modules, backed
by seven new models (migration `20260713103911_phase2_customers_projects_tasks`) and shared
zod contracts in `packages/types`. File attachments use MinIO/S3 through the `ObjectStorage`
wrapper (server-side size + content-type validation, presigned 5-minute downloads); comments
and attachments are polymorphic over customers/projects/tasks with the "exactly one parent"
rule and tenant-isolation gate enforced in the service layer. A user-facing `activities`
timeline (distinct from the security audit log, with a denormalized customer chain) and an
org-wide, permission-scoped search complete the module, and completing a task emits a
`task.completed` domain event on the existing outbox. The reviewed permission matrix already
carried `customers.*`, `projects.*`, `tasks.*`, so no matrix change was needed. Docs
(data-model, api, architecture, security, README, roadmap) are updated to match; Phase 3
(Personnel) is next.

## 13. Status (2026-07-13, Phase 4)

Phase 4 (Quotes & invoicing) is implemented on top of Phases 1–3: the `products`, `quotes`,
`invoices`, `payments` and `credit-notes` API modules, backed by nine new models (migration
`20260713153048_phase4_quotes_invoicing`) and shared zod contracts in `packages/types`. Money
is **deterministic and never floating point** — integer minor units (`BigInt`) computed
server-side with decimal.js and HALF_UP line-level rounding (`apps/api/src/lib/money.ts`).
Quotes run `DRAFT → SENT → ACCEPTED` and convert into a draft invoice; invoices are editable
only while draft and become **immutable on finalize**, which allocates a concurrency-safe
per-organization number under a row lock (`number_sequences`) inside the finalize transaction
and generates a pdfkit PDF stored via the shared `@businessos/storage` package. Send emails
the invoice with the PDF attached (worker fetches it from storage — the worker now also needs
`S3_*`), payments allow partials but reject overpayment, and credit notes (full/partial,
over-credit rejected) correct finalized invoices; an overdue sweep worker job flags unpaid
past-due invoices. New outbox events `quote.accepted`, `invoice.finalized` (the Phase 5
accounting-draft hook), `invoice.sent` and `payment.registered` were added. The reviewed
permission matrix already carried `invoices.read` / `invoices.manage`, so no matrix change was
needed. Docs (data-model, api, architecture, security, README, roadmap, legal-review) are
updated to match. The money/VAT/numbering machinery is a **technical foundation only** and
still requires professional review against momslagen/EU VAT and bokföringslagen before real
use. Phase 5 (Bookkeeping support) is next.

## 14. Status (2026-07-17, Phase 8) — catch-up through Phases 5–8

This entry brings the status log current (the per-phase notes for 5–7 live in
[product-roadmap.md](product-roadmap.md), the maintained phase tracker). Phase 5 (bookkeeping —
double-entry ledger with event-driven draft vouchers), Phase 6 (calendar & tasks — server-side
recurrence, reminders), and Phase 7 (email — shared/personal mailboxes, outbound via the worker
pipeline, inbound via an authenticated webhook seam) all shipped and are documented there.

**Phase 8 (Voice notes & telephony) is delivered.** The `recordings` API module and one worker
consumer, backed by two new models — `Recording` and `TranscriptSegment` (migration
`20260717210840_phase8_recordings`) — and shared zod contracts in `packages/types`. A recording
is a **voice note** (uploaded audio) or a **call log** (no audio). Audio is validated
server-side (MIME type + 50 MB cap) and stored through `@businessos/storage`; the DTO exposes a
derived `hasAudio` and never the storage key, and audio is read back only via a short-lived
signed URL. **Transcription is asynchronous**: upload writes a `recording.uploaded` outbox
message in the same transaction, and the worker's `recording.transcribe` consumer transcribes
through a **pluggable `Transcriber` seam** — a **deterministic `StubTranscriber`** now (offline,
reproducible tests), a real STT provider at Phase 9 behind the same interface — rewriting
time-coded segments in one transaction (idempotent), with `status`/`transcriptStatus` tracking
progress and re-transcription enqueuing a fresh message (see
[ADR-0009](decisions/adr-0009-pluggable-transcription-seam.md)). Search spans title and
transcript text; **recording → task** and **recording → DRAFT invoice** are each dual-gated
(`recordings.manage` + `tasks.manage` / `invoices.manage`) so neither permission is a back door.
The reviewed permission matrix already carried `recordings.read` / `recordings.manage`, so no
matrix change was needed. Docs (data-model, api, architecture, roadmap, this plan) and ADR-0009
are updated to match. The `→ invoice` output is a **DRAFT for review only** — no bookkeeping or
tax-compliance claim attaches (see [legal-review-required.md](legal-review-required.md)), and a
real STT provider carries its own review since audio is personal data and the vendor a
subprocessor. Phase 9 (integrations & compliance hardening) is next.

## 15. Status (2026-07-18, Phase 9) — integrations & compliance, feature-complete

**Phase 9 (Integrations & compliance hardening) is delivered — the project is now
feature-complete against the 9-phase plan.** Two new API modules (`integrations`, `compliance`),
four worker jobs, and four new models — `WebhookEndpoint`, `WebhookDelivery`, `DataExportJob`,
`RetentionPolicy` (migration `20260718194050_phase9_integrations_compliance`) — with shared zod
contracts, event constants and the signing scheme in `packages/types`.

- **Outbound webhooks.** Org-managed endpoints subscribe to specific domain events or `'*'`. The
  worker's `webhook.dispatch` consumer binds `#` on `businessos.events` and creates one delivery
  row per (endpoint, event) — unique, so redelivery is idempotent — then POSTs a JSON envelope
  with an **HMAC-SHA256 signature** (`x-businessos-signature: t=…,v1=…`, scheme in
  `@businessos/types`). Failures retry with exponential backoff via `webhook-retry-sweep`; a
  synchronous `ping`, secret **rotation** and manual **redelivery** round out the surface.
  Permissions `integrations.read` / `integrations.manage` (OWNER/ADMIN).
- **SSRF guard.** `assertDeliverableUrl` / `isBlockedAddress` (`apps/*/src/lib/url-safety.ts`,
  byte-for-byte identical in API and worker) reject loopback/private/link-local/metadata hosts
  and non-https URLs, re-checked at delivery time. `WEBHOOK_ALLOW_LOCAL` (off in prod) relaxes it
  for loopback receivers in dev/tests.
- **GDPR export & retention.** `POST /v1/organization/export` enqueues a job the worker turns
  into a JSON bundle in object storage (secrets excluded), served by a short-lived signed URL;
  per-org **retention windows** drive a worker sweep that deletes aged recordings/audit
  logs/activities/webhook deliveries. `org.update` gates both.
- **Organization erasure.** `DELETE /v1/organization` — **OWNER-only** (`org.delete`), typed-slug
  confirmation, cascade-deletes all org data (33 FKs `onDelete: Cascade`) and purges storage.
- **Multi-worker outbox.** The relay now uses `SELECT … FOR UPDATE SKIP LOCKED` and marks rows in
  the same transaction, so multiple workers never double-publish (ADR-0011, superseding ADR-0005's
  single-relay note).
- **Evaluations recorded.** ADR-0010 (Postgres RLS re-evaluated — app-layer tenancy kept as the
  primary control, RLS as future defence-in-depth, amending ADR-0004) and ADR-0012 (custom role
  editor evaluated — code-defined matrix kept, amending ADR-0003).

**Tests.** Integration: `webhooks.test.ts` (16), `compliance.test.ts` (9),
`tenant.isolation.p9.test.ts` (4), `rbac.p9.test.ts` (5) — the full API integration suite is
**63 files / 399 tests green**. Unit: `url-safety` and `webhook-sign` in both API and worker
(the API's `webhook-sign` test additionally asserts the API and worker copies are byte-for-byte
identical). Docs (api, data-model, architecture, security, roadmap, this plan) and ADRs 0010–0012
are updated to match.

**Compliance caveats unchanged.** Export/erasure/retention are implemented controls, not a
finished GDPR programme; bookkeeping/VAT is not legally reviewed; audio (STT) and email remain
personal-data processing needing DPO/subprocessor review
([legal-review-required.md](legal-review-required.md)). Remaining work is the per-phase
"Future work" items in [product-roadmap.md](product-roadmap.md) (real provider swaps,
DST-correct recurrence, external calendar/mailbox sync) — not new phases.
