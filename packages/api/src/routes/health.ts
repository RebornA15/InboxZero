import type { FastifyPluginAsync } from "fastify";
import { pool } from "../db/index.js";

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (_request, reply) => {
    let dbOk = false;

    try {
      const client = await pool.connect();
      try { await client.query("SELECT 1"); }
      finally { client.release(); }
      dbOk = true;
    } catch {
      // DB connection failed — do not reveal details
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
