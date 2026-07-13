# ADR-0001: Fastify over NestJS

Status: accepted (2026-07)

## Context

The API needs schema-validated routes, OpenAPI generation, good performance and a
structure that keeps business logic out of HTTP handlers. The main candidates were
NestJS (batteries-included DI framework) and Fastify 5 with the zod type provider.

## Decision

Use **Fastify 5** with `fastify-type-provider-zod`. Zod schemas in `packages/types` are
the single source of truth: they validate requests, serialize responses (allow-lists) and
generate the OpenAPI document via `@fastify/swagger`. Module discipline (routes → service
→ Prisma) is enforced by convention and lint rules instead of a DI container.

## Consequences

- One schema definition drives validation, serialization, OpenAPI and shared client types
  — no drift between decorators and reality.
- Less boilerplate and faster cold starts than NestJS; no decorator/reflection magic.
- We give up NestJS's enforced structure; the modules convention
  (`apps/api/src/modules/*/{routes,service}.ts`) must be defended in code review.
- Plugin ecosystem (helmet, cors, rate-limit, cookie, swagger) covers the security
  baseline without custom middleware.
