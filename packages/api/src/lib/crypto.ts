import crypto from "crypto";

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = "sha512";
const SALT_BYTES = 32;

/**
 * Generates a cryptographically secure random hex string.
 */
export function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * Generates a URL-safe base64 token.
 */
export function randomToken(bytes: number): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/**
 * Hashes a secret using PBKDF2 with a random salt.
 * Returns a string in the format `salt:hash` (both hex).
 */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomHex(SALT_BYTES);
  const hash = await pbkdf2(secret, salt);
  return `${salt}:${hash}`;
}

/**
 * Verifies a raw secret against a stored `salt:hash` string.
 * Uses constant-time comparison to prevent timing attacks.
 */
export async function verifySecret(
  raw: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 2) return false;
  const [salt, expectedHash] = parts as [string, string];
  const actualHash = await pbkdf2(raw, salt);
  // Constant-time comparison
  return crypto.timingSafeEqual(
    Buffer.from(actualHash, "hex"),
    Buffer.from(expectedHash, "hex")
  );
}

function pbkdf2(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(
      password,
      salt,
      PBKDF2_ITERATIONS,
      PBKDF2_KEYLEN,
      PBKDF2_DIGEST,
      (err, key) => {
        if (err) reject(err);
        else resolve(key.toString("hex"));
      }
    );
  });
}

/**
 * Generates a random email local part (8 alphanumeric chars).
 * Uses crypto.randomBytes for true randomness — not sequential.
 */
export function generateLocalPart(length = 12): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes)
    .map((b) => alphabet[b % alphabet.length])
    .join("");
}
