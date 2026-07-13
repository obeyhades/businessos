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

## Phase 2 — customers, projects, tasks

All routes require an active organization and the listed permission. List endpoints use the
`?page=`/`?pageSize=` pagination envelope above (default page size 25, max 100).

### Customers

| Method | Path                                 | Auth               | Notes                                                  |
| ------ | ------------------------------------ | ------------------ | ------------------------------------------------------ |
| GET    | `/v1/customers`                      | `customers.read`   | paginated; filters `?status=`, `?search=` (name/email) |
| POST   | `/v1/customers`                      | `customers.manage` | records `customer.created` activity + outbox event     |
| GET    | `/v1/customers/:customerId`          | `customers.read`   |                                                        |
| PATCH  | `/v1/customers/:customerId`          | `customers.manage` | partial update; status change → `customer.archived`    |
| GET    | `/v1/customers/:customerId/activity` | `customers.read`   | paginated customer timeline (denormalized, one query)  |

### Customer contacts

| Method | Path                                            | Auth               | Notes          |
| ------ | ----------------------------------------------- | ------------------ | -------------- |
| GET    | `/v1/customers/:customerId/contacts`            | `customers.read`   |                |
| POST   | `/v1/customers/:customerId/contacts`            | `customers.manage` |                |
| PATCH  | `/v1/customers/:customerId/contacts/:contactId` | `customers.manage` | partial update |
| DELETE | `/v1/customers/:customerId/contacts/:contactId` | `customers.manage` | 204            |

### Projects

| Method | Path                               | Auth              | Notes                                                     |
| ------ | ---------------------------------- | ----------------- | --------------------------------------------------------- |
| GET    | `/v1/projects`                     | `projects.read`   | paginated; filters `?status=`, `?customerId=`, `?search=` |
| POST   | `/v1/projects`                     | `projects.manage` | optional `customerId`                                     |
| GET    | `/v1/projects/:projectId`          | `projects.read`   |                                                           |
| PATCH  | `/v1/projects/:projectId`          | `projects.manage` | partial update                                            |
| GET    | `/v1/projects/:projectId/activity` | `projects.read`   | paginated project timeline                                |

### Tasks

