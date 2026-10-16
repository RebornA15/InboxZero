# Vercel + Render deployment

Prepared locally only: no cloud resources, pushes, or changes to existing database data. Public launch is blocked by the dependency findings in [SECURITY_REVIEW.md](SECURITY_REVIEW.md) and real inbound-mail configuration. The Render template selects paid plans; review cost, region, and resource names before approval.

## Repository architecture

- pnpm 12.10.1 workspace: `@inboxzero/web`, `@inboxzero/api`, optional host-only `@inboxzero/local-db`. Neither app imports another workspace package. Vercel restricts workspace discovery to packages/web. Default workspace discovery includes only application packages; the host-only local database helper is explicitly excluded and installed only on request. Both apps require root workspace/TypeScript files.
- Web `build`: `tsc && vite build`, output `packages/web/dist`. There is no frontend `test` script. Frontend API/SSE tests use the API's existing Vitest command.
- API `build` now compiles TypeScript and copies SQL/journal assets to `dist/db/migrations`. Added actual scripts: `start` runs `node dist/index.js`; `db:migrate:production` runs `node dist/db/migrate.js`. Development migration scripts still load root `.env` with tsx. Production needs neither tsx nor a repository `.env`.
- HTTP and streaming fetch SSE share `VITE_API_BASE_URL`. Native EventSource is not used: inbox authentication requires `X-Access-Secret`. Empty/unset base uses `/api` and the existing Vite proxy (`API_PROXY_TARGET`, default `http://127.0.0.1:3001`). Docker retains its `http://api:3001` proxy. Vite's proxy does not run in the deployed static frontend.
- Production Fastify binds to `0.0.0.0` and reads platform `PORT`. Docker/Compose, migration SQL, address rules, categories, and responsive styles are unchanged.

## Vercel settings

Use the repository, not a separately copied web folder.

| Setting | Exact value |
| --- | --- |
| Framework | Vite |
| Root Directory | `packages/web` |
| Include source files outside Root Directory in Build Step | Enabled |
| Node.js Version | `24.x` |
| Install Command | `cd ../.. && npx --yes pnpm@12.10.1 install --frozen-lockfile --prod=false --workspace-packages=packages/web --filter @inboxzero/web...` |
| Build Command | `cd ../.. && npx --yes pnpm@12.10.1 --workspace-packages=packages/web --filter @inboxzero/web build` |
| Output Directory | `dist` (relative to project root) |
| Production environment | `VITE_API_BASE_URL=https://<actual-render-host>/api` |

`packages/web/vercel.json` contains the commands, security headers, and SPA fallback. No router currently exists; nested paths also receive the shell. `/api` is excluded from fallback to avoid serving HTML for misconfigured API calls. This does not create a Vercel backend proxy.

Set the API URL **before building**, include `/api`, and rebuild after changes. Use the public HTTPS backend hostname. VITE variables are public: never put database, ingestion, or inbox secrets in them. Do not copy backend secrets into Vercel frontend settings.

Local Vite overrides belong in `packages/web/.env.local`, based on its `.env.example`; Vite does not automatically read root `.env`. Normal development needs no override. Preview deployments should use a staging API/database and explicit preview-origin allowlists, never `*.vercel.app` against production.

### Vercel embedded PostgreSQL install failure

The dependency chain is `@inboxzero/local-db` (devDependency) -> `embedded-postgres@18.4.0-beta.17` -> the host-specific optional package, including `@embedded-postgres/linux-x64`. Only the host-only local database helper imports it. The frontend, Fastify runtime, and migrations use no embedded PostgreSQL dependency; Docker uses its PostgreSQL service.

A full workspace install discovers the local database helper. A filtered install excluded it in the Linux control check, but pnpm 12 also verifies dependencies before running scripts and can initiate another install. Limiting workspace discovery in both phases prevents unrelated packages from entering either phase. The Vercel commands use pnpm 12.10.1's supported `--workspace-packages=packages/web` override to restrict discovered workspace projects, while retaining the root workspace settings, frozen lockfile, and web devDependencies needed by Vite/TypeScript. The same override is used during build so pnpm's automatic dependency verification cannot expand back to the full workspace.

No PostgreSQL lifecycle script is approved or globally ignored. `pnpm-workspace.yaml` retains the existing Windows-only local PostgreSQL approval and esbuild approval; strict dependency build protection remains enabled. Root/package manifests and lockfile remain unchanged. Local workspace installs, Docker, backend/test commands, and migration commands keep their existing behavior.

