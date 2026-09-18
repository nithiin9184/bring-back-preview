/**
 * Backup and restore job runners (server only).
 *
 * The server is the authority: it reads the account's own encrypted snapshot,
 * validates it, encrypts the archive, uploads it to that account's private
 * Google Drive app folder, verifies what landed there, and only then records a
 * completed backup. A job that fails anywhere records the real failure code.
 */

import { decryptForUser, decryptFromBase64, encryptForUser, sha256Hex } from "./crypto.server";
import { BackupError, isBackupError } from "./errors";
import {
  applyRetentionRules,
  backupPayloadSchema,
  BACKUP_VERSION,
  countItems,
  MIN_RESTORABLE_VERSION,
  type BackupPayload,
} from "./format";
import {
  deleteBackupFile,
  downloadBackupFile,
  isGoogleConfigured,
  loadConnection,
  statBackupFile,
  uploadBackupFile,
} from "./google-drive.server";
import {
  getBackup,
  getSnapshot,
  insertBackup,
  listBackups,
  markBackupDeleted,
  updateBackupJob,
  updateRestoreJob,
} from "./repository.server";

/** Completed archives kept per account; older ones are removed from Drive. */
const KEEP_BACKUPS = 5;

export function failureOf(error: unknown): { code: string; message: string; retryable: boolean } {
  if (isBackupError(error)) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  console.error("[backup] unexpected failure", error);
  return { code: "unknown", message: "Unexpected failure", retryable: true };
}

async function requireConnection(userId: string) {
  if (!isGoogleConfigured()) {
    throw new BackupError("google_not_configured", "Google Drive is not configured.");
  }
  const connection = await loadConnection(userId);
  if (!connection) {
    throw new BackupError("google_not_connected", "No Google account is connected.");
  }
  return connection;
}

function stripMedia(payload: BackupPayload): BackupPayload {
  const messages: BackupPayload["messages"] = {};
  for (const [chat, list] of Object.entries(payload.messages)) {
    messages[chat] = list.map(({ mediaHash: _drop, ...rest }) => rest);
  }
  return { ...payload, includes_media: false, media: {}, messages };
}

export async function runBackupJob(
  userId: string,
  jobId: string,
  includeMedia: boolean,
): Promise<{ ok: true; backupId: string } | { ok: false; code: string; message: string }> {
  try {
    await updateBackupJob(jobId, userId, { state: "preparing", progress: 10 });
    const connection = await requireConnection(userId);

    const snapshot = await getSnapshot(userId);
    if (!snapshot) {
      throw new BackupError(
        "no_snapshot",
        "This account has not handed the server any data to back up yet.",
      );
    }

    let payload: BackupPayload;
    try {
      const plain = decryptFromBase64(userId, snapshot.payload_ciphertext).toString("utf8");
      payload = backupPayloadSchema.parse(JSON.parse(plain));
    } catch (error) {
      if (isBackupError(error)) throw error;
      throw new BackupError("invalid_backup", "The stored device snapshot is unreadable.");
    }
    if (payload.backup_version !== BACKUP_VERSION) {
      throw new BackupError("incompatible_version", "The device snapshot uses another format.");
    }

    // Expired statuses and disappearing messages never make it into an archive.
    payload = applyRetentionRules(payload);
    if (!includeMedia) payload = stripMedia(payload);
    payload = { ...payload, created_at: new Date().toISOString() };

    const counts = countItems(payload);
    const ciphertext = encryptForUser(userId, Buffer.from(JSON.stringify(payload), "utf8"));
    const checksum = sha256Hex(ciphertext);

    await updateBackupJob(jobId, userId, { state: "uploading", progress: 45 });
    const fileName = `nconnect-backup-v${BACKUP_VERSION}-${Date.now()}.ncb`;
    const { fileId } = await uploadBackupFile(userId, connection.connectionKey, fileName, ciphertext);

    await updateBackupJob(jobId, userId, { state: "verifying", progress: 80 });
    const stat = await statBackupFile(userId, connection.connectionKey, fileId);
    if (!stat || stat.size !== ciphertext.length) {
      throw new BackupError(
        "integrity_check_failed",
        "The uploaded archive did not match what was sent.",
        true,
      );
    }
    // Byte-for-byte verification: download it back and re-check the fingerprint.
    const roundTrip = await downloadBackupFile(userId, connection.connectionKey, fileId);
    if (sha256Hex(roundTrip) !== checksum) {
      await deleteBackupFile(userId, connection.connectionKey, fileId).catch(() => undefined);
      throw new BackupError("integrity_check_failed", "The archive failed its fingerprint check.", true);
    }

    const backupId = await insertBackup({
      user_id: userId,
      backup_version: BACKUP_VERSION,
      drive_file_id: fileId,
      destination: "google_drive_appdata",
      size_bytes: ciphertext.length,
      checksum,
      encryption: "aes-256-gcm",
      includes_media: payload.includes_media,
      item_counts: counts,
      status: "completed",
      completed_at: new Date().toISOString(),
    });

    await updateBackupJob(jobId, userId, {
      state: "completed",
      progress: 100,
      backup_id: backupId,
      error_code: null,
      error_message: null,
      finished_at: new Date().toISOString(),
    });

    await pruneOldBackups(userId, connection.connectionKey);
    return { ok: true, backupId };
  } catch (error) {
    const failure = failureOf(error);
    await updateBackupJob(jobId, userId, {
      state: "failed",
      error_code: failure.code,
      error_message: failure.message,
      finished_at: new Date().toISOString(),
    });
    return { ok: false, code: failure.code, message: failure.message };
  }
}

