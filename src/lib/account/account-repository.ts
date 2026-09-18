/**
 * Server-backed account and app state.
 *
 * Everything this module reads and writes lives in the database, scoped to the
 * signed-in account by row-level security: the profile, every settings group,
 * per-chat list state (pin, archive, mute, unread, draft, last message), muted
 * profiles, filed reports and the real signed-in device sessions.
 *
 * Nothing security-sensitive crosses this boundary. The authentication phone
 * number, password hashes, OTP secrets and session tokens are not selectable
 * here; a session row exposes only display metadata plus its own row id.
 *
 * The device keeps a copy of some of this in memory for instant rendering, but
 * the database is the only authority: a reinstall or a second device sees the
 * same state.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChatRow, Profile } from "@/data/types";
import type { AppSettings } from "@/lib/store";
import { getBackend } from "@/lib/calls/backend";

/**
 * Tables introduced by migration 0015 are not part of the generated Supabase
 * types yet (types are generated from a live database, which this change does
 * not touch), so account state goes through an untyped view of the same
 * authenticated client. Row-level security still applies to every call.
 */
/** A database row from a table whose generated types are not available yet. */
type Row = any;

function db(): SupabaseClient<any> | null {
  return getBackend() as unknown as SupabaseClient<any> | null;
}

/** Identifier of this browser/device, used only to mark "this device". */
const DEVICE_KEY = "nconnect.device.id";

export type DeviceSession = {
  id: string;
  device: string;
  place: string;
  time: string;
  current?: boolean;
};

export type ReportEntry = { id: string; username: string; reason: string; at: number };

export type AccountState = {
  profile: Partial<Profile> | null;
  settings: Partial<AppSettings>;
  chats: ChatRow[];
  mutedProfiles: string[];
  reports: ReportEntry[];
  sessions: DeviceSession[];
};

export type StorageItem = { label: string; value: number; tone: string };

function handle(username: string): string {
  return username.replace(/^@/, "").toLowerCase();
}

