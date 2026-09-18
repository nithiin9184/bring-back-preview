/**
 * Username normalisation, validation and availability.
 *
 * Availability is answered by the database only: the username column is unique
 * there, so a lookup against it is the single source of truth. Nothing about
 * which usernames are taken is kept on the device.
 */

import { getBackend } from "@/lib/calls/backend";

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/** Lowercases and strips anything that is not a-z, 0-9 or underscore. */
export function normalizeUsername(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

export type UsernameValidation = { valid: boolean; error?: string };

export function validateUsername(value: string): UsernameValidation {
  const v = normalizeUsername(value);
  if (!v) return { valid: false, error: "Username is required" };
  if (v.length < 3) return { valid: false, error: "Use at least 3 characters" };
  if (v.length > 20) return { valid: false, error: "Use 20 characters or fewer" };
  if (!USERNAME_RE.test(v)) return { valid: false, error: "Only lowercase letters, numbers and _" };
  return { valid: true };
}

export type UsernameRepository = {
  /** Resolves true when the username is free. */
  isAvailable(username: string): Promise<boolean>;
};

/** Availability straight from the accounts table, which owns the uniqueness. */
export const serverUsernameRepository: UsernameRepository = {
  async isAvailable(username) {
    const v = normalizeUsername(username);
    if (!v) return false;
    const supabase = getBackend();
    if (!supabase) throw new Error("no backend");
    const { data, error } = await supabase
      .from("profiles")
      .select("username")
      .eq("username", v)
      .maybeSingle();
    if (error) throw error;
    return !data;
  },
};

let repository: UsernameRepository = serverUsernameRepository;

/** Allows a different server repository to be registered (tests, tooling). */
export function setUsernameRepository(next: UsernameRepository): void {
  repository = next;
}

export function checkUsernameAvailability(username: string): Promise<boolean> {
  return repository.isAvailable(username);
}
