# ADR-0007: Server-side recurrence expansion and UTC-calendar-unit recurrence

Status: accepted (2026-07)

## Context

Phase 6 adds a calendar. Recurring events (a daily standup, a weekly sync) need to appear as
many concrete occurrences on a range view, agenda and free/busy query, and each occurrence must
be able to diverge — one instance cancelled, one moved. Two structural questions had to be
settled: **where occurrences are computed** (materialize rows per occurrence, or expand a rule on
demand) and **what "recur" means for time** (UTC instants, or timezone-aware wall-clock).

Materializing a row per occurrence makes some queries a plain `SELECT`, but it forces a bounded
(or ever-growing) horizon, needs a backfill job as time passes, complicates edits ("change the
whole series" must rewrite N rows), and turns an unbounded series into unbounded storage.
Timezone-aware wall-clock recurrence (keeping 09:00 _local_ fixed across a daylight-saving
transition) is what users eventually expect, but it makes expansion depend on a timezone
database, makes occurrences non-deterministic across tz-data updates, and is materially more
complex to get right.

## Decision

**Store each recurring event once** — the master `calendar_events` row carries the rule
(`recurrence_freq`/`interval`/`by_weekday`/`count`/`until`) — and **expand the rule server-side
per query** through a pure, deterministic, bounded function (`expandOccurrences` in
`packages/types/src/calendar/recurrence.ts`). The same expander runs in the API service layer
(`materializeOccurrences`) and in the worker reminder sweep, so the API and background jobs agree
by construction.

Recurrence is defined on **UTC calendar units** — day/week/month/year steps that **preserve the
series start's UTC time-of-day** — and **impossible days are skipped**, not rolled forward (Jan 31

- 1 month, Feb 29 in a non-leap year), matching RRULE semantics. `count`/`until` are properties of
  the whole series, so expansion always iterates from the series start and then filters to the query
  window. A hard cap (`MAX_OCCURRENCES = 3660`) bounds any single expansion, and the database
  prefilters to series whose window could overlap `[from, to]` before expansion runs.

**Per-occurrence divergence** is a separate `event_exceptions` table keyed by the original,
rule-generated `occurrence_start` (a `CANCELLED` or an `OVERRIDE`), applied after expansion — so a
single occurrence can be dropped, retitled, restatused or moved (including into or out of a query
window) without splitting the series.

Consciously **deferred: DST-correct local recurrence.** Recurrence is UTC-exact, so an event does
**not** keep a fixed local wall-clock time across a daylight-saving transition. The `timezone`
column is stored now (for display/all-day intent and to enable the future change) but is not yet
used to anchor expansion.

## Consequences

- One row per series: no per-occurrence backfill, no storage growth on unbounded series, and a
  series edit is a single-row update. Storage and write paths stay simple.
- The expander is pure and deterministic (no clock, no I/O), so it is unit-testable in isolation
  and identical on the API and in the worker — the reminder sweep and the range list can never
  disagree about when an occurrence falls.
- Read queries do more CPU work (expand-then-filter) instead of a plain index scan, bounded by the
  window prefilter and the hard cap — acceptable at SMB calendar volume and revisitable if a hot
  path emerges.
- UTC-exact recurrence is simple and correct in UTC but **not** DST-correct for local wall-clock
  time; **DST-correct local recurrence** and **external calendar sync** (Google/Microsoft, fed by
  the `calendar.event.*` outbox seam) are documented future work — see docs/product-roadmap.md and
  docs/architecture.md.
