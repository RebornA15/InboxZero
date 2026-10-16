import type { FastifyPluginAsync } from "fastify";
import { pool } from "../db/index.js";
import { logDatabaseError } from "../db/errors.js";

const healthQuery = { text: "SELECT 1", query_timeout: 5000 };

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (_request, reply) => {
    let dbOk = false;

    try {
      const client = await pool.connect();
      let failed = false;
      try { await client.query(healthQuery); }
      catch (error) { failed = true; throw error; }
      finally { client.release(failed); }
      dbOk = true;
    } catch (error) {
      logDatabaseError("health", error);
    }

    const status = dbOk ? "ok" : "degraded";

    return reply.code(dbOk ? 200 : 503).send({
      status,
      timestamp: new Date().toISOString(),
      services: {
        database: dbOk ? "ok" : "unavailable",
      },
      // Never expose secrets, internal paths, or stack traces here
    });
  });
};
