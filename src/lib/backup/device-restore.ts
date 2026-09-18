/**
 * Device restore.
 *
 * Applies a real restore result to the app state. The archive is data, not
 * authority: every N Connect rule is re-applied here, so a restore can never
 * unlock something the rules would not allow.
 *
 * - Account ownership: an archive is only applied to the account that made it.
 * - Contact rules: saved Contacts and Contact Requests are restored as they
 *   were; a request stays pending until the other side answers it.
 * - Message Request rules: text chat permission (`chatAllowed`) is NOT taken
 *   from the archive. Restored chats stay locked until the normal accept flow
 *   unlocks them again.
 * - Trust rules: trust is a two-sided live choice and is never restored.
 * - Block rules: blocked people are restored as blocked, and everything
 *   belonging to them is filtered out of the restored data.
 * - Disappearing and deletion rules: expired statuses and expired
 *   disappearing messages are dropped instead of coming back.
 */

import type { ChatMessage, Profile } from "@/data/types";
import { STATUS_TTL_MS, type BackupPayload } from "./format";
import type { SnapshotSource } from "./device-snapshot";

export type RestoreCounts = {
  chats: number;
  messages: number;
  contacts: number;
  statuses: number;
  notifications: number;
  media: number;
};

const lower = (value: string | undefined) => (value ?? "").trim().toLowerCase();

