# Public deployment security review

Reviewed 2026-10-15. Deployment preparation is complete locally, but **public launch is not recommended yet**. This is a focused code/configuration review, not a penetration test or proof of exploitability of every dependency advisory.

## Launch blockers

1. `pnpm audit --prod --json` still reports **14 high, 11 moderate, 3 low** advisories after compatible DOMPurify 3.4.16 and Nano ID 5.1.16 updates. See the reproducible, sanitized [audit snapshot](deployment-audit.json), including advisory URLs and patched-version ranges. Remaining packages are Fastify, find-my-way, Drizzle ORM, mailparser, and transitive Nodemailer/linkify-it. Major upgrades (especially Fastify and its matching plugins) require a separate compatibility migration and retesting; they were not silently applied here. mailparser is currently declared but not imported by application source, so its transitive advisories need reachability review or dependency removal. Reachability does not make the overall audit pass. Resolve/triage each advisory before launch and re-audit the actual production lockfile.
2. No real inbound email setup is established by the repository. Owned category domains, DNS/MX routing, and a trusted verifying relay must be configured/tested. `.test` addresses are non-deliverable; production already refuses reserved domains. Do not expose development mode to get around that protection.
3. Verify actual deployed proxy trust, database TLS, CORS, and HTTP streaming in staging. Local injection/database tests do not establish Render ingress topology or cloud certificate behavior. Keep one instance until distributed rate limiting and SSE fanout exist.

## Reviewed controls and fixes

| Area | Finding and resulting control |
| --- | --- |
| Inbox access | Metadata, list, full message, deletion, and SSE call `authorizeInbox`: opaque ID plus `X-Access-Secret`, PBKDF2 verification, expiry/status checks. Message queries include the authorized inbox ID. Missing/nonexistent/wrong credentials return unauthorized. Raw creation secret is returned once and stored in browser sessionStorage, not URLs. |
| Production simulation | Existing backend rejects simulation in production. Options reports development=false and frontend hides controls. No override was added. |
| Ingestion | Fixed comparison that previously truncated supplied secrets and accepted a correct secret plus trailing bytes. Compares actual byte lengths and uses timingSafeEqual. New `INGESTION_ENABLED` defaults false in production, true in development, and can be explicitly configured. Disabled endpoint returns 404 before DB access. |
| CORS | Production startup requires exact HTTPS origins, rejects wildcards/paths/empty lists, and retains header authentication without cookies. Raw hijacked SSE explicitly copies Fastify CORS/security headers before flushing. CORS is not server-to-server authorization. |
| API caching/logs | API responses use no-store; SSE also uses no-transform. Production database error logs omit row detail, stack, and raw error text. Request bodies and secrets are not intentionally logged. Health exposes only coarse DB status. Health connections now release even after query failure. |
| Rate limits/proxies | Existing per-IP creation and global request limits retained. Client errors, including rate-limit 429, keep their status instead of becoming 500. `TRUST_PROXY` supports bounded hop counts; Render template uses 1, pending staging verification. Unconditional true trusts spoofable prefixes and is discouraged. |
| SSE lifecycle | Header-authenticated fetch; reconnect/backoff, list reconciliation, terminal handling for 401/404/410, cancellation on unmount. Server caps streams at five per inbox, closes at authorization expiry, cleans timers on response close, and closes streams before shutdown. |
| Database | One shared connection builder for API/migrations; production requires TLS, verified by default. Explicit require mode supports self-signed internal Render TLS only. Private DB URL and disabled external-access template. No global TLS bypass. |
| Migrations | Compiled SQL/journal assets, pre-deploy migration command, same-session advisory lock, nonzero exit on failure, journal-based repeat safety. No seed/reset, no SQL changes, and no changes to existing application data during testing. |
| Untrusted email | DOMPurify patch applied; existing script/form sanitization retained. Sandbox iframe remains script-free; its added CSP blocks external resource loads, including CSS tracking, while allowing inline sender styles/data images. Shell never inserts email markup into the parent DOM. |
| Frontend hosting | Public API base at build time, no credentials in VITE variables, SPA fallback excludes API paths. Static nosniff, no-referrer, and frame-denial headers. Removed broken production preloads pointing into node_modules; Geist remains bundled. Removed inaccurate end-to-end-security metadata claim. |

## Residual risks and operational requirements

- Bearer secrets are the sole inbox credential; anyone holding one can read/delete that inbox until expiry. sessionStorage is accessible to parent-page JavaScript, so parent-page XSS remains significant. The application is not end-to-end encrypted and stores message bodies in PostgreSQL. Restrict database/admin/backup access and avoid claims stronger than the implemented controls.
- Ingestion is not protected by CORS. Enabling it on the public Render service exposes a shared-secret endpoint to the Internet. Use a private trusted relay/gateway or equivalent restrictions; rotate its secret and validate provider signatures in the relay. DNS/SMTP/provider integration is not supplied by this deployment.
- Rate limits and SSE subscribers are process-local. Multiple instances or overlapping rollout processes can weaken aggregate limits and miss immediate fanout. Reconnection reconciles lists but is not durable event replay. A per-inbox stream cap is not a global anti-DoS system; load/abuse testing is still needed.
- Per-inbox message count enforcement reads an existing count before insertion. Concurrent inbound deliveries can exceed the nominal cap or lose counter increments. Before high-volume ingestion, enforce count/expiry transactionally under a row lock or atomic conditional update. A trusted relay should also enforce actual payload-size limits rather than trusting declared sizeBytes alone. Existing Fastify body limits remain active.
- Cleanup deletes expired message bodies but retains inbox metadata/address records. Database backups can retain deleted content beyond inbox expiry. Define/disclose retention and backup policies; test cleanup and restore behavior. Do not promise immediate deletion from backups.
- The external PostgreSQL allowlist is disabled in the template. If manually provisioning, explicitly disable external access or restrict administrative CIDRs; do not assume a default public allowlist is private. Internal require TLS encrypts but does not verify certificates; use verify-full for public/external connections.
- The frontend CSP is currently scoped to untrusted email documents; it is not a complete parent application CSP. Any future parent CSP must permit the exact API origin for fetch/SSE and the email iframe behavior. No broad connect-src wildcard was introduced.
- Dependencies in the build toolchain also warrant an unfiltered audit before launch; the saved report covers production dependencies only.

## Validation evidence

59 non-database tests passed, including production configuration/TLS modes, restricted preflights, no-store, disabled ingestion/simulation, missing-secret boundaries, proxy-prefix rate limits, all frontend URL helpers/SSE auth, and reconnect cancellation. The separate PostgreSQL suite passed 19 tests covering legacy migration preservation, categories, collisions, routing, cross-inbox isolation, authenticated cross-origin SSE, deletion/expiry, and trailing ingestion-secret rejection. Compiled migrations passed concurrent/repeated runs on a fresh temporary PostgreSQL cluster. Both application builds and type checks passed.

These tests do not resolve the dependency findings or replace deployed staging/inbound-mail checks. Follow [the deployment checklist](DEPLOYMENT.md) before requesting public launch approval.
