import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  pgEnum,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const inboxStatusEnum = pgEnum("inbox_status", [
  "active",
  "expired",
  "deleted",
]);
export const inboxCategoryEnum = pgEnum("inbox_category", ["work", "school", "personal"]);

// ---------------------------------------------------------------------------
// Inboxes
// ---------------------------------------------------------------------------

/**
 * Inboxes table.
 *
 * Security model:
 *   - `id`            Internal serial PK — never exposed externally.
 *   - `public_id`     Opaque, csprng token — safe to expose in URL path.
 *   - `access_secret` Hashed high-entropy token — client must present the
 *                     raw value; we verify against the hash. Never stored raw.
 *   - `address`       Full email address, e.g. abc123@inbox.example.com.
 *
 * Authorization: a request must supply BOTH `public_id` AND a valid
 * `access_secret` to interact with an inbox. Knowing only `public_id` gives
 * read access to nothing — this prevents enumeration attacks.
 */
export const inboxes = pgTable(
  "inboxes",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    publicId: text("public_id").notNull().unique(),
    accessSecretHash: text("access_secret_hash").notNull(),
    address: text("address").notNull().unique(),
    localPart: text("local_part").notNull(),
    domain: text("domain").notNull(),
    category: inboxCategoryEnum("category").notNull().default("personal"),
    isCustomUsername: boolean("is_custom_username").notNull().default(false),
    status: inboxStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    messageCount: integer("message_count").notNull().default(0),
  },
  (t) => ({
    idxInboxesAddress: index("idx_inboxes_address").on(t.address),
    idxInboxesExpiresAt: index("idx_inboxes_expires_at").on(t.expiresAt),
    idxInboxesStatus: index("idx_inboxes_status").on(t.status),
    idxInboxesPublicId: uniqueIndex("idx_inboxes_public_id").on(t.publicId),
  })
);

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const messages = pgTable(
  "messages",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    inboxId: integer("inbox_id")
      .notNull()
      .references(() => inboxes.id, { onDelete: "cascade" }),
    /** Unique delivery identifier supplied by the MTA (e.g. Message-ID header). */
    deliveryId: text("delivery_id").notNull().unique(),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    subject: text("subject").notNull().default("(no subject)"),
    /** Truncated plain-text preview stored separately for list views. */
    preview: text("preview").notNull().default(""),
    textBody: text("text_body"),
    /** HTML body sanitized by DOMPurify before storage. */
    htmlBody: text("html_body"),
    /** Raw message size in bytes. */
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxMessagesInboxId: index("idx_messages_inbox_id").on(t.inboxId),
    idxMessagesReceivedAt: index("idx_messages_received_at").on(t.receivedAt),
    idxMessagesDeliveryId: uniqueIndex("idx_messages_delivery_id").on(t.deliveryId),
  })
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const inboxRelations = relations(inboxes, ({ many }) => ({
  messages: many(messages),
}));

export const messageRelations = relations(messages, ({ one }) => ({
  inbox: one(inboxes, {
    fields: [messages.inboxId],
    references: [inboxes.id],
  }),
}));

// ---------------------------------------------------------------------------
// TypeScript types
// ---------------------------------------------------------------------------

export type Inbox = typeof inboxes.$inferSelect;
export type NewInbox = typeof inboxes.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
