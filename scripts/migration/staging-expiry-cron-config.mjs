import { stagingNotificationScheduleMode } from "./staging-notification-wake-target.mjs";
const DISABLED_SCHEDULED_LIFECYCLE_SELECTOR = "LICENSE_EXPIRY_BACKEND";

export function isStagingExpiryCronBaseline(config) {
  if (!stagingNotificationScheduleMode(config)) return false;
  if (config?.vars?.LICENSE_EXPIRY_CRON !== "0 0 * * *") return false;
  // The staging admin's manual lifecycle route has its own selector and
  // needs a target profile. Only the scheduled runner selector controls Cron.
  return config?.vars?.[DISABLED_SCHEDULED_LIFECYCLE_SELECTOR] === undefined;
}
