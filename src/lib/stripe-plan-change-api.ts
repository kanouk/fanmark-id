import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const PLAN_CHANGE_PATH = "/api/billing/plan-change";
const MAX_RESPONSE_BYTES = 8 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PLAN_TYPES = ["free", "creator", "max", "business"] as const;

export type StripePlanChangePlan = typeof PLAN_TYPES[number];
export type StripePlanChangeBackend = "supabase" | "worker";

export class StripePlanChangeApiError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network" | "timeout";
  readonly status?: number;
  readonly code?: string;

  constructor(kind: StripePlanChangeApiError["kind"], status?: number, code?: string) {
    super(kind === "http" && status
      ? `plan change request failed (${status}${code ? `: ${code}` : ""})`
      : `plan change request ${kind}`);
    this.name = "StripePlanChangeApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export function getStripePlanChangeBackend(
  value: string | undefined = import.meta.env?.VITE_STRIPE_PLAN_CHANGE_BACKEND,
): StripePlanChangeBackend {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new StripePlanChangeApiError("configuration");
}

export function buildStripePlanChangeUrl(baseUrl: string): URL {
  let endpoint: URL;
  try { endpoint = buildRecentFanmarksApiUrl(baseUrl); }
  catch { throw new StripePlanChangeApiError("configuration"); }
  endpoint.pathname = PLAN_CHANGE_PATH;
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}

function defaultStorage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; }
  catch { return null; }
}

export function getStripePlanChangeRequestId(
  planType: StripePlanChangePlan,
  storage: Pick<Storage, "getItem" | "setItem"> | null = defaultStorage(),
): string {
  const key = `fanmark.plan-change.request.${planType}`;
  try {
    const existing = storage?.getItem(key);
    if (existing && UUID.test(existing)) return existing.toLowerCase();
  } catch { /* Create an in-memory retry key when session storage is unavailable. */ }
  const requestId = globalThis.crypto.randomUUID().toLowerCase();
  try { storage?.setItem(key, requestId); }
  catch { /* The server command still protects retry attempts that keep this page alive. */ }
  return requestId;
}

export function clearStripePlanChangeRequestId(
  planType: StripePlanChangePlan,
  storage: Pick<Storage, "removeItem"> | null = defaultStorage(),
): void {
  try { storage?.removeItem(`fanmark.plan-change.request.${planType}`); }
  catch { /* Continue without browser storage. */ }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function changeStripePlanThroughWorker(
  input: { planType: StripePlanChangePlan; requestId: string },
  options: { baseUrl?: string; authBaseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ updated: boolean; pending: boolean; requiresAction: boolean }> {
  if (!PLAN_TYPES.includes(input.planType) || !UUID.test(input.requestId)) throw new StripePlanChangeApiError("configuration");
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  const authBaseUrl = options.authBaseUrl ?? import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (!baseUrl || !authBaseUrl) throw new StripePlanChangeApiError("configuration");
  let endpoint: URL;
  try {
    endpoint = buildStripePlanChangeUrl(baseUrl);
    if (endpoint.origin !== buildRecentFanmarksApiUrl(authBaseUrl).origin) throw new StripePlanChangeApiError("configuration");
  } catch { throw new StripePlanChangeApiError("configuration"); }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new StripePlanChangeApiError("configuration");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ new_plan_type: input.planType, request_id: input.requestId.toLowerCase() }),
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) throw new StripePlanChangeApiError("timeout");
    throw new StripePlanChangeApiError("network");
  } finally { clearTimeout(timer); }

  if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    await response.body?.cancel();
    throw new StripePlanChangeApiError("invalid_response");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new StripePlanChangeApiError("invalid_response");
  }
  let text: string;
  try { text = await response.text(); }
  catch { throw new StripePlanChangeApiError("invalid_response"); }
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new StripePlanChangeApiError("invalid_response");
  let payload: unknown;
  try { payload = JSON.parse(text) as unknown; }
  catch { throw new StripePlanChangeApiError("invalid_response"); }
  if (!response.ok) {
    const code = isRecord(payload) && typeof payload.error === "string" && payload.error.length <= 128
      ? payload.error
      : undefined;
    throw new StripePlanChangeApiError("http", response.status, code);
  }
  if (!isRecord(payload) || payload.success !== true || typeof payload.updated !== "boolean" ||
      payload.pending !== true || (payload.requires_action !== undefined && typeof payload.requires_action !== "boolean") ||
      Object.keys(payload).some((key) => !["success", "updated", "pending", "requires_action"].includes(key))) {
    throw new StripePlanChangeApiError("invalid_response");
  }
  return { updated: payload.updated, pending: payload.pending, requiresAction: payload.requires_action === true };
}
