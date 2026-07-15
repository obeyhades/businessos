# ADR-0008: Inbound-email ingestion via an authenticated webhook (provider seam)

Status: accepted (2026-07)

## Context

Phase 7 adds an email module: shared/personal mailboxes with threaded conversations that link
into the business context (customers, projects, tasks). Outbound mail was easy — the
outbox → RabbitMQ → SMTP pipeline has existed since Phase 1 and only needed a status callback.
**Inbound** mail required a structural decision: how do messages addressed to a tenant's
mailbox enter the system? The candidates were running/receiving real mail infrastructure
(an MX endpoint or IMAP polling of connected accounts) or accepting parsed messages over
HTTP. Operating an MX host or an IMAP poller means credentials or DNS per mailbox, polling
schedules, MIME parsing, and provider-specific OAuth — a large surface unrelated to what the
product needs first, which is conversations connected to customers and tasks. Meanwhile,
every transactional-mail provider (SendGrid, Mailgun, Postmark) already parses inbound mail
and delivers it as a JSON webhook. Whatever the entry point, three correctness questions had
to be settled: how the caller is authenticated, how the tenant is chosen, and how redelivered
or concurrent webhooks avoid duplicate messages and falsely merged threads.

## Decision

**Inbound mail enters through one authenticated HTTP endpoint, `POST /v1/email/inbound`,
designed as the seam provider inbound-parse adapters plug into.** Its contract
(`inboundEmailBodySchema`) is a provider-neutral parsed message: addresses, subject,
text/html bodies and the RFC 5322 threading headers (`messageId`, `inReplyTo`,
`references`). The rules:

- **Shared-secret auth, not a session.** The caller sends `x-inbound-secret`, compared
  timing-safely against `INBOUND_EMAIL_SECRET`. There is no cookie, so the CSRF hook (which
  guards cookie-bearing requests) is skipped by design.
- **Tenancy is derived, never supplied.** The destination address resolves to an active
  `EmailAccount` row and the organization comes from that row. A caller can only write into
  the mailbox it addresses; an unmatched address answers 200 `unknown_account` so providers
  do not retry.
- **Idempotent by RFC Message-ID.** A fast pre-check answers `duplicate`, and a
  partial-unique index `(organization_id, message_id) WHERE message_id IS NOT NULL` is the
  race-proof backstop for concurrent redelivery (drafts, with null `message_id`, are exempt).
- **Threading strictly by `References`/`In-Reply-To`** matched against prior messages'
  Message-IDs within the same mailbox — never by subject, which falsely merges unrelated
  threads sharing a subject line. No match creates a new thread.

Thread creation, the message row, aggregate recompute, customer auto-link, activity/audit
rows and the `email.received` outbox event are written in one transaction.

## Consequences

- Providers become **adapters, not integrations**: supporting SendGrid/Mailgun/Postmark later
  is a payload mapping onto one stable endpoint, with auth, tenancy, idempotency and
  threading already solved behind it. Locally the endpoint is exercised with curl — no mail
  infrastructure to run.
- At-least-once webhook delivery is safe end to end: redelivery is answered `duplicate`
  (pre-check or unique-violation), and reference-only threading is deterministic — the same
  payload always lands in the same thread.
- A leaked secret allows **injecting mail into addressed mailboxes** (annoyance/phishing),
  not reading data or crossing tenants — the response carries only ids, and tenancy never
  comes from the caller. The secret must be managed/rotated like other credentials.
- Messages without standards-compliant reference headers start new threads even when a human
  would file them together — the accepted cost of never falsely merging.
- This is **not** a mail client: mailboxes have no real IMAP/OAuth connection, and mail sent
  to an address nobody pointed at the webhook simply never arrives. Real mailbox connect is
  documented future work (docs/product-roadmap.md).
