/**
 * Phone number normalisation and validation.
 *
 * The phone number is the private authentication identity of an account. It is
 * normalised to bare E.164 digits (leading `+`, no spaces or punctuation)
 * before it ever touches the database, so one human number can only ever map to
 * one account row.
 */

/** Normalises any user-entered number to `+<digits>`. */
export function normalizePhone(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  const digits = trimmed.replace(/\D/g, "").replace(/^0+/, "");
  return digits ? `+${digits}` : "";
}

/** True when the normalised number looks like a usable E.164 number. */
export function isValidPhone(raw: string): boolean {
  const normalized = normalizePhone(raw);
  return /^\+[1-9][0-9]{6,14}$/.test(normalized);
}

/** OTP codes are always exactly six digits. */
export function isOtpCodeFormat(code: string): boolean {
  return /^[0-9]{6}$/.test(String(code ?? "").trim());
}
