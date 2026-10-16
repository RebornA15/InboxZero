import { defineConfig } from "drizzle-kit";
// Kit loads this file through its TS require hook, outside the compiled API tree.
import { databaseCredentials } from "./src/db/connection.ts";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  // Offline generation needs no database. Online Kit commands share runtime TLS.
  dbCredentials: process.env["DATABASE_URL"] ? databaseCredentials() : { url: "" },
  verbose: true,
  strict: true,
});
