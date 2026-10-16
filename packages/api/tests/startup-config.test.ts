import { afterEach, describe, expect, it, vi } from "vitest";
import { checkStartupConfiguration, runConfigurationCheck } from "../src/check-config.js";

const runtime = {
  NODE_ENV: "production", DEMO_MODE: "true",
  DATABASE_URL: "postgresql://fixture:fixture-password@localhost/inboxzero", PGSSLMODE: "require",
  ACCESS_TOKEN_SECRET: "access-fixture-secret-".repeat(3), INGESTION_API_SECRET: "ingest-fixture-secret-".repeat(3),
  CORS_ORIGIN: "https://portfolio-fixture.vercel.app",
};
afterEach(() => vi.restoreAllMocks());

describe("actual startup configuration boundary", () => {
  it("accepts raw production environment strings with no mail-domain variables or extra flags", () => {
    const config = checkStartupConfiguration(runtime);
    expect(config.DEMO_MODE).toBe(true);
    expect(config.DOMAIN_CONFIG.demoMode).toBe(true);
    expect(config.DOMAIN_CONFIG.development).toBe(false);
    expect(config.INGESTION_ENABLED).toBe(false);
    expect(config.MAIL_DOMAINS).toEqual(["work.inboxzero.test", "school.inboxzero.test", "inboxzero.test"]);
  });
  it("reproduces the reported owned-domain error only with demo absent or disabled", () => {
    for (const flag of [undefined, "false"]) {
      expect(() => checkStartupConfiguration({ ...runtime, DEMO_MODE: flag })).toThrow("OWNED_MAIL_DOMAINS must declare");
    }
    for (const flag of ["TRUE", " true ", '"true"', "1", ""]) {
      expect(() => checkStartupConfiguration({ ...runtime, DEMO_MODE: flag })).toThrow();
    }
  });
  it.each([
    { EMAIL_GENERATION_ENABLED: "false" }, { INGESTION_ENABLED: "true" },
    { OWNED_MAIL_DOMAINS: "third-party-fixture.com" }, { MAIL_DOMAINS: "inboxzero.test" },
    { PERSONAL_EMAIL_DOMAIN: "third-party-fixture.com" }, { CORS_ORIGIN: "http://localhost:5173" },
    { ACCESS_TOKEN_SECRET: "" }, { INGESTION_API_SECRET: "" },
    { DATABASE_URL: "https://not-a-postgres-fixture.invalid" }, { PGSSLMODE: "disable" },
    { DATABASE_URL: runtime.DATABASE_URL + "?sslmode=disable" }, { PGSSLMODE: "prefer" },
  ])("rejects other runtime blockers without changing production protections %j", override => {
    expect(() => checkStartupConfiguration({ ...runtime, ...override })).toThrow();
  });
  it("reports only mode, revision, and field names without leaking secrets on success or failure", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runConfigurationCheck({ ...runtime, RENDER_GIT_COMMIT: "c5dd57c" })).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"mode":"demo-only"'));
    expect(runConfigurationCheck({ ...runtime, DATABASE_URL: "invalid:" + runtime.ACCESS_TOKEN_SECRET })).toBe(1);
    expect(runConfigurationCheck({ ...runtime, DATABASE_URL: "https://" + runtime.INGESTION_API_SECRET })).toBe(1);
    const output = JSON.stringify([log.mock.calls, error.mock.calls]);
    for (const secret of [runtime.DATABASE_URL, runtime.ACCESS_TOKEN_SECRET, runtime.INGESTION_API_SECRET, "fixture-password"]) expect(output).not.toContain(secret);
  });
});