Verified in a fresh Linux Node 24 container with pnpm 12.10.1, no node_modules or preexisting package store: frozen install and production frontend build passed. Assertions before and after the build confirmed that neither embedded PostgreSQL nor Fastify was installed. The shared lockfile and build approvals were unchanged.

Ensure Vercel uses the committed `packages/web/vercel.json` commands rather than an older dashboard install/build override. Redeploy without the existing build cache once to discard the previous full-workspace installation.

## Render settings

`render.yaml` is an unexecuted Blueprint template: one Node API instance and PostgreSQL 16 in Frankfurt. API plan: `0.5c-512mb`; database plan: `0.1c-256mb`, 1 GB storage. Database external access is disabled. Review account plan availability/cost before applying. Paid API compute supports pre-deploy commands. Auto-deploy is off, but applying a Blueprint can still create resources and trigger initial deployment.

| API service setting | Exact value |
| --- | --- |
| Runtime | Node |
| Root Directory | Blank: repository root |
| Instances | `1` |
| Build Command | `npx --yes pnpm@12.10.1 install --frozen-lockfile --prod=false --workspace-packages=packages/api --filter @inboxzero/api... && npx --yes pnpm@12.10.1 --workspace-packages=packages/api --filter @inboxzero/api build` |
| Pre-Deploy Command | `node packages/api/dist/db/migrate.js` |
| Start Command | `node packages/api/dist/index.js` |
| Health Check Path | `/api/health` |
| Auto-deploy | Off |

### Render embedded PostgreSQL install failure

Commit `1488f4a` already contains the API-only command above in `render.yaml`. The reported Render command, `pnpm install --frozen-lockfile` at repository root, does not execute that Blueprint command. A dashboard override or service configured separately from the Blueprint must be updated explicitly; repository edits do not prove the live service uses them. Previously, `packages/*` discovered every workspace, including the local helper and its development dependency chain: `@inboxzero/local-db` -> `embedded-postgres@18.4.0-beta.17` -> `@embedded-postgres/linux-x64@18.4.0-beta.17`. A plain install includes workspace development dependencies by default. The API, frontend, and root manifests have no embedded PostgreSQL dependency, and the API runtime and compiled Drizzle migrations use `pg` and `DATABASE_URL`.

`pnpm-workspace.yaml` now excludes `packages/local-db` from default discovery using a negative package pattern. This makes even the plain root frozen install safe without approving or suppressing an unused PostgreSQL binary script. Root installs still include the frontend and application development tools; the API-only Render command additionally excludes the frontend workspace. Keep `--prod=false` during compilation because TypeScript and declaration packages are development dependencies. Both install and build use the API workspace override so pnpm's pre-script dependency verification retains the same scope. API test/development tools are retained during compilation rather than restructuring existing dependency manifests.

The shared lockfile retains the helper importer and platform binaries for reproducible opt-in local use; lockfile presence alone does not cause installation of an excluded workspace. No dependency versions or build approvals change. The exact Windows embedded binary approval and esbuild approval remain intact. No Linux binary approval, global build-script bypass, or security-policy relaxation is added. Vercel commands, Dockerfiles, application source, and migrations are unchanged.

For the optional host helper, first run `pnpm --workspace-packages=packages/local-db install --frozen-lockfile`, then use the existing `node packages/api/start-embedded-pg.mjs` command. This overrides workspace discovery for that explicit install and preserves `packages/api/.pgdata`. Windows retains its existing binary approval; other host platforms still require deliberate package-specific script review. Docker development continues to use its PostgreSQL service and needs no helper install.

Set Render's dashboard Build Command to the exact command above, with Root Directory blank, and clear the build cache once when redeploying. Keep the compiled migration as the separate pre-deploy command. The new workspace exclusion also protects an earlier unfiltered install if the platform runs one.

Verified on Linux x64 under WSL with Node 24.11.1 and pnpm 12.10.1, using separate clean checkouts, an isolated home, and an initially empty package store:

