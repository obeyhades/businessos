# ADR-0010: Postgres row-level security re-evaluation (app-layer tenancy kept)

Status: accepted (2026-07) — amends ADR-0004

## Context

ADR-0004 chose shared-schema tenancy (every tenant-owned table carries `organization_id`) and
deferred Postgres **row-level security** (RLS), noting it "must be re-evaluated before
production as defence in depth" — a task explicitly parked for Phase 9. Phase 9 is that
re-evaluation.

The isolation model today is **app-layer**: the active organization comes exclusively from the
server-side session (never from the client), and every org-scoped query filters by it through a
small set of choke points — `orgContext(request)` plus `requirePermission(...)` preHandlers and
the module services that always scope by `organizationId`. Cross-tenant reads and writes are
proven impossible by a permanent band of integration tests (`tenant.isolation.*.test.ts`,
one per phase), which assert 404 (not 403) on another org's rows so existence is not even
revealed.

RLS would move (or duplicate) that enforcement into the database: a policy per table keyed on a
session variable (`current_setting('app.current_org')`) set at the start of each request. The
question for Phase 9 is whether to adopt it now, and if not, what would make it worthwhile
later.

The costs that made RLS awkward in ADR-0004 are unchanged and concrete:

- **Session-variable plumbing vs. pooling.** Prisma runs over a connection pool; a policy keyed
  on a session GUC needs that GUC `SET` on the exact pooled connection each query uses, inside a
  transaction, for every request — either a `$transaction` wrapper around all work or a
  connection-affinity scheme. This is invasive and easy to get subtly wrong (a leaked GUC on a
  recycled connection is a cross-tenant leak — the very failure RLS is meant to prevent).
- **Testability.** The current model is transparent: a forgotten filter fails a fast, readable
  integration test. RLS enforcement is implicit in the database, harder to unit-test and to
  reason about when a query returns fewer rows than expected.
- **Migration cost.** A policy (and `FORCE ROW LEVEL SECURITY`) on all ~33 tenant tables, kept
  in lockstep with every future table, plus a `BYPASSRLS` path for the platform-admin and
  worker roles that legitimately cross orgs (the outbox relay, retention sweep, export builder).
- **The shared-schema model already assumes app-layer scoping** (ADR-0004), and all 33 org FKs
  are `onDelete: Cascade`, so erasure and integrity are already handled at the schema level.

## Decision

**Keep app-layer enforcement as the primary tenant-isolation control. Do not adopt RLS now;
document it as a future defence-in-depth layer, not a replacement.**

Concretely:

- Isolation remains: session-derived active org → `orgContext` → org-scoped queries, guarded by
  `requirePermission` and proven by the per-phase `tenant.isolation.*` tests, which stay a
  permanent, mandatory part of the suite.
- RLS is recorded as an **additive** future option: a policy per table keyed on a request-scoped
  session variable, enabled behind the app-layer checks (belt-and-braces), **not** as a reason
  to relax them. Adopting it is justified when we introduce direct SQL access paths that bypass
  the service layer (analytics/BI connections, ad-hoc reporting, a second service on the same
  DB) — i.e. when something other than our audited choke points can query tenant tables.

This supersedes the "RLS must be re-evaluated before production" clause of ADR-0004 with a
recorded outcome; ADR-0004's shared-schema decision stands.

## Consequences

- No new per-request GUC/pooling machinery; Prisma queries and local development stay simple,
  and isolation stays transparently testable — the property we most want while the schema is
  still growing every phase.
- The database will still return another tenant's rows if application code forgets a filter, so
  the mitigation remains **disciplined `orgContext` usage + the isolation test band**, which is
  now the explicit, accepted primary control (not a stopgap).
- If a direct-SQL consumer is ever added, this ADR is the trigger to implement RLS as the second
  layer; the design (policy-per-table on a session variable, `BYPASSRLS` for worker/admin roles)
  is captured here so that work starts from a decision, not a blank page.
- Erasure/portability obligations are met at the schema/service layer (cascade FKs + the Phase 9
  export/erasure routes), independent of this decision.
