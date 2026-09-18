/**
 * Device snapshot builder.
 *
 * Turns the real state this account holds on this device into a backup payload.
 * Nothing here invents data: every field is copied from the live app state, and
 * the authentication/security fields listed in `EXCLUDED_KEYS` are never read.
 *
 * The snapshot is handed to the server (encrypted there) so a scheduled backup
 * can run later without the app being open.
 */

import type {
  AppNotification,
  BlockedPerson,
  ChatMessage,
  ChatRow,
  ContactEntry,
  ContactRequest,
  Profile,
  StatusEntry,
} from "@/data/types";
import type { AppSettings } from "@/lib/store";
import {
  BACKUP_VERSION,
  RESTORABLE_SETTING_KEYS,
  backupPayloadSchema,
  type BackupPayload,
} from "./format";

/** The parts of the app state a backup is allowed to read. */
export type SnapshotSource = {
  me: Profile;
  chats: ChatRow[];
  messages: Record<string, ChatMessage[]>;
  notifications: AppNotification[];
  contacts: ContactEntry[];
  contactRequests: ContactRequest[];
  blocked: BlockedPerson[];
  relations: Record<string, "follow" | "following" | "requested">;
  liked: string[];
  statuses: StatusEntry[];
  seenStatus: string[];
  mutedProfiles: string[];
  settings: AppSettings;
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function defined<T extends Record<string, unknown>>(entry: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Builds the archive payload for this device.
 *
 * @param includeMedia when false, photos and video sources are left out and
 *   only the text of each message and status is backed up.
 */
export async function buildBackupPayload(
  source: SnapshotSource,
  includeMedia: boolean,
): Promise<BackupPayload> {
  const media: Record<string, string> = {};
  const keep = async (dataUrl: string | undefined): Promise<string | undefined> => {
    if (!includeMedia || !dataUrl) return undefined;
    const hash = await sha256Hex(dataUrl);
    media[hash] = dataUrl;
    return hash;
  };

  const messages: Record<string, unknown[]> = {};
  for (const [chatId, list] of Object.entries(source.messages)) {
    const out: unknown[] = [];
    for (const m of list) {
      const hashes: string[] = [];
      for (const image of m.images ?? []) {
        const hash = await keep(image);
        if (hash) hashes.push(hash);
      }
      out.push(
        defined({
          id: m.id,
          mine: m.mine,
          time: m.time,
          text: m.text,
          state: m.state,
          reaction: m.reaction,
          replyTo: m.replyTo,
          edited: m.edited,
          deleted: m.deleted,
          mediaHash: hashes[0],
          mediaHashes: hashes.length ? hashes : undefined,
        }),
      );
    }
    messages[chatId] = out;
  }

  const statuses: unknown[] = [];
  for (const s of source.statuses) {
    statuses.push(
      defined({
        ...s,
        image: undefined,
        video: undefined,
        views: undefined,
        at: s.createdAt,
        imageHash: await keep(s.image),
        videoHash: await keep(s.video),
      }),
    );
  }

  const settings: Record<string, unknown> = {};
  for (const key of RESTORABLE_SETTING_KEYS) {
    const value = source.settings[key];
    if (value !== undefined) settings[key] = value;
  }

  // The account block carries the profile only. The verified phone number, the
  // permanent Contact ID and every session field stay on the device.
  const { phone: _phone, ...profile } = source.me;

  const draft = {
    backup_version: BACKUP_VERSION,
    created_at: new Date().toISOString(),
    app: "n-connect" as const,
    includes_media: includeMedia,
    account: defined({ ...profile, id: undefined, contactId: undefined }),
    contacts: source.contacts,
    contactRequests: source.contactRequests,
    relations: source.relations,
    liked: source.liked,
    chats: source.chats.map((c) => defined({ ...c })),
    messages,
    statuses,
    seenStatus: source.seenStatus,
    notifications: source.notifications,
    blocked: source.blocked,
    mutedProfiles: source.mutedProfiles,
    settings,
    media,
  };

  return backupPayloadSchema.parse(draft);
}
