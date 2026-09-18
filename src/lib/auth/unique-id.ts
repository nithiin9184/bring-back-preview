/**
 * Permanent 7-digit N Connect Unique ID.
 *
 * - exactly 7 numeric digits, range 1000000-9999999 (never a leading zero)
 * - cryptographically random: never derived from time, phone digits, username,
 *   device identifiers, a sequence, or Math.random()
 * - generated server-side only, once, at account creation
 * - uniqueness is enforced by the database UNIQUE constraint; generation
 *   retries on collision
 */

export const UNIQUE_ID_MIN = 1_000_000;
export const UNIQUE_ID_MAX = 9_999_999;
const SPAN = UNIQUE_ID_MAX - UNIQUE_ID_MIN + 1;

export function isUniqueId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{6}$/.test(value);
}

/** One cryptographically secure candidate, uniformly distributed. */
export function generateUniqueIdCandidate(): string {
  const limit = Math.floor(0xffffffff / SPAN) * SPAN;
  const buf = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(buf);
    value = buf[0] ?? 0;
  } while (value >= limit);
  return String(UNIQUE_ID_MIN + (value % SPAN));
}

/**
 * Allocates a Unique ID by writing it through `claim`, which must insert
 * against the database UNIQUE constraint and return false on conflict.
 */
export async function allocateUniqueId(
  claim: (candidate: string) => Promise<boolean>,
  maxAttempts = 12,
): Promise<string> {
  for (let i = 0; i < maxAttempts; i += 1) {
    const candidate = generateUniqueIdCandidate();
    if (await claim(candidate)) return candidate;
  }
  throw new Error("Could not allocate a unique ID");
}
