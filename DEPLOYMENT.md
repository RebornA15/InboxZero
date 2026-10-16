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
- API `build` compiles TypeScript and copies SQL/journal assets to `dist/db/migrations`. `start` runs `node dist/check-config.js && node dist/index.js`; `config:check` validates runtime configuration without database access; `db:migrate:production` runs `node dist/db/migrate.js`. Development migration scripts still load root `.env` with tsx. Production needs neither tsx nor a repository `.env`.
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

`render.yaml` is an unexecuted Blueprint template: one Free Node API instance and Free PostgreSQL 16 in Virginia (1 GB, 30-day database lifetime). Database external access is disabled. Review account availability and quotas before applying. Auto-deploy is off, but applying a Blueprint can still create resources and trigger initial deployment. Existing manually configured services must update their dashboard settings explicitly.

| API service setting | Exact value |
| --- | --- |
| Runtime | Node |
| Root Directory | Blank: repository root |
| Instances | `1` |
| Build Command | `npx --yes pnpm@12.10.1 install --frozen-lockfile --prod=false --workspace-packages=packages/api --filter @inboxzero/api... && npx --yes pnpm@12.10.1 --workspace-packages=packages/api --filter @inboxzero/api build` |
| Pre-Deploy Command | Empty (not supported on Free web services) |
| Start Command | `node packages/api/dist/check-config.js && node packages/api/dist/db/migrate.js && node packages/api/dist/index.js` |
| Health Check Path | `/api/health` |
| Auto-deploy | Off |

### Recurring owned-domain startup error despite DEMO_MODE=true

Commit `c5dd57c` already implements production demo mode. The raw environment schema accepts only literal strings `true` and `false`, defaults DEMO_MODE to false, and passes the string to domain resolution before transforming it to a boolean. With `NODE_ENV=production` and the exact `DEMO_MODE=true` value, domain resolution returns the fixed demo configuration before the live owned-domain check. The reported `OWNED_MAIL_DOMAINS must declare...` message can be reproduced with DEMO_MODE absent/false, but not with a valid true value on that code. Quoted, uppercase, whitespace-padded, or numeric flag values fail enum validation instead. Production reads the running process environment; it does not load the repository `.env`.

Without access to the live Render service, the precise remote mismatch cannot be confirmed. Check the deployed commit/branch and runtime service environment rather than adding fake domains. Verify the variable is on the **API Web Service**, not the database, frontend, preview service, or only a build-command shell prefix. Save the environment and redeploy the intended commit; a successful older build does not prove that the new runtime used the same configuration. Update dashboard start/build overrides to match this file and the table above. Clear the build cache once if stale compiled output is suspected.

