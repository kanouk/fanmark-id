import { runScheduledLicenseExpiry, ScheduledLicenseExpiryError } from "./license-expiry-scheduled.mjs";
import { selectD1Database, type Env } from "./repository";

const RUN_PATH = "/api/admin/license-expiry/run";
const ALLOWED_METHODS = "POST, OPTIONS";
const SAFE_ERROR_CODE = /^[a-z0-9_]{1,80}$/u;

export type LifecycleRunAdminAuthorizer = (
  request: Request,
  responseHeaders: Headers,
) => Promise<{ userId: string; sessionId: string } | Response>;

export interface LifecycleRunResult {
  schemaVersion: 1;
  status: "completed" | "in_progress";
  activeToGrace: {
    status: "completed" | "running";
    candidateCount: number;
    processed: number;
    conflicts: number;
    pagesProcessed: number;
  };
  graceFinalization: {
    status: "completed" | "running" | "deferred_active_to_grace_running" | "deferred_page_budget";
    candidateCount: number;
    processed: number;
    conflicts: number;
    pagesProcessed: number;
  };
  pagesLimit: number;
  elapsedMs: number;
}

export class LifecycleRunApiError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "LifecycleRunApiError";
  }
}

function fail(code: string, status = 503): never {
  throw new LifecycleRunApiError(code, status);
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function cors(request: Request, env: Env, headers: Headers): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const allowed = new Set(
    (env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  );
  if (!allowed.has(origin)) return false;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", ALLOWED_METHODS);
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return true;
}

async function noBody(request: Request): Promise<boolean> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) !== 0)) return false;
  if (request.body === null) return true;

  // Cloudflare can expose an empty POST body as a readable stream even when
  // the caller supplied no bytes. Drain only until the first byte (or EOF),
  // and bound the wait so a stalled upload cannot hold the admin route open.
  const reader = request.body.getReader();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return true;
          if ((value?.byteLength ?? 0) > 0) return false;
        }
      })(),
      new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => resolve(false), 1_000);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    await reader.cancel().catch(() => {});
  }
}

function counter(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("lifecycle_run_unavailable");
  }
  return value;
}

function phaseSummary(value: unknown, fallbackStatus: LifecycleRunResult["graceFinalization"]["status"]): LifecycleRunResult["graceFinalization"] {
  if (typeof value !== "object" || value === null) {
    return { status: fallbackStatus, candidateCount: 0, processed: 0, conflicts: 0, pagesProcessed: 0 };
  }
  const phase = value as Record<string, unknown>;
  const status = phase.status;
  if (
    status !== "completed" && status !== "running" &&
    status !== "deferred_active_to_grace_running" && status !== "deferred_page_budget"
  ) fail("lifecycle_run_unavailable");
  return {
    status,
    candidateCount: counter(phase.candidateCount ?? 0),
    processed: counter(phase.processed ?? 0),
    conflicts: counter(phase.conflicts ?? 0),
    pagesProcessed: counter(phase.pagesProcessed ?? 0),
  };
}

function resultPayload(value: unknown, elapsedMs: number): LifecycleRunResult {
  if (typeof value !== "object" || value === null) fail("lifecycle_run_unavailable");
  const summary = value as Record<string, unknown>;
  if (summary.status !== "completed" && summary.status !== "running") fail("lifecycle_run_unavailable");
  const finalization = phaseSummary(
    summary.graceFinalization,
    summary.status === "completed" ? "deferred_page_budget" : "deferred_active_to_grace_running",
  );
  const activeToGrace = {
    status: summary.status,
    candidateCount: counter(summary.candidateCount),
    processed: counter(summary.processed),
    conflicts: counter(summary.conflicts),
    pagesProcessed: counter(summary.pagesProcessed),
  } as const;
  const pagesLimit = counter(summary.pagesLimit);
  return {
    schemaVersion: 1,
    status: activeToGrace.status === "completed" && finalization.status === "completed" ? "completed" : "in_progress",
    activeToGrace,
    graceFinalization: finalization,
    pagesLimit,
    elapsedMs: counter(elapsedMs),
  };
}

export function isLifecycleRunPath(pathname: string): boolean {
  return pathname === RUN_PATH;
}

export async function handleLifecycleRunRequest(
  request: Request,
  env: Env,
  authorizeAdmin: LifecycleRunAdminAuthorizer,
  dependencies: {
    now?: () => number;
    run?: typeof runScheduledLicenseExpiry;
  } = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== RUN_PATH) return null;
  if (url.search || url.hash) return json({ error: "not_found" }, 404);
  const headers = new Headers();
  if (!cors(request, env, headers)) return json({ error: "forbidden_origin" }, 403);
  if (request.method === "OPTIONS") {
    headers.set("allow", ALLOWED_METHODS);
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") {
    headers.set("allow", ALLOWED_METHODS);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  if (env.AUTH_BACKEND?.trim() !== "better-auth") return json({ error: "auth_unavailable" }, 503, headers);
  const authorization = await authorizeAdmin(request, headers);
  if (authorization instanceof Response) return authorization;
  if (!(await noBody(request))) return json({ error: "invalid_request" }, 400, headers);

  const backend = env.LIFECYCLE_RUN_BACKEND?.trim();
  if (!backend) return json({ error: "lifecycle_run_unavailable" }, 503, headers);
  if (backend !== "d1") return json({ error: "lifecycle_run_unavailable" }, 500, headers);
  if (env.D1_TOPOLOGY?.trim() !== "split") return json({ error: "server_misconfigured" }, 500, headers);
  const database = selectD1Database(env, "business");
  if (!database) return json({ error: "server_misconfigured" }, 500, headers);

  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  if (!Number.isSafeInteger(startedAt) || startedAt < 0) return json({ error: "server_misconfigured" }, 500, headers);
  try {
    const summary = await (dependencies.run ?? runScheduledLicenseExpiry)({
      scheduledTime: startedAt,
      env: { ...env, LICENSE_EXPIRY_BACKEND: "d1" },
      database,
    });
    if (summary.status === "disabled") return json({ error: "lifecycle_run_unavailable" }, 503, headers);
    const finishedAt = now();
    if (!Number.isSafeInteger(finishedAt) || finishedAt < startedAt) fail("server_misconfigured", 500);
    return json(resultPayload(summary, finishedAt - startedAt), 200, headers);
  } catch (error) {
    const code = error instanceof ScheduledLicenseExpiryError && SAFE_ERROR_CODE.test(error.code)
      ? error.code
      : error instanceof LifecycleRunApiError
        ? error.code
        : "lifecycle_run_failed";
    return json({ error: code }, 503, headers);
  }
}
