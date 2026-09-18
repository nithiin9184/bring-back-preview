/**
 * Status backend.
 *
 * Statuses live in the database, their photos and videos live in private object
 * storage. Visibility (Public / Private), blocked people, the 24-hour expiry and
 * the view list are all decided here, on the server. The client can only ask.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveUserId } from "@/lib/social/graph.functions";
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient<any>;

const BUCKET = "status-media";
/** Signed media links stay valid for one viewing session. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type StatusRecord = {
  id: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  authorContactId?: string;
  kind: "text" | "photo" | "video";
  text?: string;
  caption?: string;
  background?: string;
  captionX?: number;
  captionY?: number;
  textAlign?: "left" | "center" | "right";
  textY?: number;
  mediaUrl?: string;
  mediaPath?: string;
  videoStart?: number;
  videoEnd?: number;
  visibility: "public" | "private";
  createdAt: number;
  expiresAt: number;
  mine: boolean;
  views: { userId: string; username: string; name: string; at: number; audience: "public" | "private" }[];
};

const fileSchema = z.object({
  mime: z
    .string()
    .trim()
    .regex(/^(image|video)\/[a-z0-9.+-]+$/i, "Only image or video media is allowed"),
  sizeBytes: z.number().int().positive().max(50 * 1024 * 1024),
});

function extensionFor(mime: string): string {
  const raw = mime.split("/")[1] ?? "bin";
  return raw.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
}

/**
 * Hands back a one-time upload target inside the caller's own folder. The
 * bytes go straight to object storage; PostgreSQL never sees the media.
 */
export const prepareStatusMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { mime: string; sizeBytes: number }) => fileSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const path = `${userId}/${crypto.randomUUID()}.${extensionFor(data.mime)}`;
    const { data: signed, error } = await (supabase as Db).storage
      .from(BUCKET)
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Could not start the upload");
    return { path, token: signed.token, signedUrl: signed.signedUrl };
  });

const createInput = z.object({
  kind: z.enum(["text", "photo", "video"]),
  visibility: z.enum(["public", "private"]),
  text: z.string().max(2000).optional(),
  caption: z.string().max(2000).optional(),
  background: z.string().max(400).optional(),
  captionX: z.number().optional(),
  captionY: z.number().optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  textY: z.number().optional(),
  mediaPath: z.string().max(400).optional(),
  videoStart: z.number().nonnegative().optional(),
  videoEnd: z.number().nonnegative().optional(),
  mediaMime: z.string().max(120).optional(),
});

export const createStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof createInput>) => createInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.kind !== "text" && !data.mediaPath) throw new Error("Media is missing");
    // A caller may only reference media inside their own storage folder.
    if (data.mediaPath && !data.mediaPath.startsWith(`${userId}/`)) {
      throw new Error("That media does not belong to this account");
    }

    const { data: row, error } = await (supabase as Db)
      .from("statuses")
      .insert({
        author_id: userId,
        kind: data.kind,
        visibility: data.visibility,
        text: data.text ?? null,
        caption: data.caption ?? null,
        background: data.background ?? null,
        caption_x: data.captionX ?? null,
        caption_y: data.captionY ?? null,
        text_align: data.textAlign ?? null,
        text_y: data.textY ?? null,
        media_path: data.mediaPath ?? null,
        media_mime: data.mediaMime ?? null,
        video_start: data.videoStart ?? null,
        video_end: data.videoEnd ?? null,
      })
      .select("id, created_at, expires_at")
      .single();
    if (error) throw new Error(error.message);
    return {
      id: (row as any).id as string,
      createdAt: new Date((row as any).created_at).getTime(),
      expiresAt: new Date((row as any).expires_at).getTime(),
    };
  });

/** Deletes expired statuses and their media. Cheap, idempotent, runs on load. */
async function purgeExpired(supabase: Db, userId: string) {
  const { data: dead } = await supabase
    .from("statuses")
    .select("id, media_path")
    .eq("author_id", userId)
    .lte("expires_at", new Date().toISOString());
  const rows = (dead ?? []) as { id: string; media_path: string | null }[];
  if (rows.length === 0) return;
  const paths = rows.map((r) => r.media_path).filter((p): p is string => Boolean(p));
  if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);
  await supabase
    .from("statuses")
    .delete()
    .in(
      "id",
      rows.map((r) => r.id),
    );
}

/**
 * Every status this account may see right now: their own plus everyone whose
 * visibility rules let them through. Expired entries never come back.
 */
