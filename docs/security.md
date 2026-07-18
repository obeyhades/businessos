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

Phase 5 adds the accounting actions: `account.created`, `account.updated`,
`account.deactivated`, `fiscal_year.created`, `fiscal_period.created`, `fiscal_period.locked`,
`fiscal_period.unlocked`, `fiscal_period.closed`, `voucher.created`, `voucher.updated`,
`voucher.posted`, `voucher.reversed`, `voucher.deleted`, `voucher.reconciled`,
`voucher.unreconciled`, `voucher_attachment.uploaded`, `voucher_attachment.deleted`,
`account_mapping.updated`. Every ledger-mutating action (post, reverse, period lock/close) is
recorded with actor, IP and user agent. Auto-drafted vouchers from the worker are audited as
`voucher.created` with `metadata.auto = true` (actor null, since the worker acts without a user).

Phase 6 adds the calendar actions: `calendar.created`, `calendar.updated`, `calendar.deleted`,
`event.created`, `event.updated`, `event.cancelled`, `event.deleted`,
`event.occurrence_overridden`, `event.occurrence_cancelled`, `event_attendee.added`,
`event_attendee.removed`, `event_attendee.responded`. Every calendar/event mutation — including
per-occurrence cancel/override and each attendee change and RSVP — is recorded with actor, IP and
user agent inside the same transaction as the change.

Phase 7 adds the email actions: `email_account.created`, `email_account.updated`,
`email_account.deleted`, `email.composed`, `email.sent`, `email.received`,
`email_thread.moved`, `email_thread.linked`, `email_thread.labeled`,
`email.converted_to_task`, `email_label.created`, `email_label.deleted` (plus a reserved
`email.send_failed` — today a failed send is recorded on the message row's `status`/`error`
by the worker). Inbound-webhook receipts are audited as `email.received` with a null actor,
since the provider acts without a user.

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
- **Phase 5 resources** — accounts, fiscal years/periods, vouchers, voucher lines, voucher
  attachments and the account mapping all carry `organization_id` and are looked up scoped to
  the session organization. Voucher lines only reference accounts re-validated within the tenant
  (`buildVoucherLines`), a voucher attachment is only minted a signed URL after its voucher is
  confirmed in the caller's org, and voucher numbers are per-organization (unique
  `(organization_id, number)`). The worker's auto-draft generator is likewise passed an explicit
  `organizationId` and scopes every read/write to it.
- **Phase 6 resources** — calendars, events, attendees, reminders, exceptions and sent-reminder
  rows all carry `organization_id` and are looked up scoped to the session organization. Event
  customer/project/task links and attendee user ids are re-validated within the tenant
  (`assertLinksInOrg`, `assertOrgMembers`) before a write, and free/busy resolves its target
  through an `organizationMember` row in the caller's org, so a caller can never link, invite or
  query across tenants. The worker reminder sweep scopes every claim row and email to the
  event's `organizationId`.
- **Phase 7 resources** — email accounts, threads, messages, labels and thread-label rows all
  carry `organization_id` and are looked up scoped to the session organization. Thread
  link targets (customer/project/task) and task assignees are re-validated within the tenant
  before a write, and a message can only be composed into a thread re-fetched for the same
  mailbox and organization. The **inbound webhook derives its tenant from the destination
  mailbox row** — the caller never supplies an organization id — and its idempotency check,
  reference-chain threading and customer auto-link are all scoped to that derived
  organization. The worker's send-status callback updates a message by its unique id only.

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

## Bookkeeping integrity and RBAC (Phase 5)

The double-entry ledger extends the Phase 4 financial-integrity controls with its own posting
rules and a dedicated posting permission.

- **Three-tier RBAC.** `accounting.read` (list/detail, reports, CSV exports),
  `accounting.manage` (accounts, fiscal years/periods, draft vouchers, mapping, attachments,
  reconcile) and **`accounting.post`** (post and reverse — the actions that write the immutable
  ledger). In the code-defined matrix (`packages/types/src/permissions.ts`) OWNER, ADMIN and
  **ACCOUNTANT** hold all three; READONLY holds `accounting.read` only; **MANAGER and EMPLOYEE
  have no accounting access at all**. Separating `post` from `manage` means preparing a draft
  and committing it to the books are distinct rights.
