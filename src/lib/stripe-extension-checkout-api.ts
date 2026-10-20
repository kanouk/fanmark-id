import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const CHECKOUT_PATH = "/api/billing/extension-checkout";
const MAX_RESPONSE_BYTES = 8 * 1024;
const TIMEOUT_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type StripeExtensionCheckoutBackend = "supabase" | "worker";
export type StripeExtensionCheckoutErrorKind = "configuration" | "http" | "invalid_response" | "network" | "timeout";

export class StripeExtensionCheckoutApiError extends Error {
  readonly kind: StripeExtensionCheckoutErrorKind;
  readonly status?: number;
  readonly code?: string;

  constructor(kind: StripeExtensionCheckoutErrorKind, status?: number, code?: string) {
    super(kind === "http" && status
      ? `extension checkout request failed (${status}${code ? `: ${code}` : ""})`
      : `extension checkout request ${kind}`);
    this.name = "StripeExtensionCheckoutApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export function getStripeExtensionCheckoutBackend(
  value: string | undefined = import.meta.env?.VITE_STRIPE_EXTENSION_CHECKOUT_BACKEND,
): StripeExtensionCheckoutBackend {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new StripeExtensionCheckoutApiError("configuration");
}

export function buildStripeExtensionCheckoutUrl(baseUrl: string): URL {
  let endpoint: URL;
  try {
    endpoint = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new StripeExtensionCheckoutApiError("configuration");
  }
  endpoint.pathname = CHECKOUT_PATH;
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function createStripeExtensionCheckoutThroughWorker(
  input: { licenseId: string; months: number; requestId: string },
  options: {
    baseUrl?: string;
    authBaseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<{ url: string }> {
  if (!UUID.test(input.licenseId) || !UUID.test(input.requestId) ||
      !Number.isSafeInteger(input.months) || input.months < 1 || input.months > 12) {
    throw new StripeExtensionCheckoutApiError("configuration");
  }
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  const authBaseUrl = options.authBaseUrl ?? import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (!baseUrl || !authBaseUrl) throw new StripeExtensionCheckoutApiError("configuration");

  let endpoint: URL;
  try {
    endpoint = buildStripeExtensionCheckoutUrl(baseUrl);
    if (endpoint.origin !== buildRecentFanmarksApiUrl(authBaseUrl).origin) {
      throw new StripeExtensionCheckoutApiError("configuration");
    }
  } catch {
    throw new StripeExtensionCheckoutApiError("configuration");
  }

  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new StripeExtensionCheckoutApiError("configuration");
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
      body: JSON.stringify({
        license_id: input.licenseId.toLowerCase(),
        months: input.months,
        request_id: input.requestId.toLowerCase(),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof StripeExtensionCheckoutApiError) throw error;
    if (controller.signal.aborted) throw new StripeExtensionCheckoutApiError("timeout");
    throw new StripeExtensionCheckoutApiError("network");
  } finally {
    clearTimeout(timer);
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new StripeExtensionCheckoutApiError("invalid_response");
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new StripeExtensionCheckoutApiError("invalid_response");
  }
  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch {
    throw new StripeExtensionCheckoutApiError("invalid_response");
  }
  if (new TextEncoder().encode(bodyText).byteLength > MAX_RESPONSE_BYTES) {
    throw new StripeExtensionCheckoutApiError("invalid_response");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(bodyText) as unknown;
  } catch {
    throw new StripeExtensionCheckoutApiError("invalid_response");
  }
  if (!response.ok) {
    const code = isRecord(payload) && typeof payload.error === "string" && payload.error.length <= 128
      ? payload.error
      : undefined;
    throw new StripeExtensionCheckoutApiError("http", response.status, code);
  }
  if (!isRecord(payload) || Object.keys(payload).length !== 1 ||
      typeof payload.url !== "string" || payload.url.length > 4096) {
    throw new StripeExtensionCheckoutApiError("invalid_response");
  }
  try {
    const url = new URL(payload.url);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new StripeExtensionCheckoutApiError("invalid_response");
    }
  } catch {
    throw new StripeExtensionCheckoutApiError("invalid_response");
  }
  return { url: payload.url };
}


export type StripeExtensionApplicationStatus =
  | { status: "pending" | "failed"; fanmark_id: string }
  | { status: "applied"; fanmark_id: string; license_end: string };

interface ExtensionStatusOptions {
  baseUrl?: string;
  authBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function fetchStripeExtensionApplicationStatus(
  requestId: string,
  options: ExtensionStatusOptions = {},
): Promise<StripeExtensionApplicationStatus> {
  if (!UUID.test(requestId)) throw new StripeExtensionCheckoutApiError("configuration");
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  const authBaseUrl = options.authBaseUrl ?? import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (!baseUrl || !authBaseUrl) throw new StripeExtensionCheckoutApiError("configuration");
  const endpoint = buildStripeExtensionCheckoutUrl(baseUrl);
  if (endpoint.origin !== buildRecentFanmarksApiUrl(authBaseUrl).origin) {
    throw new StripeExtensionCheckoutApiError("configuration");
  }
  endpoint.pathname += "/status";
  endpoint.searchParams.set("request_id", requestId.toLowerCase());
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new StripeExtensionCheckoutApiError("configuration");
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.throwIfAborted();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "GET", credentials: "include", cache: "no-store", signal: controller.signal,
    });
    if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      throw new StripeExtensionCheckoutApiError("invalid_response");
    }
    const declared = Number(response.headers.get("content-length"));
    if (declared > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new StripeExtensionCheckoutApiError("invalid_response");
    }
    const body = await response.text();
    if (new TextEncoder().encode(body).length > MAX_RESPONSE_BYTES) {
      throw new StripeExtensionCheckoutApiError("invalid_response");
    }
    let value: unknown;
    try { value = JSON.parse(body); } catch { throw new StripeExtensionCheckoutApiError("invalid_response"); }
    if (!response.ok) {
      throw new StripeExtensionCheckoutApiError("http", response.status,
        isRecord(value) && typeof value.error === "string" ? value.error.slice(0, 128) : undefined);
    }
    if (!isRecord(value) || !["pending", "applied", "failed"].includes(String(value.status)) ||
        typeof value.fanmark_id !== "string" || !UUID.test(value.fanmark_id) ||
        Object.keys(value).sort().join(",") !== (value.status === "applied" ? "fanmark_id,license_end,status" : "fanmark_id,status") ||
        (value.status === "applied" && (typeof value.license_end !== "string" || !Number.isFinite(Date.parse(value.license_end))))) {
      throw new StripeExtensionCheckoutApiError("invalid_response");
    }
    return value as StripeExtensionApplicationStatus;
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof StripeExtensionCheckoutApiError) throw error;
    throw new StripeExtensionCheckoutApiError(controller.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export async function waitForStripeExtensionApplication(
  requestId: string,
  fanmarkId: string,
  options: ExtensionStatusOptions & { intervalMs?: number; maxWaitMs?: number } = {},
): Promise<StripeExtensionApplicationStatus> {
  const intervalMs = options.intervalMs ?? 2000;
  const maxWaitMs = options.maxWaitMs ?? 120_000;
  if (!UUID.test(fanmarkId) || !Number.isSafeInteger(intervalMs) || intervalMs < 1 ||
      !Number.isSafeInteger(maxWaitMs) || maxWaitMs < 1) {
    throw new StripeExtensionCheckoutApiError("configuration");
  }
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    options.signal?.throwIfAborted();
    const result = await fetchStripeExtensionApplicationStatus(requestId, {
      ...options, timeoutMs: Math.min(options.timeoutMs ?? TIMEOUT_MS, Math.max(1, deadline - Date.now())),
    });
    if (result.fanmark_id !== fanmarkId) throw new StripeExtensionCheckoutApiError("invalid_response");
    if (result.status !== "pending") return result;
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(options.signal?.reason); };
      const timer = setTimeout(() => { options.signal?.removeEventListener("abort", abort); resolve(); },
        Math.min(intervalMs, Math.max(1, deadline - Date.now())));
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
    });
  }
  throw new StripeExtensionCheckoutApiError("timeout");
}
