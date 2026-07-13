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
`tokenHash`, `passwordHash` fields are censored. Request bodies are never logged.

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
permission matrix.

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
| `S3_BUCKET`     | `businessos`            | bucket for attachments                   |
| `S3_REGION`     | `us-east-1`             | region (required by the S3 SDK)          |

`S3_SECRET_KEY` is a credential and must be rotated/managed like other secrets in
production; the local value is a development default only.

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
