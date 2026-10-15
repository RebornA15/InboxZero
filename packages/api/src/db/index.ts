import pg from "pg";
import { databaseConnection } from "./connection.js";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const { Pool } = pg;

export const pool = new Pool(databaseConnection());
pool.on("error", () => console.error("Unexpected idle database connection error"));

export const db = drizzle(pool, { schema, logger: process.env["NODE_ENV"] === "development" });

export type DB = typeof db;
