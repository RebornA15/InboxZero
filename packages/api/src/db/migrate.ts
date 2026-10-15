import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index.js";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(__dirname, "migrations");

async function runMigrations() {
  console.log("Running database migrations…");
  await migrate(db, { migrationsFolder });
  console.log("Migrations complete.");
  await pool.end();
}

runMigrations().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
