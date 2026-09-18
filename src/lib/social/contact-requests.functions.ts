/**
 * Server-side Contact Requests.
 *
 * Sending, answering and withdrawing a Contact Request all happen here so the
 * database decides who may do what. Accept Chat records a "chat" approval and
 * Accept Contact records a "contact" approval in the existing connections
 * table — the behaviour the screens already rely on.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveUserId } from "./graph.functions";

type Db = SupabaseClient<any>;

const usernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform((value) => value.replace(/^@/, "").toLowerCase());

export type ContactRequestRow = {
  id: string;
  sender_id: string;
  recipient_id: string;
  status: "pending" | "chat" | "contact" | "deleted";
  created_at: string;
};

/** Every request this account sent or received that is still unanswered. */
export const listContactRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await (supabase as Db)
      .from("contact_requests")
      .select("id, sender_id, recipient_id, status, created_at")
      .eq("status", "pending")
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
      .order("created_at", { ascending: false });
    return { requests: (data ?? []) as ContactRequestRow[] };
  });

/** Sends a request. Never creates a chat or a contact by itself. */
export const sendContactRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { peerUsername: string }) =>
    z.object({ peerUsername: usernameSchema }).parse(input),
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

    // An unanswered request in either direction already covers this pair.
    const { data: open } = await (supabase as Db)
      .from("contact_requests")
      .select("id")
      .eq("status", "pending")
      .or(
        `and(sender_id.eq.${userId},recipient_id.eq.${peerId}),and(sender_id.eq.${peerId},recipient_id.eq.${userId})`,
      )
      .limit(1);
    if ((open ?? []).length > 0) return { ok: false as const, reason: "exists" };

    const { error } = await (supabase as Db)
      .from("contact_requests")
      .insert({ sender_id: userId, recipient_id: peerId, status: "pending" });
    if (error) return { ok: false as const, reason: "failed" };
    // Activity: the recipient is told (subject to their notification settings).
    {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { emitNotification } = await import("@/lib/notifications/notifications.server");
      await emitNotification(supabaseAdmin as Db, {
        userId: peerId,
        actorId: userId,
        type: "request",
        text: "sent you a contact request",
      });
    }
    return { ok: true as const };
  });

/**
 * The recipient's answer. "delete" leaves no chat and no contact; "chat"
 * unlocks text messages; "contact" unlocks messages and saves the sender.
 */
export const respondToContactRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; action: "delete" | "chat" | "contact" }) =>
    z.object({ id: z.string().uuid(), action: z.enum(["delete", "chat", "contact"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row } = await (supabase as Db)
      .from("contact_requests")
      .select("id, sender_id, recipient_id, status")
      .eq("id", data.id)
      .maybeSingle();
    const request = row as ContactRequestRow | null;
    if (!request || request.status !== "pending") {
      return { ok: false as const, reason: "unknown-request" };
    }
    // Only the recipient answers. The sender may only withdraw.
    const isRecipient = request.recipient_id === userId;
    const isSender = request.sender_id === userId;
    if (!isRecipient && !isSender) return { ok: false as const, reason: "forbidden" };
    if (!isRecipient && data.action !== "delete")
      return { ok: false as const, reason: "forbidden" };

    if (data.action === "delete") {
      await (supabase as Db).from("contact_requests").delete().eq("id", request.id);
      if (isRecipient) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await (supabaseAdmin as Db)
          .from("notifications")
          .update({ unread: false, text: "Request rejected" })
          .eq("user_id", userId)
          .eq("actor_id", request.sender_id)
          .eq("type", "request");
      }
      return { ok: true as const };
    }

    const { data: blocked } = await (supabase as Db).rpc("is_blocked_pair", {
      _a: request.sender_id,
      _b: request.recipient_id,
    });
    if (blocked) return { ok: false as const, reason: "blocked" };

    // Accept Chat unlocks messages both ways; Accept Contact also saves the sender.
    // The answering side's own row goes through their session; the sender's
    // mirror row cannot (a person may only write their own connections), so it
    // is written with elevated access after the answer has been authorised.
    await (supabase as Db)
      .from("connections")
      .upsert(
        { owner_id: userId, peer_id: request.sender_id, kind: data.action },
        { onConflict: "owner_id,peer_id" },
      );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as Db)
      .from("connections")
      .upsert(
        { owner_id: request.sender_id, peer_id: userId, kind: "chat" },
        { onConflict: "owner_id,peer_id" },
      );

    await (supabase as Db)
      .from("contact_requests")
      .update({ status: data.action, resolved_at: new Date().toISOString() })
      .eq("id", request.id);
    // Activity: the sender learns their request was accepted; the recipient's
    // own "request" notification is settled so it no longer asks for an answer.
    {
      const { emitNotification } = await import("@/lib/notifications/notifications.server");
      await emitNotification(supabaseAdmin as Db, {
        userId: request.sender_id,
        actorId: userId,
        type: "accepted",
        text:
          data.action === "contact"
            ? "accepted your contact request"
            : "accepted your chat request",
        tone: "success",
      });
      await (supabaseAdmin as Db)
        .from("notifications")
        .update({
          unread: false,
          type: "accepted",
          tone: "success",
          text: "You accepted the request",
        })
        .eq("user_id", userId)
        .eq("actor_id", request.sender_id)
        .eq("type", "request");
    }
    return { ok: true as const };
  });

/** The sender withdraws their own unanswered request. */
export const withdrawContactRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await (supabase as Db)
      .from("contact_requests")
      .delete()
      .eq("id", data.id)
      .eq("sender_id", userId)
      .eq("status", "pending");
    if (error) return { ok: false as const, reason: "failed" };
    return { ok: true as const };
  });