export const listStatuses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await purgeExpired(supabase as Db, userId);

    const { data, error } = await (supabase as Db)
      .from("statuses")
      .select(
        "id, author_id, kind, text, caption, background, caption_x, caption_y, text_align, text_y, media_path, media_mime, video_start, video_end, visibility, created_at, expires_at",
      )
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as any[];
    const authorIds = [...new Set(rows.map((r) => r.author_id as string))];
    const statusIds = rows.map((r) => r.id as string);

    const [{ data: profiles }, { data: views }, { data: seen }] = await Promise.all([
      authorIds.length
        ? (supabase as Db).from("profiles").select("id, username, name, unique_id").in("id", authorIds)
        : Promise.resolve({ data: [] as any[] } as any),
      statusIds.length
        ? (supabase as Db)
            .from("status_views")
            .select("status_id, viewer_id, audience, viewed_at")
            .in("status_id", statusIds)
        : Promise.resolve({ data: [] as any[] } as any),
      statusIds.length
        ? (supabase as Db)
            .from("status_views")
            .select("status_id")
            .eq("viewer_id", userId)
            .in("status_id", statusIds)
        : Promise.resolve({ data: [] as any[] } as any),
    ]);

    const profileById = new Map<string, any>((profiles ?? []).map((p: any) => [p.id, p]));
    const viewerIds = [...new Set((views ?? []).map((v: any) => v.viewer_id as string))];
    const { data: viewerProfiles } = viewerIds.length
      ? await (supabase as Db).from("profiles").select("id, username, name").in("id", viewerIds)
      : ({ data: [] as any[] } as any);
    const viewerById = new Map<string, any>((viewerProfiles ?? []).map((p: any) => [p.id, p]));

    // Signed links for the private media bucket, one batch per bucket call.
    const mediaPaths = rows.map((r) => r.media_path).filter((p: string | null): p is string => Boolean(p));
    const urlByPath = new Map<string, string>();
    if (mediaPaths.length > 0) {
      const { data: signed } = await (supabase as Db).storage
        .from(BUCKET)
        .createSignedUrls(mediaPaths, SIGNED_URL_TTL_SECONDS);
      for (const item of signed ?? []) {
        if (item.path && item.signedUrl) urlByPath.set(item.path, item.signedUrl);
      }
    }

    const statuses: StatusRecord[] = rows.map((r) => {
      const author = profileById.get(r.author_id);
      const mine = r.author_id === userId;
      const rowViews = mine
        ? (views ?? [])
            .filter((v: any) => v.status_id === r.id)
            .map((v: any) => ({
              userId: v.viewer_id as string,
              username: (viewerById.get(v.viewer_id)?.username as string) ?? "",
              name: (viewerById.get(v.viewer_id)?.name as string) ?? "",
              at: new Date(v.viewed_at).getTime(),
              audience: v.audience as "public" | "private",
            }))
        : [];
      return {
        id: r.id,
        authorId: r.author_id,
        authorUsername: author?.username ?? "",
        authorName: author?.name ?? author?.username ?? "",
        ...(author?.unique_id ? { authorContactId: String(author.unique_id) } : {}),
        kind: r.kind,
        ...(r.text ? { text: r.text } : {}),
        ...(r.caption ? { caption: r.caption } : {}),
        ...(r.background ? { background: r.background } : {}),
        ...(r.caption_x !== null ? { captionX: r.caption_x } : {}),
        ...(r.caption_y !== null ? { captionY: r.caption_y } : {}),
        ...(r.text_align ? { textAlign: r.text_align } : {}),
        ...(r.text_y !== null ? { textY: r.text_y } : {}),
        ...(r.media_path ? { mediaPath: r.media_path } : {}),
        ...(r.media_path && urlByPath.has(r.media_path)
          ? { mediaUrl: urlByPath.get(r.media_path)! }
          : {}),
        ...(r.video_start !== null ? { videoStart: r.video_start } : {}),
        ...(r.video_end !== null ? { videoEnd: r.video_end } : {}),
        visibility: r.visibility,
        createdAt: new Date(r.created_at).getTime(),
        expiresAt: new Date(r.expires_at).getTime(),
        mine,
        views: rowViews,
      };
    });

    return {
      statuses,
      seen: (seen ?? []).map((s: any) => s.status_id as string),
    };
  });

/** Records that the caller opened a status. The audience is decided server-side. */
export const recordStatusView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { statusId: string }) =>
    z.object({ statusId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: status } = await (supabase as Db)
      .from("statuses")
      .select("author_id")
      .eq("id", data.statusId)
      .maybeSingle();
    const authorId = (status as { author_id: string } | null)?.author_id;
    if (!authorId) return { ok: false as const, reason: "gone" };
    if (authorId === userId) return { ok: true as const };

    // Approved contacts/followers count as a private view, everyone else public.
    const { data: approved } = await (supabase as Db).rpc("is_connected", {
      _owner: authorId,
      _peer: userId,
    });
    const { error } = await (supabase as Db)
      .from("status_views")
      .upsert(
        {
          status_id: data.statusId,
          viewer_id: userId,
          audience: approved ? "private" : "public",
        },
        { onConflict: "status_id,viewer_id", ignoreDuplicates: true },
      );
    if (error) return { ok: false as const, reason: error.message };
    return { ok: true as const };
  });

export const deleteStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { statusId: string }) =>
    z.object({ statusId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row } = await (supabase as Db)
      .from("statuses")
      .select("id, author_id, media_path")
      .eq("id", data.statusId)
      .maybeSingle();
    const status = row as { author_id: string; media_path: string | null } | null;
    if (!status) return { ok: true as const };
    if (status.author_id !== userId) return { ok: false as const, reason: "not-yours" };
    if (status.media_path) await (supabase as Db).storage.from(BUCKET).remove([status.media_path]);
    const { error } = await (supabase as Db).from("statuses").delete().eq("id", data.statusId);
    if (error) return { ok: false as const, reason: error.message };
    return { ok: true as const };
  });

/** Used by the ring on a profile: does this person have anything live for me? */
export const hasLiveStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { peerUsername: string }) =>
    z.object({ peerUsername: z.string().trim().min(1).max(40) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const peerId = await resolveUserId(supabase as Db, data.peerUsername);
    if (!peerId) return { live: false as const };
    const { count } = await (supabase as Db)
      .from("statuses")
      .select("id", { count: "exact", head: true })
      .eq("author_id", peerId)
      .gt("expires_at", new Date().toISOString());
    return { live: (count ?? 0) > 0 };
  });
