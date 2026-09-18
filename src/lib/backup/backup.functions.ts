/**
 * Backup & restore server functions.
 *
 * Every endpoint here is authenticated with `requireSupabaseAuth`, and every
 * database statement is scoped to `context.userId`. Nothing trusts a user id
 * coming from the browser.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  backupPayloadSchema,
  backupSettingsPatchSchema,
  BACKUP_VERSION,
  countItems,
  type BackupPayload,
  type BackupSettingsPatch,
} from "./format";
import { isBackupError, BACKUP_ERROR_TEXT, type BackupErrorCode } from "./errors";


function fail(error: unknown) {
  if (isBackupError(error)) {
    return { ok: false as const, code: error.code, message: BACKUP_ERROR_TEXT[error.code], retryable: error.retryable };
  }
  console.error("[backup] endpoint failure", error);
  return { ok: false as const, code: "unknown" as BackupErrorCode, message: BACKUP_ERROR_TEXT.unknown, retryable: true };
}

/* ---------------- overview ---------------- */

export const getBackupOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ isGoogleConfigured, readConnectionRow }, repo] = await Promise.all([
      import("./google-drive.server"),
      import("./repository.server"),
    ]);
    const userId = context.userId;
    const [connection, settings, backups, backupJob, restoreJob, snapshot] = await Promise.all([
      readConnectionRow(userId),
      repo.getSettings(userId),
      repo.listBackups(userId, 5),
      repo.latestBackupJob(userId),
      repo.latestRestoreJob(userId),
      repo.getSnapshot(userId),
    ]);

    return {
      configured: isGoogleConfigured(),
      google: connection
        ? {
            status: connection.status as "connected" | "revoked" | "disconnected",
            email: connection.google_email as string | null,
            connectedAt: connection.connected_at as string,
          }
        : null,
      settings: {
        autoEnabled: settings.auto_enabled,
        frequency: settings.frequency,
        includeMedia: settings.include_media,
        nextRunAt: settings.next_run_at,
      },
      backups: backups.map((b) => ({
        id: b["id"] as string,
        createdAt: (b["completed_at"] ?? b["created_at"]) as string,
        sizeBytes: Number(b["size_bytes"] ?? 0),
        includesMedia: Boolean(b["includes_media"]),
        version: Number(b["backup_version"]),
        counts: b["item_counts"] as Record<string, number>,
      })),
      backupJob,
      restoreJob,
      snapshotAt: snapshot?.captured_at ?? null,
    };
  });

/* ---------------- Google connection ---------------- */

export const startGoogleConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { startGoogleAuthorization } = await import("./google-drive.server");
      const { enforceRateLimit } = await import("./repository.server");
      await enforceRateLimit(context.userId, "connect");

      const request = getRequest();
      if (!request) throw new Error("Missing request");
      const url = new URL(request.url);
      const sandboxHost =
        url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
      const origin = sandboxHost ? `https://${sandboxHost}` : url.origin;
      const returnUrl = new URL("/oauth/google-drive/return", origin).toString();

      const authorizationUrl = await startGoogleAuthorization(context.userId, returnUrl);
      return { ok: true as const, authorizationUrl };
    } catch (error) {
      return fail(error);
    }
  });

export const completeGoogleConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string }) => z.object({ code: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    try {
      const { completeGoogleAuthorization } = await import("./google-drive.server");
      const { email } = await completeGoogleAuthorization(context.userId, data.code);
      return { ok: true as const, email };
    } catch (error) {
      return fail(error);
    }
  });

export const disconnectGoogleAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { disconnectGoogle } = await import("./google-drive.server");
      await disconnectGoogle(context.userId);
      return { ok: true as const };
    } catch (error) {
      return fail(error);
    }
  });

/* ---------------- settings ---------------- */

export const saveBackupSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: BackupSettingsPatch): BackupSettingsPatch =>
    backupSettingsPatchSchema.parse(input),
  )
  .handler(async ({ data, context }) => {
    try {
      const { saveSettings } = await import("./repository.server");
      const row = await saveSettings(context.userId, data);
      return {
        ok: true as const,
        settings: {
          autoEnabled: row.auto_enabled,
          frequency: row.frequency,
          includeMedia: row.include_media,
          nextRunAt: row.next_run_at,
        },
      };
    } catch (error) {
      return fail(error);
    }
  });

/* ---------------- device snapshot ---------------- */

export const uploadDeviceSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { payload: unknown }) => input)
  .handler(async ({ data, context }) => {
    try {
      const payload = backupPayloadSchema.parse(data.payload);
      if (payload.backup_version !== BACKUP_VERSION) {
        return { ok: false as const, code: "incompatible_version" as BackupErrorCode, message: BACKUP_ERROR_TEXT.incompatible_version, retryable: false };
      }
      const { encryptToBase64 } = await import("./crypto.server");
      const { putSnapshot } = await import("./repository.server");
      await putSnapshot(
        context.userId,
        encryptToBase64(context.userId, JSON.stringify(payload)),
        payload.backup_version,
        countItems(payload),
      );
      return { ok: true as const };
    } catch (error) {
      return fail(error);
    }
  });

/* ---------------- run a backup ---------------- */

export const startBackupNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const repo = await import("./repository.server");
      const { runBackupJob } = await import("./runner.server");
      await repo.enforceRateLimit(context.userId, "backup");
      const settings = await repo.getSettings(context.userId);
      const jobId = await repo.createBackupJob(context.userId, "manual", settings.include_media);
      const result = await runBackupJob(context.userId, jobId, settings.include_media);
      if (!result.ok) {
        return {
          ok: false as const,
          code: result.code as BackupErrorCode,
          message: BACKUP_ERROR_TEXT[result.code as BackupErrorCode] ?? result.message,
          retryable: true,
        };
      }
      return { ok: true as const, backupId: result.backupId };
    } catch (error) {
      return fail(error);
    }
  });

/* ---------------- restore ---------------- */

export const startRestore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { backupId: string }) =>
    z.object({ backupId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    try {
      const repo = await import("./repository.server");
      const { runRestoreJob } = await import("./runner.server");
      await repo.enforceRateLimit(context.userId, "restore");
      const jobId = await repo.createRestoreJob(context.userId, data.backupId);
      const result = await runRestoreJob(context.userId, jobId, data.backupId);
      if (!result.ok) {
        return {
          ok: false as const,
          code: result.code as BackupErrorCode,
          message: BACKUP_ERROR_TEXT[result.code as BackupErrorCode] ?? result.message,
          retryable: true,
        };
      }
      return { ok: true as const, payload: result.payload, counts: result.counts };
    } catch (error) {
      return fail(error);
    }
  });

/* ---------------- delete ---------------- */

export const deleteBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { backupId: string }) =>
    z.object({ backupId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    try {
      const repo = await import("./repository.server");
      const drive = await import("./google-drive.server");
      const backup = await repo.getBackup(context.userId, data.backupId);
      if (!backup) {
        return { ok: false as const, code: "no_backup" as BackupErrorCode, message: BACKUP_ERROR_TEXT.no_backup, retryable: false };
      }
      const connection = await drive.loadConnection(context.userId);
      if (connection && backup["drive_file_id"]) {
        await drive.deleteBackupFile(context.userId, connection.connectionKey, backup["drive_file_id"]);
      }
      await repo.markBackupDeleted(context.userId, data.backupId);
      return { ok: true as const };
    } catch (error) {
      return fail(error);
    }
  });
