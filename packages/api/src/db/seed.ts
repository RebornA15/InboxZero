import { db } from "./index.js";
import { inboxes, messages } from "./schema.js";
import { hashSecret, randomToken } from "../lib/crypto.js";

async function seed() {
  console.log("Seeding database...");

  const rawSecret = randomToken(48);
  const secretHash = await hashSecret(rawSecret);
  const publicId = randomToken(24);
  const localPart = "demo123";
  const domain = "inbox.example.com";
  const address = `${localPart}@${domain}`;

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  const [inbox] = await db
    .insert(inboxes)
    .values({
      publicId,
      accessSecretHash: secretHash,
      address,
      localPart,
      domain,
      expiresAt,
      messageCount: 1,
    })
    .returning();

  if (inbox) {
    await db.insert(messages).values({
      inboxId: inbox.id,
      deliveryId: `seed-${Date.now()}`,
      fromAddress: "welcome@inboxzero.dev",
      fromName: "InboxZero Team",
      subject: "Welcome to your disposable inbox!",
      preview: "Welcome to InboxZero. Your private disposable address is ready to receive emails.",
      textBody: "Welcome to InboxZero!\n\nYour temporary inbox is now active and ready. All emails sent to this address will be displayed in real time.",
      htmlBody: "<p>Welcome to <strong>InboxZero</strong>!</p><p>Your temporary inbox is now active and ready.</p>",
      sizeBytes: 1024,
    });

    console.log(`Seed complete!
Inbox: ${address}
Public ID: ${publicId}
Access Secret: ${rawSecret}`);
  }

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
