/**
 * Backup and restore failure codes. Every failure the user can see maps to one
 * of these, so the UI can offer an honest message and a retry only where a
 * retry can actually help.
 */

export const BACKUP_ERROR_CODES = [
  "google_not_configured",
  "google_not_connected",
  "google_authorization_expired",
  "google_permission_denied",
  "drive_unavailable",
  "drive_insufficient_storage",
  "upload_failed",
  "download_failed",
  "integrity_check_failed",
  "decryption_failed",
  "incompatible_version",
  "invalid_backup",
  "no_snapshot",
  "no_backup",
  "job_already_running",
  "rate_limited",
  "encryption_key_missing",
  "network_error",
  "unknown",
] as const;

export type BackupErrorCode = (typeof BACKUP_ERROR_CODES)[number];

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  /** True when running the same operation again could plausibly succeed. */
  readonly retryable: boolean;

  constructor(code: BackupErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "BackupError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function isBackupError(value: unknown): value is BackupError {
  return value instanceof BackupError;
}

/** Plain-language text for each failure, shown in the app. */
export const BACKUP_ERROR_TEXT: Record<BackupErrorCode, string> = {
  google_not_configured:
    "Google backup is not configured for this app yet. Backups cannot run until it is.",
  google_not_connected: "Connect a Google account to back up.",
  google_authorization_expired: "Google access has expired. Reconnect your Google account.",
  google_permission_denied: "Google refused the permission needed for backup. Reconnect to grant it.",
  drive_unavailable: "Google Drive did not respond. Try again.",
  drive_insufficient_storage: "There is not enough space left in your Google account.",
  upload_failed: "The backup could not be uploaded. Try again.",
  download_failed: "The backup could not be downloaded. Try again.",
  integrity_check_failed: "The backup file did not match its fingerprint, so it was not used.",
  decryption_failed: "This backup could not be unlocked with your account key.",
  incompatible_version: "This backup was made by a different version of N Connect and cannot be restored.",
  invalid_backup: "The backup file is damaged and cannot be restored.",
  no_snapshot: "Open N Connect on your device once so it can hand over the latest data.",
  no_backup: "There is no backup yet.",
  job_already_running: "A backup is already running.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  encryption_key_missing: "Backup encryption is not configured on the server.",
  network_error: "No connection. Try again when you are back online.",
  unknown: "Something went wrong. Try again.",
};
