/**
 * Clipboard helper.
 *
 * Uses the async Clipboard API where the browser allows it and falls back to a
 * hidden textarea so copy actions still work on older mobile browsers and in
 * non-secure contexts. Returns whether the text actually reached the clipboard,
 * so callers never show a "Copied" confirmation for a copy that failed.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
