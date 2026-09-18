/**
 * Authentication guarantees for N Connect phone sign-in.
 *
 * The OTP lifecycle is exercised against in-memory ports, the Unique ID rules
 * against the real allocator plus the account repository, and the database-level
 * immutability guarantees against the applied migration.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import {
  generateOtpCode,
  requestOtp,
  verifyOtp,
  type NewOtpRecord,
  type OtpDeps,
  type OtpRecord,
  type OtpStore,
} from "../otp-core";
import { DEFAULT_OTP_CONFIG } from "../otp-config";
import { isOtpCodeFormat, isValidPhone, normalizePhone } from "../phone";
import { allocateUniqueId, generateUniqueIdCandidate, isUniqueId } from "../unique-id";
import { createOtpHasher } from "../otp-hasher.server";
import { createAccountRepository } from "../otp-store.server";

const PHONE = "+919876543210";

/** In-memory OtpStore with the same semantics as the database store. */
function memoryStore(): OtpStore & { rows: OtpRecord[] } {
  const rows: OtpRecord[] = [];
  return {
    rows,
    async latestForPhone(phone) {
      return (
        [...rows]
          .filter((r) => r.phone === phone)
          .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
      );
    },
    async insert(record: NewOtpRecord) {
      const row: OtpRecord = { ...record, id: `otp-${rows.length + 1}` };
      rows.push(row);
      return row;
    },
    async update(id, patch) {
      const row = rows.find((r) => r.id === id);
      if (row) Object.assign(row, patch);
    },
    async supersedeActive(phone, at) {
      rows
        .filter((r) => r.phone === phone && !r.consumedAt && !r.supersededAt)
        .forEach((r) => {
          r.supersededAt = at;
        });
    },
    async countCreatedSince(phone, since) {
      return rows.filter((r) => r.phone === phone && r.createdAt >= since).length;
    },
  };
}

function deps(overrides: Partial<OtpDeps> = {}) {
  const store = overrides.store ?? memoryStore();
  const sent: string[] = [];
  const base: OtpDeps = {
    store,
    hasher: { hash: async (phone, code) => `h:${phone}:${code}` },
    delivery: {
      id: "test",
      channel: "whatsapp",
      send: async ({ code }) => {
        sent.push(code);
      },
    },
    config: { ...DEFAULT_OTP_CONFIG },
    generateCode: () => "123456",
    ...overrides,
  };
  return { deps: base, store: store as ReturnType<typeof memoryStore>, sent };
}

describe("phone normalisation and validation", () => {
  it("normalises a raw number to E.164 digits", () => {
    expect(normalizePhone(" +91 98765-43210 ")).toBe(PHONE);
    expect(normalizePhone("0091 9876543210")).toBe(PHONE);
  });

  it("rejects numbers that are not valid E.164 mobile numbers", () => {
    expect(isValidPhone(PHONE)).toBe(true);
    expect(isValidPhone("+12345")).toBe(false);
    expect(isValidPhone("not a phone")).toBe(false);
  });
});

describe("OTP generation and hashing", () => {
  it("generates six-digit numeric codes", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateOtpCode();
      expect(isOtpCodeFormat(code)).toBe(true);
    }
  });

  it("stores only a peppered hash, never the code", async () => {
    process.env["OTP_HASH_PEPPER"] = "test-pepper";
    const hasher = createOtpHasher();
    const hash = await hasher.hash(PHONE, "123456");
    expect(hash).not.toContain("123456");
    expect(await hasher.hash(PHONE, "123456")).toBe(hash);
    expect(await hasher.hash(PHONE, "123457")).not.toBe(hash);
    expect(await hasher.hash("+919999999999", "123456")).not.toBe(hash);
  });
});

