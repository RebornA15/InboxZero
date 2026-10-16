import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { healthRoutes } from "../src/routes/health.js";

const database = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("../src/db/index.js", () => ({ pool: database }));
afterEach(() => vi.restoreAllMocks());
describe("database query readiness", () => {
  it("only returns healthy after SELECT 1 succeeds and releases the client", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] });
    const release = vi.fn();
    database.connect.mockResolvedValue({ query, release });
    const app = Fastify(); await app.register(healthRoutes, { prefix: "/api/health" });
    try {
      const response = await app.inject({ url: "/api/health" });
      expect(query).toHaveBeenCalledWith({ text: "SELECT 1", query_timeout: 5000 });
      expect(release).toHaveBeenCalledWith(false);
      expect(response.statusCode).toBe(200);
      expect(response.json().services.database).toBe("ok");
    } finally { await app.close(); }
  });
  it("reports query failure even after connection succeeds, discards that client, and recovers", async () => {
    const query = vi.fn().mockRejectedValueOnce(Object.assign(new Error("private-password-fixture"), { code: "ECONNRESET" })).mockResolvedValue({ rows: [] });
    const release = vi.fn();
    database.connect.mockResolvedValue({ query, release });
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = Fastify(); await app.register(healthRoutes, { prefix: "/api/health" });
    try {
      const failed = await app.inject({ url: "/api/health" });
      expect(failed.statusCode).toBe(503);
      expect(failed.json().services.database).toBe("unavailable");
      expect(release).toHaveBeenCalledWith(true);
      expect(failed.body).not.toContain("ECONNRESET");
      expect(failed.body).not.toContain("private-password-fixture");
      expect(JSON.stringify(output.mock.calls)).toContain("connection_reset");
      expect(JSON.stringify(output.mock.calls)).not.toContain("private-password-fixture");
      expect((await app.inject({ url: "/api/health" })).statusCode).toBe(200);
    } finally { await app.close(); }
  });
  it("logs the actual TLS failure server-side while keeping the response generic", async () => {
    database.connect.mockRejectedValue(Object.assign(new Error("postgresql://secret-fixture"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" }));
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = Fastify(); await app.register(healthRoutes, { prefix: "/api/health" });
    try {
      const response = await app.inject({ url: "/api/health" });
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain("DEPTH_ZERO");
      expect(JSON.stringify(output.mock.calls)).toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
      expect(JSON.stringify(output.mock.calls)).not.toContain("secret-fixture");
    } finally { await app.close(); }
  });
});
