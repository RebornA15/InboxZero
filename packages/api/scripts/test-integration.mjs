import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; run inside the API container or load your local .env");
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const name = `inboxzero_category_tests_${randomBytes(6).toString("hex")}`;
const testUrl = new URL(process.env.DATABASE_URL);
testUrl.pathname = `/${name}`;
let created = false;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  const child = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)), "run", "tests/categories.integration.test.ts", "--maxWorkers=1", "--minWorkers=1", "--no-cache"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "inherit",
    env: { ...process.env, INBOX_TEST_DATABASE_URL: testUrl.toString(), NODE_ENV: "test" },
  });
  process.exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", code => resolve(code ?? 1)); });
} finally {
  // Only the uniquely named database created above is removed. Never touch the
  // application's database, schemas, embedded data directory, or Docker volumes.
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
