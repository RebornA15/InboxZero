import { z } from "zod";
import { resolveDomainConfiguration } from "./lib/address-policy.js";

export const configSchema = z.object({
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
  INGESTION_ENABLED: z.enum(["true", "false"]).optional(),

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
    .refine(s => /^(true|false|[1-9][0-9]*)$/.test(s), "Use true, false, or a trusted proxy hop count")
    .transform(s => s === "true" ? true : s === "false" ? false : Number(s))
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
  if (values.NODE_ENV === "production") {
    for (const origin of values.CORS_ORIGIN) {
      try {
        const url = new URL(origin);
        if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password || url.hostname.includes("*")) throw new Error();
      } catch { context.addIssue({ code: z.ZodIssueCode.custom, path: ["CORS_ORIGIN"], message: "Production CORS origins must be exact HTTPS origins without paths or wildcards" }); }
    }
    if (!values.CORS_ORIGIN.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["CORS_ORIGIN"], message: "At least one frontend origin is required" });
  }
  try { resolveDomainConfiguration(values); }
  catch (error) { context.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message }); }
}).transform(values => {
  const domains = resolveDomainConfiguration(values);
  return { ...values, INGESTION_ENABLED: values.INGESTION_ENABLED === "true" || (values.INGESTION_ENABLED === undefined && values.NODE_ENV !== "production"), MAIL_DOMAINS: domains.allowedDomains, DOMAIN_CONFIG: domains };
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
