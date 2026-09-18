/**
 * Permanent 7-digit N Connect Unique ID (Contact ID) — client side.
 *
 * Rules, all enforced by the database:
 * - exactly 7 numeric digits (1000000–9999999, never a leading zero)
 * - globally unique (`profiles.unique_id` UNIQUE)
 * - issued once by the server (`issue_unique_id()`), never by a device
 * - permanent: the identity trigger refuses any change
 * - never derived from, and never revealing, a phone number
 *
 * This module only parses and formats IDs and asks the server to resolve them.
 * There is no device directory: a typed ID, a scanned QR and a username are all
 * answered by the backend, which applies the block, privacy and discoverability
 * rules before returning anything.
 */

import {
  lookupQrPayload,
  lookupUniqueId,
  lookupUsername,
  myUniqueId,
  type DirectoryEntry,
} from "./directory.functions";

export const CONTACT_ID_LENGTH = 7;

export type ContactIdentity = {
  contactId: string;
  username: string;
  name?: string;
};

/** True when the value is a well-formed permanent Contact ID. */
export function isContactId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{6}$/.test(value);
}

/** Normalises user input (QR payloads, typed IDs) to bare digits. */
export function parseContactId(raw: string): string | null {
  const digits = raw.replace(/^nconnect:(?:\/\/)?/i, "").replace(/\D/g, "");
  return isContactId(digits) ? digits : null;
}

/** The payload encoded in a personal QR. Carries the Contact ID only. */
export function contactIdQrPayload(contactId: string): string {
  return `nconnect:${contactId}`;
}

function toIdentity(entry: DirectoryEntry): ContactIdentity {
  return { contactId: entry.contactId, username: entry.username, name: entry.name };
}

/** Resolves a typed Unique ID through the backend. Null when nothing matches. */
export async function resolveContactId(contactId: string): Promise<ContactIdentity | null> {
  if (!isContactId(contactId)) return null;
  try {
    const result = await lookupUniqueId({ data: { uniqueId: contactId } });
    return result.ok ? toIdentity(result.entry) : null;
  } catch (error) {
    console.error("unique id lookup failed", error);
    return null;
  }
}

/** Resolves a scanned QR payload through the backend. */
export async function resolveQrPayload(payload: string): Promise<ContactIdentity | null> {
  try {
    const result = await lookupQrPayload({ data: { payload } });
    return result.ok ? toIdentity(result.entry) : null;
  } catch (error) {
    console.error("qr lookup failed", error);
    return null;
  }
}

/** Resolves a username through the backend, honouring private accounts. */
export async function resolveUsernameIdentity(username: string): Promise<ContactIdentity | null> {
  const handle = username.replace(/^@/, "").trim();
  if (!handle) return null;
  try {
    const result = await lookupUsername({ data: { username: handle } });
    return result.ok ? toIdentity(result.entry) : null;
  } catch (error) {
    console.error("username lookup failed", error);
    return null;
  }
}

/**
 * This account's permanent Unique ID. The database issues one the first time it
 * is asked for and returns the same value forever after.
 */
export async function ensureMyContactId(): Promise<string | null> {
  try {
    const result = await myUniqueId();
    return result.ok ? result.contactId : null;
  } catch (error) {
    console.error("unique id could not be read", error);
    return null;
  }
}
