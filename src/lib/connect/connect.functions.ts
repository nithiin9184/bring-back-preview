/**
 * Server-side Connect matching.
 *
 * Connect pairs two strangers. Every rule that decides whether that may happen
 * lives in the database (see migration 0013):
 *
 * - eligibility: a verified account with a finished profile and a Unique ID
 * - availability: a live place in the waiting room (heartbeat under 45 seconds)
 * - pairing: the longest-waiting other person who is not blocked either way,
 *   is not already an approved connection, and is not in another pairing
 *
 * The screen asks to be matched, reads the state it is in, votes and leaves.
 * It never decides who it is paired with.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Db = SupabaseClient<any>;

export type ConnectPhase = "idle" | "waiting" | "matched" | "ended";

export type ConnectPeer = {
  username: string;
  name: string;
  contactId?: string;
};

export type ConnectState = {
  phase: ConnectPhase;
  sessionId?: string;
  peer?: ConnectPeer;
  /** This side's vote, when it has voted. */
  myVote?: "up" | "down";
  /** The other side's vote, when they have voted. */
  theirVote?: "up" | "down";
  /** True once both sides voted up: the profile may be revealed. */
  mutual: boolean;
};

type SessionRow = {
  id: string;
  a_id: string;
  b_id: string;
  a_vote: "up" | "down" | null;
  b_vote: "up" | "down" | null;
  ended_at: string | null;
};

/** Turns a pairing row into the state this side of it sees. */
async function stateFor(
  supabase: Db,
  userId: string,
  session: SessionRow | null,
  waiting: boolean,
): Promise<ConnectState> {
  if (!session) return { phase: waiting ? "waiting" : "idle", mutual: false };

  const mine = session.a_id === userId ? session.a_vote : session.b_vote;
  const theirs = session.a_id === userId ? session.b_vote : session.a_vote;
  const peerId = session.a_id === userId ? session.b_id : session.a_id;

  const { data } = await supabase
    .from("profiles")
    .select("name, username, unique_id")
    .eq("id", peerId)
    .maybeSingle();
  const row = data as { name: string | null; username: string | null; unique_id: string | null } | null;
  const username = row?.username ?? "";

  return {
    phase: session.ended_at ? "ended" : "matched",
    sessionId: session.id,
    ...(username
      ? {
          peer: {
            username,
            name: row?.name || username,
            ...(row?.unique_id ? { contactId: row.unique_id } : {}),
          },
        }
      : {}),
    ...(mine ? { myVote: mine } : {}),
    ...(theirs ? { theirVote: theirs } : {}),
    mutual: mine === "up" && theirs === "up",
  };
}

