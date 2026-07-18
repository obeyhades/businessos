# ADR-0011: Multi-worker outbox relay via `SELECT … FOR UPDATE SKIP LOCKED`

Status: accepted (2026-07) — supersedes the single-relay constraint of ADR-0005

## Context

ADR-0005 established the transactional outbox: domain events and commands are written to
`outbox_messages` in the same transaction as the domain change, and a worker poller publishes
pending rows to the `businessos.events` exchange with publisher confirms, then marks them
published. That ADR recorded a **single-relay constraint**: the poller had no row locking, so
two worker instances would both `SELECT` the same pending rows and **double-publish** every
event. The documented mitigation was to pin the worker to exactly one instance, with
`SELECT … FOR UPDATE SKIP LOCKED` named as the upgrade path for horizontal scale.

Phase 9 needs that scale headroom: webhook dispatch, the export builder, the retention sweep and
the webhook retry sweep all run in the worker, and pinning the whole worker to a single instance
to protect the relay is an unnecessary availability and throughput ceiling. It is time to take
the upgrade path ADR-0005 pointed at.

The correctness requirements for a concurrent relay:

- two relays must never publish the same outbox row;
- a row must be marked published **only if** its publish was confirmed by the broker; and
- a crash between confirm and mark must at worst re-publish (at-least-once is already the
  contract — consumers are idempotent via `processed_messages`), never silently drop.

## Decision

**The outbox relay claims each batch with `SELECT … FOR UPDATE SKIP LOCKED` inside a
transaction and marks rows in that same transaction, making it safe to run multiple worker
instances.** Each tick:

1. opens a transaction and runs
   `SELECT … FROM outbox_messages WHERE published_at IS NULL AND attempts < N ORDER BY occurred_at LIMIT 50 FOR UPDATE SKIP LOCKED` —
   `FOR UPDATE` locks the claimed rows; `SKIP LOCKED` makes a concurrent relay skip rows another
   relay already holds, so the two never overlap;
2. for each row, publishes to the exchange and **`waitForConfirms()`** (broker acknowledgement)
   **before** marking `published_at` in the *same* transaction that still holds the lock; a
   publish failure bumps `attempts`/`lastError` instead;
3. commits, releasing the locks.

Because the lock is held across the broker round-trip, the batch transaction runs with a raised
timeout (`TX_TIMEOUT_MS`, 20s) to accommodate confirms.

This supersedes ADR-0005's single-relay constraint: deployments **no longer need to pin the
worker to one instance** for relay correctness.

## Consequences

- **Horizontal scale.** Multiple workers can run; each claims a disjoint batch, so relay
  throughput scales and a worker restart no longer stalls publishing. `deployment.md` no longer
  needs the "exactly one worker" caveat for the relay.
- **No double-publish.** `SKIP LOCKED` guarantees disjoint claims; the mark happens in the
  locking transaction, so a row is published-and-marked atomically from any other relay's point
  of view.
- **At-least-once retained.** A crash after `waitForConfirms()` but before commit rolls back the
  mark, so the row is re-claimed and re-published later — a duplicate the consumer's
  `processed_messages` ledger absorbs. Exactly-once is still only *effective* at consumers, as
  before.
- **Lock held across I/O.** The relay holds row locks while awaiting broker confirms, so a slow
  broker lengthens the transaction (hence the raised timeout) and a wedged broker will surface
  as relay-tick timeouts rather than data corruption. Batch size (50) bounds how many rows a
  single tick locks at once.
- **Other worker jobs** (webhook dispatch/retry, export, retention) are already idempotent or
  single-writer per row and were never the constraint; this ADR is specifically about the relay
  that fans the outbox into the exchange.
