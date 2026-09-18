/**
 * Backup encryption (server only).
 *
 * Archives are encrypted with AES-256-GCM before they ever leave the server, so
 * Google Drive only ever holds ciphertext. The key is derived per account:
 *
 *   userKey = HMAC-SHA256(SHA-256(BACKUP_ENCRYPTION_KEY), "nconnect-backup:v1:<userId>")
 *
 * BACKUP_ENCRYPTION_KEY lives only in the server environment. Deriving per user
 * means one account's archive can never be opened with another account's key.
 * The key is server-held, so a user cannot lose it — but it also means the
 * server (not the device) is the trust anchor for backups. The key is never
 * written to Drive, never logged and never sent to the browser.
 */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { BackupError } from "./errors";

const IV_BYTES = 12;
const TAG_BYTES = 16;

function masterKey(): Buffer {
  const raw = process.env["BACKUP_ENCRYPTION_KEY"];
  if (!raw) {
    throw new BackupError("encryption_key_missing", "BACKUP_ENCRYPTION_KEY is not set");
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

function userKey(userId: string): Buffer {
  return createHmac("sha256", masterKey()).update(`nconnect-backup:v1:${userId}`).digest();
}

/** Encrypts to `iv | tag | ciphertext`. */
export function encryptForUser(userId: string, plaintext: Buffer | string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", userKey(userId), iv);
  const body = Buffer.concat([
    cipher.update(typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decryptForUser(userId: string, blob: Buffer): Buffer {
  if (blob.length <= IV_BYTES + TAG_BYTES) {
    throw new BackupError("invalid_backup", "Encrypted payload is too short");
  }
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = blob.subarray(IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", userKey(userId), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    // Wrong key or tampered bytes — both mean "do not use this archive".
    throw new BackupError("decryption_failed", "Backup could not be decrypted");
  }
}

export function encryptToBase64(userId: string, plaintext: Buffer | string): string {
  return encryptForUser(userId, plaintext).toString("base64");
}

export function decryptFromBase64(userId: string, stored: string): Buffer {
  return decryptForUser(userId, Buffer.from(stored, "base64"));
}

/** Integrity fingerprint stored alongside the backup metadata. */
export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
