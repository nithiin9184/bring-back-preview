/**
 * Google Drive transport for N Connect backups (server only).
 *
 * Nothing here ever sees a Google password. Each account authorises N Connect
 * through the official Google OAuth consent screen; Lovable's connector gateway
 * holds the refresh token and hands this server a per-user connection key.
 * That key is stored encrypted (AES-256-GCM, per account) in
 * `public.google_connections`, a table the browser has no grants on at all.
 *
 * Permission requested: `drive.appdata` only — the private, per-user
 * application data folder. N Connect cannot see, read or touch any other file
 * in the account's Drive, and the backup file is invisible to every other app.
 */

import {
  appUserReconnectRequired,
  authorizeAppUserOAuth,
  callAsAppUser,
  disconnectAppUser,
  exchangeAppUserOAuthCode,
} from "@/integrations/lovable/appUserConnector";
import { decryptFromBase64, encryptToBase64 } from "./crypto.server";
import { BackupError } from "./errors";

export const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
export const CONNECTOR_ID = "google_drive";

/** Minimum permission that still allows a private, app-owned backup file. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/drive.appdata",
];

/** The workspace OAuth client must be linked before any Google call can work. */
export function googleClientApiKey(): string | null {
  return process.env["GOOGLE_DRIVE_APP_USER_CONNECTOR_CLIENT_API_KEY"] ?? null;
}

export function isGoogleConfigured(): boolean {
  return Boolean(googleClientApiKey() && process.env["LOVABLE_API_KEY"]);
}

function requireConfigured(): string {
  const key = googleClientApiKey();
  if (!key || !process.env["LOVABLE_API_KEY"]) {
    throw new BackupError(
      "google_not_configured",
      "The Google Drive connection is not configured for this workspace yet.",
    );
  }
  return key;
}

type Admin = Awaited<ReturnType<typeof admin>>;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as {
    from: (table: string) => any;
  };
}

export type GoogleConnection = {
  userId: string;
  connectionKey: string;
  email: string | null;
  status: "connected" | "revoked" | "disconnected";
  connectedAt: string;
};

