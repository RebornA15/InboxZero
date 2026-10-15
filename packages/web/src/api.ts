import type { AddressOptions, CreateInboxOptions, Inbox, MessageDetail, MessageListItem, SSEEvent, StoredInboxSession } from "./types";

// The value includes /api (for example https://inboxzero-api.onrender.com/api).
// Empty values preserve Vite's same-origin development proxy.
const API_BASE = (import.meta.env.VITE_API_BASE_URL?.trim() || "/api").replace(/\/+$/, "");

export async function getAddressOptions(signal?: AbortSignal): Promise<AddressOptions> {
  const response = await fetch(`${API_BASE}/inboxes/options`, { signal });
  if (!response.ok) throw new Error("Could not load address styles. Please try again.");
  return response.json();
}

export async function createInbox(options: CreateInboxOptions | string = { category: "personal" }): Promise<StoredInboxSession> {
  const res = await fetch(`${API_BASE}/inboxes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(typeof options === "string" ? { domain: options } : options),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || errorData.error || `Failed to create inbox (HTTP ${res.status})`);
  }

  const data = await res.json();
  return {
    inbox: data.inbox,
    accessSecret: data.accessSecret,
  };
}

export async function getInbox(publicId: string, accessSecret: string): Promise<Inbox> {
  const res = await fetch(`${API_BASE}/inboxes/${publicId}`, {
    headers: {
      "X-Access-Secret": accessSecret,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch inbox details (HTTP ${res.status})`);
  }

  const data = await res.json();
  return data.inbox;
}

export async function getMessages(publicId: string, accessSecret: string): Promise<MessageListItem[]> {
  const res = await fetch(`${API_BASE}/inboxes/${publicId}/messages`, {
    headers: {
      "X-Access-Secret": accessSecret,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch messages (HTTP ${res.status})`);
  }

  const data = await res.json();
  return data.messages;
}

export async function getMessage(
  publicId: string,
  messageId: number,
  accessSecret: string
): Promise<MessageDetail> {
  const res = await fetch(`${API_BASE}/inboxes/${publicId}/messages/${messageId}`, {
    headers: {
      "X-Access-Secret": accessSecret,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch message details (HTTP ${res.status})`);
  }

  const data = await res.json();
  return data.message;
}

export async function deleteMessage(
  publicId: string,
  messageId: number,
  accessSecret: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/inboxes/${publicId}/messages/${messageId}`, {
    method: "DELETE",
    headers: {
      "X-Access-Secret": accessSecret,
    },
  });

  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete message (HTTP ${res.status})`);
  }
}

/**
 * Modern fetch-based SSE connection that passes custom X-Access-Secret header
 */
export function connectInboxEvents(
  publicId: string,
  accessSecret: string,
  onEvent: (event: SSEEvent) => void,
  onStatusChange: (connected: boolean) => void
): () => void {
  const abortController = new AbortController();
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 1000;
  let terminal = false;

  async function startStream() {
    try {
      const response = await fetch(`${API_BASE}/inboxes/${publicId}/events`, {
        headers: {
          "X-Access-Secret": accessSecret,
          Accept: "text/event-stream",
        },
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        terminal = [401, 404, 410].includes(response.status);
        return;
      }

      retryDelay = 1000;
      onStatusChange(true);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventType: SSEEvent["type"] | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep unfinished trailing buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            eventType = null;
          } else if (trimmed.startsWith("event:")) {
            eventType = trimmed.replace(/^event:\s*/, "") as SSEEvent["type"];
          } else if (trimmed.startsWith("data:")) {
            const rawData = trimmed.replace(/^data:\s*/, "");
            try {
              const parsed = JSON.parse(rawData);
              onEvent(
                eventType
                  ? ({ type: eventType, payload: parsed } as SSEEvent)
                  : (parsed as SSEEvent)
              );
            } catch (err) {
              console.warn("Failed to parse SSE line:", line, err);
            }
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name !== "AbortError") {
        console.warn("SSE stream interrupted:", err);
      }
    } finally {
      onStatusChange(false);
      if (!abortController.signal.aborted && !terminal) {
        retryTimer = setTimeout(startStream, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000);
      }
    }
  }

  void startStream();

  return () => {
    clearTimeout(retryTimer);
    abortController.abort();
  };
}

/**
 * Optional helper for developer / demo simulation of inbound messages
 */
export async function simulateIncomingMail(
  publicId: string,
  accessSecret: string,
  subject: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/inboxes/${publicId}/simulate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Access-Secret": accessSecret,
      },
      body: JSON.stringify({ subject }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
