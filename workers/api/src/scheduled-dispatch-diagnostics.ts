import type { ScheduledJobName } from "./scheduled-dispatch";

export type ScheduledDispatchDiagnosticStage =
  | "received"
  | "paused"
  | "selected"
  | "job_started"
  | "job_completed"
  | "job_failed";

export interface ScheduledDispatchDiagnostic {
  cron: string;
  scheduledTime: number;
  stage: ScheduledDispatchDiagnosticStage;
  jobName?: ScheduledJobName;
  details?: {
    selectedJobs?: ScheduledJobName[];
    status?: string;
    code?: string;
    claimed?: number;
    applied?: number;
    ignored?: number;
    deadLettered?: number;
    retryable?: number;
    leaseLost?: number;
    archived?: number;
    remaining?: number;
    conflicts?: number;
    batches?: number;
  };
}

const STAGES = new Set<ScheduledDispatchDiagnosticStage>([
  "received",
  "paused",
  "selected",
  "job_started",
  "job_completed",
  "job_failed",
]);
const JOBS = new Set<ScheduledJobName>([
  "license-expiry",
  "notification-events",
  "notification-archive",
  "stripe-webhook-dispatch",
  "broadcast-email-delivery",
]);
const DETAIL_KEYS = new Set([
  "selectedJobs",
  "status",
  "code",
  "claimed",
  "applied",
  "ignored",
  "deadLettered",
  "retryable",
  "leaseLost",
  "archived",
  "remaining",
  "conflicts",
  "batches",
]);

/** Write bounded, value-free Cron execution evidence to an explicitly bound D1. */
export async function recordScheduledDispatchDiagnostic(
  database: D1Database | undefined,
  diagnostic: ScheduledDispatchDiagnostic,
): Promise<void> {
  if (!database) return;
  if (!Number.isSafeInteger(diagnostic.scheduledTime) || diagnostic.scheduledTime < 0 ||
      !/^[0-9*/,-]+(?:\s+[0-9*/,-]+){4}$/u.test(diagnostic.cron) ||
      !STAGES.has(diagnostic.stage) ||
      (diagnostic.jobName !== undefined && !JOBS.has(diagnostic.jobName))) {
    throw new TypeError("scheduled_dispatch_diagnostic_invalid");
  }

  const details = diagnostic.details ?? {};
  const metricValues = [details.claimed, details.applied, details.ignored, details.deadLettered,
    details.retryable, details.leaseLost, details.archived, details.remaining, details.conflicts, details.batches];
  const labelValues = [details.status, details.code];
  const hasInvalidMetric = metricValues.some((value) => (
    value !== undefined && (!Number.isSafeInteger(value) || value < 0)
  ));
  const hasInvalidLabel = labelValues.some((value) => (
    value !== undefined && (typeof value !== "string" || !/^[a-z0-9_-]{1,64}$/iu.test(value))
  ));
  if (Object.keys(details).some((key) => !DETAIL_KEYS.has(key)) ||
      (details.selectedJobs !== undefined && details.selectedJobs.some((job) => !JOBS.has(job))) ||
      hasInvalidMetric || hasInvalidLabel) {
    throw new TypeError("scheduled_dispatch_diagnostic_details_invalid");
  }

  const jobName = diagnostic.jobName ?? "";
  const eventId = `${diagnostic.scheduledTime}:${diagnostic.cron}:${diagnostic.stage}:${jobName}`;
  const detailsJson = JSON.stringify(details);
  const result = await database.prepare(`
    INSERT INTO migration_scheduled_dispatch_diagnostics (
      event_id, cron, scheduled_time_ms, stage, job_name, details_json
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET details_json = excluded.details_json
  `).bind(
    eventId,
    diagnostic.cron,
    diagnostic.scheduledTime,
    diagnostic.stage,
    jobName,
    detailsJson,
  ).run();
  if (result?.success !== true) throw new Error("scheduled_dispatch_diagnostic_write_failed");
}
