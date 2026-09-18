/**
 * Client-side view of the server social graph.
 *
 * Blocking, approved connections and per-person Trust are decided by the
 * database (see `graph.functions.ts`). This module is the only place the
 * screens use to read that state and to change it: it loads the graph at
 * start-up, keeps it live through realtime, and turns every account id the
 * server returns into the username and display name the screens work with.
 *
 * Nothing here invents data. With no backend reachable, or while signed out,
 * `loadSocialGraph` returns null and the screens simply show no server state.
 */

import { getBackend } from "@/lib/calls/backend";
import {
  blockUser,
  getSocialGraph,
  removeConnection,
  setConnection,
  setTrust,
  unblockUser,
} from "./graph.functions";

export type GraphPerson = {
  id: string;
  username: string;
  name: string;
  contactId?: string;
};

export type SocialGraph = {
  /** The signed-in account id the rows below belong to. */
  meId: string;
  /** Usernames this account has blocked. */
  blocked: string[];
  /** Usernames allowed to exchange text messages (chat or contact approval). */
  chatAllowed: string[];
  /** Usernames saved as contacts (an approved connection of kind "contact"). */
  contacts: string[];
  /** Usernames this account trusts. */
  trustMine: string[];
  /** Usernames that trust this account back. */
  trustTheirs: string[];
  /** Everyone referenced above, by lowercase username. */
  people: Record<string, GraphPerson>;
};

export type GraphResult = { ok: true } | { ok: false; reason: string };

function handle(username: string): string {
  return username.replace(/^@/, "").toLowerCase();
}

/** The signed-in account id, or null when signed out / no backend. */
export async function currentAccountId(): Promise<string | null> {
  const supabase = getBackend();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/** Resolves account ids to the identity fields the screens display. */
async function resolvePeople(ids: string[]): Promise<Map<string, GraphPerson>> {
  const map = new Map<string, GraphPerson>();
  const supabase = getBackend();
  const unique = [...new Set(ids)].filter(Boolean);
  if (!supabase || unique.length === 0) return map;
  const { data } = await supabase
    .from("profiles")
    .select("id, name, username, unique_id")
    .in("id", unique);
  (data ?? []).forEach((row) => {
    const username = row.username ?? "";
    if (!username) return;
    map.set(row.id, {
      id: row.id,
      username,
      name: row.name || username,
      ...(row.unique_id ? { contactId: row.unique_id } : {}),
    });
  });
  return map;
}

/**
 * Reads the whole graph for the signed-in account. Returns null when there is
 * no session or no backend, so callers keep whatever they already show.
 */
export async function loadSocialGraph(): Promise<SocialGraph | null> {
  const meId = await currentAccountId();
  if (!meId) return null;

  let raw: Awaited<ReturnType<typeof getSocialGraph>>;
  try {
    raw = await getSocialGraph();
  } catch (error) {
    console.error("social graph could not be loaded", error);
    return null;
  }

  const ids = [
    ...raw.blocked,
    ...raw.connections.flatMap((c) => [c.owner_id, c.peer_id]),
    ...raw.trust.flatMap((t) => [t.user_id, t.peer_id]),
  ].filter((id) => id !== meId);
  const people = await resolvePeople([...ids, ...raw.blocked]);

  const nameOf = (id: string): string | null => people.get(id)?.username ?? null;
  const push = (list: string[], id: string) => {
    const username = nameOf(id);
    if (username && !list.includes(handle(username))) list.push(handle(username));
  };

  const graph: SocialGraph = {
    meId,
    blocked: [],
    chatAllowed: [],
    contacts: [],
    trustMine: [],
    trustTheirs: [],
    people: {},
  };

  raw.blocked.forEach((id) => push(graph.blocked, id));
  raw.connections.forEach((row) => {
    // My approval unlocks chat for me; their approval unlocks chat for them.
    if (row.owner_id === meId) {
      push(graph.chatAllowed, row.peer_id);
      if (row.kind === "contact") push(graph.contacts, row.peer_id);
    } else if (row.peer_id === meId) {
      push(graph.chatAllowed, row.owner_id);
    }
  });
  raw.trust.forEach((row) => {
    if (row.user_id === meId) push(graph.trustMine, row.peer_id);
    if (row.peer_id === meId) push(graph.trustTheirs, row.user_id);
  });

  people.forEach((person) => {
    graph.people[handle(person.username)] = person;
  });

  return graph;
}

/**
 * Live updates for this account's graph. Any change to blocks, approvals or
 * trust — from this device, another device or the other person — triggers
 * `onChange` so the caller can reload the server-authoritative state.
 */
export function subscribeSocialGraph(meId: string, onChange: () => void): () => void {
  const supabase = getBackend();
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`social-graph:${meId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "blocks" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "connections" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "trust_choices" }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

function result(outcome: { ok: boolean; reason?: string }): GraphResult {
  return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason ?? "failed" };
}

/** Blocks a person on the server. Every approval and trust goes with it. */
export async function blockPeerOnServer(username: string): Promise<GraphResult> {
  try {
    return result(await blockUser({ data: { peerUsername: handle(username) } }));
  } catch (error) {
    console.error("block not saved", error);
    return { ok: false, reason: "unreachable" };
  }
}

export async function unblockPeerOnServer(username: string): Promise<GraphResult> {
  try {
    return result(await unblockUser({ data: { peerUsername: handle(username) } }));
  } catch (error) {
    console.error("unblock not saved", error);
    return { ok: false, reason: "unreachable" };
  }
}

/** Records an approval: "chat" unlocks messages, "contact" also saves them. */
export async function saveConnectionOnServer(
  username: string,
  kind: "chat" | "contact",
): Promise<GraphResult> {
  try {
    return result(await setConnection({ data: { peerUsername: handle(username), kind } }));
  } catch (error) {
    console.error("connection not saved", error);
    return { ok: false, reason: "unreachable" };
  }
}

export async function removeConnectionOnServer(username: string): Promise<GraphResult> {
  try {
    return result(await removeConnection({ data: { peerUsername: handle(username) } }));
  } catch (error) {
    console.error("connection not removed", error);
    return { ok: false, reason: "unreachable" };
  }
}

/** This side's Trust choice. The server reports whether trust is now mutual. */
export async function setTrustOnServer(
  username: string,
  trusted: boolean,
): Promise<GraphResult & { mutual?: boolean }> {
  try {
    const outcome = await setTrust({ data: { peerUsername: handle(username), trusted } });
    if (!outcome.ok) return { ok: false, reason: outcome.reason ?? "failed" };
    return { ok: true, mutual: Boolean(outcome.mutual) };
  } catch (error) {
    console.error("trust choice not saved", error);
    return { ok: false, reason: "unreachable" };
  }
}