The start command now runs a configuration preflight **before migrations**. It prints `inboxzero-config-preflight-v1` with the flag state (`true`, `false`, `unset`, or `invalid`) and the Render-provided `RENDER_GIT_COMMIT` when available, never credentials or the environment. Render documents that revision variable in [default environment variables](https://render.com/docs/environment-variables). Successful demo startup must then print `inboxzero-config-valid` with `nodeEnv=production`, `mode=demo-only`, and `externalIngestion=false`. Missing preflight logs indicate the new start command was not run. A missing compiled check-config file indicates the selected build lacks this change. The preflight also checks PostgreSQL protocol, TLS policy, and optional CA file readability without opening a connection; actual database connectivity is checked by migrations and health readiness.

For the Render dashboard, enter key `DEMO_MODE`, value `true` (no quotes or surrounding spaces). Keep `EMAIL_GENERATION_ENABLED=true` (or unset; true is the default) and `INGESTION_ENABLED=false` (or unset; demo forces it off). Leave OWNED_MAIL_DOMAINS and MAIL_DOMAINS empty/unset; category variables must be empty or their exact fixed demo values. Additional required values remain DATABASE_URL, ACCESS_TOKEN_SECRET, INGESTION_API_SECRET (independent, at least 32 characters each), and CORS_ORIGIN (an exact frontend HTTPS origin). Set PGSSLMODE=disable (or leave it unset) for Render's trusted internal database URL, or use verified TLS for an external database. Leave PORT to Render; preserve Node 24 and the appropriate TRUST_PROXY setting.

After building, run `node packages/api/dist/check-config.js` in the actual runtime environment for a configuration-only diagnostic. Do not paste environment dumps or connection strings into logs/issues. Live-email production (`DEMO_MODE=false`, generation enabled) continues requiring real owned roots and all category domains; demo `.test` addresses never become deliverable by changing the flag.

Recurring-startup verification: frozen API install and production build passed with pnpm 12.10.1; the regular suite passed 99 tests (24 database integration tests skipped without dedicated database variables). Five demo database integration tests passed separately. The compiled preflight, migrations (twice), and actual production API startup passed with an isolated TLS PostgreSQL instance: demo-only mode, health 200, all three reserved categories, ingestion 404 even with the correct secret. Tests reproduce the reported owned-domain error for missing/false DEMO_MODE and verify that true avoids that branch, while invalid flag syntax, conflicting flags/domains, missing secrets, invalid CORS, and disabled production TLS still fail. Logging tests check that URL/password/secret fixtures never appear in preflight output. These are local reproductions, not verification of the live Render deployment or its environment.

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
| `PGSSLMODE` | `disable` or unset for the trusted Render internal URL; `verify-full` for external URLs |
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

### Render internal PostgreSQL: self-signed certificate errors

`DEPTH_ZERO_SELF_SIGNED_CERT` means the TLS connection reached a server but certificate verification rejected its self-signed leaf. It is not fixed by putting both resources in the same region alone. Render's internal PostgreSQL endpoint uses self-signed TLS certificates; see [Render internal TLS modes](https://render.com/docs/postgresql-creating-connecting#ssl-modes-for-internal-connections). Previously the production default was `verify-full` for every hostname. A missing PGSSLMODE or URL `sslmode=verify-full` overriding PGSSLMODE=require could select that incompatible verification policy. The exact live environment cannot be confirmed from this workspace.

The cleanup worker only queries PostgreSQL through the shared Drizzle/pg pool; it does not make outbound HTTPS requests. This error therefore comes from the PostgreSQL driver's Node TLS handshake, not website HTTPS. The failing settings are a requested TLS connection with rejectUnauthorized=true against the private endpoint's self-signed certificate. Earlier require/rejectUnauthorized=false settings requested TLS but would not themselves produce this verification error; a repeated error under that reported policy indicates a different deployed build, effective configuration, or connection path. The current fix removes the internal handshake by default instead of globally weakening certificate verification.

Dashboard changes for the API and database already deployed in **Virginia**:

1. On the PostgreSQL database, open **Connect → Internal** and copy the complete Internal Database URL into the **API Web Service's** `DATABASE_URL`. Both resources must also be in the same Render account/private network. Use the internal short `dpg-...` hostname, not a public `...virginia-postgres.render.com` hostname or an IP address. Do not paste the URL into logs or issues. The Blueprint's `fromDatabase.connectionString` binding supplies this internal URL.
2. On the API service remove the old `PGSSLMODE=require`/`verify-full` value, or set `PGSSLMODE=disable`. Prefer the original internal URL with no manually added TLS query parameters. Remove manually added `sslmode` parameters (including require and verify-full) and any `ssl`, `sslcert`, `sslkey`, `sslrootcert`, or `uselibpqcompat` parameters. Never use `NODE_TLS_REJECT_UNAUTHORIZED=0`, and never disable TLS for an external production database.
3. Keep `NODE_ENV=production` and the existing demo flags/secrets/CORS. No new environment variable is required: Render supplies `RENDER=true` automatically. The narrowly scoped internal-host default is an additional safeguard if PGSSLMODE is absent, not a reason to use the internal exception on a public URL.
4. Save and redeploy the intended code using the preflight/migration/start command above. Preflight should report database `endpoint=render-internal`, `sslMode=disable`, `encrypted=false`, `certificateVerification=false`. This explicit non-TLS policy belongs only to this PostgreSQL connection on Render's trusted private network; other HTTPS/TLS clients are unaffected. Migrations must complete, `/api/health` must return 200 with database `ok`, and cleanup must stop logging certificate errors. The configuration preflight does not itself test database connectivity.

For an **external/public PostgreSQL URL**, set `PGSSLMODE=verify-full` and remove any conflicting URL `sslmode=require`. Use the full provider hostname and a trusted certificate chain. A custom CA can be supplied through URL `sslrootcert=/absolute/path/to/ca.pem` with verify-full; do not disable verification to work around an external CA or hostname error. No host-based verification exception is inferred for public Render hosts, lookalike domains, IP addresses, or non-Render environments.

External production connections now reject unverified `require` explicitly, rather than allowing a manually supplied PGSSLMODE to turn verification off on a public endpoint. The default for a trusted private short dpg-* hostname on Render is now ssl=false, so no TLS handshake is requested. This corrects the earlier application policy that unnecessarily forced TLS internally. Explicit require is still available for optional internal self-signed TLS; it does not fall back to plaintext. Plaintext production connections are rejected everywhere except the recognized Render-private endpoint classification. Loopback fixtures may explicitly use require for TLS tests.

### Diagnosing degraded database health

Listening on port 10000 confirms the HTTP server started, not database readiness. `/api/health` acquires a client and executes `SELECT 1` with a 5-second query timeout; connection acquisition also has the shared 5-second connection timeout. It returns 200 only after the query succeeds and 503 otherwise. Query failures discard the client instead of returning a potentially broken connection to the pool. The response remains generic and never returns diagnostic details to public callers.

Health, cleanup, idle-pool errors, and failed migrations now write a server-only JSON entry with `event=database-error`, an operation, an allowlisted underlying error code, a static reason/action, and the effective TLS policy. Raw error messages, stack traces, URLs, hostnames, credentials, SQL details, and arbitrary error objects are never logged by this database logger. Nested driver causes and AggregateErrors are inspected safely; unknown failures receive UNKNOWN_DATABASE_ERROR without raw values. Example codes and actions:

| Code | Meaning / action |
| --- | --- |
| DEPTH_ZERO_SELF_SIGNED_CERT | A self-signed certificate was rejected; verify internal URL and effective connection policy |
| ENOTFOUND / EAI_AGAIN | DNS failure; check the internal hostname and same-account/region access |
| ECONNREFUSED / ETIMEDOUT | Database endpoint unavailable or inaccessible |
| 28P01 | Authentication failed; refresh the API's database URL after credential rotation |
| 3D000 | Database name does not exist |
| 53300 / 57P03 | Database connection limit reached or database is not ready |
| 42P01 / 42703 | Cleanup/application queries need the correct migrations; SELECT 1 alone does not validate schema |

An earlier certificate error does not prove the latest generic health failure has the same cause. After redeploy, inspect the new code/reason/TLS fields without sharing secrets. A require policy with certificateVerification=false should not produce a certificate-verification failure through this helper; if it does, verify the deployed commit/start command and check whether the error came from another process. The shared preflight and migration startup chain should reject configuration or database connection failures before the new API starts; an older dashboard override that runs only dist/index.js bypasses that sequence.

Cleanup catches and logs database failures, retries on its next configured interval, and skips a tick while a previous cleanup remains active. Starting the worker twice does not create duplicate timers, and stopping it prevents further scheduled jobs. In-flight work may finish normally. No background connection failure is allowed to become an unhandled timer rejection.

Readiness/logging regression tests verify SELECT 1 execution, bounded health query configuration, generic public 503 responses, failed-client disposal, recovery on later requests, nested error classification, and absence of secret/URL fixtures in server logs. Worker tests verify retry after failure, duplicate-start protection, stop behavior, and non-overlapping jobs. The 126 regular tests and 8 separate isolated database tests passed; 19 legacy database tests remain optional/skipped in the regular run. No frontend code was changed and no live Render deployment was accessed.

Runtime Drizzle queries, seed, cleanup, and health share the API pool from `src/db/index.ts`. The compiled migration client uses the same `databaseConnection()` helper. Drizzle Kit now obtains explicit credentials and the exact same TLS object from that helper instead of passing a raw URL through a separate parser. SSL URL parameters are removed before node-postgres parses its connection string, preventing the driver from replacing the explicit TLS object ([node-postgres SSL configuration](https://node-postgres.com/features/ssl)). Conflicting URL/environment modes and repeated sslmode parameters fail early.

TLS verification: production API build passed; regular API suite: 126 passed, 27 optional database tests skipped. Five demo integration tests and three TLS transport tests passed separately against isolated local TLS PostgreSQL. The tests reproduced `DEPTH_ZERO_SELF_SIGNED_CERT` with the verified default, confirmed `pg_stat_ssl.ssl=true` for both client and pool under require, and verified successful strict TLS with a supplied trusted CA. Actual compiled preflight, repeated migrations, API readiness, demo routes, and the cleanup query succeeded. The installed Drizzle Kit `check --config drizzle.config.ts` command also passed. No live Render URL, credentials, production records, or dashboard settings were accessed/changed.

TLS transport test variables are local-only: `INBOX_TLS_DATABASE_URL` must select a loopback self-signed disposable `inboxzero_demo_tests_<hex>` database; `INBOX_TLS_TEST_CA` supplies its CA certificate path for verified-TLS testing. Run `pnpm --workspace-packages=packages/api --filter @inboxzero/api test tests/database-tls.integration.test.ts --maxWorkers=1 --minWorkers=1` against that fixture. They are not Render deployment variables.

Latest trusted-internal validation: API build passed; 127 regular tests passed (28 optional database tests skipped). Five demo and four transport database tests passed separately. A test-only DNS preload mapped a private dpg-* fixture hostname to isolated local PostgreSQL: the compiled production preflight reported render-internal/disable, repeated migrations completed, and the running API returned health 200 without PGSSLMODE being set. Transport tests confirmed pg_stat_ssl.ssl=false for both pg.Client and pg.Pool using the internal policy, while explicit TLS and verified TLS with a trusted CA still work. Drizzle Kit's actual config/check command passed with ssl=false. No system DNS/hosts, user database, live Render environment, or frontend files were modified.

The API and compiled runner share `src/db/connection.ts`. TLS mode is taken from URL `sslmode` or `PGSSLMODE`; when both are supplied they must agree. Without either, a private short `dpg-*` hostname on Render (`RENDER=true`) uses `disable` (ssl=false); other production endpoints use `verify-full`, and local development uses `disable`. Production rejects disabled TLS outside the trusted Render-private endpoint and rejects ambiguous `ssl=` overrides.

- Render internal Postgres does not require TLS on its trusted private network. The application defaults to ssl=false only for a short dpg-* hostname when RENDER=true. Optional explicit require enables TLS 1.2+ without certificate verification or plaintext fallback. The API and database must share the account/region; never use this policy for an external connection.
- External URLs should use `verify-full`, the default in production. Restrict the database external IP allowlist if external connections are needed. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- A conflicting URL `sslmode` and `PGSSLMODE` now fails configuration validation instead of silently overriding either setting. Remove URL TLS parameters and select the intended `PGSSLMODE`. URL `sslrootcert=/absolute/path/to/ca.pem` supports a custom CA with `verify-full`. Unsupported client-certificate options are rejected explicitly.
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
