import { afterEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { databaseConnection, databaseCredentials, databaseTlsSummary } from "../src/db/connection.js";

const internal = { NODE_ENV: "production", RENDER: "true", DATABASE_URL: "postgresql://fixture:fixture@dpg-fixture-a/inboxzero" };
afterEach(() => vi.unstubAllEnvs());
describe("PostgreSQL TLS policy", () => {
  it("does not force TLS on a trusted Render internal endpoint", () => {
    const options = databaseConnection(internal);
    expect(options.ssl).toBe(false);
    expect(new pg.Client(options).ssl).toBe(false);
    expect(databaseCredentials(internal).ssl).toBe(false);
    expect(databaseTlsSummary(internal)).toEqual({ endpoint: "render-internal", sslMode: "disable", encrypted: false, certificateVerification: false });
  });
  it.each([
    { RENDER: undefined }, { RENDER: "false" },
    { DATABASE_URL: "postgresql://fixture:fixture@dpg-fixture-a.virginia-postgres.render.com/inboxzero" },
    { DATABASE_URL: "postgresql://fixture:fixture@dpg-fixture-a.attacker.invalid/inboxzero" },
    { DATABASE_URL: "postgresql://fixture:fixture@external-fixture.invalid/inboxzero" },
    { DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1/inboxzero" },
  ])("does not infer an internal certificate exception for %j", override => {
    expect(databaseConnection({ ...internal, ...override }).ssl).toMatchObject({ rejectUnauthorized: true });
  });
  it("preserves explicit verified TLS and rejects conflicting URL/environment settings", () => {
    expect(databaseConnection({ ...internal, PGSSLMODE: "verify-full" }).ssl).toMatchObject({ rejectUnauthorized: true });
    expect(() => databaseConnection({ ...internal, PGSSLMODE: "require", DATABASE_URL: internal.DATABASE_URL + "?sslmode=verify-full" })).toThrow("Conflicting");
    expect(() => databaseConnection({ ...internal, DATABASE_URL: internal.DATABASE_URL + "?sslmode=require&sslmode=verify-full" })).toThrow("single");
    expect(databaseConnection({ ...internal, PGSSLMODE: "disable" }).ssl).toBe(false);
    expect(() => databaseConnection({ ...internal, DATABASE_URL: internal.DATABASE_URL + "?host=external-fixture.invalid" })).toThrow("query overrides");
  });
  it("permits plaintext only on the trusted private endpoint in production", () => {
    for (const env of [{ ...internal, RENDER: undefined }, { ...internal, DATABASE_URL: "postgresql://fixture:fixture@dpg-fixture-a.virginia-postgres.render.com/inboxzero" }]) {
      expect(() => databaseConnection({ ...env, PGSSLMODE: "disable" })).toThrow("require TLS");
    }
    const options = databaseConnection({ ...internal, DATABASE_URL: internal.DATABASE_URL + "?sslmode=disable" });
    expect(options.connectionString).not.toContain("sslmode");
    expect(new pg.Client(options).ssl).toBe(false);
    expect(databaseConnection({ ...internal, PGSSLMODE: "require" }).ssl).toMatchObject({ rejectUnauthorized: false, minVersion: "TLSv1.2" });
  });
  it("does not let explicit require disable verification for external production connections", () => {
    for (const host of ["dpg-fixture-a.virginia-postgres.render.com", "external-fixture.invalid"]) {
      expect(() => databaseConnection({ ...internal, DATABASE_URL: `postgresql://fixture:fixture@${host}/inboxzero`, PGSSLMODE: "require" })).toThrow("verify-full");
      expect(databaseConnection({ ...internal, DATABASE_URL: `postgresql://fixture:fixture@${host}/inboxzero`, PGSSLMODE: "verify-full" }).ssl).toMatchObject({ rejectUnauthorized: true });
    }
  });
  it("strips URL TLS parameters so the real pg client cannot overwrite the explicit TLS object", () => {
    const options = databaseConnection({ ...internal, PGSSLMODE: "require", DATABASE_URL: internal.DATABASE_URL + "?sslmode=require&application_name=inboxzero" });
    expect(options.connectionString).not.toContain("sslmode");
    expect(options.connectionString).toContain("application_name=inboxzero");
    const client = new pg.Client(options);
    expect(client.ssl).toMatchObject({ rejectUnauthorized: false, minVersion: "TLSv1.2" });
  });
  it("gives Drizzle Kit the same TLS policy and correctly decodes credentials", () => {
    const env = { ...internal, DATABASE_URL: "postgresql://fixture%40user:fixture%2Fpassword@dpg-fixture-a:5432/inbox%20zero?sslmode=require" };
    const credentials = databaseCredentials(env);
    expect(credentials).toMatchObject({ host: "dpg-fixture-a", port: 5432, user: "fixture@user", password: "fixture/password", database: "inbox zero" });
    expect(credentials.ssl).toEqual(databaseConnection(env).ssl);
    expect(new pg.Client(credentials).ssl).toEqual(new pg.Client(databaseConnection(env)).ssl);
  });
  it("loads the actual Drizzle Kit config without forcing internal TLS", async () => {
    for (const [key, value] of Object.entries(internal)) vi.stubEnv(key, value);
    vi.stubEnv("PGSSLMODE", undefined);
    const { default: config } = await import("../drizzle.config.ts");
    expect(config.dbCredentials).toMatchObject({ host: "dpg-fixture-a", ssl: false });
  });
  it("retains local Docker plaintext defaults without changing global TLS settings", () => {
    const before = process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
    expect(databaseConnection({ DATABASE_URL: "postgresql://fixture:fixture@postgres/inboxzero" }).ssl).toBe(false);
    databaseConnection(internal);
    expect(process.env["NODE_TLS_REJECT_UNAUTHORIZED"]).toBe(before);
  });
});