| Method | Path                         | Auth           | Notes                                                                                                            |
| ------ | ---------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/tasks`                  | `tasks.read`   | paginated; filters `?status=`, `?priority=`, `?assigneeId=`, `?customerId=`, `?projectId=`, `?mine=`, `?search=` |
| POST   | `/v1/tasks`                  | `tasks.manage` | optional customer/project/assignee                                                                               |
| GET    | `/v1/tasks/:taskId`          | `tasks.read`   |                                                                                                                  |
| PATCH  | `/v1/tasks/:taskId`          | `tasks.manage` | first transition to `DONE` sets `completedAt` + emits `task.completed` event                                     |
| DELETE | `/v1/tasks/:taskId`          | `tasks.manage` | 204                                                                                                              |
| GET    | `/v1/tasks/:taskId/activity` | `tasks.read`   | paginated task timeline                                                                                          |

### Comments (polymorphic)

`:resource` ∈ `customers` \| `projects` \| `tasks`; the required permission is that
resource's `read`/`manage`. The parent is validated against the organization before any
write (tenant-isolation gate).

| Method | Path                                          | Auth                | Notes                                                      |
| ------ | --------------------------------------------- | ------------------- | ---------------------------------------------------------- |
| GET    | `/v1/:resource/:entityId/comments`            | `<resource>.read`   | oldest-first                                               |
| POST   | `/v1/:resource/:entityId/comments`            | `<resource>.manage` | body `{ body }`; records `comment.added` activity          |
| DELETE | `/v1/:resource/:entityId/comments/:commentId` | `<resource>.read`   | author may delete own; otherwise needs `<resource>.manage` |

### Attachments (polymorphic)

`:resource` ∈ `customers` \| `projects` \| `tasks`, as above. Uploads are **multipart
form-data** streamed through the API; size and content type are validated server-side
(max **25 MB**; allow-list of PNG/JPEG/GIF/WebP, PDF, plain text, CSV, Word/Excel `.doc`/
`.docx`/`.xls`/`.xlsx`, and ZIP). The client-declared size is never trusted.

| Method | Path                                                             | Auth                | Notes                                                 |
| ------ | ---------------------------------------------------------------- | ------------------- | ----------------------------------------------------- |
| GET    | `/v1/:resource/:entityId/attachments`                            | `<resource>.read`   | newest-first metadata list                            |
| POST   | `/v1/:resource/:entityId/attachments`                            | `<resource>.manage` | multipart upload; records `attachment.added`          |
| GET    | `/v1/:resource/:entityId/attachments/:attachmentId/download-url` | `<resource>.read`   | returns `{ url, expiresInSeconds }`; signed 5-min GET |
| DELETE | `/v1/:resource/:entityId/attachments/:attachmentId`              | `<resource>.manage` | 204; deletes row + best-effort object                 |

### Activity feed & search

| Method | Path           | Auth             | Notes                                                                          |
| ------ | -------------- | ---------------- | ------------------------------------------------------------------------------ |
| GET    | `/v1/activity` | `dashboard.read` | paginated org-wide recent activity (dashboard feed)                            |
| GET    | `/v1/search`   | session          | `?q=` (1–200 chars), `?limit=` (1–50, default 20); per-type permission scoping |

`/v1/search` returns `{ results: [{ kind, id, title, subtitle }] }`. As of Phase 3 the
`kind` is one of `customer`, `project`, `task` or **`employee`**. Each entity type is only
queried if the caller holds its `*.read` permission (`personnel.read` for employees), so
results never leak data the role cannot otherwise see. Employee hits use directory fields
only (name as title, job title/department as subtitle) — never sensitive data.

## Phase 3 — personnel

All routes require an active organization and the listed permission. The key rule is the
**two-tier sensitivity split**: `personnel.read` grants directory data, `personnel.manage`
grants create/edit/delete, and `personnel.read_sensitive` (OWNER/ADMIN only) grants the
sensitive personal block, internal notes and sensitive documents. See
[security.md](security.md#personnel-sensitive-data-handling-phase-3).

### Employees

| Method | Path                                       | Auth               | Notes                                                                                                                                        |
| ------ | ------------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/employees`                            | `personnel.read`   | paginated; filters `?status=`, `?department=`, `?managerId=`, `?search=`. **Never** returns the sensitive block                              |
| POST   | `/v1/employees`                            | `personnel.manage` | sensitive fields in the body additionally require `personnel.read_sensitive` (else 403)                                                      |
| GET    | `/v1/employees/:employeeId`                | `personnel.read`   | detail; includes the `sensitive` object **only** with `personnel.read_sensitive`, and logs an `employee.sensitive_viewed` audit when it does |
| PATCH  | `/v1/employees/:employeeId`                | `personnel.manage` | partial update; sensitive-field writes require `personnel.read_sensitive`; status change → `employee.status_changed`                         |
| DELETE | `/v1/employees/:employeeId`                | `personnel.manage` | 204; cascades notes/certs/absences/documents, detaches tasks                                                                                 |
| POST   | `/v1/employees/:employeeId/apply-template` | `personnel.manage` | onboarding automation: generates dated tasks from a template; returns `{ createdTaskCount }`                                                 |
| GET    | `/v1/employees/:employeeId/activity`       | `personnel.read`   | paginated employee timeline                                                                                                                  |

### Employee notes (restricted)

Both read and write require `personnel.read_sensitive` — stricter than directory access.

| Method | Path                                      | Auth                       | Notes           |
| ------ | ----------------------------------------- | -------------------------- | --------------- |
| GET    | `/v1/employees/:employeeId/notes`         | `personnel.read_sensitive` | newest-first    |
| POST   | `/v1/employees/:employeeId/notes`         | `personnel.read_sensitive` | body `{ body }` |
| DELETE | `/v1/employees/:employeeId/notes/:noteId` | `personnel.read_sensitive` | 204             |

### Certifications

| Method | Path                                                        | Auth               | Notes                                                                           |
| ------ | ----------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------- |
| GET    | `/v1/employees/:employeeId/certifications`                  | `personnel.read`   | sorted by expiry (nulls last)                                                   |
| POST   | `/v1/employees/:employeeId/certifications`                  | `personnel.manage` |                                                                                 |
| PATCH  | `/v1/employees/:employeeId/certifications/:certificationId` | `personnel.manage` | partial update                                                                  |
| DELETE | `/v1/employees/:employeeId/certifications/:certificationId` | `personnel.manage` | 204                                                                             |
| GET    | `/v1/certifications/expiring`                               | `personnel.read`   | `?withinDays=` (1–365, default 60); includes already-expired, with employee ref |

### Absence requests

