/**
 * Chat history read from the server message system.
 *
 * The stored messages are the authority for a conversation: this loads them
 * from the same `messages` table the send path writes to, scoped by the
 * signed-in session, so a reinstall or a second device shows the same history.
 * The device keeps only a non-authoritative copy for instant rendering.
 */

import type { ChatMessage } from "@/data/types";
import { getBackend } from "@/lib/calls/backend";
import { currentUserId, resolvePeerByUsername } from "./realtime-events";

const HISTORY_LIMIT = 500;

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * The stored conversation with one person, oldest first. Null when there is no
 * backend, no session, or no such account (nothing to load).
 */
export async function loadConversation(username: string): Promise<ChatMessage[] | null> {
  const supabase = getBackend();
  if (!supabase) return null;
  const [me, peer] = await Promise.all([currentUserId(), resolvePeerByUsername(username)]);
  if (!me || !peer) return null;
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .or(
      `and(sender_id.eq.${me},recipient_id.eq.${peer.id}),and(sender_id.eq.${peer.id},recipient_id.eq.${me})`,
    )
    .order("created_at", { ascending: true })
    .limit(HISTORY_LIMIT);
  if (error) {
    console.error("chat history could not be loaded", error);
    return null;
  }
  return (data ?? []).map((row) => {
    const images = Array.isArray(row.images) ? (row.images as string[]) : [];
    const mine = row.sender_id === me;
    return {
      id: row.id,
      mine,
      time: clock(row.created_at),
      state: row.read_at ? "read" : row.delivered_at ? "delivered" : "sent",
      ...(row.body ? { text: row.body } : {}),
      ...(images.length ? { images } : {}),
      ...(row.reply_to ? { replyTo: row.reply_to } : {}),
    } as ChatMessage;
  });
}
