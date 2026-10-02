import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LICENSE_EXPIRY_DAILY_CRON,
  NOTIFICATION_ARCHIVE_DAILY_CRON,
  NOTIFICATION_PROCESSOR_CRON,
  selectScheduledJobs,
} from "../../workers/api/src/scheduled-dispatch.ts";

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
  console.log(JSON.stringify({ status: "covered", jobs }));
}