async function liveSession(supabase: Db, userId: string): Promise<SessionRow | null> {
  const { data } = await supabase
    .from("connect_sessions")
    .select("id, a_id, b_id, a_vote, b_vote, ended_at")
    .is("ended_at", null)
    .or(`a_id.eq.${userId},b_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SessionRow | null) ?? null;
}

/** Whether this account may use Connect at all. */
export const connectEligibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await (supabase as Db)
      .from("profiles")
      .select("username, unique_id, profile_completed, auth_status")
      .eq("id", userId)
      .maybeSingle();
    const row = data as {
      username: string | null;
      unique_id: string | null;
      profile_completed: boolean | null;
      auth_status: string | null;
    } | null;
    if (!row || row.auth_status !== "verified") {
      return { eligible: false as const, reason: "account-unavailable" as const };
    }
    if (!row.profile_completed || !row.username) {
      return { eligible: false as const, reason: "profile-incomplete" as const };
    }
    if (!row.unique_id) return { eligible: false as const, reason: "no-unique-id" as const };
    return { eligible: true as const };
  });

/**
 * Joins the waiting room and returns the pairing when one is available. Calling
 * it again while waiting simply refreshes this account's place in the queue.
 */
export const requestConnectMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase as Db).rpc("connect_find_match");
    if (error) return { phase: "idle" as const, mutual: false };
    if (!data) return { phase: "waiting" as const, mutual: false };
    const session = await liveSession(supabase as Db, userId);
    return stateFor(supabase as Db, userId, session, true);
  });

/** The current Connect state for this account: waiting, matched or neither. */
export const getConnectState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const session = await liveSession(supabase as Db, userId);
    if (session) return stateFor(supabase as Db, userId, session, false);
    const { data } = await (supabase as Db)
      .from("connect_queue")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    return stateFor(supabase as Db, userId, null, Boolean(data));
  });

/** Records this side's vote on the current pairing. */
export const voteConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sessionId: string; vote: "up" | "down" }) =>
    z.object({ sessionId: z.string().uuid(), vote: z.enum(["up", "down"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row } = await (supabase as Db)
      .from("connect_sessions")
      .select("id, a_id, b_id, a_vote, b_vote, ended_at")
      .eq("id", data.sessionId)
      .maybeSingle();
    const session = (row as SessionRow | null) ?? null;
    if (!session || session.ended_at) return { ok: false as const, reason: "no-session" as const };
    if (session.a_id !== userId && session.b_id !== userId) {
      return { ok: false as const, reason: "forbidden" as const };
    }
    const column = session.a_id === userId ? "a_vote" : "b_vote";
    await (supabase as Db)
      .from("connect_sessions")
      .update({ [column]: data.vote })
      .eq("id", session.id);
    const updated = await liveSession(supabase as Db, userId);
    return {
      ok: true as const,
      state: await stateFor(supabase as Db, userId, updated, false),
    };
  });

/** Leaves the waiting room and ends any pairing this account is in. */
export const leaveConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await (context.supabase as Db).rpc("connect_leave");
    return { ok: true as const };
  });

/* -------------------- Temporary Connect chat messages -------------------- */
//
// Messages of a Connect pairing are stored server-side in
// `connect_session_messages` (migration 0014), separate from the permanent
// one-to-one chat. The database decides who may read and write: only the two
// matched accounts, only while the pairing is live, never a blocked pair.

export type ConnectMessage = {
  id: string;
  clientId: string;
  mine: boolean;
  text: string;
  createdAt: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  sender_id: string;
  client_id: string;
  body: string;
  created_at: string;
};

const sessionIdInput = z.object({ sessionId: z.string().uuid() });

/** Every message of a pairing, oldest first. Empty when not a member. */
export const listConnectMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sessionId: string }) => sessionIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows } = await (supabase as Db)
      .from("connect_session_messages")
      .select("id, session_id, sender_id, client_id, body, created_at")
      .eq("session_id", data.sessionId)
      .order("created_at", { ascending: true });
    const list = ((rows as MessageRow[] | null) ?? []).map((row) => ({
      id: row.id,
      clientId: row.client_id,
      mine: row.sender_id === userId,
      text: row.body,
      createdAt: row.created_at,
    }));
    return { messages: list satisfies ConnectMessage[] };
  });

/** Stores one outgoing message. Rejected once the pairing has ended. */
export const sendConnectMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sessionId: string; clientId: string; text: string }) =>
    z
      .object({
        sessionId: z.string().uuid(),
        clientId: z.string().min(1).max(120),
        text: z.string().trim().min(1).max(4000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await (supabase as Db)
      .from("connect_session_messages")
      .insert({
        session_id: data.sessionId,
        sender_id: userId,
        client_id: data.clientId,
        body: data.text,
      })
      .select("id, session_id, sender_id, client_id, body, created_at")
      .maybeSingle();
    if (error || !row) return { ok: false as const, reason: "not-allowed" as const };
    const saved = row as MessageRow;
    return {
      ok: true as const,
      message: {
        id: saved.id,
        clientId: saved.client_id,
        mine: true,
        text: saved.body,
        createdAt: saved.created_at,
      } satisfies ConnectMessage,
    };
  });
