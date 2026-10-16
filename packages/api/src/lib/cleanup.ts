import { eq, lt, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { inboxes, messages } from "../db/schema.js";
import { sseManager } from "./sse.js";
import { config } from "../config.js";
import { logDatabaseError } from "../db/errors.js";

let cleanupTimer: NodeJS.Timeout | null = null;
let cleanupInFlight = false;

export async function runCleanup(): Promise<{
  expiredInboxes: number;
  deletedMessages: number;
}> {
  const now = new Date();

  // Find active inboxes that have passed their expiration time
  const expired = await db
    .select({ id: inboxes.id, publicId: inboxes.publicId })
    .from(inboxes)
    .where(
      and(
        eq(inboxes.status, "active"),
        lt(inboxes.expiresAt, now)
      )
    );

  if (expired.length === 0) {
    return { expiredInboxes: 0, deletedMessages: 0 };
  }

  let deletedMessages = 0;

  for (const inbox of expired) {
    try {
      // Notify connected clients before deletion
      sseManager.publish(inbox.publicId, {
        type: "inbox:expired",
        payload: { inboxId: inbox.publicId },
      });

      // Delete messages (also handled by ON DELETE CASCADE)
      const deleted = await db
        .delete(messages)
        .where(eq(messages.inboxId, inbox.id))
        .returning({ id: messages.id });

      deletedMessages += deleted.length;

      // Mark inbox as expired (keep record for audit, do not store message content)
      await db
        .update(inboxes)
        .set({ status: "expired" })
        .where(eq(inboxes.id, inbox.id));

      console.log(`[cleanup] Expired inbox ${inbox.publicId}, deleted ${deleted.length} messages`);
    } catch (err) {
      logDatabaseError("cleanup", err);
    }
  }

  return { expiredInboxes: expired.length, deletedMessages };
}

export function startCleanupWorker(): void {
  if (cleanupTimer) return;
  const interval = config.CLEANUP_INTERVAL_MS;
  console.log(`[cleanup] Worker started, interval: ${interval}ms`);

  cleanupTimer = setInterval(async () => {
    if (cleanupInFlight) return;
    cleanupInFlight = true;
    try {
      const result = await runCleanup();
      if (result.expiredInboxes > 0) {
        console.log(`[cleanup] Expired ${result.expiredInboxes} inboxes, deleted ${result.deletedMessages} messages`);
      }
    } catch (err) {
      logDatabaseError("cleanup", err);
    } finally {
      cleanupInFlight = false;
    }
  }, interval);

  // Don't block process exit
  cleanupTimer.unref();
}

export function stopCleanupWorker(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
