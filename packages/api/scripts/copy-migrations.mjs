import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
await cp(new URL("../src/db/migrations/", import.meta.url), new URL("../dist/db/migrations/", import.meta.url), { recursive: true });
const files = readMigrationFiles({ migrationsFolder: fileURLToPath(new URL("../dist/db/migrations/", import.meta.url)) });
if (!files.length) throw new Error("Production build requires tracked migration assets");
console.log(`Validated ${files.length} bundled migration files.`);
