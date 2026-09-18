/**
 * Server-side notification creation.
 *
 * Every in-app notification row is written here so the recipient's saved
 * preferences are honoured in one place: the per-type switches from Settings →
 * Notifications, the "Restricted Accounts" mute list and Security-alert /
 * login-alert switches. Nothing bypasses those settings, and nothing about the
 * recipient's settings is ever returned to the caller.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient<any>;

export type NotificationKind =
  | "follower"
  | "request"
  | "accepted"
  | "like"
  | "message"
  | "message_request"
  | "call"
  | "security";

export type NotificationTone = "default" | "warning" | "success";

/** Which Settings → Notifications switch governs each notification type. */
const PREFERENCE_BY_TYPE: Record<NotificationKind, string> = {
  follower: "followers",
  request: "followers",
  accepted: "followers",
  like: "likes",
  message: "messages",
  message_request: "requests",
  call: "calls",
  security: "security",
};

type Preferences = { notifications?: Record<string, boolean>; loginAlerts?: boolean };

async function loadPreferences(db: Db, userId: string): Promise<Preferences> {
  const { data } = await db
    .from("user_settings")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();
  return ((data?.settings as Preferences | null) ?? {}) as Preferences;
}

/** True when the recipient wants notifications of this type right now. */
export async function notificationAllowed(
  db: Db,
  input: {
    userId: string;
    type: NotificationKind;
    actorUsername?: string | null;
    loginAlert?: boolean;
  },
): Promise<boolean> {
  const prefs = await loadPreferences(db, input.userId);
  const switches = prefs.notifications ?? {};
  const key = PREFERENCE_BY_TYPE[input.type];
  // Defaults mirror the app's default settings: every group on except likes.
  const fallback = key !== "likes";
  if (!(switches[key] ?? fallback)) return false;
  if (input.loginAlert && prefs.loginAlerts === false) return false;
  if (input.actorUsername) {
    const { data: mute } = await db
      .from("profile_mutes")
      .select("muted_username")
      .eq("user_id", input.userId)
      .eq("muted_username", input.actorUsername.replace(/^@/, "").toLowerCase())
      .maybeSingle();
    if (mute) return false;
  }
  return true;
}

/** Display identity of an account, used as the notification's sender line. */
export async function actorIdentity(
  db: Db,
  actorId: string,
): Promise<{ name: string; username: string }> {
  const { data } = await db
    .from("profiles")
    .select("name, username")
    .eq("id", actorId)
    .maybeSingle();
  const username = (data?.username as string | null) ?? "";
  return { name: (data?.name as string | null) || username || "N Connect user", username };
}

/**
 * Creates one notification for `userId`, unless their settings say otherwise.
 * Returns true when a row was written. `db` must be the privileged client: the
 * table only lets a person insert rows attributed to themselves, and system
 * events (security) have no actor at all.
 */
export async function emitNotification(
  db: Db,
  input: {
    userId: string;
    actorId?: string | null;
    type: NotificationKind;
    text: string;
    tone?: NotificationTone;
    /** Overrides the sender line (system events use a product name). */
    name?: string;
    loginAlert?: boolean;
  },
): Promise<boolean> {
  if (input.actorId && input.actorId === input.userId) return false;
  const actor = input.actorId ? await actorIdentity(db, input.actorId) : null;
  const allowed = await notificationAllowed(db, {
    userId: input.userId,
    type: input.type,
    actorUsername: actor?.username ?? null,
    ...(input.loginAlert ? { loginAlert: true } : {}),
  });
  if (!allowed) return false;
  const { error } = await db.from("notifications").insert({
    user_id: input.userId,
    actor_id: input.actorId ?? null,
    type: input.type,
    name: input.name ?? actor?.name ?? "N Connect",
    username: actor?.username ? `@${actor.username}` : null,
    text: input.text,
    tone: input.tone ?? "default",
  });
  if (error) console.error("notification not created", error);
  return !error;
}
