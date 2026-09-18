/**
 * Backend access for user-to-user events: chat messages and notifications.
 *
 * Every read and write here goes through the signed-in user's own session, so
 * the database rules decide who may see what: a message is visible only to its
 * sender and recipient, a notification only to the person it is addressed to.
 */

import type { Tables } from "@/integrations/supabase/types";
import { getBackend } from "@/lib/calls/backend";

export type MessageRow = Tables<"messages">;
export type NotificationRow = Tables<"notifications">;

export type PeerProfile = { id: string; name: string; username: string };

const profileCache = new Map<string, PeerProfile | null>();

function handle(username: string): string {
  return username.replace(/^@/, "").toLowerCase();
}

/** Resolves a username to a real account. Null when no such account exists. */
export async function resolvePeerByUsername(username: string): Promise<PeerProfile | null> {
  const supabase = getBackend();
  if (!supabase) return null;
  const key = handle(username);
  if (profileCache.has(key)) return profileCache.get(key) ?? null;
  const { data } = await supabase
    .from("profiles")
    .select("id, name, username")
    .eq("username", key)
    .maybeSingle();
  const peer = data
    ? { id: data.id, name: data.name || data.username || key, username: data.username ?? key }
    : null;
  profileCache.set(key, peer);
  return peer;
}

/** Resolves an account id to a display identity. */
export async function resolvePeerById(id: string): Promise<PeerProfile | null> {
  const supabase = getBackend();
  if (!supabase) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, name, username")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const peer = {
    id: data.id,
    name: data.name || data.username || "N Connect user",
    username: data.username ?? "",
  };
  if (peer.username) profileCache.set(handle(peer.username), peer);
  return peer;
}

/** The signed-in account id, or null when signed out / no backend. */
export async function currentUserId(): Promise<string | null> {
  const supabase = getBackend();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * Persists an outgoing message. `clientId` is the local message id; the table
 * is unique on (sender, client id) so a retry can never create a duplicate.
 * Returns false when the peer has no real account yet (local-only chat).
 */
export async function sendMessageToBackend(input: {
  toUsername: string;
  clientId: string;
  text?: string | undefined;
  images?: string[] | undefined;
  replyTo?: string | undefined;
}): Promise<boolean> {
  const supabase = getBackend();
  if (!supabase) return false;
  const [me, peer] = await Promise.all([currentUserId(), resolvePeerByUsername(input.toUsername)]);
  if (!me || !peer || peer.id === me) return false;
  const { error } = await supabase.from("messages").insert({
    sender_id: me,
    recipient_id: peer.id,
    client_id: input.clientId,
    body: input.text ?? null,
    images: input.images ?? [],
    reply_to: input.replyTo ?? null,
  });
  // A duplicate client id means the message already reached the backend.
  if (error && error.code !== "23505") {
    console.error("message not delivered to backend", error);
    return false;
  }
  return true;
}

/** The stored id of a message this account sent, found by its local id. */
export async function findOwnMessageId(clientId: string): Promise<string | null> {
  const supabase = getBackend();
  if (!supabase) return null;
  const me = await currentUserId();
  if (!me) return null;
  const { data } = await supabase
    .from("messages")
    .select("id")
    .eq("sender_id", me)
    .eq("client_id", clientId)
    .maybeSingle();
  return data?.id ?? null;
}

/** Messages addressed to me that this device has not acknowledged yet. */
export async function fetchUndeliveredMessages(me: string): Promise<MessageRow[]> {
  const supabase = getBackend();
  if (!supabase) return [];
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("recipient_id", me)
    .is("delivered_at", null)
    .order("created_at", { ascending: true })
    .limit(200);
  return data ?? [];
}

export async function markMessagesDelivered(ids: string[]): Promise<void> {
  const supabase = getBackend();
  if (!supabase || ids.length === 0) return;
  await supabase
    .from("messages")
    .update({ delivered_at: new Date().toISOString() })
    .in("id", ids)
    .is("delivered_at", null);
}

/** Marks every message from one sender to me as read. */
export async function markConversationRead(me: string, senderId: string): Promise<void> {
  const supabase = getBackend();
  if (!supabase) return;
  await supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", me)
    .eq("sender_id", senderId)
    .is("read_at", null);
}

// Notification creation lives on the server (src/lib/notifications) so the
// recipient's settings are honoured; this module only reads and marks read.

/** Unread notifications addressed to me, newest first. */
export async function fetchUnreadNotifications(me: string): Promise<NotificationRow[]> {
  const supabase = getBackend();
  if (!supabase) return [];
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", me)
    .eq("unread", true)
    .order("created_at", { ascending: false })
    .limit(50);
  return data ?? [];
}

export async function markNotificationRead(id: string): Promise<void> {
  const supabase = getBackend();
  if (!supabase) return;
  await supabase.from("notifications").update({ unread: false }).eq("id", id);
}

export async function markAllNotificationsRead(me: string): Promise<void> {
  const supabase = getBackend();
  if (!supabase) return;
  await supabase
    .from("notifications")
    .update({ unread: false })
    .eq("user_id", me)
    .eq("unread", true);
}
