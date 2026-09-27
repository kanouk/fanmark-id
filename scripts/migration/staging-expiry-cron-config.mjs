const BASELINE_CRONS = Object.freeze(["* * * * *", "0 0 * * *"]);
const DISABLED_SCHEDULED_LIFECYCLE_SELECTOR = "LICENSE_EXPIRY_BACKEND";

export function isStagingExpiryCronBaseline(config) {
  const crons = config?.triggers?.crons;
  if (!Array.isArray(crons) || crons.length !== BASELINE_CRONS.length) return false;
  if (new Set(crons).size !== crons.length) return false;
  if ([...crons].sort().some((cron, index) => cron !== [...BASELINE_CRONS].sort()[index])) return false;
  if (config?.vars?.LICENSE_EXPIRY_CRON !== "0 0 * * *") return false;
  // The staging admin's manual lifecycle route has its own selector and
  // needs a target profile. Only the scheduled runner selector controls Cron.
  return config?.vars?.[DISABLED_SCHEDULED_LIFECYCLE_SELECTOR] === undefined;
}
