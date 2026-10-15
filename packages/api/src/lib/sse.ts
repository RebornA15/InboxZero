import type { FastifyReply } from "fastify";

export type SSEEvent =
  | { type: "message:new"; payload: { messageId: number; inboxId: string } }
  | { type: "message:deleted"; payload: { messageId: number } }
  | { type: "inbox:expired"; payload: { inboxId: string } }
  | { type: "ping" };

/**
 * Server-Sent Events manager.
 *
 * Tracks active SSE connections keyed by inbox public_id.
 * Publishes events to all subscribers for a given inbox.
 */
class SSEManager {
  private subscribers = new Map<string, Set<FastifyReply>>();

  subscribe(inboxId: string, reply: FastifyReply): void {
    if (!this.subscribers.has(inboxId)) {
      this.subscribers.set(inboxId, new Set());
    }
    this.subscribers.get(inboxId)!.add(reply);

    // Clean up on connection close
    reply.raw.on("close", () => {
      this.unsubscribe(inboxId, reply);
    });
  }

  unsubscribe(inboxId: string, reply: FastifyReply): void {
    const set = this.subscribers.get(inboxId);
    if (!set) return;
    set.delete(reply);
    if (set.size === 0) {
      this.subscribers.delete(inboxId);
    }
  }

  publish(inboxId: string, event: SSEEvent): void {
    const set = this.subscribers.get(inboxId);
    if (!set || set.size === 0) return;

    const data = this.format(event);
    for (const reply of set) {
      try {
        reply.raw.write(data);
      } catch {
        // Connection likely closed — will be cleaned up on close event
      }
    }
  }

  closeAll(): void {
    for (const replies of this.subscribers.values()) {
      for (const reply of replies) reply.raw.end();
    }
    this.subscribers.clear();
  }

  subscriberCount(inboxId: string): number {
    return this.subscribers.get(inboxId)?.size ?? 0;
  }

  private format(event: SSEEvent): string {
    if (event.type === "ping") {
      return ": ping\n\n";
    }
    return `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
  }
}

export const sseManager = new SSEManager();
