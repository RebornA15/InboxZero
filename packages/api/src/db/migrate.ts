import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { databaseConnection } from "./connection.js";
import { fileURLToPath } from "node:url";

const client = new pg.Client(databaseConnection());
try {
  await client.connect();
  // A session lock on the SAME connection serializes concurrent deploy jobs.
  await client.query("SELECT pg_advisory_lock(1876889199, 1)");
  try {
    await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL("./migrations/", import.meta.url)) });
    console.log("Database migrations complete.");
  } finally {
    await client.query("SELECT pg_advisory_unlock(1876889199, 1)");
  }
} catch {
  // Database errors may include connection details or row data.
  console.error("Database migration failed. Check database connectivity and migration compatibility.");
  process.exitCode = 1;
} finally { await client.end(); }
