# API reference

Base URL (local development): `http://localhost:3001` (configurable via `API_PORT`).
All application routes are versioned under `/v1`; health probes are unversioned.

## Authentication

- Cookie session: `bos_session` (HttpOnly, SameSite=Lax, 30-day TTL). Login/register set
  it; requests must be sent with credentials (`credentials: 'include'`).
- **CSRF**: on POST/PUT/PATCH/DELETE with a session cookie present, the request must carry
  an `Origin` header matching the configured web origin (or a matching `Referer`).
  Requests without either are rejected with 403 `csrf_rejected`.

## Error envelope

Every error response has the shape:

```json
{ "error": { "code": "string", "message": "string", "details": {} } }
```

`details` is optional (present on validation errors). Common codes: `validation_error`
(400), `unauthorized` (401), `forbidden` (403), `no_active_organization` (403),
`not_found` (404), `conflict` variants (409), `rate_limited` (429), `internal_error` (500).

## Pagination envelope

List endpoints that paginate accept `?page=` and `?pageSize=` query parameters and return:

```json
{ "items": [], "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 }
```

## Endpoints

Auth column: **public** (no session), **session** (any authenticated user), a permission
name (authenticated + active organization + role must grant it via the matrix in
`packages/types/src/permissions.ts`), or **platform admin** (`users.is_platform_admin`).

### Health

| Method | Path       | Auth   | Notes                                   |
| ------ | ---------- | ------ | --------------------------------------- |
| GET    | `/healthz` | public | liveness                                |
| GET    | `/readyz`  | public | readiness (database check), 503 if down |

### Auth

| Method | Path                       | Auth    | Notes                                   |
| ------ | -------------------------- | ------- | --------------------------------------- |
| POST   | `/v1/auth/register`        | public  | rate limit 10/min; sets session cookie  |
| POST   | `/v1/auth/login`           | public  | rate limit 10/min; sets session cookie  |
| POST   | `/v1/auth/logout`          | session | deletes session, clears cookie          |
| POST   | `/v1/auth/forgot-password` | public  | rate limit 5/min; always 204            |
| POST   | `/v1/auth/reset-password`  | public  | rate limit 10/min                       |
| GET    | `/v1/auth/session`         | session | current user + memberships + active org |

### Me

| Method | Path              | Auth    | Notes                                         |
| ------ | ----------------- | ------- | --------------------------------------------- |
| GET    | `/v1/me`          | session |                                               |
| PATCH  | `/v1/me`          | session | name, locale                                  |
| PATCH  | `/v1/me/password` | session | rate limit 10/min; revokes all other sessions |

### Organizations

| Method | Path                        | Auth         | Notes                                   |
| ------ | --------------------------- | ------------ | --------------------------------------- |
| POST   | `/v1/organizations`         | session      | creator becomes OWNER; session switches |
| GET    | `/v1/organizations`         | session      | the caller's memberships                |
| GET    | `/v1/organizations/current` | `org.read`   | active organization                     |
| PATCH  | `/v1/organizations/current` | `org.update` | name, locale, currency                  |
| POST   | `/v1/organizations/switch`  | session      | must be a member of the target org      |

### Members

| Method | Path                                          | Auth                  | Notes                    |
| ------ | --------------------------------------------- | --------------------- | ------------------------ |
| GET    | `/v1/organizations/current/members`           | `members.read`        | paginated                |
| PATCH  | `/v1/organizations/current/members/:memberId` | `members.update_role` | not self, not OWNER rows |
| DELETE | `/v1/organizations/current/members/:memberId` | `members.remove`      | not self, not OWNER rows |

### Invitations

| Method | Path                                                  | Auth             | Notes                                     |
| ------ | ----------------------------------------------------- | ---------------- | ----------------------------------------- |
| POST   | `/v1/organizations/current/invitations`               | `members.invite` | emails the invite link (7-day TTL)        |
| GET    | `/v1/organizations/current/invitations`               | `members.invite` | pending invitations                       |
| DELETE | `/v1/organizations/current/invitations/:invitationId` | `members.invite` | revoke                                    |
| GET    | `/v1/invitations/:token`                              | public           | preview before login; rate limit 30/min   |
| POST   | `/v1/invitations/:token/accept`                       | session          | email must match; session switches to org |

### Audit

| Method | Path                                   | Auth         | Notes     |
| ------ | -------------------------------------- | ------------ | --------- |
| GET    | `/v1/organizations/current/audit-logs` | `audit.read` | paginated |

### Admin (platform operator)

| Method | Path                                       | Auth           | Notes                          |
| ------ | ------------------------------------------ | -------------- | ------------------------------ |
| GET    | `/v1/admin/failed-jobs`                    | platform admin | paginated, cross-organization  |
| POST   | `/v1/admin/failed-jobs/:failedJobId/retry` | platform admin | re-enqueues through the outbox |

## OpenAPI

- `GET /docs/json` serves the OpenAPI document in non-production environments.
- `pnpm generate:openapi` writes it to `apps/api/openapi.json`.
