/**
 * Automatic backup scheduler.
 *
 * Called on a schedule with the cron bearer secret. It picks up every account
 * whose automatic backup is switched on and whose next run is due, runs a real
 * backup job for it and records the real outcome. Duplicate concurrent jobs are
 * impossible: the partial unique index on `backup_jobs` rejects a second live
 * job, and that account is simply skipped this round.
 */

import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { isBackupError } from "@/lib/backup/errors";

/** A failed-but-retryable account is retried on the next sweep, not immediately. */
const RETRY_DELAY_MINUTES = 30;

type Outcome = {
  userId: string;
  status: "completed" | "skipped" | "failed";
  code?: string;
};

async function runSweep(): Promise<{ due: number; results: Outcome[] }> {
  const repo = await import("@/lib/backup/repository.server");
  const { runBackupJob } = await import("@/lib/backup/runner.server");

  const due = await repo.dueSchedules();
  const results: Outcome[] = [];

  for (const schedule of due) {
    const userId = schedule.user_id;
    let jobId: string;
    try {
      jobId = await repo.createBackupJob(userId, "scheduled", schedule.include_media);
    } catch (error) {
      // A job is already running for this account: leave it alone and try again
      // on the next sweep rather than queueing a duplicate.
      const code = isBackupError(error) ? error.code : "unknown";
      if (code !== "job_already_running") {
        await repo.deferSchedule(userId, RETRY_DELAY_MINUTES);
      }
      results.push({ userId, status: "skipped", code });
      continue;
    }

    const result = await runBackupJob(userId, jobId, schedule.include_media);
    if (result.ok) {
      await repo.bumpSchedule(userId, schedule.frequency);
      results.push({ userId, status: "completed" });
      continue;
    }

    // Terminal failures wait for the normal schedule; transient ones retry soon.
    const terminal =
      result.code === "google_not_connected" ||
      result.code === "google_not_configured" ||
      result.code === "google_authorization_expired" ||
      result.code === "google_permission_denied" ||
      result.code === "no_snapshot" ||
      result.code === "encryption_key_missing" ||
      result.code === "incompatible_version" ||
      result.code === "invalid_backup";

    if (terminal) {
      await repo.bumpSchedule(userId, schedule.frequency);
    } else {
      await repo.deferSchedule(userId, RETRY_DELAY_MINUTES);
    }
    results.push({ userId, status: "failed", code: result.code });
  }

  return { due: due.length, results };
}

export const Route = createFileRoute("/api/public/hooks/backup-scheduler")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = await authenticateCronRequest(request);
        if (unauthorized) return unauthorized;

        try {
          const summary = await runSweep();
          return new Response(JSON.stringify({ ok: true, ...summary }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("[backup-scheduler] sweep failed", error);
          return new Response(JSON.stringify({ ok: false, error: "sweep_failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
