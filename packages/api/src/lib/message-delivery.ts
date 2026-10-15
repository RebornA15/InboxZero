import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { inboxes, messages } from "../db/schema.js";
import { config } from "../config.js";
import { Errors } from "./errors.js";
import { extractPreview, sanitizeHtml } from "./sanitize.js";

export type DeliverableMessage = {
  from: string;
  fromName?: string | null | undefined;
  subject: string;
  textBody?: string | null | undefined;
  htmlBody?: string | null | undefined;
  deliveryId: string;
  sizeBytes: number;
};

export type DeliveryInbox = {
  id: number;
  publicId: string;
  status: string;
  expiresAt: Date;
  messageCount: number;
};

export async function persistMessageForInbox(
  inbox: DeliveryInbox,
  data: DeliverableMessage
): Promise<typeof messages.$inferSelect> {
  if (data.sizeBytes > config.MAX_MESSAGE_SIZE_BYTES) {
    throw Errors.messageTooLarge();
  }

  if (inbox.status !== "active" || new Date() > inbox.expiresAt) {
    throw Errors.inboxExpired();
  }

  if (inbox.messageCount >= config.MAX_MESSAGES_PER_INBOX) {
    throw Errors.inboxFull();
  }

  const sanitizedHtml = data.htmlBody
    ? sanitizeHtml(data.htmlBody, { blockRemoteImages: true })
    : null;
  const preview = extractPreview(data.textBody ?? undefined, data.htmlBody ?? undefined);

  return db.transaction(async (tx) => {
    const [msg] = await tx
      .insert(messages)
      .values({
        inboxId: inbox.id,
        deliveryId: data.deliveryId,
        fromAddress: data.from,
        fromName: data.fromName ?? null,
        subject: data.subject,
        preview,
        textBody: data.textBody ?? null,
        htmlBody: sanitizedHtml,
        sizeBytes: data.sizeBytes,
      })
      .returning();

    if (!msg) throw new Error("Insert returned no rows");

    await tx
      .update(inboxes)
      .set({
        messageCount: inbox.messageCount + 1,
        lastMessageAt: new Date(),
      })
      .where(eq(inboxes.id, inbox.id));

    return msg;
  });
}
