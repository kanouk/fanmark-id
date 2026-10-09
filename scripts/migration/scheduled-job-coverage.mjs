import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LICENSE_EXPIRY_DAILY_CRON,
  NOTIFICATION_ARCHIVE_DAILY_CRON,
  NOTIFICATION_PROCESSOR_CRON,
  selectScheduledJobs,
} from "../../workers/api/src/scheduled-dispatch.ts";
import { STAGING_BACKUP_CRON, STAGING_BACKUP_MONITOR_CRON } from "../../workers/api/src/staging-backup-schedule.ts";

/** Operational backup and its independent monitor must share the explicitly pinned application scope. */
export function validateStagingBackupJobCoverage(main, scheduler, monitor) {
  const jobs = [];
  for (const [config, name, selector, enabled, cron] of [
    [scheduler, "fanmark-backup-staging", "STAGING_BACKUP_SCHEDULE", "daily-v1", STAGING_BACKUP_CRON],
    [monitor, "fanmark-backup-monitor-staging", "STAGING_BACKUP_MONITOR", "hourly-v1", STAGING_BACKUP_MONITOR_CRON],
  ]) {
    if (config?.name !== name || config.account_id !== main.account_id || config.workers_dev !== false || config.preview_urls !== false ||
        !["disabled", enabled].includes(config.vars?.[selector])) throw new Error("staging_backup_job_configuration_invalid");
    const active = config.vars[selector] === enabled;
    if (JSON.stringify(config.triggers?.crons) !== JSON.stringify(active ? [cron] : [])) throw new Error("staging_backup_job_uncovered");
    if (config.vars.RECOVERY_DRAIN_SCOPE_DIGEST !== main.vars.RECOVERY_DRAIN_SCOPE_DIGEST)
      throw new Error("staging_backup_job_scope_mismatch");
    const binding = name === "fanmark-backup-staging" ? "BACKUP_SERVICE" : "BACKUP_ALERT_SERVICE";
    if (JSON.stringify(config.services) !== JSON.stringify([{ binding, service: "fanmark-app-staging", entrypoint: "StagingBackupService" }]))
      throw new Error("staging_backup_job_service_mismatch");
    if (active) {
      if (main.vars.STAGING_BACKUP_ALERT_BACKEND !== "resend-v1" || main.vars.STAGING_BACKUP_ADMISSION !== "writers-verified-v1")
        throw new Error("staging_backup_job_admission_missing");
      jobs.push({ job: name, cron });
    }
  }
  for (const key of ["STAGING_BACKUP_SOURCE_IDS", "STAGING_BACKUP_SCHEMA_HASHES", "STAGING_BACKUP_KEY_ID"])
    if (monitor.vars[key] !== main.vars[key]) throw new Error("staging_backup_monitor_source_mismatch");
  if (monitor.d1_databases || monitor.durable_objects || monitor.vars.STAGING_BACKUP_KEY || monitor.vars.BETTER_AUTH_SECRET ||
      JSON.stringify(monitor.r2_buckets) !== JSON.stringify([{ binding: "STAGING_BACKUP_BUCKET", bucket_name: "fanmark-backups-staging" }]))
    throw new Error("staging_backup_monitor_binding_invalid");
  return jobs;
}

/** Check the base config's enabled jobs against the actual Worker router. No remote reads or writes. */
export function validateScheduledJobCoverage(config) {
  const vars = config?.vars ?? {};
  const crons = config?.triggers?.crons ?? [];
  if (!Array.isArray(crons) || crons.some(cron => typeof cron !== "string" || !cron.trim()) ||
      new Set(crons).size !== crons.length) {
    throw new Error("scheduled_crons_invalid");
  }
  const enabled = key => vars[key]?.trim() === "d1";
  const required = [];
  if (enabled("LICENSE_EXPIRY_BACKEND")) {
    required.push(["license-expiry", vars.LICENSE_EXPIRY_CRON?.trim() || LICENSE_EXPIRY_DAILY_CRON]);
  }
  if (enabled("NOTIFICATION_ARCHIVE_BACKEND")) {
    required.push(["notification-archive", vars.NOTIFICATION_ARCHIVE_CRON?.trim() || NOTIFICATION_ARCHIVE_DAILY_CRON]);
  }
  if (enabled("NOTIFICATION_PROCESSOR_BACKEND") && vars.NOTIFICATION_WAKE_BACKEND?.trim() !== "durable-object") {
    required.push(["notification-events", NOTIFICATION_PROCESSOR_CRON]);
  }
  if (enabled("STRIPE_DISPATCH_BACKEND")) {
    required.push(["stripe-webhook-dispatch", NOTIFICATION_PROCESSOR_CRON]);
  }
  if (enabled("BROADCAST_SEND_BACKEND")) {
    if (!enabled("BROADCAST_EMAIL_BACKEND")) throw new Error("broadcast_delivery_backend_missing");
    required.push(["broadcast-email-delivery", NOTIFICATION_PROCESSOR_CRON]);
  }
  for (const [job, cron] of required) {
    if (!crons.includes(cron) || !selectScheduledJobs(cron, vars).includes(job)) {
      throw new Error(`scheduled_job_uncovered:${job}`);
    }
  }
  return required.map(([job, cron]) => ({ job, cron }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configPath = process.argv[2] ?? fileURLToPath(new URL("../../workers/api/wrangler.app-staging.jsonc", import.meta.url));
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const jobs = validateScheduledJobCoverage(config);
  const backupJobs = !process.argv[2] ? validateStagingBackupJobCoverage(config,
    JSON.parse(readFileSync(new URL("../../workers/api/wrangler.backup-staging.jsonc", import.meta.url), "utf8")),
    JSON.parse(readFileSync(new URL("../../workers/api/wrangler.backup-monitor-staging.jsonc", import.meta.url), "utf8"))) : [];
  console.log(JSON.stringify({ status: "covered", jobs: [...jobs, ...backupJobs] }));
}