- **Immutable posted entries.** Posting recomputes totals from the persisted lines, enforces
  balance (Σ debit = Σ credit), ≥2 lines, non-zero amount and a covering `OPEN` fiscal period,
  then freezes the voucher (numbered, `posted_at` set). Posted and reversed vouchers reject
  edits and deletes (`voucher_immutable`); the **only** correction is a reversing voucher that
  swaps debit/credit and nets to zero — posted rows are never mutated or removed. Accounts that
  carry journal entries cannot be deleted, only deactivated (`account_in_use`), preserving the
  trail.
- **Period locking.** A `LOCKED` or `CLOSED` fiscal period rejects new postings
  (`period_locked`), and a date with no covering period rejects posting (`no_fiscal_period`) —
  the ledger stays inside a defined fiscal structure.
- **Concurrency safety.** `post` and `reverse` run in explicit transactions that row-lock the
  voucher (`lockVoucherForUpdate`) before re-reading and validating, so two concurrent posts of
  one draft cannot both allocate a number or double-emit; voucher numbers come from the same
  row-locked `number_sequences` mechanism as invoices.
- **Every ledger mutation is audited** (see the [audit log](#audit-log) actions above), and
  voucher receipts reuse the private-bucket, server-validated, presigned-download attachment
  model.
- These are technical safeguards only. **Nothing here is verified against bokföringslagen,
  Bokföringsnämnden (BFN) standards, VAT reporting, SIE/e-accounting export requirements or tax
  law** — see [legal-review-required.md](legal-review-required.md).

## Calendar privacy and RBAC (Phase 6)

The calendar module adds two access concerns beyond ordinary CRUD: **per-event privacy** and a
deliberately **minimal cross-member view**.

- **Two-tier RBAC.** `calendar.read` (view calendars/events, RSVP, agenda, free/busy) and
  `calendar.manage` (create/edit/delete calendars and events, manage attendees, occurrence
  cancel/override). In the code-defined matrix (`packages/types/src/permissions.ts`) OWNER,
  ADMIN and **MANAGER** hold both; EMPLOYEE and READONLY hold `calendar.read` only; **ACCOUNTANT
  has no calendar access at all**. RSVP is a `read`-level action so an invited employee can
  respond without any manage right.
- **Private events.** A `PRIVATE` event is visible only to its **organizer and attendees**.
  This is enforced at the data layer, not the UI: `visibilityWhere` narrows the range-list and
  agenda queries in the database, and the single-event GET returns **404 (not 403)** to a
  non-participant, so the API does not even reveal that a private event exists. `DEFAULT` events
  are visible to anyone who can read the module.
- **Personal calendars** are visible only to their owner (`ownerId`); team calendars are shared
  across the org. The list endpoint filters to `TEAM` OR owned-personal calendars.
- **Free/busy exposes times only.** `GET /v1/calendar/free-busy` returns busy start/end blocks
  for any org member and **never titles, locations, attendees or any event detail** — cancelled
  occurrences and events the member declined are excluded. It is the intentionally narrow
  information-exposure model for scheduling across members: enough to find a free slot, nothing
  that leaks what a colleague is doing (including their private events, which still surface as
  anonymous busy blocks to the people entitled to see availability).
- **Tenant isolation and audit** — every calendar action is org-scoped and audited (see the
  [tenant isolation](#tenant-isolation) and [audit log](#audit-log) sections above).

## Email privacy and inbound-webhook authentication (Phase 7)

The email module adds two access concerns: **per-mailbox privacy** and a **cookie-less,
secret-authenticated ingestion endpoint**.

- **Two-tier RBAC.** `email.read` (view mailboxes, threads and labels) and `email.send`
  (compose/send plus **every thread mutation** — read/star/move/link/labels/email→task — and
  mailbox/label management). In the code-defined matrix (`packages/types/src/permissions.ts`)
  OWNER, ADMIN and **MANAGER** hold both; READONLY holds `email.read` only; **EMPLOYEE and
  ACCOUNTANT have no email access at all**.
- **Personal-mailbox scoping.** A `SHARED` mailbox is visible to every email reader; a
  `PERSONAL` mailbox **only to its owner**. This is enforced at the data layer, not the UI:
  `accountVisibilityWhere` narrows the account and thread list queries in the database, and a
  direct GET on a personal mailbox or any of its threads returns **404 (not 403)** to a
  non-owner — the API does not reveal that the mailbox exists (the same existence-hiding
  pattern as private events and sensitive employee documents).
- **Inbound webhook auth model.** `POST /v1/email/inbound` is authenticated by a **shared
  secret** in the `x-inbound-secret` header, compared with a **timing-safe** equality check
  (`crypto.timingSafeEqual` after a length check — no timing side channel) against
  `INBOUND_EMAIL_SECRET`. It is deliberately **not** session-authenticated: the caller is a
  mail provider's server, not a browser. Because the CSRF hook only guards cookie-bearing
  state changes, it is **skipped by design** here — there is no cookie whose ambient
  authority could be ridden, which is the attack CSRF protection exists for.
- **Tenant derivation instead of caller-supplied tenancy.** The webhook never accepts an
  organization id. The destination address is resolved to an active mailbox row and the
  tenant comes from that row, so even a caller holding the secret can only ever **write an
  inbound message into the mailbox it addresses** — it cannot read anything back (the
  response carries only status and ids) and cannot target an arbitrary tenant. Idempotency by
  RFC Message-ID (partial-unique backstop) additionally caps replay: redelivering a captured
  payload is answered `duplicate` without a second write.
- **Untrusted content and header safety.** An inbound `bodyHtml` is stored verbatim and is
  **untrusted input** — the web client must render it sandboxed/sanitized (never as trusted
  markup in the app origin). Outbound header injection is prevented by validation: every
  recipient must parse as an email address (trimmed, lower-cased, max 320 chars — no CRLF can
  survive), recipient lists are capped (50), and subjects/bodies are length-capped; the
  worker passes them to nodemailer as structured fields, never by concatenating raw headers.
- `INBOUND_EMAIL_SECRET` ships with a development default (`dev-inbound-secret`) and **must
  be set to a real secret in production** and rotated like other credentials (see below).

## Webhook signing & SSRF (Phase 9)

Outbound webhooks let a tenant register an arbitrary URL that our server then POSTs to. That
creates two distinct risks — a receiver must be able to trust the payload, and a tenant must
not be able to turn our server into a proxy into our own network.

**Signing (how integrators verify).** Every delivery carries an
`x-businessos-signature: t=<unixSeconds>,v1=<hex>` header, where
`hex = HMAC_SHA256(secret, `${t}.${rawBody}`)` (Stripe-style; the scheme, header names and
constants live in `@businessos/types` so the worker, tests and docs never drift). A receiver
verifies by:

1. reading `t` and `v1` from the header;
2. recomputing the HMAC over its own **raw** request body (not a re-serialized copy — key
   ordering/whitespace must match) with the endpoint's signing secret;
3. comparing in **constant time**; and
4. rejecting a `t` outside a tolerance window (`WEBHOOK_SIGNATURE_TOLERANCE_SECONDS`, 5 min) to
   bound replay.

Deliveries also carry `x-businessos-event`, `x-businessos-delivery` (the delivery id) and
`x-businessos-webhook-id`. The signing **secret** (`whsec_…`) is high-entropy, shown once on
create/rotate, and never serialized again — reads expose only a 4-char `secretHint`. Rotation
invalidates the previous secret immediately.

**SSRF guard (`assertDeliverableUrl` / `isBlockedAddress` in `apps/*/src/lib/url-safety.ts`,
byte-for-byte identical in the API and worker).** A user-controlled URL is checked before every
request — at create/update/ping time in the API and **again at delivery time in the worker**,
because DNS can change between registration and delivery (the classic DNS-rebinding hole). In
production the guard requires `https`, then rejects the host if it is `localhost`, a
`.local`/`.internal`/`.localhost` suffix, or resolves (any A/AAAA record) to a non-public
address: loopback, `10/8`, `172.16/12`, `192.168/16`, `100.64/10` CGNAT, `169.254/16`
link-local (which covers the `169.254.169.254` cloud-metadata endpoint), `0/8`, multicast, and
the IPv6 equivalents (`::1`, `fc00::/7`, `fe80::/10`, and IPv4-mapped `::ffff:` addresses).
Redirects are **not** followed (`redirect: 'manual'`), so a `2xx`→`3xx`→private hop is
impossible.

**`WEBHOOK_ALLOW_LOCAL` must be off in production.** This flag (default off) relaxes the guard
to allow `http` and loopback/private hosts so local dev and the integration tests can point a
webhook at a `127.0.0.1` receiver. With it **on, the SSRF protection is intentionally disabled**
— it must never be set in any environment reachable from untrusted tenants. The test config
sets it true precisely because tests run against loopback receivers; the production config
leaves it false.

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

Phase 7 adds **`INBOUND_EMAIL_SECRET`** (API, validated at startup; local default
`dev-inbound-secret`) — the shared secret the inbound-email webhook requires in the
`x-inbound-secret` header. In production it must be a long random value known only to the
mail provider's webhook configuration, managed and rotated like `S3_SECRET_KEY`.

Phase 9 adds **`WEBHOOK_ALLOW_LOCAL`** (boolean, default **false**). It relaxes the outbound
webhook SSRF guard for local dev/tests (see [Webhook signing & SSRF](#webhook-signing--ssrf-phase-9)
above) and **must remain false in production** — leaving it true disables SSRF protection.

## Compliance controls (Phase 9)

Phase 9 implements the GDPR-shaped controls previously listed as designed-only:

- **Data-retention policies are enforced.** Per-org windows (recordings, audit logs,
  activities, webhook deliveries) drive a worker sweep that deletes rows past their age; a null
  window means "retain indefinitely". Managing the policy needs `org.update` (OWNER/ADMIN).
- **Organization export** (`POST /v1/organization/export`, `org.update`) produces a JSON
  data-portability bundle to object storage, served via a short-lived signed URL. The bundle
  **excludes secrets** (webhook signing secrets, password hashes, session tokens).
- **Organization erasure** (`DELETE /v1/organization`) is **OWNER-only** (`org.delete`) and
  guarded by a typed-slug confirmation (`confirmation_mismatch` on a wrong slug). It cascade-
  deletes every org-scoped table (all 33 FKs are `onDelete: Cascade`), purges the org's storage
  objects best-effort, and logs the erasure operationally (org id + actor, no personal data) —
  the org's own audit log is erased with it, by design.

The bookkeeping/VAT and STT/email personal-data caveats are unchanged and remain
legally unreviewed (see [legal-review-required.md](legal-review-required.md)).

## Review before production

- **GDPR**: records of processing, DPAs with subprocessors — export/erasure and retention are
  now implemented (Phase 9) but the wider programme is not legally reviewed
  (see [legal-review-required.md](legal-review-required.md))
- **Postgres row-level security**: re-evaluated in Phase 9 — app-layer tenancy kept as the
  primary control, RLS documented as a future defence-in-depth option
  ([ADR-0010](decisions/adr-0010-postgres-rls-evaluation.md), superseding the ADR-0004 note)
- **Cookie `Secure` flag**: only set when `NODE_ENV=production`; requires TLS termination
- **`trustProxy`**: currently `false`; must be enabled (and configured correctly) behind a
  reverse proxy, otherwise per-IP rate limits and audit IPs record the proxy address
