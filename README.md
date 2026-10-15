# InboxZero

An open-source, ephemeral temporary email service designed for high throughput, absolute privacy, and instant real-time message streaming.

---

## Architecture Overview

```
                   +------------------------+
                   |   Incoming Mail (MTA)  |
                   +-----------+------------+
                               |
                               v
                     POST /api/ingest
                               |
+-------------------+          v         +-------------------+
|  Vite Web Client  | <--- SSE stream -- |   Fastify API     |
|   (React / CSS)   | ---- REST API ---> |  (Node / Drizzle) |
+-------------------+                    +---------+---------+
                                                   |
                                                   v
                                         +-------------------+
                                         |    PostgreSQL     |
                                         +-------------------+
```

- **Frontend (`packages/web`)**: Built with React, TypeScript, and Vanilla CSS. Features live SSE streaming, audio chime notifications, an auto-refreshing countdown timer, and safe sandboxed HTML rendering.
- **Backend API (`packages/api`)**: High-performance Fastify server with Drizzle ORM, cryptographic token signing, DOMPurify HTML sanitization, and automated cleanup worker.
- **Database**: PostgreSQL 16 storing active inboxes and messages with automatic cascading expiry.

---

## Quick Start with Docker

The easiest way to run the entire stack locally:

```bash
# 1. Copy environment variables
cp .env.example .env

# Set POSTGRES_PASSWORD and both API secrets in .env before starting.
# 2. Start PostgreSQL, API, and Web frontend
docker compose up --build
```

- **Frontend**: [http://localhost:5173](http://localhost:5173)
- **API Server**: [http://localhost:3001](http://localhost:3001)

See [DOCKER_SETUP.md](DOCKER_SETUP.md) for PowerShell setup, environment settings, persistent storage, and troubleshooting. Stop with `docker compose down` to preserve database data.

Generate Address offers Work, School, or Personal styles, with optional validated usernames. These are address styles, not verified identities. Local `.test` domains are not publicly deliverable. See [ADDRESS_CATEGORIES.md](ADDRESS_CATEGORIES.md) for owned-domain settings, API compatibility, migration and test commands, and the separate DNS/MX/inbound delivery setup.

---

## Local Development (Without Docker)

### Prerequisites
- Node.js >= 20
- pnpm >= 9
- Running PostgreSQL instance (or `docker run --name pg -p 5432:5432 -e POSTGRES_PASSWORD=changeme -e POSTGRES_USER=inboxzero -e POSTGRES_DB=inboxzero postgres:16-alpine`)

### Install Dependencies
```bash
pnpm install
```

### Database Migration & Seeding
```bash
# Push migrations / generate schema
pnpm db:generate
pnpm db:migrate

# (Optional) Seed demo inbox
pnpm db:seed
```

### Start Development Servers
```bash
# Start both API and Web concurrently
pnpm dev
```

---

## Security Model

1. **Dual-Credential Authorization**: An inbox is addressed publicly by its `publicId`, but read/delete operations strictly require the `X-Access-Secret` issued once at generation time.
2. **Zero Storage of Raw Secrets**: The backend only stores PBKDF2 hashes of access secrets.
3. **HTML Sanitization**: All incoming HTML messages are cleaned via DOMPurify before persistence and displayed in sandboxed iframes.
4. **Auto-Expiring Ephemeral Storage**: Inboxes and messages are permanently purged once their TTL expires.

## Public deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for Vercel/Render configuration and the launch checklist, and [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for outstanding public-launch blockers.
