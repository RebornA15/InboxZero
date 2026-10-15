import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { inboxes } from "../db/schema.js";
import { config } from "../config.js";
import { sseManager } from "../lib/sse.js";
import { Errors } from "../lib/errors.js";
import { persistMessageForInbox } from "../lib/message-delivery.js";

/**
 * Internal mail ingestion endpoint.
 *
 * This route is for use by the Postfix mail server only.
 * It is protected by a shared secret passed in the X-Ingestion-Secret header.
 *
 * NEVER expose this endpoint to public clients.
 * Configure your reverse proxy to block access to /api/ingest from the internet.
 *
 * Authentication: Pre-shared secret (INGESTION_API_SECRET env var).
 * This is appropriate for a trusted internal network. For production
 * deployments, consider mTLS between Postfix and the API server.
 */

const ingestMessageBody = z.object({
  /** Full recipient email address */
  recipient: z.string().email().max(254),
  /** Sender envelope address */
  from: z.string().max(254),
  /** Parsed sender display name */
  fromName: z.string().max(256).optional(),
  /** Message subject line */
  subject: z.string().max(998).default("(no subject)"),
  /** Plain text body */
  textBody: z.string().max(10_000_000).optional(),
  /** Raw HTML body (will be sanitized before storage) */
  htmlBody: z.string().max(10_000_000).optional(),
  /** Unique delivery identifier (e.g. Message-ID) */
  deliveryId: z.string().max(998),
  /** Raw message size in bytes */
  sizeBytes: z.number().int().min(0),
});

export const ingestionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/", async (request, reply) => {
    if (!config.INGESTION_ENABLED) throw Errors.notFound("Ingestion endpoint");
    // Verify internal secret — constant-time string comparison
    const provided = (request.headers["x-ingestion-secret"] as string) ?? "";
    const expected = config.INGESTION_API_SECRET;

    // Note: We use timingSafeEqual to prevent timing attacks
    const { timingSafeEqual } = await import("crypto");
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);

    if (
      providedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(providedBuf, expectedBuf)
    ) {
      throw Errors.unauthorized();
    }

    // Validate body
    const result = ingestMessageBody.safeParse(request.body);
    if (!result.success) {
      throw Errors.badRequest(result.error.issues[0]?.message ?? "Invalid body");
    }

    const data = result.data;

    // Find active inbox by recipient address
    const [inbox] = await db
      .select({ id: inboxes.id, publicId: inboxes.publicId, status: inboxes.status, expiresAt: inboxes.expiresAt, messageCount: inboxes.messageCount })
      .from(inboxes)
      .where(eq(inboxes.address, data.recipient.toLowerCase()));

    if (!inbox) {
      return reply.code(404).send({ error: "No inbox for recipient" });
    }

    // Persist transactionally
    let newMessage: Awaited<ReturnType<typeof persistMessageForInbox>>;
    try {
      newMessage = await persistMessageForInbox(inbox, data);
    } catch (err: unknown) {
      const error = err as { code?: string };
      if (error.code === "23505") {
        // Duplicate delivery_id — idempotent: already delivered
        return reply.code(200).send({ duplicate: true });
      }
      throw err;
    }

    // Publish SSE AFTER successful DB commit
    sseManager.publish(inbox.publicId, {
      type: "message:new",
      payload: { messageId: newMessage.id, inboxId: inbox.publicId },
    });

    return reply.code(201).send({ messageId: newMessage.id });
  });
};
