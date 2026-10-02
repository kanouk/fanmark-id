const ACCOUNT_ID = "bfc2890741f0b3fb236e2d755b6c9adc";
const ACCOUNT_EMAIL = "fanmark.id@gmail.com";
const BUSINESS = Object.freeze({ name: "fanmark-business-staging", id: "d4bb0c48-f24a-491f-8693-fa393ab0b873" });
const AUTH = Object.freeze({ name: "fanmark-auth-staging", id: "2116bc43-32ab-4e3e-b762-9378df88b95f" });

/** Allow the synthetic archive smoke only against the guarded staging Worker and D1s. */
export function isStagingNotificationArchiveTarget(config, identity) {
  if (!config || !identity) return false;
  const vars = config.vars ?? {};
  const databases = Array.isArray(config.d1_databases) ? config.d1_databases : [];
  const business = databases.find((entry) => entry.binding === "FANMARK_DB");
  const auth = databases.find((entry) => entry.binding === "AUTH_DB");
  return config.name === "fanmark-app-staging" && config.account_id === ACCOUNT_ID &&
    config.workers_dev === true && (config.routes === undefined || (Array.isArray(config.routes) && config.routes.length === 0)) &&
    stagingNotificationScheduleMode(config) !== null &&
    vars.NOTIFICATION_PROCESSOR_BACKEND === "d1" && vars.NOTIFICATION_ARCHIVE_BACKEND === undefined &&
    vars.LICENSE_EXPIRY_BACKEND === undefined && vars.STRIPE_DISPATCH_BACKEND === undefined &&
    vars.STRIPE_WEBHOOK_BACKEND === undefined &&
    business?.database_name === BUSINESS.name && business.database_id === BUSINESS.id && business.remote === true &&
    auth?.database_name === AUTH.name && auth.database_id === AUTH.id && auth.remote === true &&
    identity.loggedIn === true && identity.email === ACCOUNT_EMAIL &&
    Array.isArray(identity.accounts) && identity.accounts.some((account) => account.id === ACCOUNT_ID);
}
import { stagingNotificationScheduleMode } from "./staging-notification-wake-target.mjs";