function clock(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

async function myId(): Promise<string | null> {
  const supabase = db();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/* ------------------------------------------------------------------ profile */

const PROFILE_COLUMNS =
  "id, unique_id, username, name, bio, photo_url, location, village, city, region, pin_code, is_private, profile_completed";

function toProfile(row: Row): Partial<Profile> {
  return {
    id: row.id as string,
    name: (row.name as string) ?? "",
    username: row.username ? `@${row.username}` : "",
    bio: (row.bio as string) ?? "",
    location: (row.location as string) ?? "",
    village: (row.village as string) ?? "",
    city: (row.city as string) ?? "",
    state: (row.region as string) ?? "",
    pin: (row.pin_code as string) ?? "",
    photo: (row.photo_url as string) ?? "",
    private: Boolean(row.is_private),
    ...(row.unique_id ? { contactId: String(row.unique_id) } : {}),
  };
}

/** The signed-in account's stored profile, or null when signed out. */
export async function loadMyProfile(): Promise<Partial<Profile> | null> {
  const supabase = db();
  const me = await myId();
  if (!supabase || !me) return null;
  const { data } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", me).maybeSingle();
  return data ? toProfile(data) : null;
}

/**
 * Another account's profile as the database is willing to show it. Private
 * accounts and blocked relationships are enforced by the existing policies, so
 * an unauthorised lookup simply resolves to null.
 */
export async function loadPeerProfile(username: string): Promise<Partial<Profile> | null> {
  const supabase = db();
  if (!supabase) return null;
  const { data } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("username", handle(username))
    .maybeSingle();
  return data ? toProfile(data) : null;
}

/**
 * Saves editable profile fields. The permanent Unique ID, the account id and
 * the authentication phone number are never part of the update — the database
 * trigger rejects any attempt to change them.
 */
export async function saveMyProfile(patch: Partial<Profile>): Promise<boolean> {
  const supabase = db();
  const me = await myId();
  if (!supabase || !me) return false;
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update['name'] = patch.name;
  if (patch.bio !== undefined) update['bio'] = patch.bio;
  if (patch.location !== undefined) update['location'] = patch.location;
  if (patch.village !== undefined) update['village'] = patch.village;
  if (patch.city !== undefined) update['city'] = patch.city;
  if (patch.state !== undefined) update['region'] = patch.state;
  if (patch.pin !== undefined) update['pin_code'] = patch.pin;
  if (patch.photo !== undefined) update['photo_url'] = patch.photo;
  if (patch.private !== undefined) update['is_private'] = patch.private;
  if (patch.username !== undefined && handle(patch.username)) {
    update['username'] = handle(patch.username);
  }
  if (Object.keys(update).length === 0) return true;
  const { error } = await supabase.from("profiles").update(update).eq("id", me);
  if (error) {
    console.error("profile not saved", error);
    return false;
  }
  return true;
}

/* ----------------------------------------------------------------- settings */

/** Every settings group for this account, as last saved server-side. */
export async function loadSettings(): Promise<Partial<AppSettings>> {
  const supabase = db();
  const me = await myId();
  if (!supabase || !me) return {};
  const { data } = await supabase
    .from("user_settings")
    .select("settings")
    .eq("user_id", me)
    .maybeSingle();
  return (data?.settings as Partial<AppSettings> | undefined) ?? {};
}

/** Stores the complete settings object for this account. */
export async function saveSettings(settings: AppSettings): Promise<boolean> {
  const supabase = db();
  const me = await myId();
  if (!supabase || !me) return false;
  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: me, settings, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) {
    console.error("settings not saved", error);
    return false;
  }
  return true;
}

/**
 * Watches this account's settings row. When another signed-in device saves a
 * change, the server pushes the new row here so both devices agree without a
 * reload. Returns a function that stops listening.
 */
export function subscribeSettings(onChange: (settings: Partial<AppSettings>) => void): () => void {
  const supabase = db();
  if (!supabase) return () => {};
  let channel: ReturnType<SupabaseClient<any>["channel"]> | null = null;
  let cancelled = false;
  void myId().then((me) => {
    if (!me || cancelled) return;
    channel = supabase
      .channel(`settings:${me}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_settings", filter: `user_id=eq.${me}` },
        (payload: { new: Row }) => {
          const next = payload.new?.settings as Partial<AppSettings> | undefined;
          if (next) onChange(next);
        },
      )
      .subscribe();
  });
  return () => {
    cancelled = true;
    if (channel) void supabase.removeChannel(channel);
  };
}

/* --------------------------------------------------------- chat list state */

function toChatRow(row: Row): ChatRow {
  const username = String(row.peer_username ?? "");
  return {
    id: `cs-${username}`,
    name: (row.peer_name as string) || username,
    username: username ? `@${username}` : "",
    message: (row.last_message_preview as string) ?? "",
    time: (row.last_message_label as string) || clock(row.last_message_at ?? null),
    online: false,
    lastSeen: "Last seen recently",
    unread: Number(row.unread_count ?? 0),
    pinned: Boolean(row.pinned),
    muted: Boolean(row.muted),
    archived: Boolean(row.archived),
    disappearing: Boolean(row.disappearing),
    accepted: row.accepted === false ? false : true,
  };
}

/** The chat list state for this account: order, pins, unread, drafts. */
export async function loadChatStates(): Promise<ChatRow[]> {
  const supabase = db();
  const me = await myId();
  if (!supabase || !me) return [];
  const { data } = await supabase
    .from("chat_states")
    .select("*")
    .eq("user_id", me)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  return (data ?? []).map(toChatRow);
}

/** Per-chat drafts, keyed by the peer's handle. */
export async function loadChatDrafts(): Promise<Record<string, string>> {
  const supabase = db();
  const me = await myId();
  if (!supabase || !me) return {};
  const { data } = await supabase
    .from("chat_states")
    .select("peer_username, draft")
    .eq("user_id", me);
  const out: Record<string, string> = {};
  (data ?? []).forEach((row: Row) => {
    if (row.draft) out[String(row.peer_username)] = String(row.draft);
  });
  return out;
}

export type ChatStatePatch = {
  name?: string;
  preview?: string;
  timeLabel?: string;
  lastMessageAt?: string;
  unread?: number;
  pinned?: boolean;
  archived?: boolean;
  muted?: boolean;
  accepted?: boolean;
  disappearing?: boolean;
  draft?: string;
  readNow?: boolean;
};

/**
 * Writes chat list state for one conversation. The messages themselves are not
 * touched here: they stay in the existing server message system.
 */
export async function saveChatState(username: string, patch: ChatStatePatch): Promise<void> {
  const supabase = db();
  const me = await myId();
  const peer = handle(username);
  if (!supabase || !me || !peer) return;
  const row: Record<string, unknown> = {
    user_id: me,
    peer_username: peer,
    updated_at: new Date().toISOString(),
  };
  if (patch.name !== undefined) row['peer_name'] = patch.name;
  if (patch.preview !== undefined) row['last_message_preview'] = patch.preview;
  if (patch.timeLabel !== undefined) row['last_message_label'] = patch.timeLabel;
  if (patch.lastMessageAt !== undefined) row['last_message_at'] = patch.lastMessageAt;
  if (patch.unread !== undefined) row['unread_count'] = Math.max(0, patch.unread);
  if (patch.pinned !== undefined) row['pinned'] = patch.pinned;
  if (patch.archived !== undefined) row['archived'] = patch.archived;
  if (patch.muted !== undefined) row['muted'] = patch.muted;
  if (patch.accepted !== undefined) row['accepted'] = patch.accepted;
  if (patch.disappearing !== undefined) row['disappearing'] = patch.disappearing;
  if (patch.draft !== undefined) row['draft'] = patch.draft;
  if (patch.readNow) row['last_read_at'] = new Date().toISOString();
  const { error } = await supabase.from("chat_states").upsert(row, {
    onConflict: "user_id,peer_username",
  });
  if (error) console.error("chat state not saved", error);
}

/** Removes the chat list entry for one conversation. */
export async function removeChatState(username: string): Promise<void> {
  const supabase = db();
  const me = await myId();
  const peer = handle(username);
  if (!supabase || !me || !peer) return;
  await supabase.from("chat_states").delete().eq("user_id", me).eq("peer_username", peer);
}

/* ------------------------------------------------------- mutes and reports */

export async function loadMutedProfiles(): Promise<string[]> {
  const supabase = db();
  const me = await myId();
  if (!supabase || !me) return [];
  const { data } = await supabase.from("profile_mutes").select("muted_username").eq("user_id", me);
  return (data ?? []).map((r: Row) => String(r.muted_username));
}

export async function setProfileMuted(username: string, muted: boolean): Promise<void> {
  const supabase = db();
  const me = await myId();
  const peer = handle(username);
  if (!supabase || !me || !peer) return;
  if (muted) {
    await supabase
      .from("profile_mutes")
      .upsert({ user_id: me, muted_username: peer }, { onConflict: "user_id,muted_username" });
  } else {
    await supabase.from("profile_mutes").delete().eq("user_id", me).eq("muted_username", peer);
  }
}

/** Reports this account filed. They are server rows, so a reinstall keeps them. */
export async function loadReports(): Promise<ReportEntry[]> {
  const supabase = db();
  const me = await myId();
  if (!supabase || !me) return [];
  const { data } = await supabase
    .from("user_reports")
    .select("id, reported_username, reason, created_at")
    .eq("reporter_id", me)
    .order("created_at", { ascending: false });
  return (data ?? []).map((r: Row) => ({
    id: String(r.id),
    username: String(r.reported_username),
    reason: String(r.reason),
    at: Date.parse(r.created_at) || 0,
  }));
}

export async function fileReport(username: string, reason: string): Promise<ReportEntry | null> {
  const supabase = db();
  const me = await myId();
  const peer = handle(username);
  if (!supabase || !me || !peer) return null;
  const { data, error } = await supabase
    .from("user_reports")
    .insert({ reporter_id: me, reported_username: peer, reason })
    .select("id, reported_username, reason, created_at")
    .maybeSingle();
  if (error || !data) {
    console.error("report not filed", error);
    return null;
  }
  return {
    id: String(data.id),
    username: String(data.reported_username),
    reason: String(data.reason),
    at: Date.parse(data.created_at) || Date.now(),
  };
}

/* ------------------------------------------------------- device sessions */

function deviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return "";
  }
}

function describeDevice(): { label: string; platform: string } {
  if (typeof navigator === "undefined") return { label: "This device", platform: "" };
  const ua = navigator.userAgent;
  const platform = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iOS"
      : /Mac OS X/i.test(ua)
        ? "macOS"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Linux/i.test(ua)
            ? "Linux"
            : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  return { label: [platform, browser].filter(Boolean).join(" · ") || "This device", platform };
}

function sessionRowId(): string {
  return `nconnect.session.row.${deviceId()}`;
}

function rememberSessionRow(id: string): void {
  try {
    window.localStorage.setItem(sessionRowId(), id);
  } catch {
    /* a device without storage simply shows no "this device" marker */
  }
}

function currentSessionRow(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(sessionRowId());
  } catch {
    return null;
  }
}

/**
 * Records this device as a live session and returns the account's sessions.
 * Only display metadata is written — never a token or an OTP value.
 */
export async function registerThisDevice(): Promise<DeviceSession[]> {
  const supabase = db();
  const me = await myId();
  if (!supabase || !me) return [];
  const known = currentSessionRow();
  const { label, platform } = describeDevice();
  const now = new Date().toISOString();

  if (known) {
    const { data } = await supabase
      .from("auth_sessions")
      .update({ last_seen_at: now, device_label: label, platform })
      .eq("id", known)
      .eq("user_id", me)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    if (data?.id) return listDeviceSessions();
  }

  const { data: created } = await supabase
    .from("auth_sessions")
    .insert({
      user_id: me,
      // A short opaque reference, never a session token.
      session_ref: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
      expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
      device_label: label,
      platform,
      last_seen_at: now,
    })
    .select("id")
    .maybeSingle();
  if (created?.id) rememberSessionRow(String(created.id));
  return listDeviceSessions();
}

/** The account's live sessions, newest activity first. */
export async function listDeviceSessions(): Promise<DeviceSession[]> {
  const supabase = db();
  const me = await myId();
  if (!supabase || !me) return [];
  const { data } = await supabase
    .from("auth_sessions")
    .select("id, device_label, platform, place, last_seen_at, created_at")
    .eq("user_id", me)
    .is("revoked_at", null)
    .order("last_seen_at", { ascending: false });
  const mine = currentSessionRow();
  return (data ?? []).map((row: Row) => {
    const seen = row.last_seen_at ?? row.created_at;
    return {
      id: String(row.id),
      device: (row.device_label as string) || "Signed-in device",
      place: (row.place as string) || (row.platform as string) || "",
      time: seen ? new Date(seen).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "",
      ...(mine && String(row.id) === mine ? { current: true } : {}),
    };
  });
}

/** Ends one session. Returns true when the ended session is this device. */
export async function revokeDeviceSession(id: string): Promise<boolean> {
  const supabase = db();
  const me = await myId();
  if (!supabase || !me) return false;
  await supabase
    .from("auth_sessions")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: "user" })
    .eq("id", id)
    .eq("user_id", me);
  return currentSessionRow() === id;
}

/** Ends every session except this device. */
export async function revokeOtherDeviceSessions(): Promise<void> {
  const supabase = db();
  const me = await myId();
  if (!supabase || !me) return;
  const mine = currentSessionRow();
  let query = supabase
    .from("auth_sessions")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: "user_other_devices" })
    .eq("user_id", me)
    .is("revoked_at", null);
  if (mine) query = query.neq("id", mine);
  await query;
}

/* ----------------------------------------------------- storage and export */

function toMB(size: number): number {
  return Math.round((size / (1024 * 1024)) * 1000) / 1000;
}

/**
 * Real storage usage for this account, measured from server data: stored photo
 * metadata, message bodies and the account's own records.
 */
export async function accountStorageBreakdown(): Promise<StorageItem[]> {
  const supabase = db();
  const me = await myId();
  if (!supabase || !me) return [];

  const [{ data: media }, { data: messages }, { data: settings }, { data: profile }] =
    await Promise.all([
      supabase.from("chat_media").select("size_bytes").or(`sender_id.eq.${me},recipient_id.eq.${me}`),
      supabase.from("messages").select("body").or(`sender_id.eq.${me},recipient_id.eq.${me}`),
      supabase.from("user_settings").select("settings").eq("user_id", me).maybeSingle(),
      supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", me).maybeSingle(),
    ]);

  const photoBytes = (media ?? []).reduce(
    (sum: number, row: Row) => sum + Number(row.size_bytes ?? 0),
    0,
  );
  const messageBytes = (messages ?? []).reduce(
    (sum: number, row: Row) => sum + new TextEncoder().encode(String(row.body ?? "")).length,
    0,
  );
  const appBytes = new TextEncoder().encode(JSON.stringify({ settings, profile })).length;

  return [
    { label: "Photos", value: toMB(photoBytes), tone: "bg-brand" },
    { label: "Messages", value: toMB(messageBytes), tone: "bg-ink" },
    { label: "App data", value: toMB(appBytes), tone: "bg-muted" },
  ].filter((i) => i.value > 0);
}

/**
 * The account's own data, read from the server, for the "Download your data"
 * action. The phone number and every security value stay out of it.
 */
export async function buildAccountExport(): Promise<Record<string, unknown> | null> {
  const supabase = db();
  const me = await myId();
  if (!supabase || !me) return null;
  const [profile, settings, chats, mutes, reports, sessions] = await Promise.all([
    loadMyProfile(),
    loadSettings(),
    loadChatStates(),
    loadMutedProfiles(),
    loadReports(),
    listDeviceSessions(),
  ]);
  const { data: messages } = await supabase
    .from("messages")
    .select("id, sender_id, recipient_id, body, created_at, read_at")
    .or(`sender_id.eq.${me},recipient_id.eq.${me}`)
    .order("created_at", { ascending: true })
    .limit(5000);
  if (!profile) return null;
  return {
    exported_at: new Date().toISOString(),
    app: "n-connect",
    account: profile,
    settings,
    chats,
    mutedProfiles: mutes,
    reports,
    // Display metadata only: no tokens, no references.
    devices: sessions.map((s) => ({ device: s.device, place: s.place, lastSeen: s.time })),
    messages: messages ?? [],
  };
}

/** Loads every piece of account state in one round of reads. */
export async function loadAccountState(): Promise<AccountState | null> {
  const me = await myId();
  if (!me) return null;
  const [profile, settings, chats, mutedProfiles, reports, sessions] = await Promise.all([
    loadMyProfile(),
    loadSettings(),
    loadChatStates(),
    loadMutedProfiles(),
    loadReports(),
    registerThisDevice(),
  ]);
  return { profile, settings, chats, mutedProfiles, reports, sessions };
}

/** Forgets this device's session pointer (used on sign-out and delete). */
export function forgetDeviceSessionPointer(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(sessionRowId());
  } catch {
    /* nothing to clear */
  }
}
