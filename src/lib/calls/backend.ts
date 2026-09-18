/**
 * Optional access to the call backend.
 *
 * Calls are backend-powered. When no backend is connected the app must stay
 * fully usable — chat, contacts, QR, unique IDs, trust and status all work
 * locally — so reaching for the client returns null instead of throwing and
 * tearing down the screen.
 */

import { supabase } from "@/integrations/supabase/client";

type Client = typeof supabase;

let resolved = false;
let client: Client | null = null;

/** The backend client, or null when this environment has no backend. */
export function getBackend(): Client | null {
  if (resolved) return client;
  resolved = true;
  try {
    // Touching any property builds the client; missing config throws here.
    void supabase.auth;
    client = supabase;
  } catch {
    client = null;
  }
  return client;
}

/** True when calls can actually be placed in this environment. */
export function hasBackend(): boolean {
  return getBackend() !== null;
}
