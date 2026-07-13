# ADR-0005: Transactional outbox for domain events

Status: accepted (2026-07)

## Context

Side effects like invitation emails must not be lost when RabbitMQ is briefly down, and
must not fire when the surrounding database transaction rolls back. Publishing directly
to RabbitMQ from request handlers has both problems (dual-write). Alternatives:
LISTEN/NOTIFY (lower latency, Postgres-specific, delivery not durable) or a polled outbox
table.

## Decision

**Transactional outbox**: domain events and commands are written to `outbox_messages` in
the same transaction as the domain change. The worker polls (1s interval, batches of 50),
publishes to the `businessos.events` topic exchange with publisher confirms, then marks
rows published. Consumers are idempotent via the `processed_messages` ledger; failures
retry with TTL-backoff through `email.send.retry` and dead-letter into
`businessos.dlx` → `businessos.dead-letter` plus a `failed_jobs` row after 5 attempts.

## Consequences

- Atomicity: an event exists if and only if the domain change committed. At-least-once
  delivery end to end; effective exactly-once at consumers via the ledger.
- Polling adds up to ~1s latency versus LISTEN/NOTIFY — irrelevant for email and audit
  fan-out, and the mechanism is portable and easy to reason about.
- **Single-relay constraint**: the poller has no row locking, so exactly one worker
  instance may run. The documented upgrade path for horizontal scale is
  `SELECT … FOR UPDATE SKIP LOCKED` in the relay query (plus marking rows in the same
  transaction); until then, deployments must pin the worker to one instance
  (see docs/deployment.md).
- Failed jobs are visible and retryable through the platform-admin API, which re-enqueues
  through the outbox rather than talking to RabbitMQ directly.
