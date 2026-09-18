/**
 * Backup, Backup Settings and Restore screens.
 *
 * Every value on these screens comes from `getBackupOverview` on the server.
 * Nothing is hardcoded, stored in localStorage or simulated: when the backend
 * has no backup, no Google connection or no schedule, the screen says so.
 */

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CalendarClock,
  CloudUpload,
  Database,
  HardDrive,
  Image as ImageIcon,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Unplug,
} from "lucide-react";

import { Button } from "@/components/ui-kit";
import { ActionRow, ChoiceRow, Group, InfoNote, ToggleRow } from "@/components/settings-kit";
import { GlassSheet } from "@/components/GlassSheet";
import { useApp } from "@/lib/store";
import { isSignedOutError, useBackupActions, useBackupOverview } from "@/lib/backup/use-backup";
import { formatBytes, frequencyLabel, type BackupFrequency } from "@/lib/backup/format";

type Overview = NonNullable<ReturnType<typeof useBackupOverview>["query"]["data"]>;

/* ---------------- shared pieces ---------------- */

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="mt-5 rounded-[22px] border border-line bg-surface px-4 py-4 shadow-soft">
      {children}
    </section>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="mt-16 text-center" role="status" aria-live="polite">
      <RefreshCw size={18} strokeWidth={1.8} className="mx-auto animate-spin text-ink-3" />
      <p className="mt-3 text-[13px] text-ink-2">{label}</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-16 text-center">
      <p className="text-[13.5px] font-medium text-ink">Couldn't load your backup</p>
      <p className="mx-auto mt-1 max-w-xs text-[12px] text-ink-2">{message}</p>
      <Button variant="secondary" className="mt-4" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function SignedOutState() {
  const navigate = useNavigate();
  return (
    <div className="mt-16 text-center">
      <Lock size={22} strokeWidth={1.6} className="mx-auto text-ink-3" />
      <p className="mt-3 text-[13.5px] font-medium text-ink">Sign in to see your backup</p>
      <p className="mx-auto mt-1 max-w-xs text-[12px] text-ink-2">
        Backups belong to your account, so we need you signed in on this device before we can show
        them.
      </p>
      <Button className="mt-4" onClick={() => navigate({ to: "/login" })}>
        Sign in
      </Button>
    </div>
  );
}

/**
 * A failed overview load is only a connection problem when the request actually
 * reached the server with a session. A signed-out visitor gets a sign-in prompt
 * instead of a misleading "check your connection" message.
 */
function QueryProblem({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (isSignedOutError(error)) return <SignedOutState />;
  return (
    <ErrorState
      message="We couldn't reach your backup just now. Check your connection and try again."
      onRetry={onRetry}
    />
  );
}

function FailureNote({
  message,
  retryable,
  onRetry,
}: {
  message: string;
  retryable: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="mt-4 rounded-[18px] border border-red-500/30 bg-red-500/5 px-4 py-3">
      <p className="text-[12.5px] text-ink">{message}</p>
      {retryable && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-[12px] font-semibold text-ink underline underline-offset-2"
        >
          Try again
        </button>
      )}
    </div>
  );
}

