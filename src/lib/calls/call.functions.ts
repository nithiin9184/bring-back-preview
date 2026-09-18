/**
 * Call lifecycle + entitlement enforcement.
 *
 * Every rule that decides whether a call may start, how long it may run and
 * whether it counted against the Free allowance lives here, on the server.
 * The client can only ask; it can never grant itself more calling time.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

export type IceServer = { urls: string | string[]; username?: string; credential?: string };

export type CallEntitlement = {
  premium: boolean;
  blocked: "calls" | "callMinutes" | null;
  callsLeft: number | null;
  secondsLeftToday: number | null;
  maxCallSeconds: number | null;
  completedToday: number;
  secondsUsedToday: number;
};

const LIVE = ["ringing", "accepted", "connected", "reconnecting"] as const;

/** STUN / TURN come from server configuration only — never from client source. */
function iceServers(): IceServer[] {
  const servers: IceServer[] = [
    { urls: (process.env["STUN_URLS"] ?? "stun:stun.l.google.com:19302").split(",") },
  ];
  const turnUrls = process.env["TURN_URLS"];
  const turnUser = process.env["TURN_USERNAME"];
  const turnCred = process.env["TURN_CREDENTIAL"];
  if (turnUrls && turnUser && turnCred) {
    servers.push({ urls: turnUrls.split(","), username: turnUser, credential: turnCred });
  }
  return servers;
}

type Db = SupabaseClient<any>;

async function readEntitlement(supabase: Db, userId: string): Promise<CallEntitlement> {
  const { data } = await supabase.rpc("call_entitlement", { _user_id: userId });
  return data as CallEntitlement;
}

export const getCallEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => readEntitlement(context.supabase, context.userId));

