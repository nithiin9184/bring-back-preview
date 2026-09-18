/**
 * Connect matching — client side.
 *
 * Matching is decided by the backend: eligibility, the waiting room, who may be
 * paired with whom, the two votes and ending a pairing. This module only relays
 * those calls and keeps the screen informed while it waits, including live
 * updates when the other side votes or leaves.
 *
 * With no backend reachable nothing is fabricated: `requestMatch` reports that
 * matching is unavailable and the screen shows its existing unavailable state.
 */

import { getBackend } from "@/lib/calls/backend";
import {
  connectEligibility,
  listConnectMessages,
  sendConnectMessage,
  getConnectState,
  leaveConnect,
  requestConnectMatch as requestConnectMatchFn,
  voteConnect,
  type ConnectMessage,
  type ConnectState,
} from "./connect.functions";

export type { ConnectMessage, ConnectState } from "./connect.functions";

export type ConnectEligibility =
  | { eligible: true }
  | { eligible: false; reason: "account-unavailable" | "profile-incomplete" | "no-unique-id" | "unavailable" };

const UNAVAILABLE: ConnectState = { phase: "idle", mutual: false };

/** Whether this account may use Connect right now. */
export async function checkConnectEligibility(): Promise<ConnectEligibility> {
  if (!getBackend()) return { eligible: false, reason: "unavailable" };
  try {
    const outcome = await connectEligibility();
    return outcome.eligible ? { eligible: true } : { eligible: false, reason: outcome.reason };
  } catch (error) {
    console.error("connect eligibility could not be read", error);
    return { eligible: false, reason: "unavailable" };
  }
}

/**
 * Asks to be paired. Returns "waiting" while no eligible stranger is available,
 * "matched" with the other person once one is, and null when matching itself is
 * unavailable — never a made-up match.
 */
export async function requestConnectMatch(): Promise<ConnectState | null> {
  if (!getBackend()) return null;
  try {
    return await requestConnectMatchFn();
  } catch (error) {
    console.error("connect match could not be requested", error);
    return null;
  }
}

/** The current pairing state, used while waiting and after the other side acts. */
export async function readConnectState(): Promise<ConnectState> {
  if (!getBackend()) return UNAVAILABLE;
  try {
    return await getConnectState();
  } catch (error) {
    console.error("connect state could not be read", error);
    return UNAVAILABLE;
  }
}

/** Records this side's vote. The profile is revealed only when both vote up. */
export async function voteOnConnect(
  sessionId: string,
  vote: "up" | "down",
): Promise<ConnectState | null> {
  if (!getBackend()) return null;
  try {
    const outcome = await voteConnect({ data: { sessionId, vote } });
    return outcome.ok ? outcome.state : null;
  } catch (error) {
    console.error("connect vote not saved", error);
    return null;
  }
}

/** Leaves the waiting room and ends the pairing. */
export async function endConnect(): Promise<void> {
  if (!getBackend()) return;
  try {
    await leaveConnect();
  } catch (error) {
    console.error("connect could not be ended", error);
  }
}

/** Live updates for this account's pairing: the other side's vote or exit. */
export function subscribeConnect(meId: string, onChange: () => void): () => void {
  const supabase = getBackend();
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`connect:${meId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "connect_sessions" }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/* -------------------- Temporary Connect chat messages -------------------- */

/** Existing messages of a pairing, oldest first; empty when unreachable. */
export async function readConnectMessages(sessionId: string): Promise<ConnectMessage[]> {
  if (!getBackend()) return [];
  try {
    const outcome = await listConnectMessages({ data: { sessionId } });
    return outcome.messages;
  } catch (error) {
    console.error("connect messages could not be read", error);
    return [];
  }
}

/** Sends one message. Null when the pairing no longer accepts messages. */
export async function sendConnectChatMessage(
  sessionId: string,
  clientId: string,
  text: string,
): Promise<ConnectMessage | null> {
  if (!getBackend()) return null;
  try {
    const outcome = await sendConnectMessage({ data: { sessionId, clientId, text } });
    return outcome.ok ? outcome.message : null;
  } catch (error) {
    console.error("connect message not sent", error);
    return null;
  }
}

/** Live updates for the messages of one pairing (both matched users). */
export function subscribeConnectMessages(sessionId: string, onChange: () => void): () => void {
  const supabase = getBackend();
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`connect-messages:${sessionId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "connect_session_messages",
        filter: `session_id=eq.${sessionId}`,
      },
      onChange,
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
