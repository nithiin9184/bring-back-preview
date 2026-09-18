/**
 * Real account data export.
 *
 * The file contains what the account actually holds on the server: profile,
 * settings, chat list state, muted profiles, reports, signed-in device names
 * and messages. The phone number and every security value are left out.
 */

import { buildAccountExport } from "./account-repository";

/** Downloads the account's server-backed data as a JSON file. */
export async function downloadAccountData(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  let payload: Record<string, unknown> | null = null;
  try {
    payload = await buildAccountExport();
  } catch (error) {
    console.error("data export failed", error);
    return false;
  }
  if (!payload) return false;

  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `n-connect-data-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}
