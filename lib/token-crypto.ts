// Reversible encryption for signing tokens, used ONLY to resend the same
// link in reminder emails. The one-way accessTokenHash (SHA-256, in
// lib/auth-adjacent code) remains what actually authenticates incoming
// signing requests — this file is never used for that check. Keeping the
// two fully separate means a bug in the reminder-resend path can't weaken
// the security-critical auth path.

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function key(): Buffer {
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret) throw new Error("TOKEN_ENCRYPTION_KEY is not set — required to encrypt/decrypt signing tokens for resend");
  if (secret.length !== 64) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a 64-char hex string (32 bytes) — generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  }
  return Buffer.from(secret, "hex");
}

export function encryptToken(rawToken: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(rawToken, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv.authTag.ciphertext, all hex — simple enough to store in one column
  return `${iv.toString("hex")}.${authTag.toString("hex")}.${encrypted.toString("hex")}`;
}

export function decryptToken(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}
