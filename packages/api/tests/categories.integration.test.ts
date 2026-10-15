import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { FastifyInstance } from "fastify";
import { hashSecret } from "../src/lib/crypto.js";

const testUrl = process.env["INBOX_TEST_DATABASE_URL"];
const legacySecret = "legacy-inbox-test-secret";
let app: FastifyInstance;
let pool: pg.Pool;
let origin: string;
let ip = 1;
const migrationsFolder = fileURLToPath(new URL("../src/db/migrations", import.meta.url));

describe.skipIf(!testUrl)("category API with isolated PostgreSQL", () => {
  beforeAll(async () => {
    if (!testUrl || !/^\/inboxzero_category_tests_[a-f0-9]+$/.test(new URL(testUrl).pathname)) {
      throw new Error("Use the integration harness; a fresh dedicated test database is required");
    }
    const setup = new pg.Pool({ connectionString: testUrl });
    try {
      const existing = await setup.query("SELECT to_regclass('public.inboxes') AS table_name");
      if (existing.rows[0].table_name) throw new Error("The test database must be fresh; no existing records will be erased");
      // Materialize the legacy schema and records before applying the new migration.
      await setup.query(await readFile(`${migrationsFolder}/0000_hot_living_lightning.sql`, "utf8"));
      const old = await setup.query("INSERT INTO inboxes (public_id,access_secret_hash,address,local_part,domain,expires_at,message_count) VALUES ($1,$2,$3,$4,$5,now()+interval '1 hour',1) RETURNING id", ["legacy-inbox", await hashSecret(legacySecret), "legacy@inboxzero.test", "legacy", "inboxzero.test"]);
      await setup.query("INSERT INTO messages (inbox_id,delivery_id,from_address,subject,text_body) VALUES ($1,'legacy-message','sender@inboxzero.test','Existing message','Preserved content')", [old.rows[0].id]);
      await migrate(drizzle(setup), { migrationsFolder });
      await migrate(drizzle(setup), { migrationsFolder }); // Reapplying is a no-op.
    } finally { await setup.end(); }

    Object.assign(process.env, {
      DATABASE_URL: testUrl, NODE_ENV: "test", MAIL_DOMAINS: "legacy.inboxzero.test",
      OWNED_MAIL_DOMAINS: "", WORK_EMAIL_DOMAIN: "work.inboxzero.test",
      SCHOOL_EMAIL_DOMAIN: "school.inboxzero.test", PERSONAL_EMAIL_DOMAIN: "inboxzero.test",
      CUSTOM_USERNAMES_ENABLED: "true", ACCESS_TOKEN_SECRET: "a".repeat(64), INGESTION_API_SECRET: "b".repeat(64),
      RATE_LIMIT_INBOX_CREATE_PER_HOUR: "2", RATE_LIMIT_API_PER_MINUTE: "10000", TRUST_PROXY: "false",
    });
    ({ pool } = await import("../src/db/index.js"));
    const { buildServer } = await import("../src/index.js");
    app = await buildServer();
    origin = await app.listen({ host: "127.0.0.1", port: 0 });
  }, 60000);

  afterAll(async () => { if (app) await app.close(); if (pool) await pool.end(); }, 15000);

  const post = (payload: object, remoteAddress = `192.0.2.${ip++}`) => app.inject({ method: "POST", url: "/api/inboxes", payload, remoteAddress });
  async function create(payload: object) {
    const response = await post(payload);
    expect(response.statusCode).toBe(201);
    return response.json();
  }
  const headers = (session: { accessSecret: string }) => ({ "x-access-secret": session.accessSecret });

  it("migrates legacy inboxes and messages without changing their credentials or address", async () => {
    const result = await app.inject({ url: "/api/inboxes/legacy-inbox", headers: { "x-access-secret": legacySecret } });
    expect(result.statusCode).toBe(200);
    expect(result.json().inbox).toMatchObject({ publicId: "legacy-inbox", address: "legacy@inboxzero.test", category: "personal", isCustomUsername: false, messageCount: 1 });
    const messages = await app.inject({ url: "/api/inboxes/legacy-inbox/messages", headers: { "x-access-secret": legacySecret } });
    expect(messages.json().messages[0].subject).toBe("Existing message");
    expect((await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(2);
  });

  it("exposes only public generation settings", async () => {
    const result = await app.inject({ url: "/api/inboxes/options" });
    expect(result.statusCode).toBe(200);
    expect(result.json().categories.map((value: { category: string }) => value.category)).toEqual(["work", "school", "personal"]);
    expect(Object.keys(result.json()).sort()).toEqual(["categories", "customUsernamesEnabled", "development"]);
  });

  it.each(["work", "school", "personal"])("persists %s and returns category metadata on create and read", async category => {
    const session = await create({ category });
    const stored = await pool.query("SELECT category,local_part,domain,is_custom_username,expires_at FROM inboxes WHERE public_id=$1", [session.inbox.publicId]);
    expect(stored.rows[0].category).toBe(category);
    expect(stored.rows[0].is_custom_username).toBe(false);
    expect(`${stored.rows[0].local_part}@${stored.rows[0].domain}`).toBe(session.inbox.address);
    expect(new Date(stored.rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());
    const read = await app.inject({ url: `/api/inboxes/${session.inbox.publicId}`, headers: headers(session) });
    expect(read.json().inbox.category).toBe(category);
    expect(read.json()).not.toHaveProperty("accessSecret");
  });

  it("supports empty legacy requests and safe configured legacy domains", async () => {
    expect((await create({})).inbox.category).toBe("personal");
    expect((await create({ domain: "legacy.inboxzero.test" })).inbox.address).toMatch(/@legacy\.inboxzero\.test$/);
    expect((await post({ domain: "not-configured.test" })).statusCode).toBe(400);
  });

  it.each([{ category: "university" }, { username: "admin" }, { username: "two..dots" }, { username: "a".repeat(33) }, { username: "x@evil.test" }])("validates real HTTP payload %j", async payload => {
    expect((await post(payload)).statusCode).toBe(400);
  });

  it("normalizes and atomically rejects duplicate custom names including simultaneous requests", async () => {
    const results = await Promise.all([post({ category: "work", username: " Concurrent.Name " }), post({ category: "work", username: "concurrent.name" })]);
    expect(results.map(result => result.statusCode).sort()).toEqual([201, 409]);
    const session = results.find(result => result.statusCode === 201)!.json();
    expect(session.inbox).toMatchObject({ address: "concurrent.name@work.inboxzero.test", isCustomUsername: true });
    expect((await pool.query("SELECT count(*)::int AS n FROM inboxes WHERE address=$1", [session.inbox.address])).rows[0].n).toBe(1);
  });

  it("enforces the per-IP creation limit without trusting spoofed proxy headers", async () => {
    expect((await post({}, "203.0.113.250")).statusCode).toBe(201);
    expect((await post({}, "203.0.113.250")).statusCode).toBe(201);
    const limited = await app.inject({ method: "POST", url: "/api/inboxes", remoteAddress: "203.0.113.250", headers: { "x-forwarded-for": "198.51.100.123" }, payload: {} });
    expect(limited.statusCode).toBe(429);
  });

  it("routes exact-recipient ingestion without leaking across categories and simulates every category", async () => {
    const work = await create({ category: "work", username: "routing-probe" });
    const school = await create({ category: "school", username: "routing-probe" });
    const personal = await create({ category: "personal", username: "routing-probe" });
    const ingestion = await app.inject({ method: "POST", url: "/api/ingest", headers: { "x-ingestion-secret": "b".repeat(64) }, payload: {
      recipient: school.inbox.address, from: "sender@inboxzero.test", subject: "School-only", textBody: "Exact recipient", deliveryId: "routing-probe", sizeBytes: 20,
    } });
    expect(ingestion.statusCode).toBe(201);
    for (const session of [work, school, personal]) {
      const list = await app.inject({ url: `/api/inboxes/${session.inbox.publicId}/messages`, headers: headers(session) });
      expect(list.json().messages).toHaveLength(session === school ? 1 : 0);
      const simulated = await app.inject({ method: "POST", url: `/api/inboxes/${session.inbox.publicId}/simulate`, headers: headers(session), payload: {} });
      expect(simulated.statusCode).toBe(201);
      const detail = await app.inject({ url: `/api/inboxes/${session.inbox.publicId}/messages/${simulated.json().messageId}`, headers: headers(session) });
      expect(detail.json().message.textBody).toContain(session.inbox.address);
    }
    const wrongInbox = await app.inject({ url: `/api/inboxes/${work.inbox.publicId}/messages/${ingestion.json().messageId}`, headers: headers(work) });
    expect(wrongInbox.statusCode).toBe(404);
  });

  it("preserves authenticated SSE new-message and deletion events", async () => {
    const session = await create({ category: "school" });
    const controller = new AbortController();
    const response = await fetch(`${origin}/api/inboxes/${session.inbox.publicId}/events`, { headers: headers(session), signal: controller.signal });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      expect(new TextDecoder().decode((await reader.read()).value)).toContain(": ping");
      const simulated = await app.inject({ method: "POST", url: `/api/inboxes/${session.inbox.publicId}/simulate`, headers: headers(session), payload: {} });
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: message:new");
      const deleted = await app.inject({ method: "DELETE", url: `/api/inboxes/${session.inbox.publicId}/messages/${simulated.json().messageId}`, headers: headers(session) });
      expect(deleted.statusCode).toBe(204);
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: message:deleted");
    } finally { clearTimeout(timeout); controller.abort(); await reader.cancel().catch(() => {}); }
  }, 15000);

  it.each(["work", "school", "personal"])("expires %s inboxes and prevents reads, simulation, ingestion, or username reassignment", async category => {
    const session = await create({ category, username: `expired-${category}` });
    const initialMessage = await app.inject({ method: "POST", url: `/api/inboxes/${session.inbox.publicId}/simulate`, headers: headers(session), payload: {} });
    expect(initialMessage.statusCode).toBe(201);
    const expired = new Date(Date.now() - 60000);
    await pool.query("UPDATE inboxes SET expires_at=$1 WHERE public_id=$2", [expired, session.inbox.publicId]);
    const read = await app.inject({ url: `/api/inboxes/${session.inbox.publicId}`, headers: headers(session) });
    expect(read.statusCode).toBe(410);
    const simulated = await app.inject({ method: "POST", url: `/api/inboxes/${session.inbox.publicId}/simulate`, headers: headers(session), payload: {} });
    expect(simulated.statusCode).toBe(410);
    const delivery = await app.inject({ method: "POST", url: "/api/ingest", headers: { "x-ingestion-secret": "b".repeat(64) }, payload: { recipient: session.inbox.address, from: "sender@inboxzero.test", deliveryId: `expired-delivery-${category}`, sizeBytes: 1 } });
    expect(delivery.statusCode).toBe(410);
    const { runCleanup } = await import("../src/lib/cleanup.js");
    await runCleanup();
    expect((await pool.query("SELECT status FROM inboxes WHERE public_id=$1", [session.inbox.publicId])).rows[0].status).toBe("expired");
    expect((await pool.query("SELECT count(*)::int AS n FROM messages m JOIN inboxes i ON m.inbox_id=i.id WHERE i.public_id=$1", [session.inbox.publicId])).rows[0].n).toBe(0);
    expect((await post({ category, username: `expired-${category}` })).statusCode).toBe(409);
  });
});
