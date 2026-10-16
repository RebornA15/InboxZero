import { describe, it, expect, vi } from "vitest";
import { allocateAddress, createInboxSchema, resolveDomainConfiguration, usernameSchema } from "../src/lib/address-policy.js";
import type { AddressCandidate } from "../src/lib/address-policy.js";

const local = resolveDomainConfiguration({ NODE_ENV: "test" });
const production = {
  NODE_ENV: "production", OWNED_MAIL_DOMAINS: "owned-fixture.com",
  WORK_EMAIL_DOMAIN: "work.owned-fixture.com", SCHOOL_EMAIL_DOMAIN: "school.owned-fixture.com", PERSONAL_EMAIL_DOMAIN: "owned-fixture.com",
};

describe("address request validation", () => {
  it("defaults legacy empty requests to personal", () => expect(createInboxSchema.parse({})).toEqual({ category: "personal" }));
  it.each(["work", "school", "personal"])("accepts %s", category => expect(createInboxSchema.parse({ category }).category).toBe(category));
  it.each(["university", "WORK", null, 4])("rejects unknown category %s", category => expect(createInboxSchema.safeParse({ category }).success).toBe(false));
  it("normalizes usernames without requesting personal information", () => expect(usernameSchema.parse("  Guest.Name-7  ")).toBe("guest.name-7"));
  it.each(["ab", "a".repeat(33), "admin", "POST.MASTER", "no_reply", ".hello", "hello-", "two..dots", "hello@elsewhere.test", "has space", "école", "Kelvin", "<script>"])("rejects unsafe/reserved username %s", username => expect(usernameSchema.safeParse(username).success).toBe(false));
  it("rejects unknown fields instead of silently ignoring them", () => expect(createInboxSchema.safeParse({ employer: "Unused" }).success).toBe(false));
});

describe("domain configuration", () => {
  it("uses distinct reserved development domains", () => {
    expect(local.domains).toEqual({ work: "work.inboxzero.test", school: "school.inboxzero.test", personal: "inboxzero.test" });
  });
  it("normalizes declared owned domains and accepts controlled subdomains", () => {
    expect(resolveDomainConfiguration({ ...production, WORK_EMAIL_DOMAIN: " WORK.Owned-Fixture.com " }).domains.work).toBe("work.owned-fixture.com");
  });
  it.each([
    {}, { OWNED_MAIL_DOMAINS: "" }, { SCHOOL_EMAIL_DOMAIN: "" },
    { WORK_EMAIL_DOMAIN: "work.inboxzero.test" }, { PERSONAL_EMAIL_DOMAIN: "example.com", OWNED_MAIL_DOMAINS: "example.com" },
    { WORK_EMAIL_DOMAIN: "work.owned-fixture.com.attacker.com" }, { WORK_EMAIL_DOMAIN: "notowned-fixture.com" },
    { PERSONAL_EMAIL_DOMAIN: "https://owned-fixture.com" }, { SCHOOL_EMAIL_DOMAIN: "school..owned-fixture.com" },
    { SCHOOL_EMAIL_DOMAIN: "school.owned-fixture.com-" },
    { MAIL_DOMAINS: "uncontrolled-fixture.com" }, { CUSTOM_USERNAMES_ENABLED: "yes" },
  ])("rejects unsafe/missing production settings %j", override => {
    const env = Object.keys(override).length ? { ...production, ...override } : { NODE_ENV: "production" };
    expect(() => resolveDomainConfiguration(env)).toThrow();
  });
  it("does not issue on undeclared public domains in development either", () => expect(() => resolveDomainConfiguration({ WORK_EMAIL_DOMAIN: "work.uncontrolled-fixture.com" })).toThrow());
  it("preserves safe legacy domain clients without approving unowned public domains", () => {
    const legacy = resolveDomainConfiguration({ MAIL_DOMAINS: "inbox.example.com,uncontrolled-fixture.com" });
    expect(legacy.allowedDomains).toContain("inbox.example.com");
    expect(legacy.allowedDomains).not.toContain("uncontrolled-fixture.com");
  });
});

describe("atomic address allocation", () => {
  it("never generates an address or writes to storage in limited mode, including explicit legacy domains", async () => {
    const limited = resolveDomainConfiguration({ NODE_ENV: "production", EMAIL_GENERATION_ENABLED: "false" });
    const insert = vi.fn();
    for (const request of [{}, { category: "work" }, { category: "school", username: "guest" }, { domain: "inboxzero.test" }]) {
      await expect(allocateAddress(createInboxSchema.parse(request), limited, insert)).rejects.toMatchObject({ statusCode: 503, code: "EMAIL_GENERATION_DISABLED" });
    }
    expect(insert).not.toHaveBeenCalled();
  });
  it.each(["work", "school", "personal"] as const)("generates a secure %s address with category metadata", async category => {
    const candidate = await allocateAddress(createInboxSchema.parse({ category }), local, async value => value);
    expect(candidate.category).toBe(category);
    expect(candidate.domain).toBe(local.domains[category]);
    expect(candidate.localPart).toMatch(category === "work" ? /^contact\.[0-9a-f]{24}$/ : category === "school" ? /^student[0-9a-f]{24}$/ : /^[0-9a-f]{24}$/);
    expect(candidate.isCustomUsername).toBe(false);
  });
  it("retries generated collisions with new candidates", async () => {
    const insert = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockImplementation(async candidate => candidate);
    const random = vi.fn().mockReturnValueOnce("one").mockReturnValueOnce("two").mockReturnValue("three");
    expect((await allocateAddress<AddressCandidate>(createInboxSchema.parse({ category: "work" }), local, insert, random)).address).toBe("contact.three@work.inboxzero.test");
    expect(insert).toHaveBeenCalledTimes(3);
  });
  it("bounds collision retries", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    await expect(allocateAddress(createInboxSchema.parse({}), local, insert)).rejects.toMatchObject({ statusCode: 409 });
    expect(insert).toHaveBeenCalledTimes(5);
  });
  it("never silently changes a requested username on collision", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    await expect(allocateAddress(createInboxSchema.parse({ username: "guest" }), local, insert)).rejects.toMatchObject({ statusCode: 409 });
    expect(insert).toHaveBeenCalledTimes(1);
  });
  it("honors the username feature switch", async () => {
    const insert = vi.fn();
    await expect(allocateAddress(createInboxSchema.parse({ username: "guest" }), { ...local, customUsernamesEnabled: false }, insert)).rejects.toMatchObject({ statusCode: 400 });
    expect(insert).not.toHaveBeenCalled();
  });
  it.each([{ category: "school", domain: local.domains.work }, { category: "personal", domain: local.domains.school }, { domain: "uncontrolled-fixture.com" }])("rejects domain/category bypass %j", async request => {
    await expect(allocateAddress(createInboxSchema.parse(request), local, async value => value)).rejects.toMatchObject({ statusCode: 400 });
  });
  it("does not swallow database errors", async () => {
    await expect(allocateAddress(createInboxSchema.parse({}), local, async () => { throw new Error("database unavailable"); })).rejects.toThrow("database unavailable");
  });
});
