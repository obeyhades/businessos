# ADR-0004: Shared-schema tenancy (RLS considered, deferred)

Status: accepted (2026-07) — **revisit before production** (tracked in Phase 9)

## Context

Multi-tenancy options: database-per-tenant (operationally heavy at SMB volume),
schema-per-tenant (migration fan-out), or shared schema with an `organizationId` column.
Within shared schema, Postgres **row-level security** (RLS) can enforce isolation in the
database itself, but it fights Prisma ergonomics (per-request `SET`/session variables,
connection pooling interactions) and complicates local development and testing.

## Decision

**Shared schema**: every tenant-owned table carries `organization_id`. Isolation is
enforced in the service layer — the active organization comes exclusively from the
server-side session, all org-scoped queries filter by it, and `organizations/switch`
validates membership before updating the session. Tenant isolation is proven by
integration tests (cross-tenant reads and writes must fail).

RLS was **considered and deferred**, not rejected.

## Consequences

- Simple Prisma queries, one migration path, easy local development.
- The database will happily return other tenants' rows if application code forgets a
  filter — hence mandatory `orgContext()` usage and isolation tests as a permanent part
  of the suite.
- **Before production**, RLS must be re-evaluated as defence in depth (policy per table
  keyed on a session variable). This ADR is superseded or amended by that decision.
