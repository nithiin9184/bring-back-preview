import { getBackend } from "@/lib/calls/backend";
import { compressImage } from "@/lib/chat/media-repository";
import {
  deleteAppearanceBackground,
  getAppearanceBackgroundUrl,
  prepareAppearanceBackground,
} from "./background.functions";

const BUCKET = "appearance-media";

export async function uploadAppearanceBackground(file: File): Promise<string> {
  const supabase = getBackend();
  if (!supabase) throw new Error("Sign in to save a custom background");
  const blob = await compressImage(file);
  const target = await prepareAppearanceBackground({
    data: { mime: blob.type || "image/jpeg", sizeBytes: blob.size },
  });
  const { error } = await supabase.storage
    .from(BUCKET)
    .uploadToSignedUrl(target.path, target.token, blob, { contentType: blob.type || "image/jpeg" });
  if (error) throw new Error(error.message);
  return target.path;
}

export async function resolveAppearanceBackground(path: string): Promise<string | null> {
  if (!path) return null;
  return (await getAppearanceBackgroundUrl({ data: { path } })).url;
}

export async function removeAppearanceBackground(path: string): Promise<void> {
  if (path) await deleteAppearanceBackground({ data: { path } });
}