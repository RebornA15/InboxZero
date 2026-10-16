# Docker local development

## Detected architecture

- pnpm workspace with React 18, TypeScript and Vite 5 (`packages/web`).
- Fastify 4 / TypeScript API (`packages/api`), run by `tsx watch`.
- PostgreSQL through `pg` and Drizzle ORM; checked-in SQL migrations.
- Browser requests use same-origin `/api`. Vite proxies them to `http://api:3001` inside Docker; that hostname is never sent to the browser. Outside Docker the proxy defaults to `http://127.0.0.1:3001`.
- No external temporary-email provider SDK or provider API key exists in the code. The existing mail integration is `POST /api/ingest` with `X-Ingestion-Secret`; inbound delivery must come from your existing external mail infrastructure. Local simulated delivery remains available. Docker adds no mail server.

## Start in PowerShell

Install Docker Desktop with Linux containers and Docker Compose v2. From this directory:

```powershell
# First setup only; preserve an existing .env.
if (!(Test-Path .env)) { Copy-Item .env.example .env }
# Generate a different value for each password/secret, then put it in .env:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
notepad .env
docker compose up --build
```

Set `POSTGRES_PASSWORD` to a random hexadecimal password, and replace `ACCESS_TOKEN_SECRET` and `INGESTION_API_SECRET` with independent random values (at least 32 characters each). Keep your existing `MAIL_DOMAINS` and ingestion secret if already configured for incoming email. Example values are placeholders only. No secrets are copied into images; `.env` is injected into the API at runtime. Never put secrets in `VITE_*` variables, which are browser-visible.

Open http://localhost:5173. The direct API is http://localhost:3001/api/health.

```powershell
docker compose ps
docker compose logs --tail 100 api web postgres
docker compose down
```

`down` preserves the named `postgres_data` volume. Do not add `-v` unless you deliberately want to erase the container database. This volume is separate from any existing embedded PostgreSQL data at `packages/api/.pgdata`; nothing automatically imports or deletes that data.

## Services and readiness

| Service | Runtime | Host ports | Startup |
| --- | --- | --- | --- |
| postgres | Official PostgreSQL 16 Alpine | None | `pg_isready` health check; persistent named volume |
| api | Official Node 24 Debian slim, pnpm 12.10.1 | 127.0.0.1:3001 | Waits for healthy PostgreSQL, applies existing migrations, starts `tsx watch`; DB-aware `/api/health` check |
| web | Official Node 24 Debian slim, pnpm 12.10.1 | 127.0.0.1:5173 | Waits for healthy API, starts Vite; HTTP health check |

Source bind mounts enable React HMR and API restart on edits. Polling is enabled for Docker Desktop file sharing. Dependencies remain Linux-native inside images; host `node_modules` is never mounted. Rebuild after changing dependencies, package manifests, lockfile, TypeScript configuration, or Dockerfiles. Migrations run on every API container start and are recorded by Drizzle. Seeding is optional and is not run automatically.

## Environment

`.env.example` lists all API settings. Required application settings are `DATABASE_URL`, `ACCESS_TOKEN_SECRET`, and `INGESTION_API_SECRET`. Work, School, and Personal generation use reserved `.test` defaults locally; production additionally requires `WORK_EMAIL_DOMAIN`, `SCHOOL_EMAIL_DOMAIN`, `PERSONAL_EMAIL_DOMAIN`, and `OWNED_MAIL_DOMAINS`. `MAIL_DOMAINS` is an optional legacy generation allowlist, not a claim of external deliverability. See [ADDRESS_CATEGORIES.md](ADDRESS_CATEGORIES.md) for domain ownership configuration, migration details, tests, and inbound routing requirements. Compose constructs the API's internal `DATABASE_URL` from `POSTGRES_PASSWORD`, so a host URL in `.env` is deliberately overridden. A hexadecimal password avoids URL escaping issues. Database name and user are `inboxzero`.

Compose fixes API `PORT=3001`, `HOST=0.0.0.0`, and `NODE_ENV=development`. Optional settings retain existing defaults: `INBOX_TTL_MINUTES=60`, `MAX_MESSAGES_PER_INBOX=50`, `MAX_MESSAGE_SIZE_BYTES=1048576`, `RATE_LIMIT_INBOX_CREATE_PER_HOUR=10`, `RATE_LIMIT_API_PER_MINUTE=60`, `TRUST_PROXY=false`, `CLEANUP_INTERVAL_MS=60000`, and CORS localhost/127.0.0.1 on port 5173. `ACCESS_TOKEN_SECRET` is required by existing validation, though inbox access currently uses generated PBKDF2-hashed secrets. `VITE_GITHUB_URL` in the original example is not consumed by the current UI.

