# Security

Security baseline implemented in Phase 1, verified against the code in `apps/api/src`.

## Password hashing

Argon2id via the `argon2` package with OWASP-recommended parameters
(`apps/api/src/lib/passwords.ts`):

- memory cost **19 456 KiB**, time cost **2**, parallelism **1**
- malformed stored hashes verify as "no match" instead of throwing (no 500 on corrupt data)

## Sessions

Opaque server-side sessions (ADR-0002), `apps/api/src/modules/auth/session.ts`:

- 32-byte random token (base64url); only the **SHA-256 hash** is stored
  (`sessions.token_hash`), so a database leak does not leak usable credentials
- TTL **30 days**; expiry checked on every request; `last_used_at` refreshed at most
  hourly (best effort)
- Cookie `bos_session`: **HttpOnly**, **SameSite=Lax**, `Path=/`,
  `Secure` when `NODE_ENV=production`
- Logout deletes the session row; password change deletes every _other_ session of the
  user; the same hashing scheme (raw token never persisted) applies to invitation and
  password-reset tokens

## CSRF

Defence in depth on top of SameSite=Lax (`apps/api/src/plugins/security.ts`):

- Applies to POST/PUT/PATCH/DELETE **only when a session cookie is present**
- The `Origin` header must match an allow-list (`WEB_ORIGIN`, `APP_BASE_URL`); if absent,
  `Referer` is checked against the same list
- A cookie-bearing state change with neither header is **rejected** (browsers always send
  Origin on fetch/cross-site requests; future non-browser clients will use header-based
  API tokens instead of cookies)

## Rate limits

`@fastify/rate-limit`, per-IP:

| Scope                                                                          | Limit   |
| ------------------------------------------------------------------------------ | ------- |
| Global (all routes)                                                            | 300/min |
| `POST /v1/auth/register`, `/login`, `/reset-password`, `PATCH /v1/me/password` | 10/min  |
| `POST /v1/auth/forgot-password`                                                | 5/min   |
| `GET /v1/invitations/:token` (preview)                                         | 30/min  |

429 responses use the standard error envelope with code `rate_limited`.

## Input and output allow-lists

- Every route validates body/params/query with zod schemas from `packages/types`
  (schemas are allow-lists → mass assignment is not possible)
- Responses are serialized through zod response schemas; fields not in the DTO schema
  (password hashes, token hashes, internal columns) never leave the API

## Logging

Pino structured JSON with redaction (`apps/api/src/lib/logger.ts`): `authorization` and
`cookie` request headers, `set-cookie` response headers, and any `password`, `token`,
`tokenHash`, `passwordHash` fields are censored. Request bodies are never logged. Phase 3
adds the sensitive personnel fields to the redaction paths — `personalIdNumber`,
`dateOfBirth`, `homeAddress`, `personalEmail`, `personalPhone`, `emergencyContactPhone` —
so personal identifiers are censored anywhere they appear in a logged object.

## Audit log

Append-only `audit_logs` table with actor, IP, user agent and metadata. Actions recorded
in Phase 1 (`packages/types/src/audit.ts`):

`user.registered`, `user.login`, `user.login_failed`, `user.logout`,
`user.password_reset_requested`, `user.password_reset_completed`, `user.password_changed`,
`user.profile_updated`, `organization.created`, `organization.updated`,
`organization.switched`, `member.invited`, `member.invitation_accepted`,
`member.invitation_revoked`, `member.role_changed`, `member.removed`.

Phase 2 adds: `customer.created`, `customer.updated`, `customer.archived`,
`project.created`, `project.updated`, `project.archived`, `task.created`, `task.updated`,
`task.completed`, `task.deleted`, `comment.created`, `comment.deleted`,
`attachment.uploaded`, `attachment.deleted`.

Phase 3 adds: `employee.created`, `employee.updated`, `employee.status_changed`,
`employee.deleted`, **`employee.sensitive_viewed`** (the sensitive-read access log),
`employee_note.created`, `employee_note.deleted`, `certification.created`,
`certification.updated`, `certification.deleted`, `absence.requested`, `absence.approved`,
`absence.rejected`, `absence.cancelled`, `employee_document.uploaded`,
`employee_document.deleted`, `onboarding_template.created`, `onboarding_template.updated`,
`onboarding_template.deleted`, `onboarding_template.applied`.

