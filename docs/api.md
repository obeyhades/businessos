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

## Phase 5 — bookkeeping (double-entry ledger)

All routes are under `/v1/accounting` and require an active organization. Three permissions
gate the module: **`accounting.read`** (list/detail, reports, CSV exports),
**`accounting.manage`** (create/edit/delete accounts, fiscal years/periods, draft vouchers,
mapping, attachments, reconcile) and **`accounting.post`** (post and reverse — the actions that
write to the immutable ledger). OWNER, ADMIN and ACCOUNTANT hold all three; READONLY holds
`accounting.read` only; MANAGER and EMPLOYEE have no accounting access.

**Money is integer minor units** (öre; 100 = 1 SEK) on the wire — `debitMinor` / `creditMinor`
on lines, `totalDebitMinor` / `totalCreditMinor` / `balanceMinor` on documents and reports.
Each voucher line is **either a debit or a credit** (exactly one side positive). Dates are ISO
`YYYY-MM-DD`.

### Chart of accounts

| Method | Path                                 | Auth                | Notes                                                                                            |
| ------ | ------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------ |
| GET    | `/v1/accounting/accounts`            | `accounting.read`   | paginated (default page size 200, max 500); filters `?type=`, `?active=`, `?search=` (code/name) |
| POST   | `/v1/accounting/accounts`            | `accounting.manage` | `code`, `name`, `type`, `description?`, `isActive?`; 409 `duplicate_code`                        |
| GET    | `/v1/accounting/accounts/:accountId` | `accounting.read`   | detail                                                                                           |
| PATCH  | `/v1/accounting/accounts/:accountId` | `accounting.manage` | `name`/`type`/`description`/`isActive` — **`code` is immutable**                                 |
| DELETE | `/v1/accounting/accounts/:accountId` | `accounting.manage` | 204; **409 `account_in_use`** if any voucher line references it (deactivate instead)             |

### Account mapping (auto-draft rules)

| Method | Path                     | Auth                | Notes                                                                                     |
| ------ | ------------------------ | ------------------- | ----------------------------------------------------------------------------------------- |
| GET    | `/v1/accounting/mapping` | `accounting.read`   | the org's `sales`/`outputVat`/`receivable`/`bank` account ids (nulls until set)           |
| PUT    | `/v1/accounting/mapping` | `accounting.manage` | upsert; each provided id is validated to be an account in the org (400 `unknown_account`) |

### Fiscal years & periods

| Method | Path                                                | Auth                | Notes                                                                                                |
| ------ | --------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/v1/accounting/fiscal-years`                       | `accounting.read`   | all years, each with its periods                                                                     |
| POST   | `/v1/accounting/fiscal-years`                       | `accounting.manage` | `name`, `startDate`, `endDate`, `generateMonthlyPeriods?` (default true → one OPEN period per month) |
| GET    | `/v1/accounting/fiscal-years/:fiscalYearId`         | `accounting.read`   | detail with periods                                                                                  |
| POST   | `/v1/accounting/fiscal-years/:fiscalYearId/periods` | `accounting.manage` | add a period; **409 `period_overlap`** if it overlaps an existing one                                |
| PATCH  | `/v1/accounting/periods/:periodId/status`           | `accounting.manage` | body `{ status: OPEN\|LOCKED\|CLOSED }` — locking/closing blocks further postings                    |

### Vouchers (journal entries)

Created as `DRAFT` (editable, may be unbalanced). **Post** enforces the double-entry rules,
assigns a number and freezes the entry; a posted entry is corrected only by a **reverse**.

| Method | Path                                           | Auth                | Notes                                                                                                                                                                                                                                                                                                        |
| ------ | ---------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/v1/accounting/vouchers`                      | `accounting.read`   | paginated (default 50, max 200); filters `?status=`, `?source=`, `?from=`, `?to=`, `?accountId=`, `?reconciled=`                                                                                                                                                                                             |
| POST   | `/v1/accounting/vouchers`                      | `accounting.manage` | `date`, `description`, `lines[]` (**≥2**, each a debit or a credit); created `DRAFT`, **balance not required yet**                                                                                                                                                                                           |
| GET    | `/v1/accounting/vouchers/:voucherId`           | `accounting.read`   | detail with lines; DTO exposes `isBalanced`, `reversesVoucherId`, `reversedByVoucherId`                                                                                                                                                                                                                      |
| PATCH  | `/v1/accounting/vouchers/:voucherId`           | `accounting.manage` | **only while `DRAFT`** (409 `voucher_immutable`); `lines` replace the set wholesale                                                                                                                                                                                                                          |
| DELETE | `/v1/accounting/vouchers/:voucherId`           | `accounting.manage` | 204; **only while `DRAFT`** (409 `voucher_immutable`)                                                                                                                                                                                                                                                        |
| POST   | `/v1/accounting/vouchers/:voucherId/post`      | `accounting.post`   | `DRAFT → POSTED`; must balance (400 `unbalanced`), have ≥2 lines (400 `too_few_lines`), be non-zero (400 `zero_voucher`), and fall in an `OPEN` covering period (409 `no_fiscal_period` / `period_locked`); 409 `already_posted` if not a draft. Assigns the number, sets `postedAt`, emits `voucher.posted` |
| POST   | `/v1/accounting/vouchers/:voucherId/reverse`   | `accounting.post`   | 201; only a `POSTED` voucher (409 `not_reversible`) that is not yet reversed (409 `already_reversed`). Creates an offsetting **posted** voucher (debit/credit swapped) into an OPEN period, sets the original to `REVERSED`, emits `voucher.reversed`. Body: optional `date`, `description`                  |
| POST   | `/v1/accounting/vouchers/:voucherId/reconcile` | `accounting.manage` | body `{ reconciled }`; toggles `reconciledAt`. **409 `not_posted`** on a draft                                                                                                                                                                                                                               |

