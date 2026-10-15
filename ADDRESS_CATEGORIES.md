# Address categories and external mail setup

InboxZero has one active inbox per browser session. Generate Address opens a native, keyboard-accessible dialog for Work, School, or Personal, with an optional username when enabled. Work/School are address styles, not verified corporate or educational identities. No real names or affiliation details are required. Opening or cancelling the dialog, and failed generation, preserve the previous active inbox. Successful creation replaces the browser session's active credentials; existing inboxes remain stored until their normal expiry/cleanup behavior applies.

## Configuration

| Variable | Development default | Production requirement |
| --- | --- | --- |
| `WORK_EMAIL_DOMAIN` | `work.inboxzero.test` | Explicit owned domain/subdomain |
| `SCHOOL_EMAIL_DOMAIN` | `school.inboxzero.test` | Explicit owned domain/subdomain |
| `PERSONAL_EMAIL_DOMAIN` | `inboxzero.test` | Explicit owned domain/subdomain |
| `OWNED_MAIL_DOMAINS` | Empty | Operator-declared comma-separated owned root domains |
| `CUSTOM_USERNAMES_ENABLED` | `true` | `true` or `false`, per operator policy |
| `MAIL_DOMAINS` | Empty in code; reserved example in `.env.example` | Optional legacy allowlist, also under owned roots |
| `RATE_LIMIT_INBOX_CREATE_PER_HOUR` | `10` | Adjust for your deployment; all creation attempts count |

Domains are normalized and validated centrally. Ownership is an explicit operator configuration assertion, not proof of DNS ownership. Verify you control each root before adding it. Domain suffix matching uses a dot boundary; similarly named or attacker-suffixed domains are rejected. Production refuses missing domains, reserved placeholders (`.test`, `.invalid`, `.example`, `.localhost`, `example.com/net/org`), and domains outside owned roots. Production validation runs before the server listens. Category domains allow a maximum of 221 characters, leaving room for 32-character usernames.

Development uses reserved, non-deliverable defaults. An old public `MAIL_DOMAINS` entry without a matching ownership declaration is excluded from **new generation** in development. Existing inbox records, credentials, expiry, and exact-address ingestion continue working. No existing address is renamed. Explicit category domain settings using public domains also require the ownership allowlist in development.

Compose already injects `.env` into the API, so no Compose changes or new services are required. The frontend obtains public domain options from the API; secrets and ownership configuration stay server-side. After changing `.env`, recreate the API container:

```powershell
docker compose up -d --force-recreate api
```

## API and username policy

- `GET /api/inboxes/options` exposes category names/domains, the username feature switch, and development mode. It exposes no secrets and makes no delivery-readiness claim.
- `POST /api/inboxes` accepts `{ "category": "work" | "school" | "personal", "username"?: "chosen.name" }`.
- Legacy `{}` requests still create Personal inboxes. Legacy `{ "domain": "configured-domain" }` requests work for approved legacy/personal domains. Unknown or category-mismatched domains now fail validation rather than silently falling back.
- `category` and `isCustomUsername` are additive metadata on creation and authenticated inbox reads. Existing status/address/expiry fields and access-secret authorization remain unchanged.
- Username normalization trims outer whitespace and lowercases ASCII. Names are 3–32 characters, start/end with letters or digits, allow single `.`, `_`, or `-` separators between alphanumeric segments, and reject consecutive separators, Unicode, email syntax, and reserved role names. Reserved names are also checked after separator removal.
- Custom uniqueness is enforced by PostgreSQL's existing unique address constraint. A collision returns HTTP 409 without modifying the requested username. Concurrent attempts can only reserve one inbox for that address.
- Generated names contain 96 bits of cryptographic randomness. Work uses `contact.` plus the token; School uses `student` plus the token; Personal uses the token. Generated conflicts retry at most five times. No real names are fabricated.
- Expired/deleted usernames are not reassigned while their records exist. This avoids late deliveries reaching a different user. Retain that reservation policy if implementing future data-retention changes.
- Creation is limited per client IP per hour; other API routes retain the existing per-minute limit. Configure `TRUST_PROXY` only for a trusted deployment proxy; public clients must not be able to spoof client IP headers. Limits use the existing in-process Fastify store; a multi-replica deployment needs coordinated limits at a shared gateway/store.

