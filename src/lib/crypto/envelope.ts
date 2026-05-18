import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function loadKey(): Buffer {
  const raw = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "OAUTH_TOKEN_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to .env.local.",
    );
  }
  const buf = Buffer.from(raw.trim(), "base64");
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `OAUTH_TOKEN_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes; got ${buf.length}. Re-run \`openssl rand -base64 32\`.`,
    );
  }
  return buf;
}

let cachedKey: Buffer | null = null;
function key(): Buffer {
  cachedKey ??= loadKey();
  return cachedKey;
}

// Encrypt a UTF-8 string with AES-256-GCM. Output is a single base64 string
// containing iv (12 bytes) || tag (16 bytes) || ciphertext.
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error("ciphertext too short to contain iv + tag + data");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
