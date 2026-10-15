import { eq, lt, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { inboxes, messages } from "../db/schema.js";
import { sseManager } from "./sse.js";
import { config } from "../config.js";

let cleanupTimer: NodeJS.Timeout | null = null;

function serializeCleanupError(err: unknown) {
  if (!(err instanceof Error)) return err;

  const pgError = err as Error & {
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

  if (config.NODE_ENV === "production") return { name: pgError.name, code: pgError.code };
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
      // Log operational outcome without revealing message content
      console.error(
        `[cleanup] Failed to expire inbox ${inbox.publicId}:`,
        serializeCleanupError(err)
      );
    }
  }

  return { expiredInboxes: expired.length, deletedMessages };
}

export function startCleanupWorker(): void {
  const interval = config.CLEANUP_INTERVAL_MS;
  console.log(`[cleanup] Worker started, interval: ${interval}ms`);

  cleanupTimer = setInterval(async () => {
    try {
      const result = await runCleanup();
      if (result.expiredInboxes > 0) {
        console.log(`[cleanup] Expired ${result.expiredInboxes} inboxes, deleted ${result.deletedMessages} messages`);
      }
    } catch (err) {
      console.error("[cleanup] Worker error:", serializeCleanupError(err));
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
