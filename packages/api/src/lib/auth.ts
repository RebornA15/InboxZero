import type { FastifyRequest } from "fastify";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { inboxes } from "../db/schema.js";
import { verifySecret } from "./crypto.js";
import { Errors } from "./errors.js";

/**
 * Authorization scheme for inbox access.
 *
 * A caller must present both:
 *   1. `publicId` — the inbox's opaque public identifier (path parameter).
 *   2. `X-Access-Secret` header — the raw high-entropy secret issued at
 *      inbox creation time.
 *
 * We verify the raw secret against the stored PBKDF2 hash.
 *
 * Limitations:
 *   - This is a "bearer secret" model. The secret should be stored in
 *     sessionStorage (not localStorage) and never in URLs.
 *   - There is no account system; the secret is the only credential.
 *   - Rate limiting reduces brute-force risk on the hash.
 *   - Forward secrecy is not provided — rotate inboxes frequently.
 *
 * DO NOT log or include the raw secret in error responses.
 */
export async function authorizeInbox(
  request: FastifyRequest,
  publicId: string
): Promise<{ id: number; publicId: string; status: string; expiresAt: Date }> {
  const rawSecret = (request.headers["x-access-secret"] as string) ?? "";

  if (!rawSecret) {
    throw Errors.unauthorized();
  }

  const rows = await db
    .select({
      id: inboxes.id,
      publicId: inboxes.publicId,
      accessSecretHash: inboxes.accessSecretHash,
      status: inboxes.status,
      expiresAt: inboxes.expiresAt,
    })
    .from(inboxes)
    .where(eq(inboxes.publicId, publicId));

  const inbox = rows[0];
  if (!inbox) {
    // Return 401 rather than 404 to avoid confirming or denying existence
    throw Errors.unauthorized();
  }

  const valid = await verifySecret(rawSecret, inbox.accessSecretHash);
  if (!valid) {
    throw Errors.unauthorized();
  }

  if (inbox.status === "expired" || inbox.status === "deleted") {
    throw Errors.inboxExpired();
  }

  if (new Date() > inbox.expiresAt) {
    throw Errors.inboxExpired();
  }

  return {
    id: inbox.id,
    publicId: inbox.publicId,
    status: inbox.status,
    expiresAt: inbox.expiresAt,
  };
}
