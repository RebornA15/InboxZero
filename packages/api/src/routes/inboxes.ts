import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { inboxes, messages } from "../db/schema.js";
import { config } from "../config.js";
import { hashSecret, randomToken } from "../lib/crypto.js";
import { authorizeInbox } from "../lib/auth.js";
import { Errors } from "../lib/errors.js";
import { sseManager } from "../lib/sse.js";
import { persistMessageForInbox } from "../lib/message-delivery.js";
import { allocateAddress, createInboxSchema, inboxCategories, categoryLabels } from "../lib/address-policy.js";

const simulateMessageBody = z.object({
  subject: z.string().max(998).optional(),
});

export const inboxRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // POST /api/inboxes — Create a new inbox
  // -------------------------------------------------------------------------
  fastify.get("/options", async () => ({
    categories: inboxCategories.map(category => ({ category, label: categoryLabels[category], domain: config.DOMAIN_CONFIG.domains[category] })),
    customUsernamesEnabled: config.DOMAIN_CONFIG.customUsernamesEnabled,
    development: config.DOMAIN_CONFIG.development,
  }));

  fastify.post("/", {
    config: { rateLimit: { max: config.RATE_LIMIT_INBOX_CREATE_PER_HOUR, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    const parsed = createInboxSchema.safeParse(request.body === undefined ? {} : request.body);
    if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message ?? "Invalid address request");
    const rawSecret = randomToken(48);
    const secretHash = await hashSecret(rawSecret);
    const expiresAt = new Date(Date.now() + config.INBOX_TTL_MINUTES * 60 * 1000);
    const inbox = await allocateAddress(parsed.data, config.DOMAIN_CONFIG, async candidate => {
      const [created] = await db.insert(inboxes).values({
        ...candidate, publicId: randomToken(24), accessSecretHash: secretHash, expiresAt,
      }).onConflictDoNothing().returning({
        publicId: inboxes.publicId, address: inboxes.address, category: inboxes.category,
        isCustomUsername: inboxes.isCustomUsername, createdAt: inboxes.createdAt,
        expiresAt: inboxes.expiresAt, status: inboxes.status,
      });
      return created;
    });
    // Only creation returns the raw secret; neither options nor metadata expose it.
    return reply.code(201).send({ accessSecret: rawSecret, inbox });
  });

  // -------------------------------------------------------------------------
  // GET /api/inboxes/:id — Get inbox metadata
  // -------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;
    const auth = await authorizeInbox(request, id);

    const [inbox] = await db
      .select({
        publicId: inboxes.publicId,
        address: inboxes.address,
        category: inboxes.category,
        isCustomUsername: inboxes.isCustomUsername,
        status: inboxes.status,
        createdAt: inboxes.createdAt,
        expiresAt: inboxes.expiresAt,
        lastMessageAt: inboxes.lastMessageAt,
        messageCount: inboxes.messageCount,
      })
      .from(inboxes)
      .where(eq(inboxes.publicId, auth.publicId));

    if (!inbox) throw Errors.notFound("Inbox");

    return reply.send({ inbox });
  });

  // -------------------------------------------------------------------------
  // GET /api/inboxes/:id/messages — List messages
  // -------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>(
    "/:id/messages",
    async (request, reply) => {
      const { id } = request.params;
      const auth = await authorizeInbox(request, id);

      const msgs = await db
        .select({
          id: messages.id,
          fromAddress: messages.fromAddress,
          fromName: messages.fromName,
          subject: messages.subject,
          preview: messages.preview,
          sizeBytes: messages.sizeBytes,
          receivedAt: messages.receivedAt,
        })
        .from(messages)
        .where(eq(messages.inboxId, auth.id))
        .orderBy(desc(messages.receivedAt))
        .limit(config.MAX_MESSAGES_PER_INBOX);

      return reply.send({ messages: msgs });
    }
  );

  // -------------------------------------------------------------------------
  // GET /api/inboxes/:id/messages/:messageId — Get full message
  // -------------------------------------------------------------------------
  fastify.get<{ Params: { id: string; messageId: string } }>(
    "/:id/messages/:messageId",
    async (request, reply) => {
      const { id, messageId } = request.params;
      const auth = await authorizeInbox(request, id);
      const msgId = parseInt(messageId, 10);

      if (isNaN(msgId)) throw Errors.badRequest("Invalid message ID");

      const [message] = await db
        .select()
        .from(messages)
        .where(
          and(eq(messages.id, msgId), eq(messages.inboxId, auth.id))
        );

      if (!message) throw Errors.notFound("Message");

      return reply.send({ message });
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /api/inboxes/:id/messages/:messageId — Delete a message
  // -------------------------------------------------------------------------
  fastify.delete<{ Params: { id: string; messageId: string } }>(
    "/:id/messages/:messageId",
    async (request, reply) => {
      const { id, messageId } = request.params;
      const auth = await authorizeInbox(request, id);
      const msgId = parseInt(messageId, 10);

      if (isNaN(msgId)) throw Errors.badRequest("Invalid message ID");

      const deleted = await db
        .delete(messages)
        .where(
          and(eq(messages.id, msgId), eq(messages.inboxId, auth.id))
        )
        .returning({ id: messages.id });

      if (deleted.length === 0) throw Errors.notFound("Message");

      // Update message count
      await db
        .update(inboxes)
        .set({
          messageCount: sql`${inboxes.messageCount} - 1`,
        })
        .where(eq(inboxes.id, auth.id));

      sseManager.publish(auth.publicId, {
        type: "message:deleted",
        payload: { messageId: msgId },
      });

      return reply.code(204).send();
    }
  );

  fastify.post<{ Params: { id: string } }>(
    "/:id/simulate",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      if (config.NODE_ENV === "production") {
        throw Errors.notFound("Simulation endpoint");
      }

      const { id } = request.params;
      const auth = await authorizeInbox(request, id);

      const body = simulateMessageBody.safeParse(request.body ?? {});
      if (!body.success) {
        throw Errors.badRequest(body.error.issues[0]?.message ?? "Invalid body");
      }

      const [inbox] = await db
        .select({
          id: inboxes.id,
          publicId: inboxes.publicId,
          address: inboxes.address,
          category: inboxes.category,
          status: inboxes.status,
          expiresAt: inboxes.expiresAt,
          messageCount: inboxes.messageCount,
        })
        .from(inboxes)
        .where(eq(inboxes.id, auth.id));

      if (!inbox) throw Errors.notFound("Inbox");

      const subject = body.data.subject ?? "Your verification code is 492019";
      const textBody = [
        "Hello!",
        "",
        `This is a sample test email sent to your disposable inbox: ${inbox.address}.`,
        "",
        `Address style: ${categoryLabels[inbox.category]}`,
        "Your security code: 492019",
        "This code will expire in 10 minutes.",
        "",
        "Thank you for choosing InboxZero!",
      ].join("\n");
      const htmlBody = `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#1e293b;line-height:1.6;padding:20px;">
        <h2 style="color:#4f46e5;margin-bottom:12px;">Security Verification</h2>
        <p>This is a test simulated message delivered by the InboxZero development API.</p>
        <div style="background:#f1f5f9;border-radius:8px;padding:16px;text-align:center;margin:20px 0;">
          <span style="font-size:24px;font-weight:bold;letter-spacing:4px;color:#0f172a;">492019</span>
        </div>
        <p style="font-size:13px;color:#64748b;">If you did not request this verification, simply discard this message.</p>
      </body></html>`;

      let message: Awaited<ReturnType<typeof persistMessageForInbox>>;
      try {
        message = await persistMessageForInbox(inbox, {
          from: "security@simulation.inboxzero.test",
          fromName: "security",
          subject,
          textBody,
          htmlBody,
          deliveryId: `sim-${inbox.publicId}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 10)}`,
          sizeBytes: Buffer.byteLength(textBody, "utf8") + Buffer.byteLength(htmlBody, "utf8"),
        });
      } catch (err: unknown) {
        const error = err as { code?: string };
        if (error.code === "23505") {
          throw Errors.conflict("Duplicate simulated delivery ID");
        }
        throw err;
      }

      sseManager.publish(inbox.publicId, {
        type: "message:new",
        payload: { messageId: message.id, inboxId: inbox.publicId },
      });

      return reply.code(201).send({ messageId: message.id });
    }
  );

  // -------------------------------------------------------------------------
  // GET /api/inboxes/:id/events — SSE stream
  // -------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>(
    "/:id/events",
    async (request, reply) => {
      const { id } = request.params;
      const auth = await authorizeInbox(request, id);

      if (sseManager.subscriberCount(auth.publicId) >= 5) {
        return reply.code(429).send({ error: "Too many inbox streams" });
      }
      // Hijacked responses bypass Fastify's send path. Copy CORS/security headers
      // explicitly so cross-origin fetch streaming works on the deployed frontend.
      reply.hijack();
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) reply.raw.setHeader(name, value);
      }
      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-store, no-transform");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("X-Accel-Buffering", "no");
      reply.raw.flushHeaders();
      sseManager.subscribe(auth.publicId, reply);
      reply.raw.write(": ping\n\n");
      const keepalive = setInterval(() => {
        if (!reply.raw.destroyed) reply.raw.write(": ping\n\n");
      }, 30_000);
      const expiry = setTimeout(() => reply.raw.end(), Math.max(0, auth.expiresAt.getTime() - Date.now()));
      reply.raw.on("close", () => {
        clearInterval(keepalive);
        clearTimeout(expiry);
        sseManager.unsubscribe(auth.publicId, reply);
      });
      return reply;
    }
  );
};
