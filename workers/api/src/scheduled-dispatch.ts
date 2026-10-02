import type { Env } from "./repository";

export const NOTIFICATION_PROCESSOR_CRON = "* * * * *";
export const LICENSE_EXPIRY_DAILY_CRON = "0 0 * * *";
export const NOTIFICATION_ARCHIVE_DAILY_CRON = "0 0 * * *";

export type ScheduledJobName =
  | "license-expiry"
  | "notification-events"
  | "notification-archive"
  | "stripe-webhook-dispatch"
  | "broadcast-email-delivery";

export function selectScheduledJobs(cron: string, env: Env): ScheduledJobName[] {
  const selected: ScheduledJobName[] = [];
  const lifecycleCron = env.LICENSE_EXPIRY_CRON?.trim() || LICENSE_EXPIRY_DAILY_CRON;
  const archiveCron = env.NOTIFICATION_ARCHIVE_CRON?.trim() || NOTIFICATION_ARCHIVE_DAILY_CRON;
  if (cron === lifecycleCron) selected.push("license-expiry");
  if (cron === archiveCron && env.NOTIFICATION_ARCHIVE_BACKEND?.trim() === "d1") {
    selected.push("notification-archive");
  }
  if (cron === NOTIFICATION_PROCESSOR_CRON) {
    selected.push("notification-events", "stripe-webhook-dispatch");
    if (env.BROADCAST_EMAIL_BACKEND?.trim() === "d1" && env.BROADCAST_SEND_BACKEND?.trim() === "d1") {
      selected.push("broadcast-email-delivery");
    }
  }
  return selected;
}