### Voucher attachments (receipts)

Multipart upload streamed through the API, same size/content-type validation as Phase 2
attachments (max **25 MB**, allow-list). Downloads are presigned 5-minute GET URLs.

| Method | Path                                                                        | Auth                | Notes                                            |
| ------ | --------------------------------------------------------------------------- | ------------------- | ------------------------------------------------ |
| GET    | `/v1/accounting/vouchers/:voucherId/attachments`                            | `accounting.read`   | newest-first                                     |
| POST   | `/v1/accounting/vouchers/:voucherId/attachments`                            | `accounting.manage` | multipart; records `voucher_attachment.uploaded` |
| GET    | `/v1/accounting/vouchers/:voucherId/attachments/:attachmentId/download-url` | `accounting.read`   | `{ url, expiresInSeconds }` — signed 5-min GET   |
| DELETE | `/v1/accounting/vouchers/:voucherId/attachments/:attachmentId`              | `accounting.manage` | 204; deletes row + best-effort object            |

### Reports & exports

Figures cover **posted vouchers** by default; a `REVERSED` voucher is still counted (its
offsetting reversal is posted, so the pair nets to zero). `?includeDrafts=true` folds draft
vouchers in.

| Method | Path                                       | Auth              | Notes                                                                                                                 |
| ------ | ------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/accounting/reports/trial-balance`     | `accounting.read` | per-account debit/credit/net + totals and `isBalanced`; `?from=`, `?to=`, `?includeDrafts=`                           |
| GET    | `/v1/accounting/reports/general-ledger`    | `accounting.read` | per-account entries with opening/closing and **running balances**; `?accountId=`, `?from=`, `?to=`, `?includeDrafts=` |
| GET    | `/v1/accounting/exports/trial-balance.csv` | `accounting.read` | CSV export (the first export format); same filters                                                                    |
| GET    | `/v1/accounting/exports/journal.csv`       | `accounting.read` | CSV journal (one row per line) — same filters                                                                         |

### Notable accounting error codes

`duplicate_code` (409), `account_in_use` (409), `unknown_account` / `inactive_account` (400),
`period_overlap` (409), `no_fiscal_period` (409), `period_locked` (409), `unbalanced` (400),
`too_few_lines` (400), `zero_voucher` (400), `already_posted` (409), `voucher_immutable` (409),
`not_reversible` (409), `already_reversed` (409), `not_posted` (409).

## Phase 6 — calendar & tasks

All routes require an active organization. Two permissions gate the module: **`calendar.read`**
(list/detail, RSVP, agenda, free/busy) and **`calendar.manage`** (create/edit/delete calendars
and events, attendees, and occurrence operations). OWNER, ADMIN and MANAGER hold both; EMPLOYEE
and READONLY hold `calendar.read` only; **ACCOUNTANT has no calendar access**.

Times are **ISO 8601 UTC instants** (`startsAt`, `endsAt`, `from`, `to`, `occurrenceStart`).
Recurring events are stored once (a rule on the master event) and **expanded server-side per
query** — the range list, agenda and free/busy return concrete occurrences, not stored rows
(see [architecture.md](architecture.md#server-side-recurrence-expansion-phase-6)).

### Calendars

| Method | Path                        | Auth              | Notes                                                                                                |
| ------ | --------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/v1/calendars`             | `calendar.read`   | team calendars + the caller's own personal calendars, default first                                  |
| POST   | `/v1/calendars`             | `calendar.manage` | `name`, `color`, `type` (`TEAM` default / `PERSONAL`); a `PERSONAL` calendar is owned by the creator |
| PATCH  | `/v1/calendars/:calendarId` | `calendar.manage` | `name`/`color`/`isDefault`; setting `isDefault=true` clears the flag on the org's other calendars    |
| DELETE | `/v1/calendars/:calendarId` | `calendar.manage` | 204; **409 `calendar_is_default`** (default calendar) / **409 `calendar_in_use`** (still has events) |

