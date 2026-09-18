/**
 * Client-side view of server Contact Requests.
 *
 * Requests are rows in the database (see `contact-requests.functions.ts`), so
 * both people see the same thing on every device. This module loads them, keeps
 * them live through realtime, and turns the account ids the server returns into
 * the name, username and Unique ID the screens display. Nothing is kept on the
 * device: with no backend reachable the list is simply empty.
 */

import { getBackend } from "@/lib/calls/backend";
import type { ContactRequest } from "@/data/types";
import {
  listContactRequests,
  respondToContactRequest,
  sendContactRequest,
  withdrawContactRequest,
} from "./contact-requests.functions";

export type RequestOutcome = { ok: true } | { ok: false; reason: string };

function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Every unanswered request for the signed-in account, both directions.
 * Returns null when there is no session or no backend.
 */
export async function loadContactRequests(): Promise<ContactRequest[] | null> {
  const supabase = getBackend();
  if (!supabase) return null;
  const { data: session } = await supabase.auth.getUser();
  const meId = session.user?.id;
  if (!meId) return null;

  let rows: Awaited<ReturnType<typeof listContactRequests>>["requests"];
  try {
    rows = (await listContactRequests()).requests;
  } catch (error) {
    console.error("contact requests could not be loaded", error);
    return null;
  }
  if (rows.length === 0) return [];

  const peerIds = [
    ...new Set(rows.map((r) => (r.sender_id === meId ? r.recipient_id : r.sender_id))),
  ];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name, username, unique_id")
    .in("id", peerIds);
  const people = new Map((profiles ?? []).map((p) => [p.id, p]));

  return rows
    .map((row) => {
      const incoming = row.recipient_id === meId;
      const peerId = incoming ? row.sender_id : row.recipient_id;
      const person = people.get(peerId);
      const username = person?.username ?? "";
      if (!username) return null;
      return {
        id: row.id,
        name: person?.name || username,
        username,
        ...(person?.unique_id ? { contactId: person.unique_id } : {}),
        time: relativeTime(row.created_at),
        direction: incoming ? ("incoming" as const) : ("outgoing" as const),
      } satisfies ContactRequest;
    })
    .filter((row): row is ContactRequest => row !== null);
}

/** Live updates: a request sent, answered or withdrawn by either side. */
export function subscribeContactRequests(meId: string, onChange: () => void): () => void {
  const supabase = getBackend();
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`contact-requests:${meId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "contact_requests" }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/** Sends a Contact Request. The recipient decides what happens next. */
export async function sendRequestOnServer(username: string): Promise<RequestOutcome> {
  try {
    const outcome = await sendContactRequest({ data: { peerUsername: username } });
    return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason ?? "failed" };
  } catch (error) {
    console.error("contact request not sent", error);
    return { ok: false, reason: "unreachable" };
  }
}

/** The recipient's answer: Delete, Accept Chat or Accept Contact. */
export async function respondToRequestOnServer(
  id: string,
  action: "delete" | "chat" | "contact",
): Promise<RequestOutcome> {
  try {
    const outcome = await respondToContactRequest({ data: { id, action } });
    return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason ?? "failed" };
  } catch (error) {
    console.error("contact request not answered", error);
    return { ok: false, reason: "unreachable" };
  }
}

/** The sender withdraws their own unanswered request. */
export async function withdrawRequestOnServer(id: string): Promise<RequestOutcome> {
  try {
    const outcome = await withdrawContactRequest({ data: { id } });
    return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason ?? "failed" };
  } catch (error) {
    console.error("contact request not withdrawn", error);
    return { ok: false, reason: "unreachable" };
  }
}
