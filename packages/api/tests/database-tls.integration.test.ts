import { describe, expect, it } from "vitest";
import pg from "pg";
import { databaseConnection } from "../src/db/connection.js";

// Dedicated local self-signed PostgreSQL fixture only; never a live database.
const testUrl = process.env["INBOX_TLS_DATABASE_URL"];
const caPath = process.env["INBOX_TLS_TEST_CA"];
describe.skipIf(!testUrl)("self-signed PostgreSQL TLS transport", () => {
  function options(mode?: string, ca?: string) {
    if (!testUrl || !/^\/inboxzero_demo_tests_[a-f0-9]+$/.test(new URL(testUrl).pathname) || !["127.0.0.1", "localhost"].includes(new URL(testUrl).hostname)) {
      throw new Error("An isolated local inboxzero_demo_tests_<random hex> TLS fixture is required");
    }
    const url = new URL(testUrl);
    if (ca) url.searchParams.set("sslrootcert", ca);
    return databaseConnection({ NODE_ENV: "production", DATABASE_URL: url.toString(), ...(mode ? { PGSSLMODE: mode } : {}) });
  }
  it("reproduces DEPTH_ZERO_SELF_SIGNED_CERT under the production verified default", async () => {
    const client = new pg.Client(options());
    try { await expect(client.connect()).rejects.toMatchObject({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" }); }
    finally { await client.end(); }
  });
  it("requires actual encrypted connections with both pg.Client and pg.Pool", async () => {
    const client = new pg.Client(options("require"));
    const pool = new pg.Pool(options("require"));
    try {
      await client.connect();
      const query = "SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()";
      expect((await client.query(query)).rows[0].ssl).toBe(true);
      expect((await pool.query(query)).rows[0].ssl).toBe(true);
    } finally { await client.end(); await pool.end(); }
  });
  it("does not negotiate TLS with the Render internal policy, for either consumer", async () => {
    options("require"); // Validate this is the dedicated loopback fixture.
    const internal = databaseConnection({ NODE_ENV: "production", RENDER: "true", DATABASE_URL: "postgresql://fixture:fixture@dpg-fixture-a/inboxzero" });
    expect(internal.ssl).toBe(false);
    // Substitute the fixture transport address only; retain the exact internal TLS options.
    const client = new pg.Client({ ...internal, connectionString: testUrl! });
    const pool = new pg.Pool({ ...internal, connectionString: testUrl! });
    try {
      await client.connect();
      const query = "SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()";
      expect((await client.query(query)).rows[0].ssl).toBe(false);
      expect((await pool.query(query)).rows[0].ssl).toBe(false);
    } finally { await client.end(); await pool.end(); }
  });
  it.skipIf(!caPath)("supports full certificate verification with an explicitly trusted CA", async () => {
    const client = new pg.Client(options("verify-full", caPath));
    try { await client.connect(); expect((await client.query("SELECT 1 AS ok")).rows[0].ok).toBe(1); }
    finally { await client.end(); }
  });
});