describe("OTP lifecycle", () => {
  it("expires a code after the configured window", async () => {
    const { deps: d } = deps();
    let now = 1_000_000;
    d.now = () => now;
    await requestOtp(d, PHONE);
    now += (DEFAULT_OTP_CONFIG.expirySeconds + 1) * 1000;
    expect(await verifyOtp(d, PHONE, "123456")).toEqual({ ok: false, reason: "expired" });
  });

  it("locks the code after the attempt limit", async () => {
    const { deps: d } = deps();
    await requestOtp(d, PHONE);
    for (let i = 0; i < DEFAULT_OTP_CONFIG.maxAttempts - 1; i += 1) {
      expect((await verifyOtp(d, PHONE, "000000")).ok).toBe(false);
    }
    expect(await verifyOtp(d, PHONE, "000000")).toEqual({
      ok: false,
      reason: "too_many_attempts",
    });
    // Even the correct code is refused once the challenge is locked.
    expect(await verifyOtp(d, PHONE, "123456")).toEqual({
      ok: false,
      reason: "too_many_attempts",
    });
  });

  it("enforces the resend cooldown", async () => {
    const { deps: d } = deps();
    let now = 1_000_000;
    d.now = () => now;
    await requestOtp(d, PHONE);
    const blocked = await requestOtp(d, PHONE, { isResend: true });
    expect(blocked).toMatchObject({ ok: false, reason: "cooldown" });
    now += DEFAULT_OTP_CONFIG.resendCooldownSeconds * 1000;
    expect((await requestOtp(d, PHONE, { isResend: true })).ok).toBe(true);
  });

  it("enforces the hourly resend ceiling", async () => {
    const { deps: d } = deps();
    let now = 1_000_000;
    d.now = () => now;
    for (let i = 0; i < DEFAULT_OTP_CONFIG.maxSendsPerHour; i += 1) {
      expect((await requestOtp(d, PHONE, { isResend: i > 0 })).ok).toBe(true);
      now += (DEFAULT_OTP_CONFIG.resendCooldownSeconds + 1) * 1000;
    }
    expect(await requestOtp(d, PHONE, { isResend: true })).toMatchObject({
      ok: false,
      reason: "rate_limited",
    });
  });

  it("keeps only the newest code valid", async () => {
    const { deps: d, store } = deps();
    let now = 1_000_000;
    let code = "111111";
    d.now = () => now;
    d.generateCode = () => code;
    await requestOtp(d, PHONE);
    now += (DEFAULT_OTP_CONFIG.resendCooldownSeconds + 1) * 1000;
    code = "222222";
    await requestOtp(d, PHONE, { isResend: true });
    expect(store.rows[0]?.supersededAt).not.toBeNull();
    expect(await verifyOtp(d, PHONE, "111111")).toEqual({ ok: false, reason: "invalid" });
    expect((await verifyOtp(d, PHONE, "222222")).ok).toBe(true);
  });

  it("rejects a consumed code", async () => {
    const { deps: d } = deps();
    await requestOtp(d, PHONE);
    expect((await verifyOtp(d, PHONE, "123456")).ok).toBe(true);
    expect(await verifyOtp(d, PHONE, "123456")).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a superseded code directly", async () => {
    const { deps: d, store } = deps();
    await requestOtp(d, PHONE);
    const row = store.rows[0]!;
    row.supersededAt = Date.now();
    expect(await verifyOtp(d, PHONE, "123456")).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects malformed and wrong codes without consuming the challenge", async () => {
    const { deps: d, store } = deps();
    await requestOtp(d, PHONE);
    expect(await verifyOtp(d, PHONE, "12ab56")).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyOtp(d, PHONE, "654321")).toEqual({ ok: false, reason: "invalid" });
    expect(store.rows[0]?.consumedAt).toBeNull();
  });

  it("never returns the code to the caller", async () => {
    const { deps: d, sent } = deps();
    const result = await requestOtp(d, PHONE);
    expect(result).not.toHaveProperty("code");
    expect(JSON.stringify(result)).not.toContain("123456");
    expect(sent).toEqual(["123456"]);
  });
});

describe("permanent 7-digit Unique ID", () => {
  it("always generates exactly seven numeric digits with no leading zero", () => {
    for (let i = 0; i < 500; i += 1) {
      const id = generateUniqueIdCandidate();
      expect(id).toMatch(/^[1-9][0-9]{6}$/);
      expect(isUniqueId(id)).toBe(true);
    }
  });

  it("retries generation until the database accepts a free ID", async () => {
    let tries = 0;
    const id = await allocateUniqueId(async () => {
      tries += 1;
      return tries === 3;
    });
    expect(tries).toBe(3);
    expect(isUniqueId(id)).toBe(true);
  });
});

describe("accounts", () => {
  function fakeDatabase(existing: Record<string, unknown> | null) {
    const inserted: Array<Record<string, unknown>> = [];
    const database = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: existing };
                  },
                };
              },
            };
          },
          insert(row: Record<string, unknown>) {
            inserted.push(row);
            return {
              select() {
                return {
                  async single() {
                    return { data: { ...row, profile_completed: false }, error: null };
                  },
                };
              },
            };
          },
        };
      },
    };
    return { database, inserted };
  }

  it("creates exactly one account per normalised phone number", async () => {
    const existing = {
      id: "user-1",
      unique_id: "1234567",
      username: "nina",
      name: "Nina",
      profile_completed: true,
      auth_status: "verified",
    };
    const { database, inserted } = fakeDatabase(existing);
    let authUsers = 0;
    const repo = createAccountRepository(database as never);
    const account = await repo.createForPhone(PHONE, async () => {
      authUsers += 1;
      return "user-2";
    });
    expect(account.id).toBe("user-1");
    expect(authUsers).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it("allocates a permanent Unique ID and an unverified profile on first sign-in", async () => {
    const { database, inserted } = fakeDatabase(null);
    const repo = createAccountRepository(database as never);
    const account = await repo.createForPhone(PHONE, async () => "user-9");
    expect(account.id).toBe("user-9");
    expect(isUniqueId(account.uniqueId)).toBe(true);
    expect(account.profileCompleted).toBe(false);
    expect(inserted[0]).toMatchObject({
      id: "user-9",
      phone_number_normalized: PHONE,
      auth_status: "verified",
      profile_completed: false,
    });
  });
});

describe("database identity guarantees", () => {
  let sql = "";
  beforeAll(() => {
    sql = readFileSync(
      path.join(
        process.cwd(),
        "drizzle/migrations/0001_phone_auth_unique_id_and_otp_challenges.sql",
      ),
      "utf8",
    ).toLowerCase();
  });

  it("makes the Unique ID immutable and globally unique in 7-digit form", () => {
    expect(sql).toContain("unique_id");
    expect(sql).toMatch(/\^\[1-9\]\[0-9\]\{6\}\$/);
    expect(sql).toMatch(/unique.*unique_id|unique_id.*unique/s);
    expect(sql).toMatch(/unique id|unique_id/);
    expect(sql).toContain("profiles_protect_identity");
  });

  it("makes the authentication phone number immutable and private", () => {
    expect(sql).toContain("phone_number_normalized");
    expect(sql).toMatch(/old\.phone_number_normalized/);
    expect(sql).toContain("raise exception");
  });
});