export const startCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { peerUsername: string; callType: "voice" | "video" }) =>
    z
      .object({
        peerUsername: z.string().trim().min(1).max(40),
        callType: z.enum(["voice", "video"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const username = data.peerUsername.replace(/^@/, "").toLowerCase();

    // Rate limit: no more than 6 call attempts a minute per account.
    const { count: recent } = await (supabase as Db)
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("caller_id", userId)
      .gte("created_at", new Date(Date.now() - 60_000).toISOString());
    if ((recent ?? 0) >= 6) {
      return { ok: false as const, reason: "rate_limited" as const };
    }

    const entitlement = await readEntitlement(supabase, userId);
    if (entitlement.blocked) {
      return { ok: false as const, reason: "limit" as const, limit: entitlement.blocked };
    }

    const { data: peer } = await (supabase as Db)
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (!peer) return { ok: false as const, reason: "unavailable" as const };
    if (peer.id === userId) return { ok: false as const, reason: "unavailable" as const };

    // Trust and blocking decide who may be called, using the same database
    // rules the rest of the app uses: a block in either direction stops the
    // call, and voice/video need trust recorded by both sides.
    const [{ data: blockedPair }, { data: mutual }] = await Promise.all([
      (supabase as Db).rpc("is_blocked_pair", { _a: userId, _b: peer.id }),
      (supabase as Db).rpc("mutual_trust", { _a: userId, _b: peer.id }),
    ]);
    if (blockedPair) return { ok: false as const, reason: "blocked" as const };
    if (!mutual) return { ok: false as const, reason: "not_trusted" as const };

    // Either side already on a live call is busy.
    const { data: live } = await (supabase as Db)
      .from("calls")
      .select("id")
      .in("status", LIVE as unknown as string[])
      .or(`caller_id.eq.${peer.id},callee_id.eq.${peer.id}`)
      .gte("created_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .limit(1);
    if (live && live.length > 0) return { ok: false as const, reason: "busy" as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const database = supabaseAdmin as SupabaseClient<any>;
    const { data: call, error } = await database
      .from("calls")
      .insert({
        caller_id: userId,
        callee_id: peer.id,
        call_type: data.callType,
        status: "ringing",
        max_seconds: entitlement.premium ? null : entitlement.maxCallSeconds,
      })
      .select("id, max_seconds")
      .single();
    if (error || !call) return { ok: false as const, reason: "failed" as const };

    // Activity: an incoming-call entry for the callee (honours their settings).
    {
      const { emitNotification } = await import("@/lib/notifications/notifications.server");
      await emitNotification(database, {
        userId: peer.id,
        actorId: userId,
        type: "call",
        text: `Incoming ${data.callType} call`,
      });
    }

    return {
      ok: true as const,
      callId: call.id,
      maxSeconds: call.max_seconds,
      iceServers: iceServers(),
      entitlement,
    };
  });

export const acceptCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { callId: string }) =>
    z.object({ callId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: call } = await (supabase as Db)
      .from("calls")
      .select("id, caller_id, callee_id, status, max_seconds")
      .eq("id", data.callId)
      .maybeSingle();
    if (!call || call.callee_id !== userId)
      return { ok: false as const, reason: "forbidden" as const };
    if (call.status !== "ringing") return { ok: false as const, reason: "gone" as const };

    // The same Trust/Block rules are re-checked here: either side may have
    // blocked or withdrawn trust between the ring and the answer.
    const [{ data: blockedPair }, { data: mutual }] = await Promise.all([
      (supabase as Db).rpc("is_blocked_pair", { _a: userId, _b: call.caller_id }),
      (supabase as Db).rpc("mutual_trust", { _a: userId, _b: call.caller_id }),
    ]);
    if (blockedPair || !mutual) {
      await endCallRecord(data.callId, "rejected", blockedPair ? "blocked" : "not_trusted");
      return {
        ok: false as const,
        reason: blockedPair ? ("blocked" as const) : ("not_trusted" as const),
      };
    }

    const entitlement = await readEntitlement(supabase, userId);
    if (entitlement.blocked) {
      await endCallRecord(data.callId, "rejected", "callee_limit");
      return { ok: false as const, reason: "limit" as const, limit: entitlement.blocked };
    }

    // The stricter of the two participants' allowances applies.
    const maxSeconds =
      call.max_seconds === null
        ? entitlement.maxCallSeconds
        : entitlement.maxCallSeconds === null
          ? call.max_seconds
          : Math.min(call.max_seconds, entitlement.maxCallSeconds);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const database = supabaseAdmin as SupabaseClient<any>;
    await database
      .from("calls")
      .update({
        status: "connected",
        connected_at: new Date().toISOString(),
        max_seconds: maxSeconds,
      })
      .eq("id", data.callId);

    return { ok: true as const, maxSeconds, iceServers: iceServers(), entitlement };
  });

/** Shared server-side finaliser: computes the duration from stored timestamps. */
async function endCallRecord(callId: string, status: string, reason: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const database = supabaseAdmin as SupabaseClient<any>;
  const { data: call } = await database
    .from("calls")
    .select("id, status, connected_at, max_seconds")
    .eq("id", callId)
    .maybeSingle();
  if (!call) return null;
  if (!(LIVE as unknown as string[]).includes(call.status)) return call;

  const endedAt = new Date();
  let duration = 0;
  let finalStatus = status;
  if (call.connected_at) {
    duration = Math.max(
      0,
      Math.round((endedAt.getTime() - new Date(call.connected_at).getTime()) / 1000),
    );
    if (call.max_seconds !== null) duration = Math.min(duration, call.max_seconds);
    // Only a call that actually connected can be "completed" and consume usage.
    finalStatus = "completed";
  }

  const { data: updated } = await database
    .from("calls")
    .update({
      status: finalStatus,
      end_reason: reason,
      ended_at: endedAt.toISOString(),
      duration_seconds: duration,
    })
    .eq("id", callId)
    .select("id, status, duration_seconds")
    .single();
  return updated;
}

export const endCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      callId: string;
      reason?: "hangup" | "rejected" | "missed" | "busy" | "failed" | "limit";
    }) =>
      z
        .object({
          callId: z.string().uuid(),
          reason: z
            .enum(["hangup", "rejected", "missed", "busy", "failed", "limit"])
            .default("hangup"),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: call } = await (supabase as Db)
      .from("calls")
      .select("id, caller_id, callee_id, status")
      .eq("id", data.callId)
      .maybeSingle();
    if (!call || (call.caller_id !== userId && call.callee_id !== userId)) {
      return { ok: false as const, reason: "forbidden" as const };
    }
    const wasRinging = call.status === "ringing";

    const statusByReason: Record<string, string> = {
      hangup: "cancelled",
      rejected: "rejected",
      missed: "missed",
      busy: "busy",
      failed: "failed",
      limit: "completed",
    };
    const result = await endCallRecord(
      data.callId,
      statusByReason[data.reason] ?? "cancelled",
      data.reason,
    );
    // Activity: a missed call is recorded for the person who did not answer
    // (the callee for a missed or cancelled ring). Only the first end wins.
    const unanswered =
      wasRinging &&
      (data.reason === "missed" || (data.reason === "hangup" && call.caller_id === userId));
    if (unanswered && result && ["missed", "cancelled"].includes(result.status)) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { emitNotification } = await import("@/lib/notifications/notifications.server");
      await emitNotification(supabaseAdmin as Db, {
        userId: call.callee_id,
        actorId: call.caller_id,
        type: "call",
        text: "Missed call",
        tone: "warning",
      });
    }
    const entitlement = await readEntitlement(supabase, userId);
    return { ok: true as const, call: result, entitlement };
  });

/**
 * Heartbeat while connected. Returns the seconds still allowed; when the Free
 * per-call or daily allowance runs out the server ends the call itself.
 */
export const callTick = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { callId: string }) =>
    z.object({ callId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: call } = await (supabase as Db)
      .from("calls")
      .select("id, caller_id, callee_id, status, connected_at, max_seconds")
      .eq("id", data.callId)
      .maybeSingle();
    if (!call || (call.caller_id !== userId && call.callee_id !== userId)) {
      return { ok: false as const, reason: "forbidden" as const };
    }
    if (!(LIVE as unknown as string[]).includes(call.status)) {
      return { ok: true as const, ended: true, elapsed: 0, remaining: 0 };
    }
    if (!call.connected_at) {
      return { ok: true as const, ended: false, elapsed: 0, remaining: call.max_seconds };
    }

    const elapsed = Math.max(
      0,
      Math.round((Date.now() - new Date(call.connected_at).getTime()) / 1000),
    );
    if (call.max_seconds !== null && elapsed >= call.max_seconds) {
      await endCallRecord(call.id, "completed", "limit");
      return { ok: true as const, ended: true, elapsed: call.max_seconds, remaining: 0 };
    }
    return {
      ok: true as const,
      ended: false,
      elapsed,
      remaining: call.max_seconds === null ? null : call.max_seconds - elapsed,
    };
  });
