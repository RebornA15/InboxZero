import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import pg from "pg";
import { runMigrations } from "../src/db/migrate.js";

const testUrl = process.env["INBOX_MIGRATION_DATABASE_URL"];
describe.skipIf(!testUrl)("tracked production migrations on isolated databases", () => {
  let admin: pg.Client;
  beforeAll(async () => {
    if (!testUrl || !/^\/inboxzero_migration_tests_[a-f0-9]+$/.test(new URL(testUrl).pathname) || !["127.0.0.1", "localhost"].includes(new URL(testUrl).hostname)) throw new Error("Use a dedicated local migration test cluster");
    admin = new pg.Client({ connectionString: testUrl, ssl: false });
    await admin.connect();
  });
  afterAll(async () => { await admin?.end(); vi.restoreAllMocks(); });
  async function fresh() {
    const name = `inboxzero_migration_tests_${randomBytes(6).toString("hex")}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(testUrl!); url.pathname = `/${name}`;
    const client = new pg.Client({ connectionString: url.toString(), ssl: false });
    await client.connect();
    return { client, env: { NODE_ENV: "test", DATABASE_URL: url.toString(), PGSSLMODE: "disable" } };
  }
  const baseSql = () => readFile(new URL("../src/db/migrations/0000_hot_living_lightning.sql", import.meta.url), "utf8");
  const categorySql = () => readFile(new URL("../src/db/migrations/0001_inbox_categories.sql", import.meta.url), "utf8");

  it("creates both tables/enums/indexes/foreign key on an empty database and safely repeats", async () => {
    const { client, env } = await fresh();
    try {
      await runMigrations(env); await runMigrations(env);
      expect((await client.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(2);
      expect((await client.query("SELECT to_regclass('public.inboxes') AS inboxes,to_regclass('public.messages') AS messages,to_regclass('public.idx_inboxes_public_id') AS index")).rows[0]).toMatchObject({ inboxes: "inboxes", messages: "messages", index: "idx_inboxes_public_id" });
      expect((await client.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conname='messages_inbox_id_inboxes_id_fk'")).rows[0].n).toBe(1);
    } finally { await client.end(); }
  });
  it("upgrades an existing unjournaled base schema without losing records or credentials", async () => {
    const { client, env } = await fresh();
    try {
      await client.query(await baseSql());
      const row = await client.query("INSERT INTO inboxes(public_id,access_secret_hash,address,local_part,domain,expires_at) VALUES ('legacy','preserved-hash','legacy@inboxzero.test','legacy','inboxzero.test',now()+interval '1 hour') RETURNING id");
      await client.query("INSERT INTO messages(inbox_id,delivery_id,from_address,text_body) VALUES ($1,'legacy-message','sender@inboxzero.test','preserved content')", [row.rows[0].id]);
      await runMigrations(env); await runMigrations(env);
      expect((await client.query("SELECT public_id,access_secret_hash,category,is_custom_username FROM inboxes")).rows).toEqual([{ public_id: "legacy", access_secret_hash: "preserved-hash", category: "personal", is_custom_username: false }]);
      expect((await client.query("SELECT text_body FROM messages")).rows[0].text_body).toBe("preserved content");
    } finally { await client.end(); }
  });
  it("serializes simultaneous migration attempts on the same database", async () => {
    const { client, env } = await fresh();
    try {
      await Promise.all([runMigrations(env), runMigrations(env)]);
      expect((await client.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(2);
    } finally { await client.end(); }
  });
  it("fails safely on unjournaled incompatible schema instead of resetting it or forging history", async () => {
    const { client, env } = await fresh();
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await client.query(await baseSql()); await client.query(await categorySql());
      await client.query("INSERT INTO inboxes(public_id,access_secret_hash,address,local_part,domain,expires_at) VALUES ('keep','keep-hash','keep@inboxzero.test','keep','inboxzero.test',now())");
      await expect(runMigrations(env)).rejects.toThrow("startup is blocked");
      expect((await client.query("SELECT access_secret_hash FROM inboxes")).rows[0].access_secret_hash).toBe("keep-hash");
      expect((await client.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(0);
    } finally { output.mockRestore(); await client.end(); }
  });
  it("blocks actual API startup if a journal falsely reports migrations but tables are absent", async () => {
    const { client, env } = await fresh();
    try {
      // Test-only drift fixture; never baseline or modify a real journal automatically.
      await client.query("CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations(id serial PRIMARY KEY, hash text NOT NULL,created_at bigint)");
      await client.query("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('fixture',1791893967985)");
      const child = spawn(process.execPath, [fileURLToPath(new URL("../dist/index.js", import.meta.url))], { env: {
        ...process.env, ...env, DEMO_MODE: "true", EMAIL_GENERATION_ENABLED: "true", INGESTION_ENABLED: "false",
        ACCESS_TOKEN_SECRET: "a".repeat(64), INGESTION_API_SECRET: "b".repeat(64), CORS_ORIGIN: "https://fixture.vercel.app",
        OWNED_MAIL_DOMAINS: "", WORK_EMAIL_DOMAIN: "", SCHOOL_EMAIL_DOMAIN: "", PERSONAL_EMAIL_DOMAIN: "", MAIL_DOMAINS: "",
      }, stdio: ["ignore", "pipe", "pipe"] });
      let logs = ""; child.stdout.on("data", chunk => { logs += chunk; }); child.stderr.on("data", chunk => { logs += chunk; });
      const code = await new Promise<number | null>((resolve, reject) => {
        const timeout = setTimeout(() => { child.kill(); reject(new Error("API did not fail closed")); }, 15000);
        child.on("error", error => { clearTimeout(timeout); reject(error); });
        child.on("exit", value => { clearTimeout(timeout); resolve(value); });
      });
      expect(code).toBe(1);
      expect(logs).toContain("API startup blocked");
      expect(logs).not.toContain("API listening");
      expect(logs).not.toContain(env.DATABASE_URL);
      expect((await client.query("SELECT to_regclass('public.inboxes') AS table_name")).rows[0].table_name).toBe(null);
    } finally { await client.end(); }
  });
});
