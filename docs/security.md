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

Action identifiers are stable and never renamed.

## Tenant isolation

- Active organization comes only from the server-side session; membership is re-checked
  on **every request** so removed members lose access immediately
- `POST /v1/organizations/switch` validates the requested org against a membership row
  before touching the session
- Integration tests assert cross-tenant access fails (member of org A cannot read or
  mutate org B data) — this is a required part of the Phase 1 test suite

## Secrets and configuration

Environment is validated with zod at startup in every app (`packages/config`);
missing or invalid values abort boot with a readable report (e.g. `SESSION_SECRET`
minimum length). No app starts partially configured.

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
