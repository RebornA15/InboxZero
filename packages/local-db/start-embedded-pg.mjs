import EmbeddedPostgres from "embedded-postgres";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Preserve the existing helper's persistent data directory.
const databaseDir = join(__dirname, "../api/.pgdata");

const pg = new EmbeddedPostgres({
  databaseDir,
  user: "inboxzero",
  password: "changeme",
  port: 5432,
  persistent: true,
  onLog: (m) => console.log(String(m)),
  onError: (m) => console.error(String(m)),
});

try {
  await access(join(databaseDir, "PG_VERSION"), constants.R_OK);
} catch {
  console.log(`Initializing embedded Postgres data directory at ${databaseDir}`);
  await pg.initialise();
}

await pg.start();
try {
  await pg.createDatabase("inboxzero");
} catch (err) {
  if (!String(err).includes("already exists")) {
    throw err;
  }
}
console.log("EMBEDDED_POSTGRES_READY");
await new Promise(() => {});
