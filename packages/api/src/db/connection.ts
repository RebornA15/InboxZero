import { readFileSync } from "node:fs";
import type { PoolConfig } from "pg";

/** Shared by the API and migration runner. Never disable TLS globally. */
export function databaseConnection(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  if (!env["DATABASE_URL"]) throw new Error("DATABASE_URL environment variable is required");
  const url = new URL(env["DATABASE_URL"]);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("DATABASE_URL must be a PostgreSQL URL");
  const production = env["NODE_ENV"] === "production";
  const mode = url.searchParams.get("sslmode") ?? env["PGSSLMODE"] ?? (production ? "verify-full" : "disable");
  if (!["disable", "require", "verify-full"].includes(mode)) throw new Error("Use PostgreSQL sslmode disable, require, or verify-full");
  if (production && mode === "disable") throw new Error("Production PostgreSQL connections require TLS");
  if (url.searchParams.has("ssl") || url.searchParams.has("uselibpqcompat") || url.searchParams.has("sslcert") || url.searchParams.has("sslkey")) {
    throw new Error("Configure database TLS with sslmode and optional sslrootcert only");
  }
  const caPath = url.searchParams.get("sslrootcert");
  url.searchParams.delete("sslmode");
  url.searchParams.delete("sslrootcert");
  return {
    connectionString: url.toString(),
    // Render internal Postgres has self-signed certificates: explicit require
    // encrypts without certificate verification. External URLs use verify-full.
    ssl: mode === "disable" ? false : {
      rejectUnauthorized: mode === "verify-full",
      minVersion: "TLSv1.2",
      ...(caPath ? { ca: readFileSync(caPath, "utf8") } : {}),
    },
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };
}
