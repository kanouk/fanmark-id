import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const SUBSCRIPTION_PATH = "/api/me/subscription";
const MAX_RESPONSE_BYTES = 16 * 1024;
const TIMEOUT_MS = 5_000;
const FIELDS = [
  "status", "product_id", "current_period_start", "current_period_end", "amount", "currency",
  "interval", "interval_count", "cancel_at_period_end", "payment_failure_at",
  "next_payment_attempt", "payment_failure_type",
] as const;

export interface SubscriptionRecord {
  status: string | null;
  product_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  amount: number | null;
  currency: string | null;
  interval: string | null;
  interval_count: number | null;
  cancel_at_period_end: boolean;
  payment_failure_at: string | null;
  next_payment_attempt: string | null;
  payment_failure_type: string | null;
}

export type SubscriptionApiErrorKind = "configuration" | "http" | "invalid_response" | "network" | "timeout";

export class SubscriptionApiError extends Error {
  readonly kind: SubscriptionApiErrorKind;
  readonly status?: number;

  constructor(kind: SubscriptionApiErrorKind, status?: number) {
    super(kind === "http" && status ? `subscription request failed (${status})` : `subscription request ${kind}`);
    this.name = "SubscriptionApiError";
    this.kind = kind;
    this.status = status;
  }
}

interface RequestOptions {
  baseUrl?: string;
  authBaseUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function getSubscriptionBackend(
  value: string | undefined = import.meta.env?.VITE_SUBSCRIPTION_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new SubscriptionApiError("configuration");
}

export function buildSubscriptionApiUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new SubscriptionApiError("configuration");
  }
  url.pathname = SUBSCRIPTION_PATH;
  url.search = "";
  url.hash = "";
  return url;
}

function assertAuthOrigin(baseUrl: string, authBaseUrl?: string): void {
  if (!authBaseUrl?.trim()) return;
  try {
    if (buildSubscriptionApiUrl(baseUrl).origin !== buildRecentFanmarksApiUrl(authBaseUrl.trim()).origin) {
      throw new SubscriptionApiError("configuration");
    }
  } catch {
    throw new SubscriptionApiError("configuration");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function nullableText(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= 256);
}

function nullableInteger(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value));
}

function parseSubscription(value: unknown): SubscriptionRecord | null {
  if (value === null) return null;
  if (!isRecord(value) || !exactKeys(value, FIELDS) ||
      !nullableText(value.status) || !nullableText(value.product_id) ||
      !nullableText(value.current_period_start) || !nullableText(value.current_period_end) ||
      !nullableInteger(value.amount) || !nullableText(value.currency) || !nullableText(value.interval) ||
      !nullableInteger(value.interval_count) || typeof value.cancel_at_period_end !== "boolean" ||
      !nullableText(value.payment_failure_at) || !nullableText(value.next_payment_attempt) ||
      !nullableText(value.payment_failure_type)) {
    throw new SubscriptionApiError("invalid_response");
  }
  return value as unknown as SubscriptionRecord;
}

async function readPayload(response: Response): Promise<SubscriptionRecord | null> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new SubscriptionApiError("invalid_response");
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new SubscriptionApiError("invalid_response");
  }
  let payload: unknown;
  try {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new SubscriptionApiError("invalid_response");
    payload = JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof SubscriptionApiError) throw error;
    throw new SubscriptionApiError("invalid_response");
  }
  if (!isRecord(payload) || !exactKeys(payload, ["schemaVersion", "subscription"]) || payload.schemaVersion !== 1) {
    throw new SubscriptionApiError("invalid_response");
  }
  return parseSubscription(payload.subscription);
}

export async function loadOwnSubscription(options: RequestOptions = {}): Promise<SubscriptionRecord | null> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl() ?? import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (!baseUrl) throw new SubscriptionApiError("configuration");
  const authBaseUrl = options.authBaseUrl ?? import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  assertAuthOrigin(baseUrl, authBaseUrl);
  const url = buildSubscriptionApiUrl(baseUrl);
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new SubscriptionApiError("configuration");
  const abortForCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortForCaller();
  else options.signal?.addEventListener("abort", abortForCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new SubscriptionApiError("http", response.status);
    return await readPayload(response);
  } catch (error) {
    if (error instanceof SubscriptionApiError) throw error;
    if (controller.signal.aborted) {
      throw new SubscriptionApiError(options.signal?.aborted ? "network" : "timeout");
    }
    throw new SubscriptionApiError("network");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortForCaller);
  }
}
