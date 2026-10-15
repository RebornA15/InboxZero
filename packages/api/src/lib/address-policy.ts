import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Errors } from "./errors.js";

export const inboxCategories = ["work", "school", "personal"] as const;
export type InboxCategory = (typeof inboxCategories)[number];
export const categoryLabels: Record<InboxCategory, string> = {
  work: "Work Email", school: "School Email", personal: "Personal Email",
};

const reservedNames = new Set([
  "admin", "administrator", "root", "system", "postmaster", "hostmaster",
  "webmaster", "abuse", "security", "support", "help", "info", "mail", "email",
  "noreply", "no-reply", "donotreply", "billing", "privacy", "staff", "www",
  "smtp", "imap", "pop3", "autoconfig", "autodiscover",
]);

export const usernameSchema = z.string().trim().regex(/^[\x00-\x7F]*$/, "Use ASCII letters and numbers")
  .transform(value => value.toLowerCase())
  .pipe(z.string().min(3, "Use at least 3 characters").max(32, "Use at most 32 characters")
    .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, "Use letters, numbers, and single dots, hyphens or underscores between them")
    .refine(value => !reservedNames.has(value.replace(/[._-]/g, "")) && !reservedNames.has(value), "This username is reserved"));

export const createInboxSchema = z.object({
  category: z.enum(inboxCategories).default("personal"),
  username: usernameSchema.optional(),
  // Retained for legacy API clients, but only configured/owned domains are accepted.
  domain: z.string().trim().toLowerCase().optional(),
}).strict();

export interface DomainConfiguration {
  domains: Record<InboxCategory, string>;
  allowedDomains: string[];
  legacyDomains: string[];
  customUsernamesEnabled: boolean;
  development: boolean;
}

function normalizeDomain(value: string): string {
  const domain = value.trim().toLowerCase();
  if (domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) {
    throw new Error(`Invalid mail domain: ${domain}`);
  }
  return domain;
}

function isReservedDomain(domain: string): boolean {
  return /\.(test|invalid|example|localhost)$/.test(domain) ||
    ["example.com", "example.net", "example.org"].some(root => domain === root || domain.endsWith(`.${root}`));
}

export function resolveDomainConfiguration(env: Record<string, unknown>): DomainConfiguration {
  const read = (key: string) => typeof env[key] === "string" ? env[key].trim() : "";
  const development = read("NODE_ENV") !== "production";
  const owned = read("OWNED_MAIL_DOMAINS").split(",").filter(Boolean).map(normalizeDomain);
  const controlled = (domain: string) => owned.some(root => domain === root || domain.endsWith(`.${root}`));
  if (!development && owned.length === 0) throw new Error("OWNED_MAIL_DOMAINS must declare domains controlled by InboxZero in production");

  const domains = {} as Record<InboxCategory, string>;
  for (const category of inboxCategories) {
    const key = `${category.toUpperCase()}_EMAIL_DOMAIN`;
    const configured = read(key);
    if (!configured && !development) throw new Error(`${key} is required in production`);
    const domain = normalizeDomain(configured || (category === "personal" ? "inboxzero.test" : `${category}.inboxzero.test`));
    if (domain.length > 221) throw new Error(`${key} must leave room for a 32-character username`);
    if ((!development && isReservedDomain(domain)) || (!isReservedDomain(domain) && !controlled(domain))) {
      throw new Error(`${key} must be a non-placeholder domain under OWNED_MAIL_DOMAINS (reserved test domains are development-only)`);
    }
    domains[category] = domain;
  }

  const legacy = read("MAIL_DOMAINS").split(",").filter(Boolean).map(normalizeDomain);
  if (!development && legacy.some(domain => isReservedDomain(domain) || !controlled(domain))) {
    throw new Error("Every legacy MAIL_DOMAINS entry must be owned and non-placeholder in production");
  }
  // Do not issue new addresses on unverified legacy public domains. Existing inboxes
  // remain readable and ingestion still resolves their exact stored address.
  const approvedLegacy = legacy.filter(domain => controlled(domain) || (development && isReservedDomain(domain)));
  const flag = read("CUSTOM_USERNAMES_ENABLED") || "true";
  if (flag !== "true" && flag !== "false") throw new Error("CUSTOM_USERNAMES_ENABLED must be true or false");
  return { domains, allowedDomains: [...new Set([...Object.values(domains), ...approvedLegacy])], legacyDomains: approvedLegacy, customUsernamesEnabled: flag === "true", development };
}

export interface AddressCandidate {
  category: InboxCategory;
  localPart: string;
  domain: string;
  address: string;
  isCustomUsername: boolean;
}

export function addressDomain(input: z.infer<typeof createInboxSchema>, configuration: DomainConfiguration): string {
  if (!input.domain) return configuration.domains[input.category];
  if (!configuration.allowedDomains.includes(input.domain)) throw Errors.badRequest("Domain is not available");
  if (input.domain !== configuration.domains[input.category] &&
      !(input.category === "personal" && configuration.legacyDomains.includes(input.domain) && ![configuration.domains.work, configuration.domains.school].includes(input.domain))) {
    throw Errors.badRequest("Domain does not match the selected category");
  }
  return input.domain;
}

// The repository callback must atomically reserve the address and return undefined
// on a unique conflict. Never check then insert: concurrent requests can race.
export async function allocateAddress<T>(
  input: z.infer<typeof createInboxSchema>,
  configuration: DomainConfiguration,
  insert: (candidate: AddressCandidate) => Promise<T | undefined>,
  random: () => string = () => randomBytes(12).toString("hex"),
): Promise<T> {
  if (input.username && !configuration.customUsernamesEnabled) throw Errors.badRequest("Custom usernames are disabled");
  const domain = addressDomain(input, configuration);
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = input.username ? "" : random();
    const localPart = input.username ?? (input.category === "work" ? `contact.${token}` : input.category === "school" ? `student${token}` : token);
    const address = `${localPart}@${domain}`;
    if (address.length > 254) throw Errors.badRequest("Configured domain is too long for this address");
    const result = await insert({ category: input.category, localPart, domain, address, isCustomUsername: Boolean(input.username) });
    if (result !== undefined) return result;
    if (input.username) throw Errors.conflict("This username is unavailable. Choose another username or leave it blank.");
  }
  throw Errors.conflict("Could not allocate a unique address. Please try again.");
}
