import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { config, getConfig } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { inboxRoutes } from "./routes/inboxes.js";
import { ingestionRoutes } from "./routes/ingest.js";
import { healthRoutes } from "./routes/health.js";
import { AppError } from "./lib/errors.js";
import { pool } from "./db/index.js";
import { sseManager } from "./lib/sse.js";
import { startCleanupWorker, stopCleanupWorker } from "./lib/cleanup.js";
import { pathToFileURL } from "node:url";

function serializeError(error: Error) {
  const pgError = error as Error & {
    code?: string;
    severity?: string;
    detail?: string;
    hint?: string;
    position?: string;
    schema?: string;
    table?: string;
    column?: string;
    constraint?: string;
    routine?: string;
  };

  return {
    message: pgError.message,
    code: pgError.code,
    severity: pgError.severity,
    detail: pgError.detail,
    hint: pgError.hint,
    position: pgError.position,
    schema: pgError.schema,
    table: pgError.table,
    column: pgError.column,
    constraint: pgError.constraint,
    routine: pgError.routine,
    stack: pgError.stack,
  };
}

async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: config.NODE_ENV === "production" ? "warn" : "info",
      // Never log request bodies — they may contain secrets or PII
      serializers: {
        req(request) {
          return { method: request.method, url: request.url };
        },
      },
    },
    trustProxy: config.TRUST_PROXY,
  });

  // ---- Security headers ----
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  // ---- CORS ----
  await fastify.register(cors, {
    origin: config.CORS_ORIGIN,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Access-Secret", "X-Ingestion-Secret"],
    exposedHeaders: [],
    credentials: false,
    maxAge: 86400,
  });

  // ---- Global rate limit ----
  await fastify.register(rateLimit, {
    max: config.RATE_LIMIT_API_PER_MINUTE,
    timeWindow: "1 minute",
    keyGenerator: (request) =>
      (request.ip as string) ?? "unknown",
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: "Rate limit exceeded. Please slow down.",
    }),
  });

  // Bearer secrets and email content must never be cached by browsers or CDNs.
  fastify.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });
  fastify.addHook("preClose", async () => { sseManager.closeAll(); });

  // ---- Routes ----
  await fastify.register(inboxRoutes, { prefix: "/api/inboxes" });
  await fastify.register(healthRoutes, { prefix: "/api/health" });

  // Ingestion endpoint — restrict at network layer in production
  await fastify.register(ingestionRoutes, { prefix: "/api/ingest" });

  // ---- Centralized error handler ----
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: error.message,
        code: error.code,
      });
    }

    // Zod validation errors surfaced by Fastify
    if (error.validation) {
      return reply.code(400).send({
        error: "Validation error",
        code: "VALIDATION_ERROR",
        details: error.validation,
      });
    }

    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.statusCode === 429 ? "Rate limit exceeded" : "Request rejected" });
    }

    // Never expose internal errors to clients
    fastify.log.error({ err: config.NODE_ENV === "production" ? { name: error.name, code: error.code } : serializeError(error) }, "Unhandled request error");
    return reply.code(500).send({
      error: "An internal error occurred",
      code: "INTERNAL_ERROR",
    });
  });

  return fastify;
}

async function main() {
  // Enforce the gate even if a dashboard runs dist/index.js directly.
  getConfig();
  try { await runMigrations(); }
  catch {
    console.error("API startup blocked: tracked database migrations/readiness did not succeed.");
    await pool.end();
    process.exitCode = 1;
    return;
  }
  const server = await buildServer();

  try {
    await server.listen({ port: config.PORT, host: config.NODE_ENV === "production" ? "0.0.0.0" : config.HOST });
    console.log(`InboxZero API listening on ${config.HOST}:${config.PORT}`);

    // Start background cleanup
    startCleanupWorker();
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down…`);
    stopCleanupWorker();
    await server.close();
    await pool.end();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

export { buildServer };
// Importing the server for injection tests must not listen or start cleanup.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