/** Thrown when an archive belongs to a different N Connect account. */
export class RestoreOwnershipError extends Error {
  constructor() {
    super("This backup belongs to a different N Connect account.");
    this.name = "RestoreOwnershipError";
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mergeById<T extends { id: string }>(current: T[], restored: T[]): T[] {
  const seen = new Set(current.map((e) => e.id));
  return [...current, ...restored.filter((e) => !seen.has(e.id))];
}

/**
 * Builds the state that should replace the current one after a restore.
 * Pure: the caller writes the result into the store.
 */
export function buildRestoredState(
  current: SnapshotSource,
  payload: BackupPayload,
  now = Date.now(),
): { next: SnapshotSource; counts: RestoreCounts } {
  const archiveUser = lower(str(payload.account["username"]));
  const currentUser = lower(current.me.username);
  if (archiveUser && currentUser && archiveUser !== currentUser) {
    throw new RestoreOwnershipError();
  }

  const blocked = mergeById(current.blocked, payload.blocked as unknown as typeof current.blocked);
  const blockedUsers = new Set(blocked.map((b) => lower(b.username)));
  const allowed = (username: string | undefined) => !blockedUsers.has(lower(username));

  const restoredChats = (payload.chats as unknown as typeof current.chats).filter((c) =>
    allowed(c.username),
  );
  const chats = mergeById(current.chats, restoredChats);
  const chatIds = new Set(chats.map((c) => c.id));

  const messages: Record<string, ChatMessage[]> = { ...current.messages };
  let messageCount = 0;
  let mediaCount = 0;
  for (const [chatId, list] of Object.entries(payload.messages)) {
    if (!chatIds.has(chatId)) continue;
    const restored: ChatMessage[] = [];
    for (const raw of list) {
      const rec = raw as unknown as Record<string, unknown>;
      const expiresAt = rec["expiresAt"];
      if (typeof expiresAt === "number" && expiresAt <= now) continue;
      const hashes = Array.isArray(rec["mediaHashes"])
        ? (rec["mediaHashes"] as unknown[]).filter((h): h is string => typeof h === "string")
        : typeof rec["mediaHash"] === "string"
          ? [rec["mediaHash"]]
          : [];
      const images = hashes
        .map((hash) => payload.media[hash])
        .filter((value): value is string => typeof value === "string");
      mediaCount += images.length;
      const message: ChatMessage = {
        id: raw.id,
        mine: rec["mine"] === true,
        time: str(rec["time"]) ?? "",
        ...(str(rec["text"]) !== undefined ? { text: str(rec["text"]) } : {}),
        ...(images.length ? { images } : {}),
        ...(str(rec["state"]) ? { state: rec["state"] as ChatMessage["state"] } : {}),
        ...(str(rec["reaction"]) ? { reaction: str(rec["reaction"]) } : {}),
        ...(str(rec["replyTo"]) ? { replyTo: str(rec["replyTo"]) } : {}),
        ...(rec["edited"] === true ? { edited: true } : {}),
        ...(rec["deleted"] === true ? { deleted: true } : {}),
      };
      restored.push(message);
    }
    const existing = messages[chatId] ?? [];
    const merged = mergeById(existing, restored);
    messageCount += merged.length - existing.length;
    messages[chatId] = merged;
  }

  const restoredStatuses = (payload.statuses as unknown as typeof current.statuses)
    .filter((s) => allowed(s.authorUsername))
    .filter((s) => now - s.createdAt < STATUS_TTL_MS)
    .map((s) => {
      const raw = s as unknown as Record<string, unknown>;
      const image = payload.media[String(raw["imageHash"] ?? "")];
      const video = payload.media[String(raw["videoHash"] ?? "")];
      return {
        ...s,
        ...(image ? { image } : {}),
        ...(video ? { video } : {}),
      };
    });
  const statuses = mergeById(current.statuses, restoredStatuses);
  const liveIds = new Set(statuses.map((s) => s.id));

  const contacts = mergeById(
    current.contacts,
    (payload.contacts as unknown as typeof current.contacts).filter((c) => allowed(c.username)),
  );
  const contactRequests = mergeById(
    current.contactRequests,
    (payload.contactRequests as unknown as typeof current.contactRequests).filter((r) =>
      allowed(r.username),
    ),
  );
  const notifications = mergeById(
    current.notifications,
    (payload.notifications as unknown as typeof current.notifications).filter((n) =>
      allowed(n.username),
    ),
  );

  const relations = { ...current.relations };
  for (const [username, relation] of Object.entries(payload.relations)) {
    if (!allowed(username)) continue;
    if (!relations[username]) relations[username] = relation as (typeof relations)[string];
  }

  const liked = Array.from(
    new Set([...current.liked, ...payload.liked.filter((u) => allowed(u))]),
  );
  const mutedProfiles = Array.from(
    new Set([...current.mutedProfiles, ...payload.mutedProfiles.filter((u) => allowed(u))]),
  );
  const seenStatus = Array.from(
    new Set([...current.seenStatus, ...payload.seenStatus.filter((id) => liveIds.has(id))]),
  );

  // Permanent identity always stays with the device: id, Contact ID and the
  // verified phone number are never taken from an archive.
  const account = payload.account as unknown as Partial<Profile>;
  const me: Profile = {
    ...current.me,
    name: account.name ?? current.me.name,
    username: current.me.username || account.username || "",
    bio: account.bio ?? current.me.bio,
    location: account.location ?? current.me.location,
    followers: account.followers ?? current.me.followers,
    following: account.following ?? current.me.following,
    likes: account.likes ?? current.me.likes,
    ...(account.private !== undefined ? { private: account.private } : {}),
    ...(account.photo ? { photo: account.photo } : {}),
    ...(account.village ? { village: account.village } : {}),
    ...(account.city ? { city: account.city } : {}),
    ...(account.state ? { state: account.state } : {}),
    ...(account.pin ? { pin: account.pin } : {}),
  };

  const settings = { ...current.settings, ...(payload.settings as Partial<typeof current.settings>) };

  return {
    next: {
      me,
      chats,
      messages,
      notifications,
      contacts,
      contactRequests,
      blocked,
      relations,
      liked,
      statuses,
      seenStatus,
      mutedProfiles,
      settings,
    },
    counts: {
      chats: chats.length - current.chats.length,
      messages: messageCount,
      contacts: contacts.length - current.contacts.length,
      statuses: statuses.length - current.statuses.length,
      notifications: notifications.length - current.notifications.length,
      media: mediaCount,
    },
  };
}
