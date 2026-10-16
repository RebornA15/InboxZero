import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const database = vi.hoisted(() => ({
  connect: vi.fn().mockResolvedValue({ query: vi.fn().mockResolvedValue({}), release: vi.fn() }),
  insert: vi.fn(),
}));
vi.mock("../src/db/index.js", () => ({ pool: { connect: database.connect }, db: { insert: database.insert } }));

describe("limited production API", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    for (const [key, value] of Object.entries({
      NODE_ENV: "production", DEMO_MODE: "false", EMAIL_GENERATION_ENABLED: "false", INGESTION_ENABLED: "false",
      DATABASE_URL: "postgresql://user:password@localhost/inboxzero",
      ACCESS_TOKEN_SECRET: "a".repeat(64), INGESTION_API_SECRET: "b".repeat(64),
      OWNED_MAIL_DOMAINS: "", WORK_EMAIL_DOMAIN: "", SCHOOL_EMAIL_DOMAIN: "", PERSONAL_EMAIL_DOMAIN: "", MAIL_DOMAINS: "",
      CORS_ORIGIN: "https://frontend-fixture.invalid", RATE_LIMIT_API_PER_MINUTE: "60",
    })) vi.stubEnv(key, value);
    const { buildServer } = await import("../src/index.js");
    app = await buildServer();
  });
  afterAll(async () => { await app?.close(); vi.unstubAllEnvs(); });

  it("advertises no addresses and rejects creation before storage access", async () => {
    const options = await app.inject({ url: "/api/inboxes/options" });
    expect(options.statusCode).toBe(200);
    expect(options.json()).toMatchObject({ categories: [], emailGenerationEnabled: false, customUsernamesEnabled: false, development: false });
    for (const payload of [{}, { category: "work" }, { category: "personal", domain: "inboxzero.test" }]) {
      const response = await app.inject({ method: "POST", url: "/api/inboxes", payload });
      expect(response.statusCode).toBe(503);
      expect(response.json().code).toBe("EMAIL_GENERATION_DISABLED");
    }
    expect(database.insert).not.toHaveBeenCalled();
    expect(database.connect).not.toHaveBeenCalled();
  });
  it("retains database readiness checks and reports database outages", async () => {
    expect((await app.inject({ url: "/api/health" })).statusCode).toBe(200);
    database.connect.mockRejectedValueOnce(new Error("database unavailable"));
    expect((await app.inject({ url: "/api/health" })).statusCode).toBe(503);
  });
  it("keeps ingestion and simulation disabled and inbox authentication required", async () => {
    expect((await app.inject({ method: "POST", url: "/api/ingest", payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/inboxes/x/simulate", payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/inboxes/x" })).statusCode).toBe(401);
  });
});
