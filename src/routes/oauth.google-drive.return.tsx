/**
 * Google Drive OAuth return page.
 *
 * Google sends the person back here after the consent screen. The one-time
 * code is exchanged on the server (`completeGoogleConnect`); no client secret,
 * refresh token or access token ever reaches the browser.
 */

import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, CircleAlert, RefreshCw } from "lucide-react";

import { Button, Screen } from "@/components/ui-kit";
import { completeGoogleConnect } from "@/lib/backup/backup.functions";
import { BACKUP_ERROR_TEXT, type BackupErrorCode } from "@/lib/backup/errors";

type Search = {
  code?: string | undefined;
  error?: string | undefined;
  error_description?: string | undefined;
  state?: string | undefined;
};

export const Route = createFileRoute("/oauth/google-drive/return")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    code: typeof search["code"] === "string" ? search["code"] : undefined,
    error: typeof search["error"] === "string" ? search["error"] : undefined,
    error_description:
      typeof search["error_description"] === "string" ? search["error_description"] : undefined,
    state: typeof search["state"] === "string" ? search["state"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Connecting Google Drive — N Connect" },
      {
        name: "description",
        content: "Finishing the secure Google Drive connection for N Connect backups.",
      },
      { property: "og:title", content: "Connecting Google Drive — N Connect" },
      {
        property: "og:description",
        content: "Finishing the secure Google Drive connection for N Connect backups.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: GoogleReturnScreen,
});

function messageForOAuthError(error: string, description?: string): string {
  if (error === "access_denied" || error === "user_cancelled_authorize") {
    return "You cancelled the Google connection, so nothing was changed.";
  }
  if (error === "invalid_scope") return BACKUP_ERROR_TEXT.google_permission_denied;
  return description || "Google could not complete the connection. Try again.";
}

function GoogleReturnScreen() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const complete = useServerFn(completeGoogleConnect);
  const started = useRef(false);
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [message, setMessage] = useState("Finishing the connection with Google…");

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (search.error) {
      setState("failed");
      setMessage(messageForOAuthError(search.error, search.error_description));
      return;
    }
    if (!search.code) {
      setState("failed");
      setMessage("Google did not send an authorization code back, so nothing was connected.");
      return;
    }

    void (async () => {
      try {
        const result = (await complete({ data: { code: search.code as string } })) as {
          ok: boolean;
          code?: BackupErrorCode;
          message?: string;
        };
        if (result.ok) {
          setState("done");
          setMessage("Google account connected. Your backups can run now.");
        } else {
          setState("failed");
          setMessage(
            result.message ?? BACKUP_ERROR_TEXT[result.code ?? "unknown"] ?? BACKUP_ERROR_TEXT.unknown,
          );
        }
      } catch {
        setState("failed");
        setMessage(BACKUP_ERROR_TEXT.network_error);
      }
    })();
  }, [complete, search.code, search.error, search.error_description]);

  const goBack = () => navigate({ to: "/settings/$section", params: { section: "backup" } });

  return (
    <main className="app-page">
      <Screen>
        <div className="mt-24 text-center">
          {state === "working" && (
            <RefreshCw size={22} strokeWidth={1.7} className="mx-auto animate-spin text-ink-3" />
          )}
          {state === "done" && (
            <CheckCircle2 size={24} strokeWidth={1.7} className="mx-auto text-ink" />
          )}
          {state === "failed" && (
            <CircleAlert size={24} strokeWidth={1.7} className="mx-auto text-red-500" />
          )}
          <h1 className="mt-4 text-[16px] font-semibold text-ink">
            {state === "working"
              ? "Connecting Google"
              : state === "done"
                ? "Google connected"
                : "Connection not completed"}
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-[12.5px] text-ink-2">{message}</p>
          {state !== "working" && (
            <Button className="mt-6" onClick={goBack}>
              Back to Backup
            </Button>
          )}
        </div>
      </Screen>
    </main>
  );
}