Action identifiers are stable and never renamed. The audit log is distinct from the
Phase 2 user-facing `activities` feed (see
[architecture.md](architecture.md#activity-timeline)): the audit log is the security
record, the activity feed is a product timeline.

## Tenant isolation

- Active organization comes only from the server-side session; membership is re-checked
  on **every request** so removed members lose access immediately
- `POST /v1/organizations/switch` validates the requested org against a membership row
  before touching the session
- Integration tests assert cross-tenant access fails (member of org A cannot read or
  mutate org B data) — this is a required part of the Phase 1 test suite
- **Phase 2 resources** — customers, contacts, projects, tasks, comments, attachments and
  activities all carry `organization_id` and are queried only through the session-resolved
  organization. Polymorphic writes (comments/attachments) go through `resolveEntityRef`,
  which looks the parent up scoped to the organization and throws 404 if it is not in the
  caller's tenant — this is the isolation gate for every polymorphic insert. Signed
  download URLs are minted only after the attachment row is confirmed to belong to the
  caller's organization.
- **Phase 4 resources** — products, quotes, invoices, quote/invoice line items, payments and
  credit notes all carry `organization_id` and are looked up scoped to the session
  organization; a payment or credit note is only ever attached to an invoice re-fetched
  within the caller's tenant, and the invoice PDF's presigned URL is minted only after that
  ownership check. Document numbers are per-organization (unique `(organization_id, number)`),
  so tenants never see or collide on each other's invoice numbers.

## Attachment upload/download (Phase 2)

File attachments stream through the API (`apps/api/src/modules/attachments`), which
validates every upload server-side before storing anything:

- **Size** — capped at `MAX_ATTACHMENT_BYTES` (**25 MB**). The **client-declared size is
  never trusted**: the limit is enforced from the measured buffer length and the
  `@fastify/multipart` truncation flag.
- **Content type** — checked against the `ALLOWED_ATTACHMENT_TYPES` allow-list
  (`packages/types/src/contracts/attachments.ts`): PNG, JPEG, GIF, WebP, PDF, plain text,
  CSV, Word/Excel (`.doc`/`.docx`/`.xls`/`.xlsx`) and ZIP. Anything else is rejected 400.
- **Private bucket, signed downloads** — clients never receive bucket credentials or a
  public URL. Downloads are **presigned GET URLs valid for 5 minutes**
  (`DOWNLOAD_URL_TTL_SECONDS`) with a forced download filename; the URL is issued only
  after the row is confirmed in the caller's organization.
- **Namespacing** — object keys are `org/<orgId>/<uuid>/<safe-name>`, so a leaked or
  guessed key still maps to one tenant and cannot collide.

## Search permission scoping (Phase 2)

`GET /v1/search` requires a session but scopes results by permission: each of customers,
projects and tasks is queried only when the caller holds its `*.read` permission. Roles
never see entities they could not read directly — search is not a bypass around the
permission matrix. Phase 3 adds employees to search on the same rule — the employee query
runs only for callers with `personnel.read`, and it selects **directory fields only** (name,
work email, job title, department), never sensitive personal data.

## Personnel sensitive-data handling (Phase 3)

Employee records carry two tiers of data separated by permission, enforced in the API's
serialization and route layers (`apps/api/src/lib/mappers-personnel.ts`,
`apps/api/src/modules/employees`), not by hiding database columns.

**Two permission tiers:**

- **`personnel.read`** — the **directory**: name, work email/phone, job title, department,
  employment status/type, start/end date, manager, optional linked user. This is what
  `MANAGER` and `READONLY` roles see.
- **`personnel.read_sensitive`** — the extra **sensitive block**: personnummer
  (`personalIdNumber`), date of birth, home address, personal email/phone and emergency
  contact. Held **only by `OWNER` and `ADMIN`** in the code-defined matrix (`MANAGER` has
  `read` + `manage` but **not** `read_sensitive`).

**How the tiers are enforced:**

- **Serialization gate** — `toEmployeeDto` attaches the `sensitive` object **only when the
  caller holds `personnel.read_sensitive`**; otherwise the key is absent entirely, so the
  data never leaves the process. The employee **list never includes the sensitive block**,
  regardless of role (`GET /v1/employees` always serializes with `includeSensitive: false`).
  It appears only on the **detail** response (`GET /v1/employees/:id`) for authorized
  callers.
- **Access logging** — every sensitive read is audited. When a caller with
  `personnel.read_sensitive` fetches an employee detail, the API records an
  **`employee.sensitive_viewed`** audit entry (actor, IP, user agent) so sensitive access is
  attributable after the fact.
- **Sensitive writes also require `read_sensitive`** — create/update reject any attempt to
  set a sensitive field by a caller without `personnel.read_sensitive`
  (`assertSensitiveWriteAllowed` checks the request body against `SENSITIVE_EMPLOYEE_FIELDS`
  and throws 403), even though the write endpoints themselves are guarded by
  `personnel.manage`. So a `MANAGER` can edit directory fields but not personnummer.
- **Internal notes require `read_sensitive`** — `employee_notes` (`/v1/employees/:id/notes`)
  are the most restricted personnel data: **both reading and writing** require
  `personnel.read_sensitive`, stricter than the surrounding directory access.
- **Sensitive documents are hidden from directory viewers** — a document uploaded with
  `?sensitive=true` (which itself requires `read_sensitive`) is filtered out of the list for
  directory-only viewers, and a direct download-URL request for one returns **404, not 403**,
  so the API does not even reveal that a sensitive document exists. Employee documents reuse
  the Phase 2 object-storage model (private bucket, server-side size/content-type validation,
  presigned 5-minute downloads, `org/<orgId>/<uuid>/<safe-name>` keys) — see
  [architecture.md](architecture.md#object-storage-flow) and the S3 configuration below.

**Log redaction** — the pino redaction paths (`apps/api/src/lib/logger.ts`) censor the
sensitive personnel fields so they never appear in logs even if an object carrying them is
logged: `personalIdNumber`, `dateOfBirth`, `homeAddress`, `personalEmail`, `personalPhone`,
`emergencyContactPhone` (in addition to the Phase 1 `password`/`token`/`hash` paths).

**Requires further GDPR/legal review** — these fields are **special-category / sensitive
personal data** under GDPR (a national identity number, date of birth, home address). The
current controls (permission tiers, access logging, redaction) are technical safeguards, not
a compliance sign-off. Before production use the following need legal/DPO review: lawful
basis and records of processing for each field; **retention** windows (none are enforced
yet); and **right-to-erasure** — today an employee's personal data is removed only by
deleting the `employees` row (`DELETE /v1/employees/:id`, which cascades notes,
certifications, absences and documents and SetNulls their tasks), with no partial-erasure or
export workflow. See [legal-review-required.md](legal-review-required.md).

## Financial-operation integrity (Phase 4)

Invoicing touches money, so Phase 4 adds integrity controls beyond ordinary CRUD:

- **Money is never floating point.** All amounts are integer minor units (öre) stored as
  `BigInt` and computed with decimal.js (HALF_UP at the line level). The UI does no money
  math; the server is the single source of every total. This eliminates a whole class of
  rounding/precision defects.
- **Explicit database transactions** wrap every state-changing financial operation —
  finalize, send, cancel, payment register/remove, credit-note issue — so number allocation,
  status recomputation, audit and outbox writes all commit atomically or not at all.
- **Immutable finalized invoices.** Once finalized (numbered, `finalized_at` set), an
  invoice and its lines are frozen: edits and deletes are rejected, and corrections are made
  only through credit notes. This preserves an accurate, non-repudiable record of what was
  billed.
- **Concurrency-safe numbering.** `number_sequences` is incremented under a row-level write
  lock inside the finalize transaction, so concurrent finalizations cannot produce duplicate
  or gap numbers — a bookkeeping-integrity requirement (see
  [architecture.md](architecture.md#concurrency-safe-document-numbering)).
- **Overpayment and over-credit are rejected server-side** (400 `overpayment` /
  `over_credit`): a payment cannot exceed the amount due, and total credited cannot exceed
  the invoice total. Clients cannot bypass this — it is enforced in the transaction that
  recomputes the invoice position.
- These are technical safeguards. VAT correctness, invoice-content requirements and
  numbering/immutability against **bokföringslagen** still require professional review before
  production (see [legal-review-required.md](legal-review-required.md)).

## Secrets and configuration

Environment is validated with zod at startup in every app (`packages/config`);
missing or invalid values abort boot with a readable report (e.g. `SESSION_SECRET`
minimum length). No app starts partially configured.

Object storage (Phase 2) is configured via `S3_*` variables, validated at API startup:

| Variable        | Local value             | Purpose                                  |
| --------------- | ----------------------- | ---------------------------------------- |
| `S3_ENDPOINT`   | `http://localhost:9000` | S3-compatible endpoint (MinIO locally)   |
| `S3_ACCESS_KEY` | `businessos`            | access key                               |
| `S3_SECRET_KEY` | `businessos-dev-secret` | secret key — a real secret in production |
| `S3_BUCKET`     | `businessos`            | bucket for attachments + employee docs   |
| `S3_REGION`     | `us-east-1`             | region (required by the S3 SDK)          |

`S3_SECRET_KEY` is a credential and must be rotated/managed like other secrets in
production; the local value is a development default only.

As of **Phase 4 the worker also requires the same `S3_*` variables** (validated at worker
startup in `apps/worker/src/env.ts`): the invoice-email consumer fetches the finalized
invoice PDF from object storage to attach it to outgoing mail. Point the worker at the same
bucket/endpoint as the API.

## Not implemented yet (designed, Phase 9)

- **Data retention policies** — retention windows per data category are not enforced
- **Organization export and deletion** (GDPR portability/erasure) — not implemented

## Review before production

- **GDPR**: records of processing, DPAs with subprocessors, retention, export/erasure
  (see [legal-review-required.md](legal-review-required.md))
- **Postgres row-level security**: evaluated and deferred (ADR-0004) — revisit
- **Cookie `Secure` flag**: only set when `NODE_ENV=production`; requires TLS termination
- **`trustProxy`**: currently `false`; must be enabled (and configured correctly) behind a
  reverse proxy, otherwise per-IP rate limits and audit IPs record the proxy address
