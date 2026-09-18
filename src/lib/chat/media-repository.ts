/**
 * Chat image data access.
 *
 * Photos sent in a chat are compressed in the browser, uploaded straight into
 * the private `chat-media` bucket and referenced by their stored path. Nothing
 * but that reference travels with the message, and no image is kept on the
 * device. Blocking, two-sided Trust, the Message Request rule and the daily
 * image allowance are all decided by the backend before an upload is allowed.
 */

import { getBackend } from "@/lib/calls/backend";
import {
  deleteChatImages,
  getChatImageUrls,
  linkChatImages,
  prepareChatImages,
  purgeExpiredChatImages,
  type ChatMediaDenial,
} from "./media.functions";

const BUCKET = "chat-media";
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

/** Marker that tells the chat UI a value is a stored reference, not a URL. */
const REF_PREFIX = "chatmedia:";

export type { ChatMediaDenial };

export function isImageReference(value: string): boolean {
  return value.startsWith(REF_PREFIX);
}

export function referenceToPath(value: string): string {
  return value.startsWith(REF_PREFIX) ? value.slice(REF_PREFIX.length) : value;
}

export function pathToReference(path: string): string {
  return `${REF_PREFIX}${path}`;
}

export const denialMessages: Record<ChatMediaDenial, string> = {
  "unknown-user": "We couldn't find that account",
  blocked: "Unblock to send photos",
  "not-trusted": "Photos unlock when you both trust each other",
  "not-accepted": "They haven't accepted your conversation yet",
  "daily-limit": "You've reached today's photo limit",
};

async function signedIn(): Promise<boolean> {
  const supabase = getBackend();
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

/** Shrinks and re-encodes a picked photo before it leaves the device. */
export async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY),
    );
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export type UploadResult =
  | { ok: true; references: string[] }
  | { ok: false; reason: ChatMediaDenial | "offline" };

/**
 * Authorizes the send, uploads every compressed photo and returns the stored
 * references to attach to the message.
 */
export async function uploadChatImages(input: {
  peerUsername: string;
  clientId: string;
  files: File[];
  expiresInHours?: number | undefined;
}): Promise<UploadResult> {
  const supabase = getBackend();
  if (!supabase || !(await signedIn())) return { ok: false, reason: "offline" };

  const blobs = await Promise.all(input.files.map((file) => compressImage(file)));
  const prepared = await prepareChatImages({
    data: {
      peerUsername: input.peerUsername,
      clientId: input.clientId,
      files: blobs.map((blob) => ({ mime: blob.type || "image/jpeg", sizeBytes: blob.size })),
      ...(input.expiresInHours ? { expiresInHours: input.expiresInHours } : {}),
    },
  });
  if (!prepared.ok) return { ok: false, reason: prepared.reason };

  const references: string[] = [];
  for (const [index, target] of prepared.uploads.entries()) {
    const blob = blobs[index];
    if (!blob) continue;
    const { error } = await supabase.storage
      .from(BUCKET)
      .uploadToSignedUrl(target.path, target.token, blob, {
        contentType: blob.type || "image/jpeg",
      });
    if (error) throw new Error(error.message);
    references.push(pathToReference(target.path));
  }
  return { ok: true, references };
}

/** Short-lived viewing links for stored references. Expired media is dropped. */
export async function resolveChatImageUrls(
  references: string[],
): Promise<Record<string, string>> {
  const paths = [...new Set(references.filter(isImageReference).map(referenceToPath))];
  if (paths.length === 0 || !(await signedIn())) return {};
  const result = await getChatImageUrls({ data: { paths } });
  const urls: Record<string, string> = {};
  for (const [path, url] of Object.entries(result.urls)) urls[pathToReference(path)] = url;
  return urls;
}

/** Attaches uploaded media to the stored message row. */
export async function attachImagesToMessage(clientId: string, messageId: string): Promise<void> {
  if (!(await signedIn())) return;
  await linkChatImages({ data: { clientId, messageId } });
}

/** Deletes chat photos this account sent. */
export async function removeChatImages(references: string[]): Promise<void> {
  const paths = references.filter(isImageReference).map(referenceToPath);
  if (paths.length === 0 || !(await signedIn())) return;
  await deleteChatImages({ data: { paths } });
}

/** Clears media whose disappearing window has passed. Safe to call on load. */
export async function purgeExpiredImages(): Promise<void> {
  if (!(await signedIn())) return;
  await purgeExpiredChatImages({ data: undefined });
}
