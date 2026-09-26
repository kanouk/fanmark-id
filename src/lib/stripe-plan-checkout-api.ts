import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const PLAN_CHECKOUT_PATH = "/api/billing/plan-checkout";
const MAX_RESPONSE_BYTES = 8 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type StripePlanCheckoutBackend = "supabase" | "worker";
export type StripePlanCheckoutPlan = "creator" | "max" | "business";
export type StripePlanCheckoutApiErrorKind = "configuration" | "http" | "invalid_response" | "network" | "timeout";

export class StripePlanCheckoutApiError extends Error {
  readonly kind: StripePlanCheckoutApiErrorKind;
  readonly status?: number;
  readonly code?: string;

  constructor(kind: StripePlanCheckoutApiErrorKind, status?: number, code?: string) {
    super(kind === "http" && status
      ? `plan checkout request failed (${status}${code ? `: ${code}` : ""})`
      : `plan checkout request ${kind}`);
    this.name = "StripePlanCheckoutApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export function getStripePlanCheckoutBackend(
  value: string | undefined = import.meta.env?.VITE_STRIPE_PLAN_CHECKOUT_BACKEND,
): StripePlanCheckoutBackend {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new StripePlanCheckoutApiError("configuration");
}

export function buildStripePlanCheckoutUrl(baseUrl: string): URL {
  let endpoint: URL;
  try {
    endpoint = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new StripePlanCheckoutApiError("configuration");
  }
  endpoint.pathname = PLAN_CHECKOUT_PATH;
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}

function defaultStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function getStripePlanCheckoutRequestId(
  planType: StripePlanCheckoutPlan,
  storage: Pick<Storage, "getItem" | "setItem"> | null = defaultStorage(),
): string {
  const key = `fanmark.plan-checkout.request.${planType}`;
  try {
    const existing = storage?.getItem(key);
    if (existing && UUID.test(existing)) return existing.toLowerCase();
  } catch {
    // Use a fresh key when browser storage is unavailable.
  }
  const requestId = globalThis.crypto.randomUUID().toLowerCase();
  try {
    storage?.setItem(key, requestId);
  } catch {
    // Stripe idempotency still protects retries performed during this page session.
  }
  return requestId;
}

export function clearStripePlanCheckoutRequestIds(storage: Pick<Storage, "removeItem"> | null = defaultStorage()): void {
  for (const planType of ["creator", "max", "business"] as const) {
    try {
      storage?.removeItem(`fanmark.plan-checkout.request.${planType}`);
    } catch {
      // Continue clearing independent plan keys when one storage operation fails.
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function createStripePlanCheckoutThroughWorker(
  input: { planType: StripePlanCheckoutPlan; requestId: string },
  options: {
    baseUrl?: string;
    authBaseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<{ url: string }> {
  if (!["creator", "max", "business"].includes(input.planType) || !UUID.test(input.requestId)) {
    throw new StripePlanCheckoutApiError("configuration");
  }
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  const authBaseUrl = options.authBaseUrl ?? import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (!baseUrl || !authBaseUrl) throw new StripePlanCheckoutApiError("configuration");

  let endpoint: URL;
  try {
    endpoint = buildStripePlanCheckoutUrl(baseUrl);
    if (endpoint.origin !== buildRecentFanmarksApiUrl(authBaseUrl).origin) {
      throw new StripePlanCheckoutApiError("configuration");
    }
  } catch {
    throw new StripePlanCheckoutApiError("configuration");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new StripePlanCheckoutApiError("configuration");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan_type: input.planType, request_id: input.requestId.toLowerCase() }),
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) throw new StripePlanCheckoutApiError("timeout");
    throw new StripePlanCheckoutApiError("network");
  } finally {
    clearTimeout(timer);
  }

  if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    await response.body?.cancel();
    throw new StripePlanCheckoutApiError("invalid_response");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new StripePlanCheckoutApiError("invalid_response");
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new StripePlanCheckoutApiError("invalid_response");
  }
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new StripePlanCheckoutApiError("invalid_response");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new StripePlanCheckoutApiError("invalid_response");
  }
  if (!response.ok) {
    const code = isRecord(payload) && typeof payload.error === "string" && payload.error.length <= 128
      ? payload.error
      : undefined;
    throw new StripePlanCheckoutApiError("http", response.status, code);
  }
  if (!isRecord(payload) || Object.keys(payload).length !== 1 || typeof payload.url !== "string" ||
      payload.url.length === 0 || payload.url.length > 4096) {
    throw new StripePlanCheckoutApiError("invalid_response");
  }
  try {
    const url = new URL(payload.url);
    if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.username || url.password) {
      throw new StripePlanCheckoutApiError("invalid_response");
    }
  } catch {
    throw new StripePlanCheckoutApiError("invalid_response");
  }
  return { url: payload.url };
}