### Events

The range list returns **materialized occurrences** (`occurrenceStart` = the rule-generated
start, the identity used for overrides; `start`/`end` = the effective times after any override).
A **`PRIVATE` event is only visible to its organizer and attendees** — enforced on the range
list, single GET (404 to others) and the agenda.

| Method | Path                                       | Auth              | Notes                                                                                                                                                                                       |
| ------ | ------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/events`                               | `calendar.read`   | required `from`/`to`; filters `?calendarId=`, `?customerId=`, `?mine=true`. Expanded occurrences, privacy-filtered. **400 `bad_range`** if `to` < `from`                                    |
| POST   | `/v1/events`                               | `calendar.manage` | `calendarId`, times, `recurrence?`, `reminders[]`, `attendeeUserIds[]`, `customer/project/task` links; organizer auto-added as `ACCEPTED`. Emits `event.created` + `calendar.event.created` |
| GET    | `/v1/events/:eventId`                      | `calendar.read`   | master event (series definition) with reminders + attendees; **404** if `PRIVATE` and caller is not organizer/attendee                                                                      |
| PATCH  | `/v1/events/:eventId`                      | `calendar.manage` | partial series update; `recurrence: null` clears recurrence; `reminders` / `attendeeUserIds` replace the set (organizer always kept). Emits `calendar.event.updated`                        |
| POST   | `/v1/events/:eventId/cancel`               | `calendar.manage` | soft-cancel the whole series → `status = CANCELLED`; emits `calendar.event.cancelled`                                                                                                       |
| DELETE | `/v1/events/:eventId`                      | `calendar.manage` | 204; hard-delete the series (cascades attendees/reminders/exceptions)                                                                                                                       |
| POST   | `/v1/events/:eventId/occurrences/cancel`   | `calendar.manage` | 204; body `{ occurrenceStart }`; writes a `CANCELLED` exception. **400 `not_recurring`** on a single event                                                                                  |
| POST   | `/v1/events/:eventId/occurrences/override` | `calendar.manage` | 204; body `{ occurrenceStart, title?/location?/startsAt?/endsAt?/status? }`; writes an `OVERRIDE` exception (may move the occurrence). **400 `not_recurring`** / **400 `bad_range`**        |

### Attendees & RSVP

| Method | Path                                    | Auth              | Notes                                                                                                                 |
| ------ | --------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/events/:eventId/attendees`         | `calendar.manage` | body `{ userId }` (must be an org member, else **400 `unknown_attendee`**); idempotent upsert                         |
| DELETE | `/v1/events/:eventId/attendees/:userId` | `calendar.manage` | remove an attendee; **409 `cannot_remove_organizer`** for the organizer                                               |
| POST   | `/v1/events/:eventId/rsvp`              | `calendar.read`   | the caller sets **their own** response (`NEEDS_ACTION`/`ACCEPTED`/`DECLINED`/`TENTATIVE`); **403** if not an attendee |

