# Deployment

**BusinessOS is not deployed anywhere yet.** This document is honest guidance for a first
production deployment, not a description of an existing environment. No Kubernetes — the
target shape is: managed Postgres + managed RabbitMQ + S3-compatible storage + SMTP
provider, with the three Node processes (api, worker, web) on any container/VM platform
behind a TLS-terminating reverse proxy.

## Build

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build            # api + worker → dist/ (tsup), web → .next/ (next build)
```

Start commands per app:

| App    | Command                                  |
| ------ | ---------------------------------------- |
| api    | `pnpm --filter @businessos/api start`    |
| worker | `pnpm --filter @businessos/worker start` |
| web    | `pnpm --filter @businessos/web start`    |

Migrations are applied with `pnpm db:deploy` (`prisma migrate deploy`) — run once per
release **before** starting the new api/worker.

## Required environment variables

Validated with zod at boot; a missing/invalid value aborts startup.

| Variable                                                                      | Used by     | Notes                                                    |
| ----------------------------------------------------------------------------- | ----------- | -------------------------------------------------------- |
| `NODE_ENV`                                                                    | all         | `production` — enables the `Secure` cookie flag          |
| `LOG_LEVEL`                                                                   | all         | `info` recommended                                       |
| `DATABASE_URL`                                                                | api, worker | managed PostgreSQL                                       |
| `SESSION_SECRET`                                                              | api         | ≥ 32 random chars; rotate periodically (see checklist)   |
| `API_PORT` / `API_HOST`                                                       | api         | bind address for the API                                 |
| `WEB_ORIGIN`                                                                  | api         | public origin of the web app — CORS + CSRF allow-list    |
| `APP_BASE_URL`                                                                | api         | public base URL used in emailed links                    |
| `RABBITMQ_URL`                                                                | worker      | managed RabbitMQ (AMQP)                                  |
| `WORKER_HEALTH_PORT`                                                          | worker      | health probe port                                        |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_FROM`                                       | worker      | production SMTP provider                                 |
| `NEXT_PUBLIC_API_URL`                                                         | web (build) | public URL of the API — baked in at build time           |
| `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` / `S3_REGION` | (Phase 2+)  | S3-compatible storage; provisioned but unused in Phase 1 |

## Production checklist

- [ ] **TLS everywhere** — the session cookie is only `Secure` when
      `NODE_ENV=production`; never serve the app over plain HTTP.
- [ ] **`trustProxy`** — the API currently boots with `trustProxy: false`
      (`apps/api/src/app.ts`). Behind a reverse proxy/load balancer this must be enabled
      and scoped to the proxy, or rate limiting and audit logs record the proxy IP.
- [ ] **`SESSION_SECRET`** — generated with a CSPRNG, stored in a secret manager, with a
      rotation procedure (rotation invalidates cookies signed with the old secret).
- [ ] **Managed services** — Postgres (with automated backups + PITR), RabbitMQ, S3,
      SMTP. Nothing from `docker-compose.yml` is production-grade as-is.
- [ ] **Migrations** — `pnpm db:deploy` as a release step; never `migrate dev` in
      production.
- [ ] **Exactly one worker instance** — the outbox relay is single-instance by design
      (ADR-0005); scaling workers requires the SKIP LOCKED upgrade first.
- [ ] **Backups tested** — restore drills for Postgres; audit logs and outbox live there.
- [ ] **Health probes wired** — api `/healthz` + `/readyz`; worker `/healthz` + `/readyz`
      on `WORKER_HEALTH_PORT`. Note the worker health server binds to `127.0.0.1`.
- [ ] **Log shipping** — pino JSON to your aggregator; redaction is already configured.
- [ ] **Legal review completed** — see
      [legal-review-required.md](legal-review-required.md); GDPR items (retention,
      export/erasure) are designed but **not implemented** (Phase 9).
