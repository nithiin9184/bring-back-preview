/**
 * OTP hashing. Raw codes are never stored: only an HMAC-SHA256 of
 * `phone:code`, keyed with a server-side pepper held in the environment.
 */

import type { OtpHasher } from "./otp-core";

export function createOtpHasher(): OtpHasher {
  const pepper =
    process.env["OTP_HASH_PEPPER"] ?? process.env["AUTH_SESSION_SECRET"] ?? "";
  if (!pepper) throw new Error("OTP_HASH_PEPPER is not configured");

  return {
    async hash(phone: string, code: string): Promise<string> {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(pepper),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`${phone}:${code}`),
      );
      return Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    },
  };
}
