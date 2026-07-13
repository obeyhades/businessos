# ADR-0002: Opaque server-side sessions over JWT

Status: accepted (2026-07)

## Context

The web app needs authenticated sessions. JWTs are stateless and avoid a database read
per request, but revocation requires denylists, and every claim baked into the token
(role, active organization) can go stale until expiry. BusinessOS is a B2B SMB product
where instant revocation (member removed, role changed) matters more than shaving one
indexed read.

## Decision

Use **opaque tokens in a `sessions` table**: 32 random bytes, only the SHA-256 hash
stored, delivered as an HttpOnly SameSite=Lax cookie (`bos_session`), 30-day TTL. The
session row also carries `activeOrganizationId` — the server-side tenant context — and
membership is re-checked against the database on every request.

## Consequences

- Logout, password change and member removal take effect immediately — delete/update the
  row and the session is gone; no denylist infrastructure.
- A database leak does not leak usable credentials (only hashes are stored).
- Cost: one indexed lookup (`token_hash`) plus a membership lookup per request —
  acceptable at SMB scale; caching can be added later if profiling demands it.
- No cross-service token verification — fine for a modular monolith; if services are
  extracted later, a token-introspection endpoint or a switch to short-lived JWTs scoped
  to service-to-service calls would be revisited.
