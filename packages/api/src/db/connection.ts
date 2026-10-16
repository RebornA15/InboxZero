import { readFileSync } from "node:fs";
import type { PoolConfig } from "pg";

/** Only Render's private short database hostname, never a public Render endpoint. */
function isRenderInternal(env: NodeJS.ProcessEnv, url: URL): boolean {
  return env["RENDER"] === "true" && /^dpg-[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(url.hostname);
}

function tlsMode(env: NodeJS.ProcessEnv, url: URL): string {
  if (url.searchParams.getAll("sslmode").length > 1) throw new Error("Use a single PostgreSQL sslmode setting");
  const urlMode = url.searchParams.get("sslmode");
  const envMode = env["PGSSLMODE"];
  if (urlMode !== null && envMode !== undefined && urlMode !== envMode) {
    throw new Error("Conflicting PostgreSQL TLS settings: DATABASE_URL sslmode and PGSSLMODE must agree");
  }
  return urlMode ?? envMode ?? (isRenderInternal(env, url) ? "disable" : env["NODE_ENV"] === "production" ? "verify-full" : "disable");
}

/** Shared by the API and migration runner. Never disable TLS globally. */
export function databaseConnection(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  if (!env["DATABASE_URL"]) throw new Error("DATABASE_URL environment variable is required");
  const url = new URL(env["DATABASE_URL"]);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("DATABASE_URL must be a PostgreSQL URL");
  // Driver query overrides must not change the endpoint after TLS policy selection.
  if (["host", "hostaddr", "port", "user", "password", "database", "dbname"].some(key => url.searchParams.has(key))) {
    throw new Error("Put PostgreSQL host, port and credentials in the URL authority/path, not query overrides");
  }
  const production = env["NODE_ENV"] === "production";
  const mode = tlsMode(env, url);
  if (!["disable", "require", "verify-full"].includes(mode)) throw new Error("Use PostgreSQL sslmode disable, require, or verify-full");
  if (production && mode === "disable" && !isRenderInternal(env, url)) throw new Error("External production PostgreSQL connections require TLS; plaintext is allowed only for Render private endpoints");
  if (production && mode === "require" && !isRenderInternal(env, url) && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("External production PostgreSQL connections require verify-full; unverified require is limited to Render private endpoints or loopback");
  }
  if (url.searchParams.has("ssl") || url.searchParams.has("uselibpqcompat") || url.searchParams.has("sslcert") || url.searchParams.has("sslkey")) {
    throw new Error("Configure database TLS with sslmode and optional sslrootcert only");
  }
  const caPath = url.searchParams.get("sslrootcert");
  if (mode === "disable" && caPath) throw new Error("sslrootcert requires an explicit TLS mode");
  url.searchParams.delete("sslmode");
  url.searchParams.delete("sslrootcert");
  return {
    connectionString: url.toString(),
    // Trusted Render private connections do not require TLS. Explicit require
    // opts into internal self-signed TLS; public production URLs use verify-full.
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

/** Non-sensitive operational details only: no hostname, URL, username or credentials. */
export function databaseTlsSummary(env: NodeJS.ProcessEnv = process.env) {
  const connection = databaseConnection(env);
  const url = new URL(env["DATABASE_URL"]!);
  return {
    endpoint: isRenderInternal(env, url) ? "render-internal" : "other",
    sslMode: tlsMode(env, url),
    encrypted: connection.ssl !== false,
    certificateVerification: typeof connection.ssl === "object" && connection.ssl.rejectUnauthorized === true,
  };
}

/** Drizzle Kit 0.24 expects explicit credentials to retain our pg TLS object. */
export function databaseCredentials(env: NodeJS.ProcessEnv = process.env) {
  const connection = databaseConnection(env);
  const url = new URL(connection.connectionString!);
  return {
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port || "5432"),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    ssl: connection.ssl ?? false,
  };
}
