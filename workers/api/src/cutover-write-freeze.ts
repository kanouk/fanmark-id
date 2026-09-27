const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const AUTH_METHODS_ALLOWED_DURING_FREEZE = new Set([
  "POST /api/auth/sign-in/email",
  "POST /api/auth/sign-out",
  "POST /api/auth/two-factor/verify-totp",
  "POST /api/auth/two-factor/verify-backup-code",
  "GET /api/auth/get-session",
  "GET /api/auth/ok",
  "GET /api/auth/capabilities",
]);

export type CutoverWriteFreezeState = "disabled" | "enabled" | "invalid";

export function cutoverWriteFreezeState(value: string | undefined): CutoverWriteFreezeState {
  const normalized = value?.trim().toLowerCase();
  if (normalized === undefined || normalized === "" || normalized === "false") return "disabled";
  if (normalized === "true") return "enabled";
  return "invalid";
}

export function blocksRequestDuringCutoverFreeze(
  method: string,
  pathname: string,
  selector: string | undefined,
): boolean {
  if (!pathname.startsWith("/api/")) return false;
  if (cutoverWriteFreezeState(selector) === "disabled") return false;
  if (method === "POST" && pathname === "/api/stripe/webhook") return false;
  if (AUTH_METHODS_ALLOWED_DURING_FREEZE.has(`${method} ${pathname}`)) return false;
  // Better Auth OAuth callbacks use GET while creating a session. Keep auth
  // traffic closed unless the exact endpoint/method is explicitly allowlisted.
  if (pathname.startsWith("/api/auth/")) return true;
  if (SAFE_METHODS.has(method)) return false;
  return true;
}

export function shouldPauseScheduledJobsForCutover(selector: string | undefined): boolean {
  return cutoverWriteFreezeState(selector) !== "disabled";
}
