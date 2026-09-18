/**
 * Server-side social graph.
 *
 * Blocking, approved connections and per-person Trust live here so that Status
 * visibility, chat media authorization and calling restrictions are decided by
 * the database, never by the client. The screens keep their local state for
 * instant feedback and mirror every change through these functions.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient<any>;

const usernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform((value) => value.replace(/^@/, "").toLowerCase());

/** Resolves a username to an account id. Returns null when nobody owns it. */
export async function resolveUserId(supabase: Db, username: string): Promise<string | null> {
  const clean = username.replace(/^@/, "").toLowerCase();
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", clean)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

const peerInput = (input: { peerUsername: string }) =>
  z.object({ peerUsername: usernameSchema }).parse(input);

/** Blocks a person. Blocking is one-sided but hides both directions everywhere. */
export const blockUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(peerInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const peerId = await resolveUserId(supabase as Db, data.peerUsername);
    if (!peerId || peerId === userId) return { ok: false as const, reason: "unknown-user" };

    await (supabase as Db)
      .from("blocks")
      .upsert({ blocker_id: userId, blocked_id: peerId }, { onConflict: "blocker_id,blocked_id" });
    // A block removes every approval and trust in both directions.
    await (supabase as Db)
      .from("connections")
      .delete()
      .or(`and(owner_id.eq.${userId},peer_id.eq.${peerId}),and(owner_id.eq.${peerId},peer_id.eq.${userId})`);
    await (supabase as Db)
      .from("trust_choices")
      .delete()
      .eq("user_id", userId)
      .eq("peer_id", peerId);
    return { ok: true as const };
  });

export const unblockUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(peerInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const peerId = await resolveUserId(supabase as Db, data.peerUsername);
    if (!peerId) return { ok: false as const, reason: "unknown-user" };
    await (supabase as Db).from("blocks").delete().eq("blocker_id", userId).eq("blocked_id", peerId);
    return { ok: true as const };
  });

/** Records that this account approved someone for chat or saved them as a contact. */
export const setConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { peerUsername: string; kind: "chat" | "contact" }) =>
    z.object({ peerUsername: usernameSchema, kind: z.enum(["chat", "contact"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const peerId = await resolveUserId(supabase as Db, data.peerUsername);
    if (!peerId || peerId === userId) return { ok: false as const, reason: "unknown-user" };
    const { data: blocked } = await (supabase as Db).rpc("is_blocked_pair", {
      _a: userId,
      _b: peerId,
    });
    if (blocked) return { ok: false as const, reason: "blocked" };
    await (supabase as Db)
      .from("connections")
      .upsert(
        { owner_id: userId, peer_id: peerId, kind: data.kind },
        { onConflict: "owner_id,peer_id" },
      );
    return { ok: true as const };
  });

export const removeConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(peerInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const peerId = await resolveUserId(supabase as Db, data.peerUsername);
    if (!peerId) return { ok: false as const, reason: "unknown-user" };
    await (supabase as Db)
      .from("connections")
      .delete()
      .eq("owner_id", userId)
      .eq("peer_id", peerId);
    return { ok: true as const };
  });

/** This side's Trust choice. Images and calls need the same row from both sides. */
export const setTrust = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { peerUsername: string; trusted: boolean }) =>
    z.object({ peerUsername: usernameSchema, trusted: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const peerId = await resolveUserId(supabase as Db, data.peerUsername);
    if (!peerId || peerId === userId) return { ok: false as const, reason: "unknown-user" };
    if (data.trusted) {
      const { data: blocked } = await (supabase as Db).rpc("is_blocked_pair", {
        _a: userId,
        _b: peerId,
      });
      if (blocked) return { ok: false as const, reason: "blocked" };
      await (supabase as Db)
        .from("trust_choices")
        .upsert({ user_id: userId, peer_id: peerId }, { onConflict: "user_id,peer_id" });
    } else {
      await (supabase as Db)
        .from("trust_choices")
        .delete()
        .eq("user_id", userId)
        .eq("peer_id", peerId);
    }
    const { data: mutual } = await (supabase as Db).rpc("mutual_trust", { _a: userId, _b: peerId });
    return { ok: true as const, mutual: Boolean(mutual) };
  });

/** Everything this account needs to mirror the server graph locally. */
export const getSocialGraph = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [blocks, connections, trust] = await Promise.all([
      (supabase as Db).from("blocks").select("blocked_id").eq("blocker_id", userId),
      (supabase as Db).from("connections").select("owner_id, peer_id, kind"),
      (supabase as Db).from("trust_choices").select("user_id, peer_id"),
    ]);
    return {
      blocked: (blocks.data ?? []).map((row: any) => row.blocked_id as string),
      connections: (connections.data ?? []) as {
        owner_id: string;
        peer_id: string;
        kind: "chat" | "contact";
      }[],
      trust: (trust.data ?? []) as { user_id: string; peer_id: string }[],
    };
  });
