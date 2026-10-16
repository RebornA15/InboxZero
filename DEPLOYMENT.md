# Vercel + Render deployment

Prepared locally only: no cloud resources, commits, pushes, or changes to existing database data. The default Render template is a free public portfolio demo with simulated messages and reserved, non-deliverable `.test` addresses. No custom email domain or inbound mail provider is needed. Existing dependency findings in [SECURITY_REVIEW.md](SECURITY_REVIEW.md) still need separate review; demo mode does not resolve dependency advisories.

## Free portfolio demo setup

1. In Vercel, create/import the frontend project using the Vite settings below. Use its assigned `https://<your-project>.vercel.app` origin; this website hostname is **not** an owned email domain. A personal, non-commercial portfolio fits the intended Vercel Hobby use (see [Hobby plan](https://vercel.com/docs/plans/hobby)).
2. In Render, create a **Free PostgreSQL** database and a **Free Node Web Service** in the same region, or review the `render.yaml` Blueprint. Keep the API Root Directory blank (repository root). Do not apply a free-plan template to existing paid resources expecting an automatic downgrade.
3. Set the backend variables in the table below: `NODE_ENV=production`, `DEMO_MODE=true`, `EMAIL_GENERATION_ENABLED=true`, `INGESTION_ENABLED=false`, the real database connection URL, two independent secrets, and the exact Vercel HTTPS origin in `CORS_ORIGIN`. Remove or leave empty all five mail-domain variables. Do not enter the Vercel website hostname as a mail domain.
4. Use the exact Render build and start commands below. Clear any old dashboard Pre-Deploy Command. Free web services do not support a pre-deploy command, so the start command applies migrations and starts the API only on success. Redeploy after environment changes.
5. Set Vercel `VITE_API_BASE_URL=https://<actual-render-host>/api` for Production before building, then deploy/rebuild the frontend. Backend secrets stay only in Render. No frontend `DEMO_MODE` or `VITE_DEMO_MODE` is needed: the UI reads capabilities from the API. Only enable Preview environments against a suitable backend with explicit exact-origin CORS entries; do not use wildcard Vercel origins.
6. Verify `/api/health` returns 200 and `/api/inboxes/options` reports `demoMode=true`, three `.test` categories, and `simulationEnabled=true`. Open the frontend: its persistent demo banner and address dialog must warn that addresses cannot send or receive real email. Create each category, add a sample message, view it, and verify expiration. `/api/ingest` must return 404, even with the ingestion secret.

Free hosting is limited: Render's free API sleeps after 15 minutes without inbound traffic and can take about a minute to wake. Free Render PostgreSQL is limited to 1 GB and **expires after 30 days**; plan replacement/export before expiry or use another PostgreSQL service with verified TLS. This template is not a promise of indefinite free storage. See [Render free limits](https://render.com/docs/free) and [pre-deploy availability](https://render.com/docs/deploys#pre-deploy-command).

## Repository architecture

- pnpm 12.10.1 workspace: `@inboxzero/web`, `@inboxzero/api`, optional host-only `@inboxzero/local-db`. Neither app imports another workspace package. Vercel restricts workspace discovery to packages/web. Default workspace discovery includes only application packages; the host-only local database helper is explicitly excluded and installed only on request. Both apps require root workspace/TypeScript files.
- Web `build`: `tsc && vite build`, output `packages/web/dist`. There is no frontend `test` script. Frontend API/SSE tests use the API's existing Vitest command.
- API `build` now compiles TypeScript and copies SQL/journal assets to `dist/db/migrations`. Added actual scripts: `start` runs `node dist/index.js`; `db:migrate:production` runs `node dist/db/migrate.js`. Development migration scripts still load root `.env` with tsx. Production needs neither tsx nor a repository `.env`.
- HTTP and streaming fetch SSE share `VITE_API_BASE_URL`. Native EventSource is not used: inbox authentication requires `X-Access-Secret`. Empty/unset base uses `/api` and the existing Vite proxy (`API_PROXY_TARGET`, default `http://127.0.0.1:3001`). Docker retains its `http://api:3001` proxy. Vite's proxy does not run in the deployed static frontend.
- Production Fastify binds to `0.0.0.0` and reads platform `    PORT`. Docker/Compose, migration SQL, address rules, categories, and responsive styles are unchanged.

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

`render.yaml` is an unexecuted Blueprint template: one Free Node API instance and Free PostgreSQL 16 in Frankfurt (1 GB, 30-day database lifetime). Database external access is disabled. Review account availability and quotas before applying. Auto-deploy is off, but applying a Blueprint can still create resources and trigger initial deployment. Existing manually configured services must update their dashboard settings explicitly.

| API service setting | Exact value |
| --- | --- |
| Runtime | Node |
| Root Directory | Blank: repository root |
| Instances | `1` |
| Build Command | `npx --yes pnpm@12.10.1 install --frozen-lockfile --prod=false --workspace-packages=packages/api --filter @inboxzero/api... && npx --yes pnpm@12.10.1 --workspace-packages=packages/api --filter @inboxzero/api build` |
| Pre-Deploy Command | Empty (not supported on Free web services) |
| Start Command | `node packages/api/dist/db/migrate.js && node packages/api/dist/index.js` |
| Health Check Path | `/api/health` |
| Auto-deploy | Off |

### Render embedded PostgreSQL install failure

Commit `1488f4a` already contains the API-only command above in `render.yaml`. The reported Render command, `pnpm install --frozen-lockfile` at repository root, does not execute that Blueprint command. A dashboard override or service configured separately from the Blueprint must be updated explicitly; repository edits do not prove the live service uses them. Previously, `packages/*` discovered every workspace, including the local helper and its development dependency chain: `@inboxzero/local-db` -> `embedded-postgres@18.4.0-beta.17` -> `@embedded-postgres/linux-x64@18.4.0-beta.17`. A plain install includes workspace development dependencies by default. The API, frontend, and root manifests have no embedded PostgreSQL dependency, and the API runtime and compiled Drizzle migrations use `pg` and `DATABASE_URL`.

`pnpm-workspace.yaml` now excludes `packages/local-db` from default discovery using a negative package pattern. This makes even the plain root frozen install safe without approving or suppressing an unused PostgreSQL binary script. Root installs still include the frontend and application development tools; the API-only Render command additionally excludes the frontend workspace. Keep `--prod=false` during compilation because TypeScript and declaration packages are development dependencies. Both install and build use the API workspace override so pnpm's pre-script dependency verification retains the same scope. API test/development tools are retained during compilation rather than restructuring existing dependency manifests.

The shared lockfile retains the helper importer and platform binaries for reproducible opt-in local use; lockfile presence alone does not cause installation of an excluded workspace. No dependency versions or build approvals change. The exact Windows embedded binary approval and esbuild approval remain intact. No Linux binary approval, global build-script bypass, or security-policy relaxation is added. Vercel commands, Dockerfiles, application source, and migrations are unchanged.

For the optional host helper, first run `pnpm --workspace-packages=packages/local-db install --frozen-lockfile`, then use the existing `node packages/api/start-embedded-pg.mjs` command. This overrides workspace discovery for that explicit install and preserves `packages/api/.pgdata`. Windows retains its existing binary approval; other host platforms still require deliberate package-specific script review. Docker development continues to use its PostgreSQL service and needs no helper install.

Set Render's dashboard Build Command to the exact command above, with Root Directory blank, and clear the build cache once when redeploying. Run the compiled migration before listening through the start command above. The workspace exclusion also protects an earlier unfiltered install if the platform runs one.

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
| `DEMO_MODE` | `true` for this portfolio; strict literal `true`/`false`, code default `false` |
| `EMAIL_GENERATION_ENABLED` | `true` for demo; `false` selects domain-free limited mode only when DEMO_MODE=false |
| `OWNED_MAIL_DOMAINS` | Empty/unset in demo or limited mode; real owned roots for real production email |
| `WORK_EMAIL_DOMAIN` | Empty/unset in demo (fixed `work.inboxzero.test`); real owned domain outside demo |
| `SCHOOL_EMAIL_DOMAIN` | Empty/unset in demo (fixed `school.inboxzero.test`); real owned domain outside demo |
| `PERSONAL_EMAIL_DOMAIN` | Empty/unset in demo (fixed `inboxzero.test`); real owned domain outside demo |
| `MAIL_DOMAINS` | Empty/unset in demo or limited mode; owned legacy domains only for real mode |
| `CUSTOM_USERNAMES_ENABLED` | `true` |

Generate each manual secret independently with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Store only in Render secret settings. `ACCESS_TOKEN_SECRET` remains required by existing config; inbox authorization uses per-inbox generated secrets and PBKDF2 hashes instead.

### Demo mode and real email separation

Demo mode is explicit and off by default in code. With `DEMO_MODE=true`, generation must be enabled, ingestion cannot be enabled, and owned/legacy domain lists must be empty. Category variables may be empty or their exact fixed demo domain, with no arbitrary overrides. Production secrets, CORS, TLS, authentication, and rate limits remain enforced. Options and created inboxes identify demo addresses, and the UI labels them before generation, beside the active address, in the workspace banner, and when copying. Every address uses reserved `.test`, including when copied outside the UI. Neither a `.test` address nor a Vercel website hostname receives Internet mail through this app.

The simulation endpoint accepts only an optional subject and always uses a fixed, clearly marked sample in demo mode; it accepts no recipient, sender, or HTML override. It requires the matching inbox's `X-Access-Secret`, never an ingestion/admin credential. It refuses stored real-domain inboxes, expired or full inboxes, and is limited to 10 requests per minute per client IP alongside global rate limits. The privileged `/api/ingest` handler always returns 404 in demo mode, even with its correct secret. Browser credentials remain in sessionStorage and request headers. No new public ingestion capability is exposed.

To enable real production email later, set `DEMO_MODE=false`, retain `EMAIL_GENERATION_ENABLED=true`, and configure every owned/category domain under the existing strict checks. Keep ingestion false until DNS/MX and a trusted relay are configured. Production simulation is disabled outside demo mode. Development simulation remains available for authenticated local inboxes. Existing read/delete/expiry behavior is shared across modes.

Demo validation: API and frontend production builds passed with pnpm 12.10.1. The compiled production API was started against a new isolated local PostgreSQL instance with TLS (`NODE_ENV=production`, `PGSSLMODE=require`), returned health 200, advertised all three demo categories, and returned ingestion 404 with the correct secret. Compiled migrations passed twice on that dedicated database. The 5 database-backed demo tests passed, covering cross-inbox access/injection denial, fixed labeled messages, strict payloads, rate limiting, expiration/full-inbox protection, and rejecting stored real-domain inboxes. The regular suite passed 84 tests; 24 database tests skip without their dedicated database variables (the 5 demo database tests were run separately). No real user data or deployment resources were touched.

The existing 19 PostgreSQL category integration tests also passed separately on a fresh isolated test database, including legacy migrations/credentials, authenticated SSE, deletion, local ingestion/simulation, and expiry. Their public-options assertion was updated to allow only the newly advertised public capabilities, with no secret/configuration leakage.

To rerun the demo integration test, migrate a disposable PostgreSQL database named `inboxzero_demo_tests_<random hexadecimal suffix>`, set `INBOX_DEMO_DATABASE_URL` to its URL in the local test process, and run `pnpm --workspace-packages=packages/api --filter @inboxzero/api test tests/demo.integration.test.ts --maxWorkers=1 --minWorkers=1 --hookTimeout=60000`. Configure `PGSSLMODE` for that test database; never use a production database. This variable is test-only and is not needed on Render or Vercel.

### Optional limited launch without generation

Set `NODE_ENV=production`, `DEMO_MODE=false`, `EMAIL_GENERATION_ENABLED=false`, and `INGESTION_ENABLED=false`. Remove or leave empty **all five** domain variables: `OWNED_MAIL_DOMAINS`, `WORK_EMAIL_DOMAIN`, `SCHOOL_EMAIL_DOMAIN`, `PERSONAL_EMAIL_DOMAIN`, and `MAIL_DOMAINS`. Nonempty domain settings are rejected in limited mode rather than silently accepted or replaced with test domains. Keep the real database URL, both independent secrets (at least 32 characters), exact HTTPS CORS origins, and production TLS configuration. The Blueprint now defaults to the interactive demo above; existing Render services must update their dashboard environment separately.

In limited mode, `/api/inboxes/options` returns no categories and `emailGenerationEnabled=false`; `POST /api/inboxes` returns HTTP 503 with code `EMAIL_GENERATION_DISABLED` before hashing secrets or accessing storage. Ingestion cannot be enabled, production simulation remains disabled, and existing inbox authentication/read/delete/SSE routes remain available. Migrations, cleanup, and the database-aware health endpoint retain their behavior. This is an operational API deployment, not a working disposable-email service. The existing frontend UI is unchanged and cannot successfully generate an address in this mode.

When domains are ready, set `EMAIL_GENERATION_ENABLED=true` and configure **all four** ownership/category variables in the same environment update, then restart/redeploy. `OWNED_MAIL_DOMAINS` is a plain comma-separated list of DNS names: no JSON, email addresses, schemes, paths, ports, wildcards, or trailing dots. Category variables each hold one DNS name equal to or below a declared root (maximum 221 characters). For format only, `OWNED_MAIL_DOMAINS=<owned-root-domain>,<another-owned-root>` with `WORK_EMAIL_DOMAIN=work.<owned-root-domain>`, `SCHOOL_EMAIL_DOMAIN=school.<owned-root-domain>`, and `PERSONAL_EMAIL_DOMAIN=<owned-root-domain>`. Replace every placeholder with domains you actually control; reserved `.test` and example domains are rejected in production. A syntactically valid domain or ownership declaration alone does not verify ownership or establish delivery. Keep `MAIL_DOMAINS` empty unless explicitly supporting owned legacy domains.

Keep ingestion false until DNS/MX, a trusted receiving relay, and endpoint restrictions are ready. No domain registration, DNS provisioning, or inbound provider adapter is implemented by this flag.

Limited-mode validation: production API build passed with pnpm 12.10.1. API tests passed with `--maxWorkers=1 --minWorkers=1 --hookTimeout=60000`: 64 passed, 19 database integration tests skipped (no test database configured). The initial concurrent Windows run timed out in server-import hooks. Tests cover disabled creation before storage, empty advertised categories, ingestion/simulation restrictions, retained authentication and database readiness, strict CORS/secrets/TLS, and rejecting invalid domain settings. Health readiness uses a mocked database in this test; no live Render or database changes were made.

Existing optional defaults: `INBOX_TTL_MINUTES=60`, `MAX_MESSAGES_PER_INBOX=50`, `MAX_MESSAGE_SIZE_BYTES=1048576`, `CLEANUP_INTERVAL_MS=60000`, `RATE_LIMIT_INBOX_CREATE_PER_HOUR=10`, `RATE_LIMIT_API_PER_MINUTE=60`. Fastify also retains its default 1 MiB JSON body ceiling; a relay must obey both message and request limits.

CORS requires exact comma-separated HTTPS origins. List the custom frontend origin and Vercel production alias separately if using both. CORS is not authentication and does not restrict non-browser clients. There are no credentialed cookies. Browser access secrets stay in headers, never query strings.

## TLS and migrations

The API and compiled runner share `src/db/connection.ts`. TLS mode precedence: URL `sslmode`, then standard `PGSSLMODE`, then `verify-full` in production or `disable` locally. Production rejects disabled TLS and ambiguous `ssl=` overrides.

- Render internal Postgres uses self-signed certificates. Explicit `require` encrypts with TLS 1.2+ without plaintext fallback, but does not verify the certificate. Limit this exception to Render's private network in the same account/region.
- External URLs should use `verify-full`, the default in production. Restrict the database external IP allowlist if external connections are needed. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- A URL's `sslmode=require` overrides `PGSSLMODE=verify-full`; remove it for verified TLS. URL `sslrootcert=/absolute/path/to/ca.pem` supports a custom CA with `verify-full`. Unsupported client-certificate options are rejected explicitly.
- Pool maximum: 20 per process. Keep one instance: SSE fanout and rate limits are process-local. Horizontal scaling needs shared event/rate-limit infrastructure. Rolling deployments temporarily overlap processes; verify reconnect/reconciliation in staging.

Migrations run after build at the start of each API instance, including free-tier wakeups, before listening. The runner serializes concurrent jobs with a PostgreSQL session advisory lock on the same connection used by Drizzle. Checked-in migrations/journal are applied, the lock released, and connection closed. Failure exits nonzero and prevents API startup. Repeat runs are no-ops for applied journal entries. Do not use seed, schema push, generation, reset, or volume removal in deployment. Paid deployments may move migration to a separate pre-deploy step and use the Node API command alone as start.

Back up before migration and verify restore procedures. Existing category migrations preserve legacy data/credentials, covered by integration tests. Future migrations must support old and new API versions during rollout. Code rollback does not reverse database changes: use a tested forward repair or backup restore plan.

## Inbound email

Hosting this HTTP app does not configure SMTP, MX, or an inbound provider. Real production email mode (`DEMO_MODE=false`) rejects `.test`, reserved example domains, and domains outside `OWNED_MAIL_DOMAINS`. Explicit demo mode permits only its fixed reserved domains and disables ingestion. Never publicly use development mode to bypass production checks. Owned domains also remain non-delivering until routing is configured.

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
- [ ] Review cloud creation, free-tier limits/expiry, region, names, backups, and commands; commit/push only after approval.
- [ ] Choose owned category domains and configure/test inbound delivery before advertising reception.
- [ ] After approval, provision private PostgreSQL/API with exact CORS origins and secrets; check TLS and `/api/health` returns 200.
- [ ] Verify startup migration completion, journal, and legacy records; never seed/reset.
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