### Agenda & free/busy

| Method | Path                     | Auth            | Notes                                                                                                                                                                                    |
| ------ | ------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/agenda`             | `calendar.read` | `from`/`to`; the caller's own events (organizer or attendee) **merged with their due tasks** (assigned, not `DONE`, due in range), sorted; cancelled occurrences excluded                |
| GET    | `/v1/calendar/free-busy` | `calendar.read` | `userId`/`from`/`to`; **busy blocks (times only, never details)** for any org member; excludes cancelled occurrences and events the target declined; **404** if `userId` is not a member |

### Notable calendar error codes

`bad_range` (400), `not_recurring` (400), `unknown_calendar` / `unknown_customer` /
`unknown_project` / `unknown_task` / `unknown_attendee` (400), `cannot_remove_organizer` (409),
`calendar_is_default` (409), `calendar_in_use` (409).

## Phase 7 — email

All routes are under `/v1/email` and — except the inbound webhook — require an active
organization. Two permissions gate the module: **`email.read`** (list/view mailboxes, threads
and labels) and **`email.send`** (compose/edit/send messages, every thread mutation —
read/star/move/link/labels/email→task — and mailbox/label management). OWNER, ADMIN and
MANAGER hold both; READONLY holds `email.read` only; **EMPLOYEE and ACCOUNTANT have no email
access**.

A **`SHARED` mailbox is visible to every email reader; a `PERSONAL` mailbox only to its
owner** — other users get **404** (not 403) on the mailbox and on all of its threads, so its
existence is never revealed. Thread lists use the standard pagination envelope (default page
size 25, max 100).

### Mailboxes (accounts)

| Method | Path                            | Auth         | Notes                                                                                                                 |
| ------ | ------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/email/accounts`            | `email.read` | shared mailboxes + the caller's own personal ones                                                                     |
| POST   | `/v1/email/accounts`            | `email.send` | `address`, `displayName?`, `type` (`SHARED` default / `PERSONAL` — owned by the creator); **409 `duplicate_address`** |
| PATCH  | `/v1/email/accounts/:accountId` | `email.send` | `displayName` / `isActive`                                                                                            |
| DELETE | `/v1/email/accounts/:accountId` | `email.send` | 204; **409 `account_in_use`** if the mailbox has any threads (deactivate instead)                                     |

### Labels

| Method | Path                        | Auth         | Notes                                                    |
| ------ | --------------------------- | ------------ | -------------------------------------------------------- |
| GET    | `/v1/email/labels`          | `email.read` | sorted by name                                           |
| POST   | `/v1/email/labels`          | `email.send` | `name`, `color` (hex); **409 `duplicate_label`**         |
| DELETE | `/v1/email/labels/:labelId` | `email.send` | 204; detaches the label from all threads (join cascades) |

### Threads

The list's `?folder=` accepts the **five folder views**: the physical `INBOX` / `ARCHIVE` /
`TRASH` plus the computed `SENT` (thread has an outbound `SENT` message) and `DRAFTS` (thread
has a `DRAFT`). `INBOX` (the default) excludes draft-only threads. Threads are sorted by
`lastMessageAt` descending.

