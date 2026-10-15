import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { inboxRoutes } from "./routes/inboxes.js";
import { ingestionRoutes } from "./routes/ingest.js";
import { healthRoutes } from "./routes/health.js";
import { AppError } from "./lib/errors.js";
import { startCleanupWorker } from "./lib/cleanup.js";
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

    // Never expose internal errors to clients
    fastify.log.error({ err: serializeError(error) }, "Unhandled request error");
    return reply.code(500).send({
      error: "An internal error occurred",
      code: "INTERNAL_ERROR",
    });
  });

  return fastify;
}

async function main() {
  const server = await buildServer();

  try {
    await server.listen({ port: config.PORT, host: config.HOST });
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
    await server.close();
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
