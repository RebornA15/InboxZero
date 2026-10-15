export type InboxCategory = "work" | "school" | "personal";
export const categoryLabels: Record<InboxCategory, string> = {
  work: "Work Email", school: "School Email", personal: "Personal Email",
};

export interface CreateInboxOptions {
  category: InboxCategory;
  username?: string;
}

export interface AddressOptions {
  categories: { category: InboxCategory; label: string; domain: string }[];
  customUsernamesEnabled: boolean;
  development: boolean;
}

export interface Inbox {
  publicId: string;
  address: string;
  category: InboxCategory;
  isCustomUsername: boolean;
  status: "active" | "expired" | "deleted";
  createdAt: string;
  expiresAt: string;
  lastMessageAt?: string | null;
  messageCount?: number;
}

export interface StoredInboxSession {
  inbox: Inbox;
  accessSecret: string;
}

export interface MessageListItem {
  id: number;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  preview: string;
  sizeBytes: number;
  receivedAt: string;
}

export interface MessageDetail {
  id: number;
  inboxId: number;
  deliveryId: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  preview: string;
  textBody: string | null;
  htmlBody: string | null;
  sizeBytes: number;
  receivedAt: string;
}

export type SSEEvent =
  | { type: "message:new"; payload: { messageId: number; inboxId: string } }
  | { type: "message:deleted"; payload: { messageId: number } }
  | { type: "inbox:expired"; payload: { inboxId: string } };
