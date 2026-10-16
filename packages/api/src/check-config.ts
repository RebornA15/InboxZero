import { pathToFileURL } from "node:url";
import { ZodError } from "zod";
import { configSchema } from "./config.js";
import { databaseConnection, databaseTlsSummary } from "./db/connection.js";

/** Validate the actual runtime environment without connecting or running migrations. */
export function checkStartupConfiguration(env: NodeJS.ProcessEnv) {
  const config = configSchema.parse(env);
  // Check protocol, TLS policy and optional CA file as well as the API schema.
  databaseConnection(env);
  return config;
}

export function runConfigurationCheck(env: NodeJS.ProcessEnv): number {
  const demoSetting = env["DEMO_MODE"] === undefined ? "unset" :
    env["DEMO_MODE"] === "true" ? "true" : env["DEMO_MODE"] === "false" ? "false" : "invalid";
  const revision = env["RENDER_GIT_COMMIT"];
  // Never print the environment, URLs, credentials, or unvalidated flag values.
  console.log(JSON.stringify({ event: "inboxzero-config-preflight-v1", demoSetting,
    revision: revision && /^[a-f0-9]{7,40}$/i.test(revision) ? revision : "unavailable" }));
  try {
    const config = checkStartupConfiguration(env);
    console.log(JSON.stringify({ event: "inboxzero-config-valid", nodeEnv: config.NODE_ENV,
      mode: config.DEMO_MODE ? "demo-only" : config.DOMAIN_CONFIG.generationEnabled ? "live-email" : "limited",
      externalIngestion: config.INGESTION_ENABLED, database: databaseTlsSummary(env) }));
    return 0;
  } catch (error) {
    if (error instanceof ZodError) {
      // Report only failed field names: error objects and URL parser errors can contain inputs.
      const fields = [...new Set(error.issues.map(issue => issue.path.join(".") || "email/domain settings"))];
      console.error("Invalid startup configuration. Check fields:", fields.join(", "));
    } else {
      console.error("Invalid database configuration. Check DATABASE_URL, PGSSLMODE, TLS options and CA file access.");
    }
    console.error("DEMO_MODE=true requires EMAIL_GENERATION_ENABLED=true, INGESTION_ENABLED=false (or unset), empty owned/legacy domain lists, and empty or exact fixed .test category domains. Secrets and production HTTPS CORS remain required.");
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runConfigurationCheck(process.env);
}