- Unmodified `1488f4a`: exact root `pnpm install --frozen-lockfile` failed with `ERR_PNPM_IGNORED_BUILDS` for the Linux embedded binary (all 4 workspace projects).
- Exclusion applied: exact root `pnpm install --frozen-lockfile` and API build passed (all 3 remaining projects), both without NODE_ENV and with `NODE_ENV=production`. Embedded PostgreSQL was absent from installed modules.
- API-only Render install and build above passed with `NODE_ENV=production`; neither local-db nor frontend workspace dependencies were linked. The lockfile was byte-for-byte unchanged, and compiled migration assets matched source.
- Existing API tests: 59 passed, 19 database integration tests skipped because no isolated test database was configured. The production frontend build also passed.

No live Render settings were changed and no production database migrations were executed. Docker images were not rebuilt in this check because the Docker daemon was unavailable; Dockerfiles and compose configuration are unchanged.

Replace angle-bracket placeholders with real values; no production hostname or domain ownership is inferred.

| API environment variable | Production value |
| --- | --- |
| `NODE_VERSION` | `24` |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | Leave unset; Render supplies it |
| `DATABASE_URL` | Private Render database connection URL; Blueprint uses `fromDatabase.connectionString` |
| `PGSSLMODE` | `require` for Render internal URL only; see TLS below |
| `CORS_ORIGIN` | Exact frontend origin, e.g. `https://<actual-project>.vercel.app`, no trailing slash/path |
| `TRUST_PROXY` | `1`; verify actual proxy chain in staging |
| `ACCESS_TOKEN_SECRET` | Unique random value, minimum 32 characters; Blueprint generates it |
| `INGESTION_API_SECRET` | Independent random value, minimum 32 characters; Blueprint generates it |
| `INGESTION_ENABLED` | `false` until protected inbound-mail relay is ready |
| `OWNED_MAIL_DOMAINS` | Real comma-separated root domains you control |
| `WORK_EMAIL_DOMAIN` | Owned category domain, equal to/below an owned root |
| `SCHOOL_EMAIL_DOMAIN` | Owned category domain, equal to/below an owned root |
| `PERSONAL_EMAIL_DOMAIN` | Owned category domain, equal to/below an owned root |
| `MAIL_DOMAINS` | Empty unless retaining explicitly owned legacy domains |
| `CUSTOM_USERNAMES_ENABLED` | `true` |

Generate each manual secret independently with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Store only in Render secret settings. `ACCESS_TOKEN_SECRET` remains required by existing config; inbox authorization uses per-inbox generated secrets and PBKDF2 hashes instead.

Existing optional defaults: `INBOX_TTL_MINUTES=60`, `MAX_MESSAGES_PER_INBOX=50`, `MAX_MESSAGE_SIZE_BYTES=1048576`, `CLEANUP_INTERVAL_MS=60000`, `RATE_LIMIT_INBOX_CREATE_PER_HOUR=10`, `RATE_LIMIT_API_PER_MINUTE=60`. Fastify also retains its default 1 MiB JSON body ceiling; a relay must obey both message and request limits.

CORS requires exact comma-separated HTTPS origins. List the custom frontend origin and Vercel production alias separately if using both. CORS is not authentication and does not restrict non-browser clients. There are no credentialed cookies. Browser access secrets stay in headers, never query strings.

## TLS and migrations

The API and compiled runner share `src/db/connection.ts`. TLS mode precedence: URL `sslmode`, then standard `PGSSLMODE`, then `verify-full` in production or `disable` locally. Production rejects disabled TLS and ambiguous `ssl=` overrides.

- Render internal Postgres uses self-signed certificates. Explicit `require` encrypts with TLS 1.2+ without plaintext fallback, but does not verify the certificate. Limit this exception to Render's private network in the same account/region.
- External URLs should use `verify-full`, the default in production. Restrict the database external IP allowlist if external connections are needed. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- A URL's `sslmode=require` overrides `PGSSLMODE=verify-full`; remove it for verified TLS. URL `sslrootcert=/absolute/path/to/ca.pem` supports a custom CA with `verify-full`. Unsupported client-certificate options are rejected explicitly.
- Pool maximum: 20 per process. Keep one instance: SSE fanout and rate limits are process-local. Horizontal scaling needs shared event/rate-limit infrastructure. Rolling deployments temporarily overlap processes; verify reconnect/reconciliation in staging.

Migrations run after build, before starting the new API. The runner serializes concurrent jobs with a PostgreSQL session advisory lock on the same connection used by Drizzle. Checked-in migrations/journal are applied, the lock released, and connection closed. Failure exits nonzero. Repeat runs are no-ops for applied journal entries. Do not use seed, schema push, generation, reset, or volume removal in deployment.