| Method | Path                                         | Auth               | Notes                                                                                                |
| ------ | -------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| GET    | `/v1/absence-requests`                       | `personnel.read`   | paginated; filters `?status=`, `?employeeId=`                                                        |
| GET    | `/v1/employees/:employeeId/absence-requests` | `personnel.read`   | one employee's requests, newest-first                                                                |
| POST   | `/v1/employees/:employeeId/absence-requests` | `personnel.manage` | creates a `PENDING` request                                                                          |
| POST   | `/v1/absence-requests/:absenceId/review`     | `personnel.manage` | body `{ decision: APPROVED\|REJECTED, reviewNote? }`; only `PENDING` may be reviewed (409 otherwise) |
| POST   | `/v1/absence-requests/:absenceId/cancel`     | `personnel.manage` | sets `CANCELLED` (409 if already cancelled)                                                          |

### Employee documents

Multipart upload streamed through the API, same size/content-type validation as Phase 2
attachments (max **25 MB**, allow-list). Downloads are presigned 5-minute GET URLs.

| Method | Path                                                           | Auth               | Notes                                                                                                                                                |
| ------ | -------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/employees/:employeeId/documents`                          | `personnel.read`   | newest-first; `is_sensitive` docs hidden unless caller has `personnel.read_sensitive`                                                                |
| POST   | `/v1/employees/:employeeId/documents`                          | `personnel.manage` | multipart; `?category=` (`EmployeeDocumentCategory`, default `OTHER`) and `?sensitive=` (bool). `sensitive=true` requires `personnel.read_sensitive` |
| GET    | `/v1/employees/:employeeId/documents/:documentId/download-url` | `personnel.read`   | signed 5-min GET; a sensitive doc returns **404** (not 403) to non-sensitive callers                                                                 |
| DELETE | `/v1/employees/:employeeId/documents/:documentId`              | `personnel.manage` | 204; deletes row + best-effort object                                                                                                                |

### Onboarding templates

| Method | Path                                   | Auth               | Notes                                                                                             |
| ------ | -------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------- |
| GET    | `/v1/onboarding-templates`             | `personnel.read`   | with items                                                                                        |
| POST   | `/v1/onboarding-templates`             | `personnel.manage` | body includes `type` (`ONBOARDING`/`OFFBOARDING`) + `items[]` (title, description, dueOffsetDays) |
| GET    | `/v1/onboarding-templates/:templateId` | `personnel.read`   |                                                                                                   |
| PATCH  | `/v1/onboarding-templates/:templateId` | `personnel.manage` | partial; when `items` is provided it replaces the list wholesale                                  |
| DELETE | `/v1/onboarding-templates/:templateId` | `personnel.manage` | 204                                                                                               |

## Phase 4 — quotes & invoicing

All routes require an active organization. Two permissions gate everything:
**`invoices.read`** (list/detail/PDF/activity) and **`invoices.manage`**
(create/edit/delete and every lifecycle action). OWNER and ACCOUNTANT hold both; READONLY
holds `invoices.read` only; the EMPLOYEE role has no invoices access.

**Money is always integer minor units** (öre; 100 = 1 SEK) on the wire — request bodies send
`unitPriceMinor` etc., responses return `*Minor` fields; quantities and percentages are plain
numbers. The server computes all line and document totals (see
[architecture.md](architecture.md#deterministic-money-phase-4)). Format for display with
`formatMinor` from `@businessos/types`.

### Products (catalogue)

| Method | Path                      | Auth              | Notes                                         |
| ------ | ------------------------- | ----------------- | --------------------------------------------- |
| GET    | `/v1/products`            | `invoices.read`   | paginated                                     |
| POST   | `/v1/products`            | `invoices.manage` | `unitPriceMinor`, `taxRatePercent`, `unit`, … |
| GET    | `/v1/products/:productId` | `invoices.read`   | detail                                        |
| PATCH  | `/v1/products/:productId` | `invoices.manage` | partial update                                |
| DELETE | `/v1/products/:productId` | `invoices.manage` | 204                                           |

### Quotes

Editable only while `DRAFT`. Lifecycle: `DRAFT → SENT → ACCEPTED → (convert)`, or `DECLINED`.

| Method | Path                          | Auth              | Notes                                                                       |
| ------ | ----------------------------- | ----------------- | --------------------------------------------------------------------------- |
| GET    | `/v1/quotes`                  | `invoices.read`   | paginated; filters by status/customer                                       |
| POST   | `/v1/quotes`                  | `invoices.manage` | body includes `customerId` + `lineItems[]`; server computes totals          |
| GET    | `/v1/quotes/:quoteId`         | `invoices.read`   | detail with line items and money snapshot                                   |
| PATCH  | `/v1/quotes/:quoteId`         | `invoices.manage` | **only while `DRAFT`** (409 `quote_not_draft`/`invalid_transition` else)    |
| DELETE | `/v1/quotes/:quoteId`         | `invoices.manage` | 204; **only while `DRAFT`**                                                 |
| POST   | `/v1/quotes/:quoteId/send`    | `invoices.manage` | `DRAFT → SENT`                                                              |
| POST   | `/v1/quotes/:quoteId/accept`  | `invoices.manage` | `DRAFT`/`SENT → ACCEPTED`; emits `quote.accepted`                           |
| POST   | `/v1/quotes/:quoteId/decline` | `invoices.manage` | `DRAFT`/`SENT → DECLINED`                                                   |
| POST   | `/v1/quotes/:quoteId/convert` | `invoices.manage` | 201; creates a new **draft invoice** copying the lines; links back to quote |

### Invoices

Editable only while `DRAFT`. **Finalize makes the invoice immutable** (assigns a number, sets
`finalizedAt`, generates the PDF); corrections thereafter are credit notes only. The DTO
exposes derived `isOverdue` and `amountDueMinor` (= total − paid − credited).

| Method | Path                               | Auth              | Notes                                                                                                                                         |
| ------ | ---------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/invoices`                     | `invoices.read`   | paginated; filters by status/customer                                                                                                         |
| POST   | `/v1/invoices`                     | `invoices.manage` | body `customerId`, `dueDate`, `lineItems[]`; created as `DRAFT`                                                                               |
| GET    | `/v1/invoices/:invoiceId`          | `invoices.read`   | detail; `isOverdue`, `amountDueMinor` derived on the DTO                                                                                      |
| PATCH  | `/v1/invoices/:invoiceId`          | `invoices.manage` | **only while `DRAFT`** (409 once finalized)                                                                                                   |
| DELETE | `/v1/invoices/:invoiceId`          | `invoices.manage` | 204; **only while `DRAFT`**                                                                                                                   |
| POST   | `/v1/invoices/:invoiceId/finalize` | `invoices.manage` | `DRAFT → OPEN`; assigns number, freezes the document, generates PDF; emits `invoice.finalized` (409 `already_finalized`, 400 `empty_invoice`) |
| POST   | `/v1/invoices/:invoiceId/send`     | `invoices.manage` | emails the invoice with the PDF attached; emits `invoice.sent`                                                                                |
| POST   | `/v1/invoices/:invoiceId/cancel`   | `invoices.manage` | cancels a finalized, unpaid invoice → `CANCELLED`                                                                                             |
| GET    | `/v1/invoices/:invoiceId/pdf-url`  | `invoices.read`   | `{ url, expiresInSeconds }` — short-lived presigned GET                                                                                       |
| GET    | `/v1/invoices/:invoiceId/activity` | `invoices.read`   | invoice timeline                                                                                                                              |

### Payments

| Method | Path                                          | Auth              | Notes                                                                                                 |
| ------ | --------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| GET    | `/v1/invoices/:invoiceId/payments`            | `invoices.read`   | payments recorded against the invoice                                                                 |
| POST   | `/v1/invoices/:invoiceId/payments`            | `invoices.manage` | `amountMinor`, `method`, `paidOn`, …; **overpayment rejected** (400 `overpayment`); recomputes status |
| DELETE | `/v1/invoices/:invoiceId/payments/:paymentId` | `invoices.manage` | 204; recomputes status                                                                                |

### Credit notes

| Method | Path                                   | Auth              | Notes                                                                                   |
| ------ | -------------------------------------- | ----------------- | --------------------------------------------------------------------------------------- |
| GET    | `/v1/invoices/:invoiceId/credit-notes` | `invoices.read`   | credit notes against the invoice                                                        |
| POST   | `/v1/invoices/:invoiceId/credit-notes` | `invoices.manage` | full or partial; **over-credit rejected** (400 `over_credit`); full credit → `CREDITED` |

## OpenAPI

- `GET /docs/json` serves the OpenAPI document in non-production environments.
- `pnpm generate:openapi` writes it to `apps/api/openapi.json`.