`API_PROXY_TARGET` and `DEV_USE_POLLING` are server-only Vite configuration, set by Compose. The frontend receives no backend secrets or database URL.

## Existing commands and routes

Without Docker: `pnpm install`, `pnpm db:migrate`, `pnpm dev`; root scripts also include `build`, `typecheck`, `db:generate`, and `db:seed`. Existing API scripts load the root `.env`; container commands use runtime environment directly. The optional `start-embedded-pg.mjs` is an alternative local PostgreSQL helper, not a required service.

The optional helper's dependency lives in `packages/local-db`, outside the API dependency graph and excluded from default workspace installs. To opt in, run `pnpm --workspace-packages=packages/local-db install --frozen-lockfile` first (Windows retains its existing build approval; other platforms require package-specific review). Its existing command, `node packages/api/start-embedded-pg.mjs`, forwards to that workspace and retains `packages/api/.pgdata`. Neither Dockerfile copies the local-db manifest or helper, so embedded PostgreSQL is not installed in the images. Both images use pnpm 12.10.1 and copy `pnpm-workspace.yaml` before installation. That file is the build approval source: only esbuild and the exact existing Windows embedded binary version are approved. No Linux embedded binary approval or global script bypass is needed. The root `packageManager` field pins the same pnpm version for host installs.

Routes preserved: `POST /api/inboxes`, `GET /api/inboxes/:id`, message list/detail `GET /api/inboxes/:id/messages[/:messageId]`, `DELETE /api/inboxes/:id/messages/:messageId`, `GET /api/inboxes/:id/events` (SSE), `POST /api/inboxes/:id/simulate` (development only), `POST /api/ingest`, and `GET /api/health`. Inbox routes require `X-Access-Secret` after creation; ingestion requires `X-Ingestion-Secret`.

## Troubleshooting

- Validate without printing resolved secrets: `docker compose config --quiet`.
- Docker reports `metadata_v2.db: read-only file system`: check free disk space and Docker Desktop storage. Free space, restart Docker Desktop, and retry; changing application files cannot repair a read-only Docker filesystem.
- Port already allocated: stop other local API/Vite processes or change the host side of the mapping. Keep the container ports unchanged. For a different browser port, update `CORS_ORIGIN` accordingly.
- Database password changed after initialization: PostgreSQL initialization variables do not update existing volume credentials. Restore the original password or change the database role password explicitly; preserve the volume.
- Migration/startup failure: inspect `docker compose logs api postgres`. The API does not start if migration fails.
- Proxy failures: check `docker compose ps` and API logs; the browser must request `/api`, not `http://api:3001`. SSE timeouts and anti-buffering configuration are retained.
- Stale source changes: confirm Docker Desktop can share this directory. Polling is already enabled; dependency changes require `docker compose up --build`.
- To inspect PostgreSQL without a published database port: `docker compose exec postgres psql -U inboxzero -d inboxzero`.
- Changes to `.env` require container recreation: `docker compose up -d --force-recreate api web`.

## Validation in this workspace

Verified after isolating the optional embedded PostgreSQL helper:

- `pnpm install --frozen-lockfile` and `pnpm typecheck` passed.
- `docker compose build` built both API and frontend images successfully. Neither image contains embedded PostgreSQL packages.
- `docker compose up -d --wait --wait-timeout 180` completed; PostgreSQL, API, and web are healthy.
- PostgreSQL `pg_isready` accepts connections; existing Drizzle migrations completed and were not reapplied on API recreation (one recorded migration).
- Both `http://localhost:3001/api/health` and the frontend proxy at `http://localhost:5173/api/health` returned HTTP 200 with `status: ok` and `services.database: ok`. The frontend root returned HTTP 200.
- Startup logs show Fastify listening, the cleanup worker running, and Vite ready. Container startup invokes installed tsx/Vite executables directly, avoiding pnpm's runtime attempt to reinstall dependencies as a non-root user. Build-time dependency approval remains enforced.

Services are left running. No database volumes were deleted or reset; `inboxzero_postgres_data` is mounted normally, and the separate existing `packages/api/.pgdata` directory was untouched. UI/theme and application source were not changed. This workspace has no Git metadata, so changes are saved in project files but cannot be recorded as a Git commit here.
