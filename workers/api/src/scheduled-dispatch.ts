import type { Env } from "./repository";

export const NOTIFICATION_PROCESSOR_CRON = "* * * * *";
export const LICENSE_EXPIRY_DAILY_CRON = "0 0 * * *";

export type ScheduledJobName = "license-expiry" | "notification-events" | "stripe-webhook-dispatch";

export function selectScheduledJobs(cron: string, env: Env): ScheduledJobName[] {
  const selected: ScheduledJobName[] = [];
  const lifecycleCron = env.LICENSE_EXPIRY_CRON?.trim() || LICENSE_EXPIRY_DAILY_CRON;
  if (cron === lifecycleCron) selected.push("license-expiry");
  if (cron === NOTIFICATION_PROCESSOR_CRON) selected.push("notification-events", "stripe-webhook-dispatch");
  return selected;
}
