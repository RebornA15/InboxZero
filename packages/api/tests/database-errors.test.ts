import { afterEach, describe, expect, it, vi } from "vitest";
import { logDatabaseError, safeDatabaseError } from "../src/db/errors.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe("sanitized database failures", () => {
  it.each([
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "self_signed_certificate"], ["ENOTFOUND", "dns_lookup_failed"],
    ["ECONNREFUSED", "connection_refused"], ["28P01", "authentication_failed"],
    ["3D000", "database_not_found"], ["42P01", "missing_table"], ["53300", "connection_limit_reached"],
  ])("reports the underlying %s failure without raw messages", (code, reason) => {
    expect(safeDatabaseError(Object.assign(new Error("password-sensitive-fixture"), { code }))).toMatchObject({ code, reason });
  });
  it("finds causes and aggregate errors while bounding traversal of cycles", () => {
    const root = { code: "DEPTH_ZERO_SELF_SIGNED_CERT", message: "private-url-fixture" };
    expect(safeDatabaseError(new Error("wrapper", { cause: new AggregateError([root]) })).code).toBe(root.code);
    const cycle: { cause?: unknown } = {}; cycle.cause = cycle;
    expect(safeDatabaseError(cycle).code).toBe("UNKNOWN_DATABASE_ERROR");
  });
  it("never logs credentials, arbitrary errors, data, stack traces, or environment values", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://private-user:private-password@private-host.invalid/private-database");
    vi.stubEnv("NODE_ENV", "production");
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "sensitive-secret-fixture";
    for (const failure of [
      { name: secret, code: "28P01", message: process.env["DATABASE_URL"], detail: secret, stack: secret },
      { code: secret, message: secret }, secret, null,
    ]) logDatabaseError("health", failure);
    const logs = JSON.stringify(output.mock.calls);
    for (const value of ["private-user", "private-password", "private-host", "private-database", secret]) expect(logs).not.toContain(value);
    expect(logs).toContain("authentication_failed");
    expect(logs).toContain("verify-full");
  });
});
