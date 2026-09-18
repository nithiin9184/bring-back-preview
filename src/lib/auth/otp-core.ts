/**
 * OTP lifecycle — pure logic over injected ports, so it can be exercised in
 * tests without a database or a delivery provider.
 *
 * Guarantees implemented here:
 * - codes are cryptographically random 6 digits, generated server-side
 * - only a hash of the code is ever stored, and the code is never returned
 * - a new code immediately supersedes the previous one for that number
 * - codes expire, are consumed on success, and are invalidated after the
 *   configured number of failed attempts
 * - resends are rate limited by a cooldown plus an hourly ceiling
 */

import type { OtpConfig } from "./otp-config";
import { isOtpCodeFormat } from "./phone";

export type OtpChannel = "whatsapp" | "sms";

export type OtpRecord = {
  id: string;
  phone: string;
  otpHash: string;
  attempts: number;
  maxAttempts: number;
  resendCount: number;
  channel: OtpChannel;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
  supersededAt: number | null;
  invalidatedReason: string | null;
};

export type NewOtpRecord = Omit<OtpRecord, "id">;

export interface OtpStore {
  latestForPhone(phone: string): Promise<OtpRecord | null>;
  insert(record: NewOtpRecord): Promise<OtpRecord>;
  update(id: string, patch: Partial<OtpRecord>): Promise<void>;
  supersedeActive(phone: string, at: number): Promise<void>;
  countCreatedSince(phone: string, since: number): Promise<number>;
}

export interface OtpHasher {
  hash(phone: string, code: string): Promise<string>;
}

export interface OtpDelivery {
  readonly id: string;
  readonly channel: OtpChannel;
  send(input: { phone: string; code: string; expirySeconds: number }): Promise<void>;
}

export type OtpDeps = {
  store: OtpStore;
  hasher: OtpHasher;
  delivery: OtpDelivery;
  config: OtpConfig;
  now?: () => number;
  generateCode?: () => string;
};

export type RequestOtpResult =
  | { ok: true; requestId: string; expiresInSeconds: number; resendAfterSeconds: number }
  | {
      ok: false;
      reason: "cooldown" | "rate_limited" | "failed";
      retryAfterSeconds?: number;
    };

export type VerifyOtpOutcome =
  | { ok: true; otpId: string }
  | { ok: false; reason: "invalid" | "expired" | "too_many_attempts" };

/** Cryptographically secure, uniformly distributed 6-digit code. */
export function generateOtpCode(): string {
  const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000;
  const buf = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(buf);
    value = buf[0] ?? 0;
  } while (value >= limit);
  return String(value % 1_000_000).padStart(6, "0");
}

function isActive(record: OtpRecord, now: number): boolean {
  return (
    record.consumedAt === null &&
    record.supersededAt === null &&
    record.invalidatedReason === null &&
    record.expiresAt > now
  );
}

/** Issues a fresh OTP, invalidating any previous one for the same number. */
export async function requestOtp(
  deps: OtpDeps,
  phone: string,
  options: { isResend?: boolean } = {},
): Promise<RequestOtpResult> {
  const now = (deps.now ?? Date.now)();
  const { config, store } = deps;

  const latest = await store.latestForPhone(phone);
  if (latest) {
    const elapsed = (now - latest.createdAt) / 1000;
    if (elapsed < config.resendCooldownSeconds) {
      return {
        ok: false,
        reason: "cooldown",
        retryAfterSeconds: Math.max(1, Math.ceil(config.resendCooldownSeconds - elapsed)),
      };
    }
  }

  const sends = await store.countCreatedSince(phone, now - 60 * 60 * 1000);
  if (sends >= config.maxSendsPerHour) {
    return { ok: false, reason: "rate_limited" };
  }

  const code = (deps.generateCode ?? generateOtpCode)();
  const otpHash = await deps.hasher.hash(phone, code);

  // Only the newest OTP for a number is ever valid.
  await store.supersedeActive(phone, now);

  let record: OtpRecord;
  try {
    record = await store.insert({
      phone,
      otpHash,
      attempts: 0,
      maxAttempts: config.maxAttempts,
      resendCount: options.isResend ? (latest?.resendCount ?? 0) + 1 : 0,
      channel: deps.delivery.channel,
      createdAt: now,
      expiresAt: now + config.expirySeconds * 1000,
      consumedAt: null,
      supersededAt: null,
      invalidatedReason: null,
    });
  } catch {
    return { ok: false, reason: "failed" };
  }

  try {
    await deps.delivery.send({ phone, code, expirySeconds: config.expirySeconds });
  } catch {
    await store.update(record.id, { invalidatedReason: "delivery_failed" });
    return { ok: false, reason: "failed" };
  }

  return {
    ok: true,
    requestId: record.id,
    expiresInSeconds: config.expirySeconds,
    resendAfterSeconds: config.resendCooldownSeconds,
  };
}

/** Verifies a code against the newest OTP issued for the number. */
export async function verifyOtp(
  deps: OtpDeps,
  phone: string,
  code: string,
): Promise<VerifyOtpOutcome> {
  const now = (deps.now ?? Date.now)();
  if (!isOtpCodeFormat(code)) return { ok: false, reason: "invalid" };

  const record = await deps.store.latestForPhone(phone);
  if (!record) return { ok: false, reason: "expired" };
  if (record.invalidatedReason === "too_many_attempts") {
    return { ok: false, reason: "too_many_attempts" };
  }
  if (!isActive(record, now)) return { ok: false, reason: "expired" };

  if (record.attempts >= record.maxAttempts) {
    await deps.store.update(record.id, { invalidatedReason: "too_many_attempts" });
    return { ok: false, reason: "too_many_attempts" };
  }

  const candidate = await deps.hasher.hash(phone, code.trim());
  if (candidate !== record.otpHash) {
    const attempts = record.attempts + 1;
    const patch: Partial<OtpRecord> = { attempts };
    if (attempts >= record.maxAttempts) patch.invalidatedReason = "too_many_attempts";
    await deps.store.update(record.id, patch);
    return attempts >= record.maxAttempts
      ? { ok: false, reason: "too_many_attempts" }
      : { ok: false, reason: "invalid" };
  }

  await deps.store.update(record.id, { consumedAt: now });
  return { ok: true, otpId: record.id };
}
