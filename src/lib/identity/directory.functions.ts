/**
 * Server-side Unique ID directory.
 *
 * The permanent 7-digit Unique ID is issued by the database (see
 * `issue_unique_id()` in migration 0013) and every lookup — typed ID, QR payload
 * or username — is answered here. Clients never allocate an ID, never keep a
 * directory of their own, and never learn about an account the rules hide:
 *
 * - a blocked pair can never resolve each other in either direction
 * - a private account is reachable by its exact Unique ID or QR only; it is not
 *   discoverable by username unless an approved connection already exists
 * - only the display identity is returned: name, username, Unique ID
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Db = SupabaseClient<any>;

export type DirectoryEntry = {
  /** Permanent 7-digit Unique ID. */
  contactId: string;
  username: string;
  name: string;
};

const PROFILE_COLUMNS = "id, unique_id, username, name, is_private, profile_completed, auth_status";

const uniqueIdSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{6}$/);

const usernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform((value) => value.replace(/^@/, "").toLowerCase());

const qrSchema = z.string().trim().min(1).max(64);

/** Digits inside a typed ID or an `nconnect:` QR payload. */
function digitsFrom(raw: string): string | null {
  const digits = raw.replace(/^nconnect:(?:\/\/)?/i, "").replace(/\D/g, "");
  return /^[1-9][0-9]{6}$/.test(digits) ? digits : null;
}

type ProfileRow = {
  id: string;
  unique_id: string | null;
  username: string | null;
  name: string | null;
  is_private: boolean | null;
  profile_completed: boolean | null;
  auth_status: string | null;
};

async function admin(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as Db;
}

function visible(row: ProfileRow | null): row is ProfileRow {
  return Boolean(
    row && row.unique_id && row.username && row.profile_completed && row.auth_status === "verified",
  );
}

function entry(row: ProfileRow): DirectoryEntry {
  return {
    contactId: row.unique_id as string,
    username: row.username as string,
    name: row.name || (row.username as string),
  };
}

/** True when either side has blocked the other. */
async function blockedPair(database: Db, a: string, b: string): Promise<boolean> {
  const { data } = await database.rpc("is_blocked_pair", { _a: a, _b: b });
  return Boolean(data);
}

/** True when the two accounts already have an approved connection either way. */
async function connected(database: Db, a: string, b: string): Promise<boolean> {
  const { data } = await database
    .from("connections")
    .select("owner_id")
    .or(`and(owner_id.eq.${a},peer_id.eq.${b}),and(owner_id.eq.${b},peer_id.eq.${a})`)
    .limit(1);
  return (data ?? []).length > 0;
}

/** The caller's permanent Unique ID, issued by the database when missing. */
export const myUniqueId = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await (supabase as Db).rpc("issue_unique_id");
    if (error || typeof data !== "string") return { ok: false as const };
    return { ok: true as const, contactId: data };
  });

/** Resolves a typed 7-digit Unique ID. */
export const lookupUniqueId = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { uniqueId: string }) =>
    z.object({ uniqueId: uniqueIdSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const database = await admin();
    const { data: row } = await database
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("unique_id", data.uniqueId)
      .maybeSingle();
    const profile = (row as ProfileRow | null) ?? null;
    if (!visible(profile) || profile.id === context.userId) {
      return { ok: false as const, reason: "unknown" as const };
    }
    if (await blockedPair(database, context.userId, profile.id)) {
      return { ok: false as const, reason: "unknown" as const };
    }
    return { ok: true as const, entry: entry(profile) };
  });

/** Resolves a scanned QR payload (`nconnect:1234567`). */
export const lookupQrPayload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { payload: string }) => z.object({ payload: qrSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const uniqueId = digitsFrom(data.payload);
    if (!uniqueId) return { ok: false as const, reason: "invalid-code" as const };
    const database = await admin();
    const { data: row } = await database
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("unique_id", uniqueId)
      .maybeSingle();
    const profile = (row as ProfileRow | null) ?? null;
    if (!visible(profile) || profile.id === context.userId) {
      return { ok: false as const, reason: "unknown" as const };
    }
    if (await blockedPair(database, context.userId, profile.id)) {
      return { ok: false as const, reason: "unknown" as const };
    }
    return { ok: true as const, entry: entry(profile) };
  });

/**
 * Resolves a username. A private account answers only to someone it is already
 * connected with — by design its Unique ID and QR remain the way in.
 */
export const lookupUsername = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { username: string }) =>
    z.object({ username: usernameSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const database = await admin();
    const { data: row } = await database
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .ilike("username", data.username)
      .maybeSingle();
    const profile = (row as ProfileRow | null) ?? null;
    if (!visible(profile) || profile.id === context.userId) {
      return { ok: false as const, reason: "unknown" as const };
    }
    if (await blockedPair(database, context.userId, profile.id)) {
      return { ok: false as const, reason: "unknown" as const };
    }
    if (profile.is_private && !(await connected(database, context.userId, profile.id))) {
      return { ok: false as const, reason: "private" as const };
    }
    return { ok: true as const, entry: entry(profile) };
  });
