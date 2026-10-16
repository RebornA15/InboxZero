import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { databaseConnection } from "../src/db/connection.js";

const testUrl = process.env["INBOX_DEMO_DATABASE_URL"];
describe.skipIf(!testUrl)("production demo with isolated PostgreSQL", () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let client = 1;
  const request = (method: "GET" | "POST", url: string, secret?: string, payload?: object) => app.inject({
    method, url, remoteAddress: `192.0.2.${client++}`, ...(secret ? { headers: { "x-access-secret": secret } } : {}), ...(payload ? { payload } : {}),
  });
  let work: { accessSecret: string; inbox: { publicId: string; address: string } };
  let personal: typeof work;
  beforeAll(async () => {
    if (!testUrl || !/^\/inboxzero_demo_tests_[a-f0-9]+$/.test(new URL(testUrl).pathname)) throw new Error("A dedicated migrated inboxzero_demo_tests_<random hex> database is required");
    for (const [key, value] of Object.entries({
      NODE_ENV: "production", DEMO_MODE: "true", EMAIL_GENERATION_ENABLED: "true", INGESTION_ENABLED: "false",
      DATABASE_URL: testUrl, ACCESS_TOKEN_SECRET: "a".repeat(64), INGESTION_API_SECRET: "b".repeat(64),
      CORS_ORIGIN: "https://portfolio-fixture.vercel.app", OWNED_MAIL_DOMAINS: "", MAIL_DOMAINS: "",
      WORK_EMAIL_DOMAIN: "", SCHOOL_EMAIL_DOMAIN: "", PERSONAL_EMAIL_DOMAIN: "",
      RATE_LIMIT_API_PER_MINUTE: "1000", RATE_LIMIT_INBOX_CREATE_PER_HOUR: "10", TRUST_PROXY: "false",
    })) vi.stubEnv(key, value);
    pool = new pg.Pool(databaseConnection());
    const { buildServer } = await import("../src/index.js");
    app = await buildServer();
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await pool?.end();
    const api = await import("../src/db/index.js");
    await api.pool.end();
    vi.unstubAllEnvs();
  });
  it("starts healthy, labels demo capabilities, and preserves every category and expiration", async () => {
    expect((await request("GET", "/api/health")).statusCode).toBe(200);
    const { runCleanup } = await import("../src/lib/cleanup.js");
    expect(await runCleanup()).toEqual({ expiredInboxes: 0, deletedMessages: 0 });
    const options = (await request("GET", "/api/inboxes/options")).json();
    expect(options).toMatchObject({ demoMode: true, development: false, simulationEnabled: true });
    expect(options.deliveryNotice).toContain("DEMO ONLY");
    for (const category of ["work", "school", "personal"]) {
      const response = await request("POST", "/api/inboxes", undefined, { category });
      expect(response.statusCode).toBe(201);
      const session = response.json();
      expect(session.inbox).toMatchObject({ category, demoOnly: true });
      expect(session.inbox.address).toMatch(/@(?:work\.|school\.)?inboxzero\.test$/);
      expect(new Date(session.inbox.expiresAt).getTime()).toBeGreaterThan(Date.now());
      if (category === "work") work = session;
      if (category === "personal") personal = session;
    }
  });
  it("requires the matching inbox access secret, never the ingestion secret", async () => {
    for (const secret of [undefined, personal.accessSecret, "b".repeat(64)]) {
      const response = await request("POST", `/api/inboxes/${work.inbox.publicId}/simulate`, secret, {});
      expect(response.statusCode).toBe(401);
    }
    expect((await request("GET", `/api/inboxes/${work.inbox.publicId}/messages`, personal.accessSecret)).statusCode).toBe(401);
    const messages = await request("GET", `/api/inboxes/${work.inbox.publicId}/messages`, work.accessSecret);
    expect(messages.json().messages).toHaveLength(0);
  });
  it("only creates a clearly labeled fixed sample for its authenticated inbox", async () => {
    const url = `/api/inboxes/${work.inbox.publicId}/simulate`;
    expect((await request("POST", url, work.accessSecret, { recipient: personal.inbox.address, htmlBody: "injected" })).statusCode).toBe(400);
    const response = await request("POST", url, work.accessSecret, { subject: "pretend real email" });
    expect(response.statusCode).toBe(201);
    const detail = await request("GET", `/api/inboxes/${work.inbox.publicId}/messages/${response.json().messageId}`, work.accessSecret);
    expect(detail.json().message.subject).toMatch(/^\[DEMO\]/);
    expect(detail.json().message.textBody).toContain("No external email was received");
    expect((await request("GET", `/api/inboxes/${personal.inbox.publicId}/messages`, personal.accessSecret)).json().messages).toHaveLength(0);
    expect((await request("GET", `/api/inboxes/${personal.inbox.publicId}/messages/${response.json().messageId}`, personal.accessSecret)).statusCode).toBe(404);
  });
  it("never exposes ingestion, even with its correct secret, and rate limits simulation", async () => {
    expect((await app.inject({ method: "POST", url: "/api/ingest", headers: { "x-ingestion-secret": "b".repeat(64) }, payload: {} })).statusCode).toBe(404);
    for (let i = 0; i < 10; i++) {
      expect((await app.inject({ method: "POST", url: `/api/inboxes/${personal.inbox.publicId}/simulate`, remoteAddress: "198.51.100.1", headers: { "x-access-secret": personal.accessSecret }, payload: {} })).statusCode).toBe(201);
    }
    expect((await app.inject({ method: "POST", url: `/api/inboxes/${personal.inbox.publicId}/simulate`, remoteAddress: "198.51.100.1", headers: { "x-access-secret": personal.accessSecret }, payload: {} })).statusCode).toBe(429);
  });
  it("retains expired/full-inbox protection and cannot simulate into a stored real-domain inbox", async () => {
    await pool.query("UPDATE inboxes SET message_count=50 WHERE public_id=$1", [work.inbox.publicId]);
    const url = `/api/inboxes/${work.inbox.publicId}/simulate`;
    expect((await request("POST", url, work.accessSecret, {})).statusCode).toBe(422);
    await pool.query("UPDATE inboxes SET message_count=0,address='legacy@uncontrolled-fixture.com' WHERE public_id=$1", [work.inbox.publicId]);
    expect((await request("POST", url, work.accessSecret, {})).statusCode).toBe(403);
    await pool.query("UPDATE inboxes SET address=$2,expires_at=now()-interval '1 minute' WHERE public_id=$1", [work.inbox.publicId, work.inbox.address]);
    expect((await request("POST", url, work.accessSecret, {})).statusCode).toBe(410);
  });
});
