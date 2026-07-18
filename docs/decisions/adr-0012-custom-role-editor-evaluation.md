# ADR-0012: Custom/user-defined role editor evaluation (code-defined matrix kept)

Status: accepted (2026-07) — amends ADR-0003

## Context

ADR-0003 chose a fixed role enum (`OWNER, ADMIN, ACCOUNTANT, MANAGER, EMPLOYEE, READONLY`) with
a **code-defined permission matrix** (`ROLE_PERMISSIONS` / `hasPermission` in
`packages/types/src/permissions.ts`), and noted that "custom roles are a later phase; adding
DB-driven roles later doesn't break the schema (role stays an enum on the membership until
then)." By Phase 9 the permission surface is complete — nine modules' worth of
`resource.action` permissions are defined and every route guards on them — so it is the natural
point to evaluate a **custom role editor**: letting an org define its own roles and pick each
role's permissions from the matrix, rather than being limited to the six built-ins.

The pull toward custom roles is real for some buyers (an org wants, say, a "Bookkeeper who can
also read personnel" or to split MANAGER into two). But the permission **vocabulary** already
exists and is stable; what a custom-role feature adds is *who can hold which subset*, made
data-driven and self-service.

What building it well would actually require:

- **Persistence + resolution.** A `roles` table (per-org, plus system roles) and a
  `role_permissions` join, with `hasPermission` resolving against the DB instead of a constant —
  touching the hot path of every `requirePermission` preHandler (needs caching/invalidation).
- **Guardrails.** An org must not be able to lock itself out: at least one OWNER-equivalent with
  `org.delete`/`members.update_role` must always exist; permission dependencies must hold
  (e.g. `*.manage` without the matching `*.read` is incoherent; `personnel.read_sensitive`
  without `personnel.read`); and platform-admin separation (ADR-0003) must stay outside tenant
  roles.
- **Migration + UI.** The six enum roles become seeded system roles; the membership `role` enum
  becomes a role FK; and a management UI (with the dependency validation above) plus audit of
  role/permission edits. The web app currently gates UI off the same static matrix — that
  coupling would move to an API call.
- **Testing.** The matrix is trivially unit-testable today (`hasPermission(role, perm)`); a
  data-driven matrix needs seed/fixture roles and per-org resolution tests, and the invariant
  "no org can strip its last owner" needs its own guard tests.

None of this is blocked by the schema (ADR-0003 preserved that), but all of it is real surface
for a capability no current requirement demands.

## Decision

**Keep the code-defined matrix for now. Do not build a custom role editor in Phase 9; record
what it would take so the decision is deliberate, not deferred by omission.**

Rationale:

- Changing who-can-do-what stays a **reviewed code change with tests** — exactly what ADR-0003
  wanted while (and just after) the permission surface finished growing. A regression in access
  control is caught in CI, not discovered in a tenant's self-service edit.
- The six built-in roles cover the SMB target's needs; no shipped or planned requirement needs
  per-org roles. Building the persistence/resolution/guardrail machinery now is speculative.
- The path stays open and cheap: the permission vocabulary is the stable part and already
  exists, so a future custom-role feature is *additive* (seed the six as system roles, swap the
  membership enum for a role FK, make `hasPermission` DB-backed) without reworking route guards
  or the permission names.

## Consequences

- Orgs cannot define their own roles yet; a buyer needing that is a driver to revisit this ADR,
  at which point the requirements above are the starting spec.
- Route authorization stays declarative and fast (`requirePermission('x.y')` against an
  in-process constant — no per-request DB lookup), and the web app keeps gating UI off the same
  shared matrix.
- Access-control changes remain code + tests + review, which is the intended safety property
  while correctness matters more than self-service flexibility.
- When custom roles are built, the migration is understood in advance (system-role seeding +
  enum→FK + DB-backed resolution + last-owner and dependency guards), so it begins from a
  decision rather than a blank page.
