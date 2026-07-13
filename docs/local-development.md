# Local development

## Prerequisites

- Node.js ≥ 22 (the project is developed on Node 24)
- pnpm 10: `corepack enable && corepack prepare pnpm@10 --activate`
- Docker Desktop, running before any database/infra command

## First-time setup

```bash
cp .env.example .env      # defaults are fine locally; every variable is validated at boot
docker compose up -d      # postgres :5432, rabbitmq :5672 (+ mgmt :15672),
                          # minio :9000 (+ console :9001), mailpit :1025 (+ UI :8025)
pnpm install
pnpm db:migrate           # prisma migrate dev (also runs prisma generate)
pnpm db:seed              # demo org + users; idempotent, safe to re-run
pnpm dev                  # all apps in watch mode via turbo
```

Default ports: web **3000**, API **3001**, worker health **3009**.

## Windows notes

- Use Git Bash or PowerShell; all scripts are cross-platform (dotenv-cli loads the root
  `.env` for Prisma commands, so no `export`/`set` gymnastics are needed).
- Docker Desktop must use the WSL 2 backend for reasonable Postgres performance.
- If line endings cause Prettier/ESLint noise, set `git config core.autocrlf input`.

## Running apps individually

```bash
pnpm --filter @businessos/api dev      # API only (needs postgres)
pnpm --filter @businessos/worker dev   # worker only (needs postgres + rabbitmq)
pnpm --filter @businessos/web dev      # web only (needs the API running)
```

## Database workflows

| Task                              | Command                                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Browse data                       | `pnpm db:studio` (Prisma Studio)                                                                                                       |
| New migration after schema change | `pnpm db:migrate` (prompts for a name)                                                                                                 |
| Regenerate Prisma client          | `pnpm db:generate` — required after any `schema.prisma` change before typecheck/tests pass                                             |
| Apply committed migrations only   | `pnpm db:deploy`                                                                                                                       |
| Re-seed                           | `pnpm db:seed`                                                                                                                         |
| **Full reset**                    | `docker compose down -v && docker compose up -d && pnpm db:migrate && pnpm db:seed` — `-v` deletes the Postgres/RabbitMQ/MinIO volumes |

The compose init script also creates `businessos_test`, the database integration tests
use (`DATABASE_URL_TEST`).

## Email (Mailpit) workflow

All email the worker sends lands in Mailpit — nothing leaves your machine.

1. Start the stack and `pnpm dev` (the **worker must be running** — email is delivered
   asynchronously via the outbox and RabbitMQ, so nothing arrives if only the API is up).
2. Trigger an invitation (org settings → invite) or a password reset (forgot password).
3. Open **http://localhost:8025**, click the message, follow the accept/reset link
   (links point at `APP_BASE_URL`, default `http://localhost:3000`).

## Tests

```bash
pnpm test               # unit — no infrastructure needed
pnpm test:integration   # needs docker compose up (uses businessos_test)
pnpm test:e2e           # needs migrated + seeded db; Playwright boots the apps
```

## Troubleshooting

| Symptom                                                              | Fix                                                                                                                                                                                                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web fails to start / port 3000 busy                                  | Something else owns 3000. Run `PORT=3100 pnpm --filter @businessos/web dev` and set `WEB_ORIGIN=http://localhost:3100`, `APP_BASE_URL=http://localhost:3100` in `.env` (the API's CORS/CSRF allow-list and email links use these). |
| `ECONNREFUSED 127.0.0.1:5432` / apps exit at boot                    | Docker Desktop isn't running or `docker compose up -d` wasn't run. Check `docker compose ps` — all services should be healthy.                                                                                                     |
| Type errors mentioning `@prisma/client` after pulling schema changes | Run `pnpm db:generate` (or `pnpm db:migrate` if new migrations arrived).                                                                                                                                                           |
| App exits immediately with "Invalid environment configuration"       | The zod env validation failed — the message lists exactly which variables are missing/invalid. Compare with `.env.example`.                                                                                                        |
| Invitation/reset email never arrives in Mailpit                      | The worker isn't running, or RabbitMQ is down. Check `pnpm dev` output and http://localhost:15672 (businessos/businessos).                                                                                                         |
| 403 `csrf_rejected` when calling the API manually                    | Send an `Origin: http://localhost:3000` header (matching `WEB_ORIGIN`) on POST/PATCH/DELETE requests that carry the session cookie.                                                                                                |
| Stale/corrupt local data                                             | Full reset (see above) — `docker compose down -v` wipes all volumes.                                                                                                                                                               |