All message routes, exact-recipient ingestion, SSE events, HTML/Text rendering, search, deletion, and development simulation remain in place. Simulation uses the selected inbox's stored address and category and works for all three styles. It remains development-only and is explicitly a simulated message, not evidence of external reception. Received HTML stays inside its original sandboxed iframe.

## Migration and verification

`0001_inbox_categories.sql` adds the `inbox_category` enum and two non-null columns with backward-compatible defaults: `category='personal'`, `is_custom_username=false`. It does not rename addresses, change credentials, remove messages, or change expiry. Existing Drizzle migration tracking makes subsequent runs a no-op. The generated snapshot and journal are checked in alongside the SQL.

Container startup already applies migrations. For an existing running API:

```powershell
docker compose exec -T api ./node_modules/.bin/tsx src/db/migrate.ts
```

Run checks from the repository root:

```powershell
pnpm typecheck
pnpm build
pnpm --filter @inboxzero/api test
# PostgreSQL-backed checks create and remove only a fresh, uniquely named test DB:
docker compose build api
docker compose exec -T api node scripts/test-integration.mjs
```

The integration runner requires permission to create/drop a temporary database. It never resets the application database or Docker volumes. For host PostgreSQL, `pnpm --filter @inboxzero/api test:integration` loads your root `.env`. Ordinary unit tests skip integration tests unless the isolated test URL is provided by the harness.

## Real external reception remains a separate setup

The reserved `.test` defaults cannot receive public mail. Before making an external-reception claim, configure owned domains, publish and verify DNS/MX for **every** category domain/subdomain, connect your existing inbound provider/MTA to authenticated `POST /api/ingest`, protect the ingestion route at the network/proxy boundary, and test end-to-end delivery from an external mailbox for each category. Verify exact recipients, duplicates, rejected/expired addresses, and SSE delivery. Registering a domain in configuration or passing an internal simulation does not establish external reception. No new mail server or external email provider is introduced here.

## Implementation files and verified results

Created:

- `ADDRESS_CATEGORIES.md`
- `packages/api/src/lib/address-policy.ts`
- `packages/api/src/db/migrations/0001_inbox_categories.sql`
- `packages/api/src/db/migrations/meta/0001_snapshot.json`
- `packages/api/tests/address-policy.test.ts`
- `packages/api/tests/categories.integration.test.ts`
- `packages/api/scripts/test-integration.mjs`
- `packages/web/src/CreateAddressDialog.tsx`

Updated:

- `.env.example`, `README.md`, `DOCKER_SETUP.md`
- `packages/api/package.json`
- `packages/api/src/config.ts`, `packages/api/src/index.ts`
- `packages/api/src/routes/inboxes.ts`
- `packages/api/src/db/schema.ts`
- `packages/api/src/db/migrations/meta/_journal.json`
- `packages/web/src/App.tsx`, `packages/web/src/api.ts`, `packages/web/src/types.ts`, `packages/web/src/index.css`

Verification completed locally:

- Workspace TypeScript checks and API/frontend production builds passed.
- 50 unit tests and 18 isolated PostgreSQL integration tests passed, including concurrent uniqueness, legacy migration/credentials/messages, expiry cleanup, exact-recipient routing, rate limits, and SSE events.
- Both Docker images rebuilt successfully. PostgreSQL, API, and web containers are healthy; `/api/health` reports database `ok`.
- Migration applied to the existing database without resetting records or volumes; repeat migration execution was tested. Temporary integration databases were removed.
- Browser checks passed at 1440, 1024, 768, 390, and 320 pixel widths, including dialog focus trapping/return, loading/error/retry states, all three categories, copy/countdown, search, message deletion, SSE, simulation, session restoration, and isolated HTML/Text rendering. Browser interaction checks used mocked API responses; PostgreSQL-backed API behavior was tested separately by the integration suite.

No dependencies, lockfile changes, Docker configuration changes, or additional services were needed.
