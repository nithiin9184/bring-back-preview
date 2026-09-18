/**
 * Database access for backup & restore (server only, service role).
 *
 * Every function here takes the authenticated user id from the server function
 * context and scopes every statement to it, so one account can never read or
 * change another account's snapshot, backup, job or schedule.
 */

import { BackupError } from "./errors";
import type { BackupFrequency, BackupSettingsPatch } from "./format";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as { from: (table: string) => any };
}

export type BackupSettingsRow = {
  user_id: string;
  auto_enabled: boolean;
  frequency: BackupFrequency;
  include_media: boolean;
  next_run_at: string | null;
};

export function nextRunAt(frequency: BackupFrequency, from = new Date()): string {
  const days = frequency === "daily" ? 1 : frequency === "weekly" ? 7 : 30;
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export async function getSettings(userId: string): Promise<BackupSettingsRow> {
  const client = await db();
  const { data } = await client
    .from("backup_settings")
    .select("user_id, auto_enabled, frequency, include_media, next_run_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data as BackupSettingsRow;
  const row: BackupSettingsRow = {
    user_id: userId,
    auto_enabled: false,
    frequency: "daily",
    include_media: false,
    next_run_at: null,
  };
  await client.from("backup_settings").upsert(row, { onConflict: "user_id" });
  return row;
}

export async function saveSettings(
  userId: string,
  patch: BackupSettingsPatch,
): Promise<BackupSettingsRow> {
  const current = await getSettings(userId);
  const autoEnabled = patch.autoEnabled ?? current.auto_enabled;
  const frequency = patch.frequency ?? current.frequency;
  const includeMedia = patch.includeMedia ?? current.include_media;
  const scheduleChanged = autoEnabled !== current.auto_enabled || frequency !== current.frequency;
  const next: BackupSettingsRow = {
    user_id: userId,
    auto_enabled: autoEnabled,
    frequency,
    include_media: includeMedia,
    next_run_at: autoEnabled
      ? scheduleChanged || !current.next_run_at
        ? nextRunAt(frequency)
        : current.next_run_at
      : null,
  };
  const client = await db();
  const { error } = await client
    .from("backup_settings")
    .upsert({ ...next, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new BackupError("unknown", error.message);
  return next;
}

/* ---------------- device snapshot ---------------- */

export async function putSnapshot(
  userId: string,
  ciphertext: string,
  version: number,
  itemCounts: Record<string, number>,
) {
  const client = await db();
  const { error } = await client.from("backup_snapshots").upsert(
    {
      user_id: userId,
      payload_ciphertext: ciphertext,
      payload_version: version,
      item_counts: itemCounts,
      captured_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new BackupError("unknown", error.message);
}

export async function getSnapshot(userId: string) {
  const client = await db();
  const { data } = await client
    .from("backup_snapshots")
    .select("payload_ciphertext, payload_version, item_counts, captured_at")
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

/* ---------------- rate limiting ---------------- */

const WINDOWS: Record<string, { ms: number; max: number }> = {
  backup: { ms: 60 * 60 * 1000, max: 6 },
  restore: { ms: 60 * 60 * 1000, max: 4 },
  connect: { ms: 15 * 60 * 1000, max: 8 },
};

export async function enforceRateLimit(userId: string, operation: keyof typeof WINDOWS) {
  const rule = WINDOWS[operation]!;
  const client = await db();
  const { data } = await client
    .from("backup_rate_limits")
    .select("window_started_at, count")
    .eq("user_id", userId)
    .eq("operation", operation)
    .maybeSingle();
  const now = Date.now();
  const started = data ? new Date(data.window_started_at).getTime() : 0;
  const fresh = !data || now - started > rule.ms;
  if (!fresh && data.count >= rule.max) {
    throw new BackupError("rate_limited", "Too many attempts. Try again later.");
  }
  await client.from("backup_rate_limits").upsert(
    {
      user_id: userId,
      operation,
      window_started_at: fresh ? new Date(now).toISOString() : data.window_started_at,
      count: fresh ? 1 : data.count + 1,
    },
    { onConflict: "user_id,operation" },
  );
}

/* ---------------- jobs ---------------- */

export async function createBackupJob(
  userId: string,
  trigger: "manual" | "scheduled",
  includeMedia: boolean,
) {
  const client = await db();
  const { data, error } = await client
    .from("backup_jobs")
    .insert({ user_id: userId, trigger, include_media: includeMedia, state: "queued", progress: 0 })
    .select("id")
    .single();
  if (error) {
    // The partial unique index rejects a second live job for this account.
    if (error.code === "23505") {
      throw new BackupError("job_already_running", "A backup is already running.");
    }
    throw new BackupError("unknown", error.message);
  }
  return data.id as string;
}

export async function updateBackupJob(
  jobId: string,
  userId: string,
  patch: Record<string, unknown>,
) {
  const client = await db();
  await client
    .from("backup_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("user_id", userId);
}

export async function createRestoreJob(userId: string, backupId: string) {
  const client = await db();
  const { data, error } = await client
    .from("restore_jobs")
    .insert({ user_id: userId, backup_id: backupId, state: "preparing", progress: 0 })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new BackupError("job_already_running", "A restore is already running.");
    }
    throw new BackupError("unknown", error.message);
  }
  return data.id as string;
}

export async function updateRestoreJob(
  jobId: string,
  userId: string,
  patch: Record<string, unknown>,
) {
  const client = await db();
  await client
    .from("restore_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("user_id", userId);
}

export async function latestBackupJob(userId: string) {
  const client = await db();
  const { data } = await client
    .from("backup_jobs")
    .select("id, state, progress, trigger, attempts, error_code, error_message, created_at, finished_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function latestRestoreJob(userId: string) {
  const client = await db();
  const { data } = await client
    .from("restore_jobs")
    .select("id, state, progress, attempts, restored_counts, error_code, error_message, created_at, finished_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/* ---------------- backups ---------------- */

export async function listBackups(userId: string, limit = 10) {
  const client = await db();
  const { data } = await client
    .from("backups")
    .select(
      "id, backup_version, size_bytes, checksum, includes_media, item_counts, status, created_at, completed_at, drive_file_id",
    )
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Array<Record<string, any>>;
}

export async function getBackup(userId: string, backupId: string) {
  const client = await db();
  const { data } = await client
    .from("backups")
    .select("*")
    .eq("user_id", userId)
    .eq("id", backupId)
    .maybeSingle();
  return data ?? null;
}

export async function insertBackup(row: Record<string, unknown>) {
  const client = await db();
  const { data, error } = await client.from("backups").insert(row).select("id").single();
  if (error) throw new BackupError("unknown", error.message);
  return data.id as string;
}

export async function markBackupDeleted(userId: string, backupId: string) {
  const client = await db();
  await client
    .from("backups")
    .update({ status: "deleted", deleted_at: new Date().toISOString(), drive_file_id: null })
    .eq("user_id", userId)
    .eq("id", backupId);
}

/** Accounts whose scheduled backup is due. Used only by the scheduler route. */
export async function dueSchedules(limit = 25) {
  const client = await db();
  const { data } = await client
    .from("backup_settings")
    .select("user_id, frequency, include_media, next_run_at")
    .eq("auto_enabled", true)
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(limit);
  return (data ?? []) as Array<{
    user_id: string;
    frequency: BackupFrequency;
    include_media: boolean;
    next_run_at: string;
  }>;
}

export async function bumpSchedule(userId: string, frequency: BackupFrequency) {
  const client = await db();
  await client
    .from("backup_settings")
    .update({ next_run_at: nextRunAt(frequency), updated_at: new Date().toISOString() })
    .eq("user_id", userId);
}

/**
 * Push the next automatic run a short time out after a transient failure, so a
 * failing account is retried safely instead of being swept every minute.
 */
export async function deferSchedule(userId: string, minutes: number) {
  const client = await db();
  const next = new Date(Date.now() + minutes * 60_000).toISOString();
  await client
    .from("backup_settings")
    .update({ next_run_at: next, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
}
