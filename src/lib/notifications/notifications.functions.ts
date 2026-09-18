/**
 * Notification actions that need more than the signed-in person's own row.
 *
 * Reading the list and flipping the unread flag happen through the person's
 * own session (row-level security scopes them). Everything that creates a
 * notification, or resolves the request behind one, runs here so the recipient's
 * preferences are honoured and the underlying server state really changes.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveUserId } from "@/lib/social/graph.functions";

type Db = SupabaseClient<any>;

const usernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform((value) => value.replace(/^@/, "").toLowerCase());

/** Records a security/account event addressed to the signed-in account. */
export const recordSecurityEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { text: string; tone?: "default" | "warning" | "success"; source?: string }) =>
      z
        .object({
          text: z.string().trim().min(1).max(280),
          tone: z.enum(["default", "warning", "success"]).default("default"),
          source: z.string().trim().min(1).max(60).default("N Connect"),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { emitNotification } = await import("./notifications.server");
    const created = await emitNotification(supabaseAdmin as Db, {
      userId: context.userId,
      type: "security",
      text: data.text,
      tone: data.tone,
      name: data.source,
    });
    return { ok: true as const, created };
  });

/** Tells someone that the signed-in account sent them a message request. */
export const notifyMessageRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { peerUsername: string }) =>
    z.object({ peerUsername: usernameSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const peerId = await resolveUserId(context.supabase as Db, data.peerUsername);
    if (!peerId || peerId === context.userId) return { ok: false as const };
    const { data: blocked } = await (context.supabase as Db).rpc("is_blocked_pair", {
      _a: context.userId,
      _b: peerId,
    });
    if (blocked) return { ok: false as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { emitNotification } = await import("./notifications.server");
    const created = await emitNotification(supabaseAdmin as Db, {
      userId: peerId,
      actorId: context.userId,
      type: "message_request",
      text: "sent you a message request",
    });
    return { ok: true as const, created };
  });

/* ------------------------------------------------------------------ likes */

/** Profiles the signed-in account has liked (usernames, lower-case). */
export const listMyLikes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as Db;
    const { data: likes } = await db
      .from("profile_likes")
      .select("liked_id")
      .eq("liker_id", context.userId);
    const ids = (likes ?? []).map((row: { liked_id: string }) => row.liked_id);
    if (ids.length === 0) return { usernames: [] as string[] };
    const { data: profiles } = await db.from("profiles").select("username").in("id", ids);
    return {
      usernames: (profiles ?? [])
        .map((p: { username: string | null }) => (p.username ?? "").toLowerCase())
        .filter(Boolean),
    };
  });

/** Likes or unlikes a profile; a new like tells the other person. */
export const setProfileLike = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { peerUsername: string; liked: boolean }) =>
    z.object({ peerUsername: usernameSchema, liked: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as Db;
    const peerId = await resolveUserId(db, data.peerUsername);
    if (!peerId || peerId === context.userId)
      return { ok: false as const, reason: "unknown-user" as const };

    if (!data.liked) {
      await db.from("profile_likes").delete().eq("liker_id", context.userId).eq("liked_id", peerId);
      return { ok: true as const, created: false };
    }

    const { data: blocked } = await db.rpc("is_blocked_pair", { _a: context.userId, _b: peerId });
    if (blocked) return { ok: false as const, reason: "blocked" as const };

    const { error } = await db
      .from("profile_likes")
      .insert({ liker_id: context.userId, liked_id: peerId });
    // Already liked: nothing new happened, so nobody is told twice.
    if (error && error.code === "23505") return { ok: true as const, created: false };
    if (error) return { ok: false as const, reason: "failed" as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { emitNotification } = await import("./notifications.server");
    const created = await emitNotification(supabaseAdmin as Db, {
      userId: peerId,
      actorId: context.userId,
      type: "like",
      text: "liked your profile",
    });
    return { ok: true as const, created };
  });

/* --------------------------------------------------------- request answers */

/**
 * Accept or reject the request behind a notification. A Contact Request is
 * answered through the real request row; a Message Request accepts the chat.
 * The notification then reflects the answer and is marked read.
 */
export const resolveRequestNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; accept: boolean }) =>
    z.object({ id: z.string().uuid(), accept: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as Db;
    const { userId } = context;
    const { data: row } = await db
      .from("notifications")
      .select("id, user_id, actor_id, type, username")
      .eq("id", data.id)
      .maybeSingle();
    if (!row || row.user_id !== userId) return { ok: false as const, reason: "unknown" as const };
    if (row.type !== "request" && row.type !== "message_request") {
      return { ok: false as const, reason: "not-a-request" as const };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as Db;
    let outcome: "answered" | "expired" = "expired";

    if (row.type === "request" && row.actor_id) {
      const { data: request } = await db
        .from("contact_requests")
        .select("id, status")
        .eq("sender_id", row.actor_id)
        .eq("recipient_id", userId)
        .eq("status", "pending")
        .maybeSingle();
      if (request) {
        if (data.accept) {
          const { data: blocked } = await db.rpc("is_blocked_pair", {
            _a: row.actor_id,
            _b: userId,
          });
          if (blocked) return { ok: false as const, reason: "blocked" as const };
          await db
            .from("connections")
            .upsert(
              { owner_id: userId, peer_id: row.actor_id, kind: "chat" },
              { onConflict: "owner_id,peer_id" },
            );
          await admin
            .from("connections")
            .upsert(
              { owner_id: row.actor_id, peer_id: userId, kind: "chat" },
              { onConflict: "owner_id,peer_id" },
            );
          await db
            .from("contact_requests")
            .update({ status: "chat", resolved_at: new Date().toISOString() })
            .eq("id", request.id);
          const { emitNotification } = await import("./notifications.server");
          await emitNotification(admin, {
            userId: row.actor_id,
            actorId: userId,
            type: "accepted",
            text: "accepted your request",
            tone: "success",
          });
        } else {
          await db.from("contact_requests").delete().eq("id", request.id);
        }
        outcome = "answered";
      }
    } else if (row.type === "message_request" && row.username) {
      const peer = String(row.username).replace(/^@/, "").toLowerCase();
      if (data.accept) {
        await db.from("chat_states").upsert(
          {
            user_id: userId,
            peer_username: peer,
            accepted: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,peer_username" },
        );
      }
      outcome = "answered";
    }

    const text =
      outcome === "expired"
        ? "This request is no longer open"
        : data.accept
          ? "You accepted the request"
          : "Request rejected";
    await admin
      .from("notifications")
      .update({
        unread: false,
        type: data.accept && outcome === "answered" ? "accepted" : row.type,
        tone: data.accept && outcome === "answered" ? "success" : "default",
        text,
      })
      .eq("id", row.id)
      .eq("user_id", userId);
    return { ok: true as const, outcome };
  });
