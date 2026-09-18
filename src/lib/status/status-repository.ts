/**
 * Status data access.
 *
 * Every Status now lives in the backend: the row in `statuses`, the photo or
 * video in the private `status-media` bucket. This module is the only place the
 * screens talk to that backend, so the UI keeps working unchanged while nothing
 * about a Status is persisted on the device any more.
 *
 * When no backend is connected (or nobody is signed in) each call resolves to an
 * empty/no-op result so the rest of the app stays usable.
 */

import type { StatusEntry, StatusVisibility } from "@/data/types";
import { getBackend } from "@/lib/calls/backend";
import {
  createStatus,
  deleteStatus as deleteStatusFn,
  listStatuses,
  prepareStatusMedia,
  recordStatusView,
} from "./status.functions";

const BUCKET = "status-media";

/** True when a signed-in session exists to act on. */
async function signedIn(): Promise<boolean> {
  const supabase = getBackend();
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

/** Backend ids are uuids; anything else was never stored server-side. */
function isServerId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * Uploads picked media (data URL or object URL) into the private Status bucket
 * and returns the stored reference. The bytes never pass through the database.
 */
export async function uploadStatusMedia(
  source: string,
): Promise<{ path: string; mime: string } | null> {
  const supabase = getBackend();
  if (!supabase || !(await signedIn())) return null;
  const response = await fetch(source);
  const blob = await response.blob();
  const mime = blob.type || "application/octet-stream";
  const target = await prepareStatusMedia({ data: { mime, sizeBytes: blob.size } });
  const { error } = await supabase.storage
    .from(BUCKET)
    .uploadToSignedUrl(target.path, target.token, blob, { contentType: mime });
  if (error) throw new Error(error.message);
  return { path: target.path, mime };
}

export type PublishStatusInput = {
  text?: string | undefined;
  image?: string | undefined;
  video?: string | undefined;
  videoStart?: number | undefined;
  videoEnd?: number | undefined;
  caption?: string | undefined;
  captionX?: number | undefined;
  captionY?: number | undefined;
  textAlign?: "left" | "center" | "right" | undefined;
  textY?: number | undefined;
  background?: string | undefined;
  visibility: StatusVisibility;
};

/** Stores one Status in the backend. Returns false when there is no session. */
export async function publishStatus(input: PublishStatusInput): Promise<boolean> {
  if (!(await signedIn())) return false;
  const media = input.image ?? input.video;
  const uploaded = media ? await uploadStatusMedia(media) : null;
  if (media && !uploaded) return false;
  await createStatus({
    data: {
      kind: input.video ? "video" : input.image ? "photo" : "text",
      visibility: input.visibility,
      ...(input.text ? { text: input.text } : {}),
      ...(input.caption ? { caption: input.caption } : {}),
      ...(input.background ? { background: input.background } : {}),
      ...(typeof input.captionX === "number" ? { captionX: input.captionX } : {}),
      ...(typeof input.captionY === "number" ? { captionY: input.captionY } : {}),
      ...(input.textAlign ? { textAlign: input.textAlign } : {}),
      ...(typeof input.textY === "number" ? { textY: input.textY } : {}),
      ...(typeof input.videoStart === "number" ? { videoStart: input.videoStart } : {}),
      ...(typeof input.videoEnd === "number" ? { videoEnd: input.videoEnd } : {}),
      ...(uploaded ? { mediaPath: uploaded.path, mediaMime: uploaded.mime } : {}),
    },
  });
  return true;
}

/**
 * Every live Status this account may see, already shaped the way the screens
 * expect, plus the ids this account has already opened.
 */
export async function fetchStatuses(): Promise<{ statuses: StatusEntry[]; seen: string[] }> {
  if (!(await signedIn())) return { statuses: [], seen: [] };
  const result = await listStatuses({ data: undefined });
  const statuses: StatusEntry[] = result.statuses.map((row) => ({
    id: row.id,
    authorUsername: row.authorUsername,
    authorName: row.authorName,
    ...(row.authorContactId ? { authorContactId: row.authorContactId } : {}),
    ...(row.text ? { text: row.text } : {}),
    ...(row.kind === "photo" && row.mediaUrl ? { image: row.mediaUrl } : {}),
    ...(row.kind === "video" && row.mediaUrl ? { video: row.mediaUrl } : {}),
    ...(typeof row.videoStart === "number" ? { videoStart: row.videoStart } : {}),
    ...(typeof row.videoEnd === "number" ? { videoEnd: row.videoEnd } : {}),
    ...(row.caption ? { caption: row.caption } : {}),
    ...(typeof row.captionX === "number" ? { captionX: row.captionX } : {}),
    ...(typeof row.captionY === "number" ? { captionY: row.captionY } : {}),
    ...(row.textAlign ? { textAlign: row.textAlign } : {}),
    ...(typeof row.textY === "number" ? { textY: row.textY } : {}),
    ...(row.background ? { background: row.background } : {}),
    createdAt: row.createdAt,
    visibility: row.visibility,
    // The server already decided who may see this row, so the screens don't
    // re-apply visibility rules to it.
    serverAuthorized: true,
    views: row.views.map((view) => ({
      username: view.username,
      name: view.name,
      at: view.at,
      audience: view.audience,
    })),
  }));
  return { statuses, seen: result.seen };
}

/** Removes one of my own statuses, media included. */
export async function removeStatus(id: string): Promise<boolean> {
  if (!isServerId(id) || !(await signedIn())) return false;
  const result = await deleteStatusFn({ data: { statusId: id } });
  return result.ok;
}

/** Records that I opened someone's status. The audience is decided server-side. */
export async function viewStatus(id: string): Promise<boolean> {
  if (!isServerId(id) || !(await signedIn())) return false;
  const result = await recordStatusView({ data: { statusId: id } });
  return result.ok;
}