Back up before migration and verify restore procedures. Existing category migrations preserve legacy data/credentials, covered by integration tests. Future migrations must support old and new API versions during rollout. Code rollback does not reverse database changes: use a tested forward repair or backup restore plan.

## Inbound email

Hosting this HTTP app does not configure SMTP, MX, or an inbound provider. Production already rejects `.test`, reserved example domains, and domains outside `OWNED_MAIL_DOMAINS`. Never publicly use development mode to bypass this. Displayed `.test` addresses now explicitly say they cannot receive public Internet mail. Owned domains also remain non-delivering until routing is configured.

Configure inbound delivery for every category domain, then a trusted relay posting the existing JSON contract to `/api/ingest` with `X-Ingestion-Secret`. The app is not an SMTP server and does not verify arbitrary provider webhook signatures; a verifying adapter may be required. Keep `INGESTION_ENABLED=false` until ready. Protect ingestion through a private relay/network policy or equivalent gateway. Enabling it directly on the public API leaves an Internet-reachable shared-secret endpoint requiring a security decision; CORS does not protect it.

Simulation is always 404 in production and the frontend hides simulation controls using the existing options response. No public simulation override was introduced.

## Checks and launch checklist

Validated locally on 2026-10-15: frontend/API production builds and TypeScript checks; 59 non-database tests; 19 PostgreSQL integration tests on a fresh temporary cluster; concurrent and repeated compiled migrations. The configured local database was offline and was left untouched. Integration removes only its own uniquely named test database. Cloud TLS, DNS, proxy topology, and actual hosting behavior still need staging validation.

Run from repository root:

```sh
pnpm --filter @inboxzero/web typecheck
pnpm --filter @inboxzero/web build
pnpm --filter @inboxzero/api typecheck
pnpm --filter @inboxzero/api build
pnpm --filter @inboxzero/api test
pnpm --filter @inboxzero/api test:integration
pnpm audit --prod
```

The existing integration harness loads root `.env` and needs a local test-capable PostgreSQL connection with CREATE DATABASE permission. Never point it at production. Without its isolated database URL, the normal test command skips database integration tests.

- [ ] Resolve/triage remaining audit advisories: currently 14 high, 11 moderate, 3 low. Audit is failing, so public launch is not recommended.
- [ ] Approve cloud creation, paid plans, region, names, backups, and commands; commit/push only after approval.
- [ ] Choose owned category domains and configure/test inbound delivery before advertising reception.
- [ ] After approval, provision private PostgreSQL/API with exact CORS origins and secrets; check TLS and `/api/health` returns 200.
- [ ] Verify pre-deploy migration completion, journal, and legacy records; never seed/reset.
- [ ] Build Vercel with public API `/api` URL; refresh root/nested paths and check bundled Geist fonts.
- [ ] Test categories/custom usernames, copy/search, HTML/plain-text reading, deletion, countdown, and desktop/mobile layouts.
- [ ] Check cross-origin preflight and authenticated SSE; trigger mail/deletion and test reconnection after API restart. Denied origins must receive no CORS allow-origin header.
- [ ] Verify missing/wrong secrets fail; cross-inbox message access fails; simulation/disabled ingestion return 404.
- [ ] Verify actual client IP isolation/rate limits and forged forwarded-header prefixes behind Render. Do not blindly enable trust for every proxy hop.
- [ ] Keep one API instance; monitor 5xx, cleanup, pool failures, storage, and abuse; test backups/restores and database network restrictions.
- [ ] Review retention/privacy, protect ingestion, then approve public launch.

## Official references

[Vercel monorepos](https://vercel.com/docs/monorepos), [root-directory access](https://vercel.com/docs/monorepos/monorepo-faq), [Vite](https://vercel.com/docs/frameworks/frontend/vite), and [package managers](https://vercel.com/docs/package-managers).

[Render Blueprint/plans](https://render.com/docs/blueprint-spec), [pre-deploy lifecycle](https://render.com/docs/deploys), [Node versions](https://render.com/docs/node-version), and [PostgreSQL TLS/network restrictions](https://render.com/docs/postgresql-creating-connecting).

[node-postgres TLS](https://node-postgres.com/features/ssl) and [Fastify proxy trust](https://fastify.dev/docs/v4.29.x/Reference/Server/).
