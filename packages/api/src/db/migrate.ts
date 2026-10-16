import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { databaseConnection } from "./connection.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import { logDatabaseError } from "./errors.js";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { inboxes, messages } from "./schema.js";

/** Same database/TLS policy as the API; never seed, reset, or alter migration history. */
export async function runMigrations(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL("./migrations/", import.meta.url));
  let client: pg.Client | undefined;
  try {
    const files = readMigrationFiles({ migrationsFolder });
    if (!files.length) throw new Error("Tracked migration assets are missing");
    client = new pg.Client(databaseConnection(env));
    console.log(`Database migrations starting (${files.length} tracked files).`);
    await client.connect();
    // A session lock on the SAME connection serializes concurrent deploy jobs.
    await client.query("SELECT pg_advisory_lock(1876889199, 1)");
    try {
      const db = drizzle(client);
      await migrate(db, { migrationsFolder });
      // Match the API's table/column resolution without reading user records.
      // A stale/incorrect journal must not allow startup with a missing schema.
      await db.select().from(inboxes).limit(0);
      await db.select().from(messages).limit(0);
      console.log("Database migrations complete; required tables verified.");
    } finally {
      await client.query("SELECT pg_advisory_unlock(1876889199, 1)");
    }
  } catch (error) {
    // Database errors may include connection details or row data.
    console.error("Database migration failed. Check database connectivity and migration compatibility.");
    logDatabaseError("migration", error);
    throw new Error("Database migration/readiness failed; API startup is blocked");
  } finally { await client?.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations().catch(() => { process.exitCode = 1; });
}