/** Reads and decrypts this account's connection key. Never leaves the server. */
export async function loadConnection(userId: string): Promise<GoogleConnection | null> {
  const db = await admin();
  const { data } = await db
    .from("google_connections")
    .select("user_id, connection_key_ciphertext, google_email, status, connected_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data || data.status !== "connected") return null;
  return {
    userId,
    connectionKey: decryptFromBase64(userId, data.connection_key_ciphertext).toString("utf8"),
    email: data.google_email ?? null,
    status: data.status,
    connectedAt: data.connected_at,
  };
}

export async function readConnectionRow(userId: string) {
  const db = await admin();
  const { data } = await db
    .from("google_connections")
    .select("google_email, status, connected_at, revoked_at")
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

async function saveConnection(userId: string, connectionKey: string, email: string | null) {
  const db = await admin();
  const { error } = await db.from("google_connections").upsert(
    {
      user_id: userId,
      connector_id: CONNECTOR_ID,
      connection_key_ciphertext: encryptToBase64(userId, connectionKey),
      google_email: email,
      status: "connected",
      connected_at: new Date().toISOString(),
      revoked_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new BackupError("unknown", `Could not store the Google connection: ${error.message}`);
}

async function markRevoked(userId: string, status: "revoked" | "disconnected") {
  const db = await admin();
  await db
    .from("google_connections")
    .update({ status, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("user_id", userId);
}

/* ---------------- OAuth ---------------- */

export async function startGoogleAuthorization(userId: string, returnUrl: string) {
  const clientAPIKey = requireConfigured();
  const existing = await loadConnection(userId);
  const { authorizationUrl } = await authorizeAppUserOAuth({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectorId: CONNECTOR_ID,
    appUserId: userId,
    clientAPIKey,
    returnUrl,
    ...(existing ? { connectionAPIKey: existing.connectionKey } : {}),
    credentialsConfiguration: { scopes: GOOGLE_SCOPES },
  });
  return authorizationUrl;
}

export async function completeGoogleAuthorization(userId: string, code: string) {
  requireConfigured();
  const { connectionAPIKey, connectorId } = await exchangeAppUserOAuthCode(GATEWAY_BASE_URL, code);
  if (connectorId !== CONNECTOR_ID) {
    throw new BackupError("unknown", "The Google sign-in returned the wrong connector.");
  }
  const email = await fetchAccountEmail(connectionAPIKey);
  await saveConnection(userId, connectionAPIKey, email);
  return { email };
}

export async function disconnectGoogle(userId: string) {
  const connection = await loadConnection(userId);
  if (connection) {
    try {
      await disconnectAppUser({
        gatewayBaseUrl: GATEWAY_BASE_URL,
        connectionAPIKey: connection.connectionKey,
        connectorId: CONNECTOR_ID,
      });
    } catch {
      // Gateway already dropped it, or it is unreachable. Either way the local
      // record must not keep claiming the account is connected.
    }
  }
  await markRevoked(userId, "disconnected");
}

/* ---------------- Drive calls ---------------- */

async function drive(userId: string, connectionKey: string, path: string, init?: RequestInit) {
  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey: connectionKey,
    connectorId: CONNECTOR_ID,
    path,
    requiredScopes: GOOGLE_SCOPES,
    ...(init ? { init } : {}),
  });
  if (await appUserReconnectRequired(res)) {
    await markRevoked(userId, "revoked");
    throw new BackupError(
      "google_authorization_expired",
      "Google access expired and must be renewed.",
    );
  }
  return res;
}

async function failFromDrive(res: Response, fallback: "upload_failed" | "download_failed") {
  const body = await res.text();
  console.error(`[backup] Google Drive ${res.status}: ${body.slice(0, 400)}`);
  if (res.status === 403 && /storageQuotaExceeded|quotaExceeded/i.test(body)) {
    throw new BackupError("drive_insufficient_storage", "Google account storage is full.");
  }
  if (res.status === 403) {
    throw new BackupError("google_permission_denied", "Google refused the Drive permission.");
  }
  if (res.status >= 500) {
    throw new BackupError("drive_unavailable", "Google Drive is unavailable.", true);
  }
  throw new BackupError(fallback, `Google Drive returned ${res.status}.`, true);
}

async function fetchAccountEmail(connectionKey: string): Promise<string | null> {
  try {
    const res = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey: connectionKey,
      connectorId: CONNECTOR_ID,
      path: "/drive/v3/about?fields=user(emailAddress)",
      requiredScopes: GOOGLE_SCOPES,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { user?: { emailAddress?: string } };
    return body.user?.emailAddress ?? null;
  } catch {
    return null;
  }
}

/** Uploads ciphertext into the account's private app-data folder. */
export async function uploadBackupFile(
  userId: string,
  connectionKey: string,
  fileName: string,
  ciphertext: Buffer,
): Promise<{ fileId: string; size: number }> {
  const boundary = `nconnect${Date.now().toString(16)}`;
  const metadata = JSON.stringify({
    name: fileName,
    parents: ["appDataFolder"],
    mimeType: "application/octet-stream",
  });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      "utf8",
    ),
    ciphertext,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);

  const res = await drive(
    userId,
    connectionKey,
    "/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=false&fields=id,size",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: new Uint8Array(body),
    },
  );
  if (!res.ok) await failFromDrive(res, "upload_failed");
  const json = (await res.json()) as { id?: string; size?: string };
  if (!json.id) throw new BackupError("upload_failed", "Google Drive did not return a file id.", true);
  return { fileId: json.id, size: Number(json.size ?? ciphertext.length) };
}

export async function downloadBackupFile(
  userId: string,
  connectionKey: string,
  fileId: string,
): Promise<Buffer> {
  const res = await drive(userId, connectionKey, `/drive/v3/files/${fileId}?alt=media`);
  if (!res.ok) await failFromDrive(res, "download_failed");
  return Buffer.from(await res.arrayBuffer());
}

export async function statBackupFile(
  userId: string,
  connectionKey: string,
  fileId: string,
): Promise<{ id: string; size: number } | null> {
  const res = await drive(userId, connectionKey, `/drive/v3/files/${fileId}?fields=id,size,trashed`);
  if (res.status === 404) return null;
  if (!res.ok) await failFromDrive(res, "download_failed");
  const json = (await res.json()) as { id: string; size?: string; trashed?: boolean };
  if (json.trashed) return null;
  return { id: json.id, size: Number(json.size ?? 0) };
}

export async function deleteBackupFile(userId: string, connectionKey: string, fileId: string) {
  const res = await drive(userId, connectionKey, `/drive/v3/files/${fileId}`, { method: "DELETE" });
  // 404 means it is already gone, which is the outcome we wanted.
  if (!res.ok && res.status !== 404) await failFromDrive(res, "upload_failed");
}

export type { Admin };
