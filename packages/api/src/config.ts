import { z } from "zod";
import { resolveDomainConfiguration } from "./lib/address-policy.js";

const configSchema = z.object({
  // Server
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // Database
  DATABASE_URL: z.string().url(),

  // Secrets
  ACCESS_TOKEN_SECRET: z.string().min(32),
  INGESTION_API_SECRET: z.string().min(32),

  // Email
  MAIL_DOMAINS: z.string().default(""),
  OWNED_MAIL_DOMAINS: z.string().optional(),
  WORK_EMAIL_DOMAIN: z.string().optional(),
  SCHOOL_EMAIL_DOMAIN: z.string().optional(),
  PERSONAL_EMAIL_DOMAIN: z.string().optional(),
  CUSTOM_USERNAMES_ENABLED: z.enum(["true", "false"]).default("true"),

  // Lifecycle
  INBOX_TTL_MINUTES: z.coerce.number().int().min(1).max(10080).default(60),
  MAX_MESSAGES_PER_INBOX: z.coerce.number().int().min(1).max(500).default(50),
  MAX_MESSAGE_SIZE_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(52_428_800)
    .default(1_048_576),

  // Rate limiting
  RATE_LIMIT_INBOX_CREATE_PER_HOUR: z.coerce
    .number()
    .int()
    .min(1)
    .default(10),
  RATE_LIMIT_API_PER_MINUTE: z.coerce.number().int().min(1).default(60),
  TRUST_PROXY: z
    .string()
    .transform((s) => s === "true")
    .default("false"),

  // CORS
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:5173,http://127.0.0.1:5173")
    .transform((s) => s.split(",").map((origin) => origin.trim()).filter(Boolean)),

  // Cleanup worker
  CLEANUP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .default(60_000),
}).superRefine((values, context) => {
  try { resolveDomainConfiguration(values); }
  catch (error) { context.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message }); }
}).transform(values => {
  const domains = resolveDomainConfiguration(values);
  return { ...values, MAIL_DOMAINS: domains.allowedDomains, DOMAIN_CONFIG: domains };
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (_config) return _config;

  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid configuration:", result.error.format());
    process.exit(1);
  }
  _config = result.data;
  return _config;
}

export const config = new Proxy({} as Config, {
  get(_target, key) {
    return getConfig()[key as keyof Config];
  },
});
