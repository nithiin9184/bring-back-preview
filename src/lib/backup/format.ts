/**
 * N Connect backup format (client-safe).
 *
 * A backup is a versioned JSON document. `BACKUP_VERSION` is written into every
 * archive and checked again on restore, so an archive written by an older or
 * newer build is rejected with a real compatibility error instead of being
 * partially applied.
 *
 * Nothing in this module fabricates data: every field is copied from what the
 * signed-in account actually has on this device.
 */

import { z } from "zod";

/** Current archive schema version. Bump when the payload shape changes. */
export const BACKUP_VERSION = 2;

/** Oldest archive version this build can still restore. */
export const MIN_RESTORABLE_VERSION = 2;

export type BackupFrequency = "daily" | "weekly" | "monthly";

export const BACKUP_JOB_STATES = [
  "idle",
  "queued",
  "preparing",
  "uploading",
  "verifying",
  "completed",
  "failed",
  "cancelled",
] as const;
export type BackupJobState = (typeof BACKUP_JOB_STATES)[number];

export const RESTORE_JOB_STATES = [
  "idle",
  "preparing",
  "downloading",
  "verifying",
  "decrypting",
  "restoring",
  "completed",
  "failed",
  "cancelled",
] as const;
export type RestoreJobState = (typeof RESTORE_JOB_STATES)[number];

/**
 * Keys that must never leave the device inside a backup: authentication
 * identity, verification state and device sessions. They are stripped when the
 * snapshot is built and rejected again on restore.
 */
export const EXCLUDED_KEYS = [
  "authPhone",
  "phoneVerified",
  "registeredPhone",
  "sessions",
  "signedIn",
  "plan",
  "billing",
  "subscriptions",
  "extraCredits",
  "counters",
] as const;

/** Settings that are safe to carry across a restore (no security state). */
export const RESTORABLE_SETTING_KEYS = [
  "readReceipts",
  "nearbyVisible",
  "tagging",
  "lastSeen",
  "whoCanMessage",
  "hideProfilePhoto",
  "incognitoNearby",
  "notifications",
  "chat",
  "defaultDisappearing",
  "autoDownload",
  "background",
  "textSize",
  "bubble",
  "reduceMotion",
  "bubbleColour",
  "chatFont",
  "callQuality",
  "lowData",
] as const;

/**
 * A backup archive is JSON, so every extra field a record or entry carries must
 * itself be JSON. Typing the open fields as `JsonValue` instead of `unknown`
 * keeps the payload fully describable, which is what lets a restore result
 * travel back to the device over the typed server-function boundary.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

const jsonRecord = z.record(jsonValueSchema);

/** An entry with the listed fields plus any other JSON fields it carries. */
const openObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).catchall(jsonValueSchema);

const messageSchema = openObject({
  id: z.string().min(1),
  at: z.number().optional(),
  time: z.string().optional(),
  expiresAt: z.number().nullable().optional(),
  /** Content hash of the attached image, when media backup is on. */
  mediaHash: z.string().optional(),
});

const chatSchema = openObject({ username: z.string().min(1) });

const statusSchema = openObject({ id: z.string().min(1), at: z.number() });

const identifiedSchema = openObject({ id: z.string() });

export const backupPayloadSchema = z.object({
  backup_version: z.number().int().positive(),
  created_at: z.string(),
  app: z.literal("n-connect"),
  includes_media: z.boolean(),
  account: openObject({
    username: z.string().default(""),
    name: z.string().default(""),
    bio: z.string().default(""),
    location: z.string().default(""),
  }),
  contacts: z.array(identifiedSchema).default([]),
  contactRequests: z.array(identifiedSchema).default([]),
  relations: z.record(z.string()).default({}),
  liked: z.array(z.string()).default([]),
  chats: z.array(chatSchema).default([]),
  messages: z.record(z.array(messageSchema)).default({}),
  statuses: z.array(statusSchema).default([]),
  seenStatus: z.array(z.string()).default([]),
  notifications: z.array(identifiedSchema).default([]),
  blocked: z.array(identifiedSchema).default([]),
  mutedProfiles: z.array(z.string()).default([]),
  settings: jsonRecord.default({}),
  /** Deduplicated media, keyed by SHA-256 of the data URL. */
  media: z.record(z.string()).default({}),
});

/**
 * The persisted backup schedule. `undefined` means "leave this as it is", which
 * is exactly what a partial settings save sends, so the field types stay
 * optional-with-undefined all the way from the screen to the database.
 */
export type BackupSettingsPatch = {
  autoEnabled?: boolean | undefined;
  frequency?: BackupFrequency | undefined;
  includeMedia?: boolean | undefined;
};

export const backupSettingsPatchSchema = z.object({
  autoEnabled: z.boolean().optional(),
  frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
  includeMedia: z.boolean().optional(),
});

export type BackupPayload = z.infer<typeof backupPayloadSchema>;

export type BackupItemCounts = {
  chats: number;
  messages: number;
  contacts: number;
  statuses: number;
  notifications: number;
  media: number;
};

/** Counts shown in the UI. Derived from the payload, never invented. */
export function countItems(payload: BackupPayload): BackupItemCounts {
  return {
    chats: payload.chats.length,
    messages: Object.values(payload.messages).reduce((n, list) => n + list.length, 0),
    contacts: payload.contacts.length,
    statuses: payload.statuses.length,
    notifications: payload.notifications.length,
    media: Object.keys(payload.media).length,
  };
}

/** Statuses expire 24 hours after posting and are never restored after that. */
export const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Restore safety filter, applied on the server before an archive is handed
 * back to a device: expired statuses and expired disappearing messages are
 * dropped, and excluded keys can never reappear.
 */
export function applyRetentionRules(payload: BackupPayload, now = Date.now()): BackupPayload {
  const statuses = payload.statuses.filter((s) => now - s.at < STATUS_TTL_MS);
  const seenIds = new Set(statuses.map((s) => s.id));
  const messages: BackupPayload["messages"] = {};
  for (const [chat, list] of Object.entries(payload.messages)) {
    const kept = list.filter((m) => m.expiresAt == null || m.expiresAt > now);
    if (kept.length) messages[chat] = kept;
  }
  return {
    ...payload,
    statuses,
    seenStatus: payload.seenStatus.filter((id) => seenIds.has(id)),
    messages,
  };
}

export function frequencyLabel(frequency: BackupFrequency): string {
  return frequency === "daily" ? "Daily" : frequency === "weekly" ? "Weekly" : "Monthly";
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
