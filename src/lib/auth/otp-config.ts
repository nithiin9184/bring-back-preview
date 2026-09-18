/**
 * OTP policy, read from environment variables on the server only.
 * Call `readOtpConfig()` inside a server-function handler, never at module
 * scope (environment values are injected per request in production).
 */

export type OtpConfig = {
  expirySeconds: number;
  resendCooldownSeconds: number;
  maxAttempts: number;
  maxSendsPerHour: number;
};

export const DEFAULT_OTP_CONFIG: OtpConfig = {
  expirySeconds: 300,
  resendCooldownSeconds: 30,
  maxAttempts: 5,
  maxSendsPerHour: 8,
};

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readOtpConfig(): OtpConfig {
  return {
    expirySeconds: int(process.env["OTP_EXPIRY_SECONDS"], DEFAULT_OTP_CONFIG.expirySeconds),
    resendCooldownSeconds: int(
      process.env["OTP_RESEND_COOLDOWN_SECONDS"],
      DEFAULT_OTP_CONFIG.resendCooldownSeconds,
    ),
    maxAttempts: int(process.env["OTP_MAX_ATTEMPTS"], DEFAULT_OTP_CONFIG.maxAttempts),
    maxSendsPerHour: int(process.env["OTP_MAX_SENDS_PER_HOUR"], DEFAULT_OTP_CONFIG.maxSendsPerHour),
  };
}
