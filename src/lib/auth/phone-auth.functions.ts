/**
 * Phone-number authentication endpoints.
 *
 *   Login UI -> these server functions -> OTP core -> store / hasher / delivery
 *
 * Everything sensitive stays on the server: the code is minted, hashed with the
 * server pepper, stored hash-only, delivered by the configured provider, and
 * verified server-side. The raw code is never returned to a client, and the
 * phone number is never returned to a client either.
 */

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readOtpConfig } from "./otp-config";
import { requestOtp, verifyOtp, type OtpDeps } from "./otp-core";
import { isValidPhone, normalizePhone } from "./phone";
import { createOtpDelivery } from "./delivery/otp-delivery.server";
import { createOtpHasher } from "./otp-hasher.server";
import { createAccountRepository, createOtpStore, type Account } from "./otp-store.server";

const phoneInput = z.object({ phone: z.string().trim().min(4).max(24) });

const codeInput = z.object({
  phone: z.string().trim().min(4).max(24),
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/),
});

const profileInput = z.object({
  name: z.string().trim().min(1).max(80),
  username: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{3,20}$/),
});

type AdminClient = SupabaseClient<any>;

async function adminClient(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as AdminClient;
}

async function buildDeps(database: AdminClient): Promise<OtpDeps> {
  return {
    store: createOtpStore(database),
    hasher: createOtpHasher(),
    delivery: createOtpDelivery(),
    config: readOtpConfig(),
  };
}

/** Deterministic, non-routable account identifier derived from the number. */
function accountEmail(phone: string): string {
  return `p${phone.replace(/\D/g, "")}@phone.nconnect.app`;
}

function randomPassword(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type PublicAccount = {
  uniqueId: string;
  username: string | null;
  name: string;
  profileCompleted: boolean;
};

function publicAccount(account: Account): PublicAccount {
  return {
    uniqueId: account.uniqueId,
    username: account.username,
    name: account.name,
    profileCompleted: account.profileCompleted,
  };
}

async function issueOtp(rawPhone: string, isResend: boolean) {
  const phone = normalizePhone(rawPhone);
  if (!isValidPhone(phone)) return { ok: false as const, reason: "invalid_phone" as const };

  const database = await adminClient();
  const deps = await buildDeps(database);
  const result = await requestOtp(deps, phone, { isResend });

  if (!result.ok) {
    return {
      ok: false as const,
      reason: result.reason,
      ...(result.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: result.retryAfterSeconds }
        : {}),
    };
  }

  return {
    ok: true as const,
    requestId: result.requestId,
    expiresInSeconds: result.expiresInSeconds,
    resendAfterSeconds: result.resendAfterSeconds,
  };
}

/** Sends a fresh verification code to a phone number. */
export const requestPhoneOtp = createServerFn({ method: "POST" })
  .inputValidator((input: { phone: string }) => phoneInput.parse(input))
  .handler(async ({ data }) => issueOtp(data.phone, false));

/** Resends the code, subject to the cooldown and the hourly ceiling. */
export const resendPhoneOtp = createServerFn({ method: "POST" })
  .inputValidator((input: { phone: string }) => phoneInput.parse(input))
  .handler(async ({ data }) => issueOtp(data.phone, true));

/**
 * Verifies a code and, on success, creates or loads the single account for that
 * number and returns a one-time token the client exchanges for a real session.
 */
export const verifyPhoneOtp = createServerFn({ method: "POST" })
  .inputValidator((input: { phone: string; code: string }) => codeInput.parse(input))
  .handler(async ({ data }) => {
    const phone = normalizePhone(data.phone);
    if (!isValidPhone(phone)) return { ok: false as const, reason: "invalid" as const };

    const database = await adminClient();
    const deps = await buildDeps(database);
    const outcome = await verifyOtp(deps, phone, data.code);
    if (!outcome.ok) return { ok: false as const, reason: outcome.reason };

    const accounts = createAccountRepository(database);
    const email = accountEmail(phone);

    let account: Account;
    try {
      account = await accounts.createForPhone(phone, async () => {
        const created = await database.auth.admin.createUser({
          email,
          password: randomPassword(),
          email_confirm: true,
          user_metadata: { auth_method: "phone_otp" },
        });
        if (created.error || !created.data.user) {
          throw new Error("Could not create the account");
        }
        return created.data.user.id;
      });
    } catch {
      return { ok: false as const, reason: "failed" as const };
    }

    if (account.authStatus !== "verified") {
      return { ok: false as const, reason: "suspended" as const };
    }

    const link = await database.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = link.data?.properties?.hashed_token;
    if (link.error || !tokenHash) return { ok: false as const, reason: "failed" as const };

    // Session audit trail: one row per issued session.
    await database.from("auth_sessions").insert({
      user_id: account.id,
      session_ref: tokenHash.slice(-16),
      expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
    });
    // Security activity: a new sign-in, if the account wants login alerts.
    {
      const { emitNotification } = await import("@/lib/notifications/notifications.server");
      await emitNotification(database as SupabaseClient<any>, {
        userId: account.id,
        type: "security",
        text: "New sign-in to your account",
        tone: "warning",
        name: "Security",
        loginAlert: true,
      });
    }

    return { ok: true as const, tokenHash, account: publicAccount(account) };
  });

/** Completes the signed-in account's profile. Requires a real session. */
export const completePhoneProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string; username: string }) => profileInput.parse(input))
  .handler(async ({ data, context }) => {
    const database = await adminClient();

    const { data: taken } = await database
      .from("profiles")
      .select("id")
      .eq("username", data.username)
      .neq("id", context.userId)
      .maybeSingle();
    if (taken) return { ok: false as const, reason: "username_taken" as const };

    const { data: row, error } = await database
      .from("profiles")
      .update({
        name: data.name,
        username: data.username,
        profile_completed: true,
      })
      .eq("id", context.userId)
      .select("id, unique_id, username, name, profile_completed, auth_status")
      .single();

    if (error || !row) return { ok: false as const, reason: "failed" as const };

    return {
      ok: true as const,
      account: publicAccount({
        id: row.id,
        uniqueId: row.unique_id,
        username: row.username ?? null,
        name: row.name ?? "",
        profileCompleted: Boolean(row.profile_completed),
        authStatus: row.auth_status ?? "verified",
      }),
    };
  });

/** The signed-in account, including its permanent Unique ID. */
export const currentPhoneAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const database = await adminClient();
    const { data: row } = await database
      .from("profiles")
      .select("id, unique_id, username, name, profile_completed, auth_status")
      .eq("id", context.userId)
      .maybeSingle();
    if (!row) return { ok: false as const };
    return {
      ok: true as const,
      account: publicAccount({
        id: row.id,
        uniqueId: row.unique_id,
        username: row.username ?? null,
        name: row.name ?? "",
        profileCompleted: Boolean(row.profile_completed),
        authStatus: row.auth_status ?? "verified",
      }),
    };
  });
