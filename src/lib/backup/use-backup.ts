/**
 * Client hooks for Backup & Restore.
 *
 * Every value shown on the Backup and Restore screens comes from the backend
 * through these hooks. Nothing here fakes progress, sizes, dates or success:
 * a step is only reported as done once the server says it is done.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { recordSecurityEvent as recordSecurityEventFn } from "@/lib/notifications/notifications.functions";
import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/lib/store";
import {
  deleteBackup as deleteBackupFn,
  disconnectGoogleAccount as disconnectFn,
  getBackupOverview,
  saveBackupSettings as saveSettingsFn,
  startBackupNow as startBackupFn,
  startGoogleConnect as startConnectFn,
  startRestore as startRestoreFn,
  uploadDeviceSnapshot as uploadSnapshotFn,
} from "./backup.functions";
import { buildBackupPayload } from "./device-snapshot";
import { RestoreOwnershipError, buildRestoredState } from "./device-restore";
import { BACKUP_ERROR_TEXT, type BackupErrorCode } from "./errors";
import type { BackupSettingsPatch } from "./format";

export const BACKUP_QUERY_KEY = ["backup", "overview"] as const;

export type BackupFailure = { code: BackupErrorCode; message: string; retryable: boolean };

/**
 * True when a backup server function rejected the call because the request
 * carried no valid session. This is not a connectivity problem: the person is
 * signed out (or their session expired), so retrying can never succeed.
 */
export function isSignedOutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /unauthori[sz]ed|jwt|no authorization header/i.test(message);
}

type SessionState = "loading" | "signed-in" | "signed-out";

/** Tracks whether this device currently holds a Supabase session. */
function useSessionState(): SessionState {
  const [state, setState] = useState<SessionState>("loading");

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setState(data.session ? "signed-in" : "signed-out");
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? "signed-in" : "signed-out");
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return state;
}

/**
 * Loads the backup overview. The underlying server function requires a session,
 * so the request is only made once we know this device is signed in — calling it
 * while signed out would throw "Unauthorized" instead of telling the person to
 * sign in.
 */
export function useBackupOverview() {
  const fetchOverview = useServerFn(getBackupOverview);
  const session = useSessionState();
  const query = useQuery({
    queryKey: BACKUP_QUERY_KEY,
    queryFn: () => fetchOverview(),
    enabled: session === "signed-in",
    staleTime: 10_000,
    retry: (attempt, error) => attempt < 1 && !isSignedOutError(error),
  });

  return {
    query,
    signedOut: session === "signed-out" || (query.isError && isSignedOutError(query.error)),
    authLoading: session === "loading",
  };
}

function failureOf(result: unknown): BackupFailure | null {
  if (result && typeof result === "object" && (result as { ok?: boolean }).ok === false) {
    const r = result as { code?: BackupErrorCode; message?: string; retryable?: boolean };
    const code = r.code ?? "unknown";
    return {
      code,
      message: r.message ?? BACKUP_ERROR_TEXT[code],
      retryable: r.retryable ?? true,
    };
  }
  return null;
}

/**
 * Backup and restore actions. Each one reports a single meaningful outcome to
 * the notification list — never one notification per internal step.
 */
export function useBackupActions() {
  const queryClient = useQueryClient();
  const { notify, readBackupSource, applyRestoredSource } = useApp();
  const recordSecurityEvent = useServerFn(recordSecurityEventFn);
  const [failure, setFailure] = useState<BackupFailure | null>(null);

  const startConnect = useServerFn(startConnectFn);
  const disconnect = useServerFn(disconnectFn);
  const saveSettings = useServerFn(saveSettingsFn);
  const uploadSnapshot = useServerFn(uploadSnapshotFn);
  const startBackup = useServerFn(startBackupFn);
  const startRestore = useServerFn(startRestoreFn);
  const removeBackup = useServerFn(deleteBackupFn);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: BACKUP_QUERY_KEY }),
    [queryClient],
  );

  // Backup events are account activity: written on the server so they survive
  // reopening the app and reach every signed-in device.
  const announce = useCallback(
    (text: string, tone: "success" | "warning") =>
      void recordSecurityEvent({ data: { text, tone, source: "Backup & Restore" } }).catch(
        () => undefined,
      ),
    [recordSecurityEvent],
  );

  const report = useCallback(
    (f: BackupFailure, event: "Backup failed" | "Restore failed" | null) => {
      setFailure(f);
      if (f.code === "google_not_connected" || f.code === "google_authorization_expired") {
        announce("Connect your Google account to keep backups running.", "warning");
      } else if (event) {
        announce(`${event}: ${f.message}`, "warning");
      }
      notify(f.message);
      return f;
    },
    [announce, notify],
  );

  const connect = useMutation({
    mutationFn: async () => {
      setFailure(null);
      const result = await startConnect();
      const f = failureOf(result);
      if (f) throw report(f, null);
      // The Google window decides the outcome; the app does not claim success.
      window.location.href = (result as { authorizationUrl: string }).authorizationUrl;
    },
  });

  const disconnectGoogle = useMutation({
    mutationFn: async () => {
      setFailure(null);
      const f = failureOf(await disconnect());
      if (f) throw report(f, null);
      await refresh();
    },
  });

  const updateSettings = useMutation({
    mutationFn: async (patch: BackupSettingsPatch) => {
      setFailure(null);
      const f = failureOf(await saveSettings({ data: patch }));
      if (f) throw report(f, null);
      await refresh();
    },
  });

  const backupNow = useMutation({
    mutationFn: async (includeMedia: boolean) => {
      setFailure(null);
      const payload = await buildBackupPayload(await readBackupSource(), includeMedia);
      const uploaded = failureOf(await uploadSnapshot({ data: { payload } }));
      if (uploaded) throw report(uploaded, "Backup failed");
      const result = await startBackup();
      const f = failureOf(result);
      if (f) throw report(f, "Backup failed");
      await refresh();
      announce("Backup completed.", "success");
      notify("Backup completed");
    },
  });

  const restore = useMutation({
    mutationFn: async (backupId: string) => {
      setFailure(null);
      const result = await startRestore({ data: { backupId } });
      const f = failureOf(result);
      if (f) throw report(f, "Restore failed");
      const { payload } = result as { payload: Parameters<typeof buildRestoredState>[1] };
      try {
        const { next, counts } = buildRestoredState(await readBackupSource(), payload);
        applyRestoredSource(next);
        await refresh();
        announce("Restore completed.", "success");
        notify("Restore completed");
        return counts;
      } catch (error) {
        const message =
          error instanceof RestoreOwnershipError ? error.message : BACKUP_ERROR_TEXT.invalid_backup;
        throw report({ code: "invalid_backup", message, retryable: false }, "Restore failed");
      }
    },
  });

  const remove = useMutation({
    mutationFn: async (backupId: string) => {
      setFailure(null);
      const f = failureOf(await removeBackup({ data: { backupId } }));
      if (f) throw report(f, null);
      await refresh();
      notify("Backup deleted");
    },
  });

  return {
    failure,
    clearFailure: () => setFailure(null),
    connect,
    disconnectGoogle,
    updateSettings,
    backupNow,
    restore,
    remove,
    refresh,
  };
}
