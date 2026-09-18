/**
 * Media helpers for the Status creation flow.
 * Frontend-only: files are read in the browser, no upload pipeline.
 */

/** Longest allowed Status video, in seconds. */
export const MAX_STATUS_VIDEO_SECONDS = 40;

/** Above this size a video stays a session blob URL instead of a stored data URL. */
const MAX_INLINE_VIDEO_BYTES = 3 * 1024 * 1024;

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

/** Data URL for small videos (survives reload), object URL for big ones. */
export async function readVideoSource(file: File): Promise<string> {
  if (file.size <= MAX_INLINE_VIDEO_BYTES) return readFileAsDataUrl(file);
  return URL.createObjectURL(file);
}

export function getVideoDuration(src: string): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => resolve(0);
    el.src = src;
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the image"));
    img.src = src;
  });
}

export function formatSeconds(value: number): string {
  const total = Math.max(0, Math.round(value));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return mins > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : `0:${String(secs).padStart(2, "0")}`;
}