async function pruneOldBackups(userId: string, connectionKey: string) {
  const all = await listBackups(userId, 50);
  for (const backup of all.slice(KEEP_BACKUPS)) {
    const fileId = backup["drive_file_id"] as string | null;
    if (fileId) {
      await deleteBackupFile(userId, connectionKey, fileId).catch(() => undefined);
    }
    await markBackupDeleted(userId, backup["id"] as string);
  }
}

export async function runRestoreJob(
  userId: string,
  jobId: string,
  backupId: string,
): Promise<
  | { ok: true; payload: BackupPayload; counts: ReturnType<typeof countItems> }
  | { ok: false; code: string; message: string }
> {
  try {
    const connection = await requireConnection(userId);
    // Ownership: the row is fetched with the user id in the predicate, so a
    // backup belonging to another account simply does not exist here.
    const backup = await getBackup(userId, backupId);
    if (!backup || backup.status !== "completed" || !backup.drive_file_id) {
      throw new BackupError("no_backup", "That backup is not available.");
    }

    await updateRestoreJob(jobId, userId, { state: "downloading", progress: 25 });
    const blob = await downloadBackupFile(userId, connection.connectionKey, backup.drive_file_id);

    await updateRestoreJob(jobId, userId, { state: "verifying", progress: 50 });
    if (sha256Hex(blob) !== backup.checksum) {
      throw new BackupError("integrity_check_failed", "The downloaded archive was damaged.");
    }

    await updateRestoreJob(jobId, userId, { state: "decrypting", progress: 65 });
    const plain = decryptForUser(userId, blob).toString("utf8");

    let payload: BackupPayload;
    try {
      payload = backupPayloadSchema.parse(JSON.parse(plain));
    } catch {
      throw new BackupError("invalid_backup", "The archive contents are damaged.");
    }
    if (payload.backup_version < MIN_RESTORABLE_VERSION || payload.backup_version > BACKUP_VERSION) {
      throw new BackupError("incompatible_version", "This archive cannot be restored by this build.");
    }

    await updateRestoreJob(jobId, userId, { state: "restoring", progress: 85 });
    // Expired statuses and disappearing messages are never resurrected.
    const safe = applyRetentionRules(payload);
    const counts = countItems(safe);
    await updateRestoreJob(jobId, userId, {
      state: "completed",
      progress: 100,
      restored_counts: counts,
      error_code: null,
      error_message: null,
      finished_at: new Date().toISOString(),
    });
    return { ok: true, payload: safe, counts };
  } catch (error) {
    const failure = failureOf(error);
    await updateRestoreJob(jobId, userId, {
      state: "failed",
      error_code: failure.code,
      error_message: failure.message,
      finished_at: new Date().toISOString(),
    });
    return { ok: false, code: failure.code, message: failure.message };
  }
}