function when(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function GoogleCard({ overview }: { overview: Overview }) {
  const { connect, disconnectGoogle } = useBackupActions();
  if (!overview.configured) {
    return (
      <Card>
        <p className="text-[13px] font-semibold text-ink">Google Drive is not set up</p>
        <p className="mt-1 text-[12px] text-ink-2">
          This app has no Google backup destination configured yet, so backups cannot run.
        </p>
      </Card>
    );
  }
  const connected = overview.google?.status === "connected";
  return (
    <Card>
      <p className="text-[13px] text-ink-2">Google account</p>
      <p className="mt-0.5 text-[15px] font-semibold text-ink">
        {connected ? (overview.google?.email ?? "Connected") : "Not connected"}
      </p>
      {overview.google?.status === "revoked" && (
        <p className="mt-1 text-[12px] text-ink-2">
          Google access was withdrawn. Reconnect to keep backing up.
        </p>
      )}
      {connected ? (
        <Button
          variant="secondary"
          className="mt-3 w-full"
          disabled={disconnectGoogle.isPending}
          onClick={() => disconnectGoogle.mutate()}
        >
          <Unplug size={16} strokeWidth={1.8} />
          {disconnectGoogle.isPending ? "Disconnecting…" : "Disconnect Google"}
        </Button>
      ) : (
        <Button
          className="mt-3 w-full"
          disabled={connect.isPending}
          onClick={() => connect.mutate()}
        >
          {connect.isPending ? "Opening Google…" : "Connect Google account"}
        </Button>
      )}
    </Card>
  );
}

/* ---------------- Backup ---------------- */

export function BackupScreen() {
  const navigate = useNavigate();
  const { query, signedOut, authLoading } = useBackupOverview();
  const { backupNow, remove, failure, clearFailure, refresh } = useBackupActions();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (signedOut) return <SignedOutState />;
  if (authLoading || query.isPending) return <Loading label="Loading your backup" />;
  if (query.isError || !query.data) {
    return <QueryProblem error={query.error} onRetry={() => void query.refetch()} />;
  }

  const overview = query.data;
  const latest = overview.backups[0] ?? null;
  const job = overview.backupJob;
  const running = backupNow.isPending;
  const canBackUp = overview.configured && overview.google?.status === "connected";

  return (
    <>
      <Card>
        <p className="text-[13px] text-ink-2">Last backup</p>
        <p className="mt-0.5 text-[16px] font-semibold text-ink">
          {when(latest?.createdAt) ?? "No backup yet"}
        </p>
        {latest && (
          <p className="mt-1 text-[12px] text-ink-2">
            {formatBytes(latest.sizeBytes)} ·{" "}
            {latest.includesMedia ? "Chats and media" : "Chats only"} · Version {latest.version}
          </p>
        )}
        <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-2">
          <Lock size={12} strokeWidth={2} />
          End-to-end encrypted before it leaves this device
        </p>

        {job?.state === "failed" && !failure && (
          <p className="mt-3 text-[12px] text-ink-2">
            Last attempt failed: {job.error_message ?? "Unknown error"}
          </p>
        )}

        <Button
          className="mt-3 w-full"
          disabled={running || !canBackUp}
          onClick={() => backupNow.mutate(overview.settings.includeMedia)}
        >
          <CloudUpload size={16} strokeWidth={1.8} />
          {running ? "Backing up…" : "Back up now"}
        </Button>
        {!canBackUp && overview.configured && (
          <p className="mt-2 text-center text-[11.5px] text-ink-2">
            Connect a Google account to back up.
          </p>
        )}
        {failure && (
          <FailureNote
            message={failure.message}
            retryable={failure.retryable}
            onRetry={() => {
              clearFailure();
              backupNow.mutate(overview.settings.includeMedia);
            }}
          />
        )}
      </Card>

      <GoogleCard overview={overview} />

      <Group label="Schedule">
        <ActionRow
          Icon={CalendarClock}
          title="Next scheduled backup"
          value={
            overview.settings.autoEnabled
              ? (when(overview.settings.nextRunAt) ?? "Not scheduled")
              : "Automatic backup off"
          }
          chevron={false}
        />
        <ActionRow
          Icon={RefreshCw}
          title="Backup settings"
          note={`${frequencyLabel(overview.settings.frequency as BackupFrequency)} · ${
            overview.settings.includeMedia ? "Chats and media" : "Chats only"
          }`}
          onSelect={() =>
            navigate({ to: "/settings/$section", params: { section: "backup-settings" } })
          }
        />
      </Group>

      <Group label="Backup">
        <ActionRow
          Icon={HardDrive}
          title="Backup size"
          value={latest ? formatBytes(latest.sizeBytes) : "—"}
          chevron={false}
        />
        <ActionRow
          Icon={RotateCcw}
          title="Restore from backup"
          note={latest ? "Bring your chats back on this device" : "No backup available yet"}
          onSelect={() => navigate({ to: "/settings/$section", params: { section: "restore" } })}
        />
        <ActionRow
          Icon={Trash2}
          title="Delete backup"
          danger
          chevron={false}
          {...(latest ? {} : { note: "Nothing to delete" })}
          onSelect={() => latest && setConfirmDelete(true)}
        />
      </Group>

      <InfoNote>
        Backups are encrypted with your account key. Lose it and nobody, including us, can read
        them.
      </InfoNote>

      <GlassSheet
        open={confirmDelete}
        title="Delete this backup?"
        onClose={() => setConfirmDelete(false)}
        actions={[
          {
            label: remove.isPending ? "Deleting…" : "Delete backup",
            Icon: Trash2,
            tone: "danger",
            onSelect: () => {
              if (latest) remove.mutate(latest.id, { onSettled: () => void refresh() });
              setConfirmDelete(false);
            },
          },
          { label: "Keep backup" },
        ]}
      />
    </>
  );
}

/* ---------------- Backup settings ---------------- */

export function BackupSettingsScreen() {
  const { query, signedOut, authLoading } = useBackupOverview();
  const { updateSettings, failure, clearFailure } = useBackupActions();
  const { require: requireLimit, limits } = useApp();

  if (signedOut) return <SignedOutState />;
  if (authLoading || query.isPending) return <Loading label="Loading backup settings" />;
  if (query.isError || !query.data) {
    return <QueryProblem error={query.error} onRetry={() => void query.refetch()} />;
  }

  const settings = query.data.settings;
  const saving = updateSettings.isPending;
  const options: BackupFrequency[] = ["daily", "weekly", "monthly"];

  return (
    <>
      <Group label="Schedule">
        <ToggleRow
          Icon={CloudUpload}
          title="Automatic backup"
          note={saving ? "Saving…" : "Runs in the background on your schedule"}
          on={settings.autoEnabled}
          onChange={(v) => updateSettings.mutate({ autoEnabled: v })}
        />
        <ChoiceRow
          title="Frequency"
          options={options.map(frequencyLabel)}
          value={frequencyLabel(settings.frequency as BackupFrequency)}
          onChange={(label) => {
            const next = options.find((o) => frequencyLabel(o) === label);
            if (next) updateSettings.mutate({ frequency: next });
          }}
        />
      </Group>

      <Group label="Content">
        <ToggleRow
          Icon={ImageIcon}
          title="Media backup"
          note={limits.backupMedia ? "Photos and voice notes" : "Premium adds photos and voice notes"}
          on={settings.includeMedia}
          onChange={(v) => {
            if (v && !requireLimit("backupMedia")) return;
            updateSettings.mutate({ includeMedia: v });
          }}
        />
      </Group>

      {failure && (
        <FailureNote
          message={failure.message}
          retryable={failure.retryable}
          onRetry={() => {
            clearFailure();
            void query.refetch();
          }}
        />
      )}

      <InfoNote>
        Settings are saved on the server, so the schedule keeps running even when this device is
        offline.
      </InfoNote>
    </>
  );
}

/* ---------------- Restore ---------------- */

export function RestoreScreen() {
  const { query, signedOut, authLoading } = useBackupOverview();
  const { restore, failure, clearFailure } = useBackupActions();
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  if (signedOut) return <SignedOutState />;
  if (authLoading || query.isPending) return <Loading label="Looking for your backup" />;
  if (query.isError || !query.data) {
    return <QueryProblem error={query.error} onRetry={() => void query.refetch()} />;
  }

  const overview = query.data;
  const connected = overview.configured && overview.google?.status === "connected";
  const latest = overview.backups[0] ?? null;

  if (!connected) {
    return (
      <>
        <div className="mt-16 text-center">
          <Database size={22} strokeWidth={1.6} className="mx-auto text-ink-3" />
          <p className="mt-3 text-[13.5px] font-medium text-ink">Google account required</p>
          <p className="mx-auto mt-1 max-w-xs text-[12px] text-ink-2">
            Your backups live in your own Google Drive. Connect the account that made them to
            restore.
          </p>
        </div>
        <GoogleCard overview={overview} />
      </>
    );
  }

  if (!latest) {
    return (
      <div className="mt-16 text-center">
        <Database size={22} strokeWidth={1.6} className="mx-auto text-ink-3" />
        <p className="mt-3 text-[13.5px] font-medium text-ink">No backup found</p>
        <p className="mx-auto mt-1 max-w-xs text-[12px] text-ink-2">
          Once a backup completes it shows up here, ready to restore.
        </p>
      </div>
    );
  }

  const counts = latest.counts ?? {};

  return (
    <>
      <Card>
        <p className="text-[13px] text-ink-2">Available backup</p>
        <p className="mt-0.5 text-[16px] font-semibold text-ink">{when(latest.createdAt)}</p>
        <p className="mt-1 text-[12px] text-ink-2">
          {formatBytes(latest.sizeBytes)} · Version {latest.version} ·{" "}
          {latest.includesMedia ? "Chats and media" : "Chats only"}
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-ink-2">
          <ShieldCheck size={12} strokeWidth={2} />
          Fingerprint verified when it was uploaded
        </p>
        <p className="mt-1 text-[11.5px] text-ink-2">
          {Object.entries(counts)
            .filter(([, n]) => Number(n) > 0)
            .map(([key, n]) => `${n} ${key}`)
            .join(" · ") || "No items recorded"}
        </p>

        <Button
          className="mt-3 w-full"
          disabled={restore.isPending}
          onClick={() => setConfirm(true)}
        >
          <RotateCcw size={16} strokeWidth={1.8} />
          {restore.isPending ? "Restoring…" : "Restore this backup"}
        </Button>

        {done && <p className="mt-3 text-center text-[12px] text-ink-2">{done}</p>}
        {failure && (
          <FailureNote
            message={failure.message}
            retryable={failure.retryable}
            onRetry={() => {
              clearFailure();
              restore.mutate(latest.id);
            }}
          />
        )}
      </Card>

      <InfoNote>
        Restoring merges this backup into what is already on this device. Expired statuses and
        disappearing messages are never brought back.
      </InfoNote>

      <GlassSheet
        open={confirm}
        title="Restore this backup?"
        onClose={() => setConfirm(false)}
        actions={[
          {
            label: "Restore",
            Icon: RotateCcw,
            onSelect: () => {
              setConfirm(false);
              setDone(null);
              restore.mutate(latest.id, {
                onSuccess: () => setDone("Restore completed on this device."),
              });
            },
          },
          { label: "Cancel" },
        ]}
      />
    </>
  );
}
