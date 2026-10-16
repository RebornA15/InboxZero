import { describe, expect, it, vi } from "vitest";
import { configSchema } from "../src/config.js";
import { allocateAddress, createInboxSchema } from "../src/lib/address-policy.js";

const demo = {
  NODE_ENV: "production", DEMO_MODE: "true", EMAIL_GENERATION_ENABLED: "true",
  DATABASE_URL: "postgresql://fixture:fixture@localhost/inboxzero",
  ACCESS_TOKEN_SECRET: "a".repeat(64), INGESTION_API_SECRET: "b".repeat(64),
  CORS_ORIGIN: "https://portfolio-fixture.vercel.app", INGESTION_ENABLED: "false",
};

describe("explicit production demo configuration", () => {
  it("uses only fixed reserved domains with external ingestion disabled", () => {
    const config = configSchema.parse(demo);
    expect(config.DEMO_MODE).toBe(true);
    expect(config.DOMAIN_CONFIG.development).toBe(false);
    expect(config.INGESTION_ENABLED).toBe(false);
    expect(config.MAIL_DOMAINS).toEqual(["work.inboxzero.test", "school.inboxzero.test", "inboxzero.test"]);
    expect(configSchema.parse({ ...demo, INGESTION_ENABLED: undefined }).INGESTION_ENABLED).toBe(false);
    expect(configSchema.parse({ ...demo, NODE_ENV: "development", INGESTION_ENABLED: undefined }).INGESTION_ENABLED).toBe(false);
  });
  it.each([
    { DEMO_MODE: "yes" }, { DEMO_MODE: "TRUE" }, { DEMO_MODE: "" },
    { INGESTION_ENABLED: "true" }, { EMAIL_GENERATION_ENABLED: "false" },
    { OWNED_MAIL_DOMAINS: "uncontrolled-fixture.com" }, { MAIL_DOMAINS: "inboxzero.test" },
    { WORK_EMAIL_DOMAIN: "work.uncontrolled-fixture.com" }, { PERSONAL_EMAIL_DOMAIN: "elsewhere.test" },
    { SCHOOL_EMAIL_DOMAIN: "school.example.com" }, { ACCESS_TOKEN_SECRET: "" }, { INGESTION_API_SECRET: "" },
    { CORS_ORIGIN: "*" }, { CORS_ORIGIN: "http://localhost:5173" }, { DATABASE_URL: "" },
  ])("rejects unsafe demo configuration %j", override => {
    expect(configSchema.safeParse({ ...demo, ...override }).success).toBe(false);
  });
  it("retains owned-domain requirements outside demo mode", () => {
    expect(configSchema.safeParse({ ...demo, DEMO_MODE: "false" }).success).toBe(false);
    expect(configSchema.safeParse({ ...demo, DEMO_MODE: undefined }).success).toBe(false);
  });
  it.each(["work", "school", "personal"] as const)("allocates a non-deliverable %s address and rejects real-domain overrides", async category => {
    const config = configSchema.parse(demo).DOMAIN_CONFIG;
    const result = await allocateAddress(createInboxSchema.parse({ category }), config, async candidate => candidate);
    expect(result.domain).toBe(config.domains[category]);
    expect(result.address).toMatch(/@(?:work\.|school\.)?inboxzero\.test$/);
    const insert = vi.fn();
    await expect(allocateAddress(createInboxSchema.parse({ category, domain: "uncontrolled-fixture.com" }), config, insert)).rejects.toMatchObject({ statusCode: 400 });
    expect(insert).not.toHaveBeenCalled();
  });
});
