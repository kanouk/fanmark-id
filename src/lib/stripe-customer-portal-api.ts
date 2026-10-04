import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const PORTAL_PATH = "/api/billing/customer-portal";
const MAX_RESPONSE_BYTES = 8 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export type StripeCustomerPortalBackend = "supabase" | "worker";
export type StripeCustomerPortalApiErrorKind = "configuration" | "http" | "invalid_response" | "network" | "timeout";

export class StripeCustomerPortalApiError extends Error {
  readonly kind: StripeCustomerPortalApiErrorKind;
  readonly status?: number;
  readonly code?: string;

  constructor(kind: StripeCustomerPortalApiErrorKind, status?: number, code?: string) {
    super(kind === "http" && status
      ? `customer portal request failed (${status}${code ? `: ${code}` : ""})`
      : `customer portal request ${kind}`);
    this.name = "StripeCustomerPortalApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export function getStripeCustomerPortalBackend(
  value: string | undefined = import.meta.env?.VITE_STRIPE_CUSTOMER_PORTAL_BACKEND,
): StripeCustomerPortalBackend {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new StripeCustomerPortalApiError("configuration");
}

export function buildStripeCustomerPortalUrl(baseUrl: string): URL {
  let endpoint: URL;
  try {
    endpoint = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new StripeCustomerPortalApiError("configuration");
  }
  endpoint.pathname = PORTAL_PATH;
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}

export async function createStripeCustomerPortalThroughWorker(options: {
  baseUrl?: string;
  authBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): Promise<{ url: string }> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  const authBaseUrl = options.authBaseUrl ?? import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (!baseUrl || !authBaseUrl) throw new StripeCustomerPortalApiError("configuration");

  let endpoint: URL;
  try {
    endpoint = buildStripeCustomerPortalUrl(baseUrl);
    if (endpoint.origin !== buildRecentFanmarksApiUrl(authBaseUrl).origin) {
      throw new StripeCustomerPortalApiError("configuration");
    }
  } catch {
    throw new StripeCustomerPortalApiError("configuration");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new StripeCustomerPortalApiError("configuration");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) throw new StripeCustomerPortalApiError("timeout");
    throw new StripeCustomerPortalApiError("network");
  } finally {
    clearTimeout(timer);
  }

  if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    await response.body?.cancel();
    throw new StripeCustomerPortalApiError("invalid_response");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new StripeCustomerPortalApiError("invalid_response");
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new StripeCustomerPortalApiError("invalid_response");
  }
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new StripeCustomerPortalApiError("invalid_response");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new StripeCustomerPortalApiError("invalid_response");
  }
  if (!response.ok) {
    const code = typeof payload === "object" && payload !== null && !Array.isArray(payload) &&
      typeof (payload as Record<string, unknown>).error === "string" &&
      ((payload as Record<string, unknown>).error as string).length <= 128
      ? (payload as Record<string, string>).error
      : undefined;
    throw new StripeCustomerPortalApiError("http", response.status, code);
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload) ||
      Object.keys(payload).length !== 1 || typeof (payload as Record<string, unknown>).url !== "string") {
    throw new StripeCustomerPortalApiError("invalid_response");
  }
  const url = (payload as Record<string, string>).url;
  if (url.length === 0 || url.length > 4096) throw new StripeCustomerPortalApiError("invalid_response");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new StripeCustomerPortalApiError("invalid_response");
    }
  } catch {
    throw new StripeCustomerPortalApiError("invalid_response");
  }
  return { url };
}
