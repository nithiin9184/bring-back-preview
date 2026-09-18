/**
 * Chat image media.
 *
 * Image bytes go to a private storage bucket; PostgreSQL only ever holds the
 * reference row in `chat_media`. Blocking, two-sided Trust, the Message Request
 * rule and the daily image allowance are all enforced here, on the server.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveUserId } from "@/lib/social/graph.functions";
import { PLANS } from "@/lib/entitlements";
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient<any>;

const BUCKET = "chat-media";
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export type ChatMediaDenial =
  | "unknown-user"
  | "blocked"
  | "not-trusted"
  | "not-accepted"
  | "daily-limit";

async function isPremium(supabase: Db, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("user_id", userId)
    .eq("status", "active");
  const rows = (data ?? []) as { current_period_end: string | null }[];
  return rows.some((r) => !r.current_period_end || new Date(r.current_period_end) > new Date());
}

function startOfToday(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/**
 * Runs every send-side rule once. Returns the peer id when sending is allowed.
 */
async function authorizeSend(
  supabase: Db,
  userId: string,
  peerUsername: string,
  count: number,
): Promise<{ ok: true; peerId: string } | { ok: false; reason: ChatMediaDenial }> {
  const peerId = await resolveUserId(supabase, peerUsername);
  if (!peerId || peerId === userId) return { ok: false, reason: "unknown-user" };

  const { data: blocked } = await supabase.rpc("is_blocked_pair", { _a: userId, _b: peerId });
  if (blocked) return { ok: false, reason: "blocked" };

  // Images unlock only after both people have independently chosen Trust.
  const { data: trusted } = await supabase.rpc("mutual_trust", { _a: userId, _b: peerId });
  if (!trusted) return { ok: false, reason: "not-trusted" };

  // Message Request rule: the conversation must be accepted by at least one side.
  const { count: approved } = await supabase
    .from("connections")
    .select("owner_id", { count: "exact", head: true })
    .or(
      `and(owner_id.eq.${userId},peer_id.eq.${peerId}),and(owner_id.eq.${peerId},peer_id.eq.${userId})`,
    );
  if ((approved ?? 0) === 0) return { ok: false, reason: "not-accepted" };

  const premium = await isPremium(supabase, userId);
  const allowance = premium ? PLANS.premium.images : PLANS.free.images;
  const { count: sentToday } = await supabase
    .from("chat_media")
    .select("path", { count: "exact", head: true })
    .eq("sender_id", userId)
    .gte("created_at", startOfToday());
  if ((sentToday ?? 0) + count > allowance) return { ok: false, reason: "daily-limit" };

  return { ok: true, peerId };
}

const prepareInput = z.object({
  peerUsername: z.string().trim().min(1).max(40),
  clientId: z.string().trim().min(1).max(80),
  files: z
    .array(
      z.object({
        mime: z.string().regex(/^image\/[a-z0-9.+-]+$/i, "Only images can be sent in chat"),
        sizeBytes: z.number().int().positive().max(MAX_IMAGE_BYTES),
      }),
    )
    .min(1)
    .max(10),
  /** Optional disappearing-message window, in hours. */
  expiresInHours: z.number().int().positive().max(24 * 60).optional(),
});

/**
 * Authorizes a send and hands back one-time upload targets. The browser PUTs
 * the compressed bytes straight to storage; no image ever touches the database.
 */
export const prepareChatImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof prepareInput>) => prepareInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const check = await authorizeSend(
      supabase as Db,
      userId,
      data.peerUsername,
      data.files.length,
    );
    if (!check.ok) return { ok: false as const, reason: check.reason };

    const expiresAt = data.expiresInHours
      ? new Date(Date.now() + data.expiresInHours * 3600_000).toISOString()
      : null;

    const uploads: { path: string; token: string; signedUrl: string }[] = [];
    for (const [index, file] of data.files.entries()) {
      const ext = (file.mime.split("/")[1] ?? "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "jpg";
      const path = `${userId}/${data.clientId}/${index}-${crypto.randomUUID()}.${ext}`;
      const { data: signed, error } = await (supabase as Db).storage
        .from(BUCKET)
        .createSignedUploadUrl(path);
      if (error || !signed) return { ok: false as const, reason: "unknown-user" as ChatMediaDenial };

      const { error: rowError } = await (supabase as Db).from("chat_media").insert({
        path,
        sender_id: userId,
        recipient_id: check.peerId,
        client_id: data.clientId,
        mime: file.mime,
        size_bytes: file.sizeBytes,
        expires_at: expiresAt,
      });
      if (rowError) throw new Error(rowError.message);

      uploads.push({ path, token: signed.token, signedUrl: signed.signedUrl });
    }

    return { ok: true as const, uploads };
  });

/** Turns stored paths into short-lived links. Authorization is enforced by RLS. */
export const getChatImageUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { paths: string[] }) =>
    z.object({ paths: z.array(z.string().max(400)).min(1).max(60) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Only paths this account is a participant of, and that have not expired.
    const { data: allowed } = await (supabase as Db)
      .from("chat_media")
      .select("path, expires_at")
      .in("path", data.paths);
    const live = ((allowed ?? []) as { path: string; expires_at: string | null }[]).filter(
      (row) => !row.expires_at || new Date(row.expires_at) > new Date(),
    );
    if (live.length === 0) return { urls: {} as Record<string, string> };

    const { data: signed } = await (supabase as Db).storage
      .from(BUCKET)
      .createSignedUrls(
        live.map((row) => row.path),
        SIGNED_URL_TTL_SECONDS,
      );
    const urls: Record<string, string> = {};
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
    }
    void userId;
    return { urls };
  });

/** Links uploaded media to the stored message row once the message exists. */
export const linkChatImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; messageId: string }) =>
    z
      .object({ clientId: z.string().trim().min(1).max(80), messageId: z.string().uuid() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await (supabase as Db)
      .from("chat_media")
      .update({ message_id: data.messageId })
      .eq("client_id", data.clientId)
      .eq("sender_id", userId);
    if (error) return { ok: false as const, reason: error.message };
    return { ok: true as const };
  });

/** Deletes chat images. Only the sender can remove what they sent. */
export const deleteChatImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { paths: string[] }) =>
    z.object({ paths: z.array(z.string().max(400)).min(1).max(60) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: mine } = await (supabase as Db)
      .from("chat_media")
      .select("path")
      .eq("sender_id", userId)
      .in("path", data.paths);
    const paths = ((mine ?? []) as { path: string }[]).map((row) => row.path);
    if (paths.length === 0) return { ok: true as const, removed: 0 };
    await (supabase as Db).storage.from(BUCKET).remove(paths);
    await (supabase as Db).from("chat_media").delete().in("path", paths);
    return { ok: true as const, removed: paths.length };
  });

/** Removes media whose disappearing window has passed. Safe to call on load. */
export const purgeExpiredChatImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await (supabase as Db)
      .from("chat_media")
      .select("path")
      .eq("sender_id", userId)
      .not("expires_at", "is", null)
      .lte("expires_at", new Date().toISOString());
    const paths = ((data ?? []) as { path: string }[]).map((row) => row.path);
    if (paths.length === 0) return { removed: 0 };
    await (supabase as Db).storage.from(BUCKET).remove(paths);
    await (supabase as Db).from("chat_media").delete().in("path", paths);
    return { removed: paths.length };
  });
