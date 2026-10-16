import { databaseTlsSummary } from "./connection.js";

// Static descriptions only. Driver messages/details/stacks can contain credentials or data.
const failures: Record<string, [string, string]> = {
  DEPTH_ZERO_SELF_SIGNED_CERT: ["self_signed_certificate", "Use Render's trusted internal URL with PGSSLMODE=disable (or unset); external connections need a trusted CA and verify-full."],
  SELF_SIGNED_CERT_IN_CHAIN: ["untrusted_certificate_chain", "Check the selected endpoint, TLS mode and trusted CA."],
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: ["untrusted_certificate_chain", "Check the trusted database CA chain."],
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: ["untrusted_certificate_chain", "Check the trusted database CA chain."],
  CERT_HAS_EXPIRED: ["expired_certificate", "Check the server certificate and CA validity."],
  ERR_TLS_CERT_ALTNAME_INVALID: ["certificate_hostname_mismatch", "Use the provider hostname matching its certificate, not an IP address."],
  ENOTFOUND: ["dns_lookup_failed", "Check the database hostname and same-region private-network access."],
  EAI_AGAIN: ["dns_temporarily_unavailable", "Retry after DNS/network recovery."],
  ECONNREFUSED: ["connection_refused", "Check database availability, endpoint and port."],
  ETIMEDOUT: ["connection_timed_out", "Check database availability and network access."],
  ECONNRESET: ["connection_reset", "Check database availability and retry."],
  EHOSTUNREACH: ["host_unreachable", "Check the selected endpoint and private-network access."],
  ENETUNREACH: ["network_unreachable", "Check network access to the database."],
  "28P01": ["authentication_failed", "Refresh DATABASE_URL from the database dashboard; check credential rotation."],
  "28000": ["authorization_failed", "Check database credentials and connection access rules."],
  "3D000": ["database_not_found", "Check the database name in DATABASE_URL."],
  "53300": ["connection_limit_reached", "Check database connection limits and instance/pool counts."],
  "57P03": ["database_not_ready", "Wait for database startup or recovery, then retry."],
  "57P01": ["database_shutdown", "Retry after database recovery."],
  "08006": ["connection_failed", "Check database availability and network access."],
  "42P01": ["missing_table", "Run the checked-in migrations before starting the API."],
  "42703": ["missing_column", "Check migration completion and deployed application version."],
  "42501": ["insufficient_privilege", "Check database role permissions."],
  "57014": ["query_cancelled", "Check query timeouts and database load."],
  DB_CONNECTION_TIMEOUT: ["connection_timed_out", "Check database availability and network access."],
  DB_QUERY_TIMEOUT: ["query_timed_out", "Check database load and query timeouts."],
  DB_TLS_UNSUPPORTED: ["server_does_not_support_tls", "Use disable only on Render's trusted internal endpoint; external production connections require verified TLS."],
};

export function safeDatabaseError(error: unknown) {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  for (let count = 0; pending.length && count < 12; count++) {
    const value = pending.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const item = value as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown };
    let code = typeof item.code === "string" ? item.code : "";
    if (item.message === "timeout exceeded when trying to connect" || item.message === "Connection terminated due to connection timeout") code = "DB_CONNECTION_TIMEOUT";
    if (item.message === "The server does not support SSL connections") code = "DB_TLS_UNSUPPORTED";
    if (item.message === "Query read timeout") code = "DB_QUERY_TIMEOUT";
    if (Object.hasOwn(failures, code)) {
      const [reason, action] = failures[code]!;
      return { code, reason, action };
    }
    pending.push(item.cause);
    if (Array.isArray(item.errors)) pending.push(...item.errors.slice(0, 8));
  }
  return { code: "UNKNOWN_DATABASE_ERROR", reason: "database_operation_failed", action: "Check database availability, credentials, TLS policy and migration status." };
}

export function logDatabaseError(operation: "health" | "cleanup" | "migration" | "idle-pool", error: unknown): void {
  let tls: ReturnType<typeof databaseTlsSummary> | undefined;
  try { tls = databaseTlsSummary(); } catch { /* Configuration errors must not break error handling. */ }
  console.error(JSON.stringify({ event: "database-error", operation, ...safeDatabaseError(error), ...(tls ? { tls } : {}) }));
}
