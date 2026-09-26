const BASELINE_CRONS = Object.freeze(["* * * * *", "0 0 * * *"]);
const DISABLED_LIFECYCLE_VARS = Object.freeze([
  "LICENSE_EXPIRY_BACKEND",
  "LICENSE_EXPIRY_TARGET_INCARNATION",
  "LICENSE_EXPIRY_SCHEMA_EXTENSION_DIGEST",
]);

export function isStagingExpiryCronBaseline(config) {
  const crons = config?.triggers?.crons;
  if (!Array.isArray(crons) || crons.length !== BASELINE_CRONS.length) return false;
  if (new Set(crons).size !== crons.length) return false;
  if ([...crons].sort().some((cron, index) => cron !== [...BASELINE_CRONS].sort()[index])) return false;
  if (config?.vars?.LICENSE_EXPIRY_CRON !== "0 0 * * *") return false;
  return DISABLED_LIFECYCLE_VARS.every((name) => config?.vars?.[name] === undefined);
}
