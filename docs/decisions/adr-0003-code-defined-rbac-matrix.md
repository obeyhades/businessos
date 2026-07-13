# ADR-0003: Code-defined RBAC matrix

Status: accepted (2026-07)

## Context

Access control needs per-resource, per-action granularity across current and future
modules. Options: database-driven roles/permissions (flexible, supports custom roles) or
a fixed role enum with a code-defined permission matrix.

## Decision

Fixed role enum (`OWNER, ADMIN, ACCOUNTANT, MANAGER, EMPLOYEE, READONLY`) plus a
**code-defined matrix** in `packages/types/src/permissions.ts`
(`ROLE_PERMISSIONS` / `hasPermission`). Permissions for later phases (customers,
personnel, invoicing, accounting, calendar, email, recordings) are defined now so the
matrix is reviewed once and route guards use stable names from day one. Platform
operation (`isPlatformAdmin` on the user) is deliberately separate from tenant roles.

## Consequences

- Changing who can do what is a reviewed code change with tests — exactly what we want
  while the permission surface is still growing.
- The matrix is trivially unit-testable and shared with the web app for UI gating
  (hide actions the role can't perform).
- Custom roles are not possible yet; adding DB-driven roles later doesn't break the
  schema (role stays an enum on the membership until then).
- Route guards (`requirePermission('x.y')`) keep authorization declarative at the route
  level; services never re-implement role checks.
