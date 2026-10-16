import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { databaseConnection } from "../src/db/connection.js";
import { configSchema } from "../src/config.js";

const production = {
  NODE_ENV: "production", DEMO_MODE: "false", DATABASE_URL: "postgresql://user:password@localhost/inboxzero",
  ACCESS_TOKEN_SECRET: "a".repeat(64), INGESTION_API_SECRET: "b".repeat(64),
  OWNED_MAIL_DOMAINS: "owned-fixture.com", WORK_EMAIL_DOMAIN: "work.owned-fixture.com",
  SCHOOL_EMAIL_DOMAIN: "school.owned-fixture.com", PERSONAL_EMAIL_DOMAIN: "owned-fixture.com",
  MAIL_DOMAINS: "", CORS_ORIGIN: "https://inboxzero.vercel.app", TRUST_PROXY: "1",
};

describe("production configuration", () => {
  const limited = { ...production, EMAIL_GENERATION_ENABLED: "false", OWNED_MAIL_DOMAINS: "", WORK_EMAIL_DOMAIN: "", SCHOOL_EMAIL_DOMAIN: "", PERSONAL_EMAIL_DOMAIN: "" };
  it("allows explicit limited production mode without domains, retaining all other security checks", () => {
    const config = configSchema.parse(limited);
    expect(config.DOMAIN_CONFIG.domains).toEqual({});
    expect(config.MAIL_DOMAINS).toEqual([]);
    expect(config.INGESTION_ENABLED).toBe(false);
    expect(configSchema.safeParse({ ...limited, INGESTION_ENABLED: "true" }).success).toBe(false);
    expect(configSchema.safeParse({ ...limited, EMAIL_GENERATION_ENABLED: "true" }).success).toBe(false);
    expect(configSchema.safeParse({ ...limited, EMAIL_GENERATION_ENABLED: "yes" }).success).toBe(false);
    expect(configSchema.parse({ ...production, EMAIL_GENERATION_ENABLED: "true" }).DOMAIN_CONFIG.generationEnabled).toBe(true);
    for (const key of ["DATABASE_URL", "ACCESS_TOKEN_SECRET", "INGESTION_API_SECRET", "CORS_ORIGIN"]) {
      expect(configSchema.safeParse({ ...limited, [key]: "" }).success).toBe(false);
    }
    for (const key of ["OWNED_MAIL_DOMAINS", "WORK_EMAIL_DOMAIN", "SCHOOL_EMAIL_DOMAIN", "PERSONAL_EMAIL_DOMAIN", "MAIL_DOMAINS"]) {
      for (const domain of ["inboxzero.test", "example.com", "uncontrolled-fixture.com"]) {
        expect(configSchema.safeParse({ ...limited, [key]: domain }).success).toBe(false);
      }
    }
  });
  it("requires exact HTTPS origins and rejects test domains", () => {
    expect(configSchema.safeParse(production).success).toBe(true);
    for (const origin of ["*", "https://*.vercel.app", "http://localhost:5173", "https://inboxzero.vercel.app/path", ""]) {
      expect(configSchema.safeParse({ ...production, CORS_ORIGIN: origin }).success).toBe(false);
    }
    expect(configSchema.safeParse({ ...production, PERSONAL_EMAIL_DOMAIN: "inboxzero.test" }).success).toBe(false);
    expect(configSchema.parse(production).INGESTION_ENABLED).toBe(false);
    expect(configSchema.parse(production).TRUST_PROXY).toBe(1);
  });
  it("verifies production TLS by default and requires opt-in for internal self-signed TLS", () => {
    expect(databaseConnection(production).ssl).toMatchObject({ rejectUnauthorized: true });
    expect(databaseConnection({ ...production, PGSSLMODE: "require" }).ssl).toMatchObject({ rejectUnauthorized: false });
    expect(databaseConnection({ DATABASE_URL: production.DATABASE_URL }).ssl).toBe(false);
    expect(() => databaseConnection({ ...production, PGSSLMODE: "disable" })).toThrow("require TLS");
    expect(() => databaseConnection({ ...production, DATABASE_URL: production.DATABASE_URL + "?sslmode=disable", PGSSLMODE: "require" })).toThrow();
    expect(() => databaseConnection({ ...production, DATABASE_URL: production.DATABASE_URL + "?ssl=false" })).toThrow();
  });
});

describe("public API boundaries without database access", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    for (const [key, value] of Object.entries(production)) vi.stubEnv(key, value);
    vi.stubEnv("INGESTION_ENABLED", "false");
    vi.stubEnv("RATE_LIMIT_API_PER_MINUTE", "3");
    const { buildServer } = await import("../src/index.js");
    app = await buildServer();
  });
  afterAll(async () => {
    await app?.close();
    const { pool } = await import("../src/db/index.js");
    await pool.end();
    vi.unstubAllEnvs();
  });
  it("permits the explicit frontend preflight and omits CORS for other origins", async () => {
    const headers = { origin: production.CORS_ORIGIN, "access-control-request-method": "GET", "access-control-request-headers": "x-access-secret" };
    const allowed = await app.inject({ method: "OPTIONS", url: "/api/inboxes/x/events", headers });
    expect(allowed.headers["access-control-allow-origin"]).toBe(production.CORS_ORIGIN);
    const denied = await app.inject({ url: "/api/inboxes/options", headers: { origin: "https://attacker.example" } });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    expect(denied.headers["cache-control"]).toBe("no-store");
  });
  it("disables simulation and ingestion before reaching the database", async () => {
    expect((await app.inject({ method: "POST", url: "/api/inboxes/x/simulate", remoteAddress: "192.0.2.2", payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/ingest", remoteAddress: "192.0.2.3", payload: {} })).statusCode).toBe(404);
  });
  it("requires an access secret for metadata, message bodies, deletion, and SSE", async () => {
    let client = 10;
    for (const [method, url] of [["GET", "/api/inboxes/x"], ["GET", "/api/inboxes/x/messages"], ["GET", "/api/inboxes/x/messages/1"], ["DELETE", "/api/inboxes/x/messages/1"], ["GET", "/api/inboxes/x/events"]] as const) {
      const response = await app.inject({ method, url, remoteAddress: `192.0.2.${client++}` });
      expect(response.statusCode).toBe(401);
      expect(response.body).not.toContain("stack");
    }
  });
  it("returns 429 and cannot bypass a one-hop proxy limit with forged prefix IPs", async () => {
    for (let i = 0; i < 3; i++) {
      const response = await app.inject({ url: "/api/inboxes/options", remoteAddress: "127.0.0.1", headers: { "x-forwarded-for": `198.51.100.${i}, 203.0.113.42` } });
      expect(response.statusCode).toBe(200);
    }
    const limited = await app.inject({ url: "/api/inboxes/options", remoteAddress: "127.0.0.1", headers: { "x-forwarded-for": "198.51.100.200, 203.0.113.42" } });
    expect(limited.statusCode).toBe(429);
  });
});