| Method | Path                                          | Auth         | Notes                                                                                                                                                                                                     |
| ------ | --------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/email/threads`                           | `email.read` | paginated; filters `?folder=`, `?accountId=`, `?labelId=`, `?customerId=`, `?unread=`, `?starred=`, `?search=` (subject/snippet/body/from)                                                                |
| GET    | `/v1/email/threads/:threadId`                 | `email.read` | detail with all messages (oldest-first) and labels                                                                                                                                                        |
| POST   | `/v1/email/threads/:threadId/read`            | `email.send` | body `{ read }`; marks every inbound message read/unread                                                                                                                                                  |
| POST   | `/v1/email/threads/:threadId/star`            | `email.send` | body `{ starred }`                                                                                                                                                                                        |
| POST   | `/v1/email/threads/:threadId/move`            | `email.send` | body `{ folder: INBOX\|ARCHIVE\|TRASH }` (physical folders only)                                                                                                                                          |
| PATCH  | `/v1/email/threads/:threadId/link`            | `email.send` | link/unlink `customerId`/`projectId`/`taskId` (nullable); each id validated in-org (**400 `unknown_customer`/`unknown_project`/`unknown_task`**)                                                          |
| POST   | `/v1/email/threads/:threadId/labels`          | `email.send` | body `{ labelId }`; idempotent upsert; **400 `unknown_label`**                                                                                                                                            |
| DELETE | `/v1/email/threads/:threadId/labels/:labelId` | `email.send` | detach                                                                                                                                                                                                    |
| POST   | `/v1/email/threads/:threadId/task`            | `email.send` | 201 **email → task**: creates a Task (`title` defaults to the subject, description = last-message snippet) carrying the thread's customer/project, back-links `thread.taskId`; **400 `unknown_assignee`** |

### Messages (compose / reply / send)

Compose creates an **outbound `DRAFT`** — a new thread, or a reply appended to an existing
thread when `threadId` is set (the reply's `In-Reply-To`/`References` are chained from the
thread's most recent message that has a Message-ID). Only drafts can be edited, deleted or
sent. **Send** assigns an RFC 5322 Message-ID, flips the draft to `QUEUED` and hands off to
the shared worker email pipeline, which later marks it **`SENT`** on delivery or **`FAILED`**
(with `error`) after retries exhaust — see
[architecture.md](architecture.md#outbound-send-path-phase-7).

| Method | Path                                 | Auth         | Notes                                                                                                                                                           |
| ------ | ------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/email/messages`                 | `email.send` | 201; `accountId`, `threadId?` (reply), `to[]` (1–50), `cc[]`, `subject`, `bodyText`, `bodyHtml?`; **400 `unknown_account`/`inactive_account`/`unknown_thread`** |
| PATCH  | `/v1/email/messages/:messageId`      | `email.send` | edit a draft (to/cc/subject/bodies); **409 `not_a_draft`** otherwise                                                                                            |
| DELETE | `/v1/email/messages/:messageId`      | `email.send` | 204; drafts only (**409 `not_a_draft`**); deletes the thread too if it becomes empty                                                                            |
| POST   | `/v1/email/messages/:messageId/send` | `email.send` | queues the draft; returns the updated thread detail; **409 `already_sent`** if not a draft, **400 `no_recipient`** if `to` is empty                             |

### Inbound webhook (provider integration seam)

`POST /v1/email/inbound` is the ingestion endpoint a mail provider's inbound-parse webhook
(SendGrid/Mailgun/Postmark, or curl locally) POSTs a parsed message to. It is **not
session-authenticated**: the caller must send the shared secret in the **`x-inbound-secret`
header** (compared timing-safely against `INBOUND_EMAIL_SECRET`; 401 otherwise). Because no
cookie is involved, the CSRF hook does not apply — by design (see
[security.md](security.md#email-privacy-and-inbound-webhook-authentication-phase-7)).

| Method | Path                | Auth                             | Notes                                                                                                                         |
| ------ | ------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/email/inbound` | `x-inbound-secret` shared secret | body `to`, `from`, `fromName?`, `cc[]`, `subject`, `text`, `html?`, `messageId?`, `inReplyTo?`, `references[]`, `receivedAt?` |

The response is always **200** with `{ status, threadId, messageId }` where `status` is one
of:

- **`created`** — the message was stored (new thread, or appended to the thread matched via
  `References`/`In-Reply-To`)
- **`duplicate`** — a message with this RFC `messageId` already exists in the organization
  (idempotent redelivery; the existing thread/message ids are returned)
- **`unknown_account`** — no active mailbox matches `to` (200, not 404, so providers do not
  retry)

Tenancy is **derived from the destination mailbox** — the caller is never trusted for an
organization id.

### Notable email error codes

`duplicate_address` (409), `account_in_use` (409), `duplicate_label` (409), `not_a_draft`
(409), `already_sent` (409), `no_recipient` (400), `inactive_account` (400),
`unknown_account` / `unknown_thread` / `unknown_customer` / `unknown_project` /
`unknown_task` / `unknown_label` / `unknown_assignee` (400).

## OpenAPI

- `GET /docs/json` serves the OpenAPI document in non-production environments.
- `pnpm generate:openapi` writes it to `apps/api/openapi.json`.
