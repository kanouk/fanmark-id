import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const APPLY_PATH = "/api/me/licenses/extend-with-coupon";
const MAX_RESPONSE_BYTES = 8 * 1024;
const TIMEOUT_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COUPON_CODE = /^[A-Z0-9][A-Z0-9_-]{2,63}$/u;
const ALLOWED_MONTHS = new Set([1, 2, 3, 6]);

export type ExtensionCouponBackend = "supabase" | "worker";
export type ExtensionCouponApiErrorKind = "configuration" | "http" | "invalid_response" | "network" | "storage" | "timeout";

export class ExtensionCouponApiError extends Error {
  readonly kind: ExtensionCouponApiErrorKind;
  readonly status?: number;
  readonly code?: string;

  constructor(kind: ExtensionCouponApiErrorKind, status?: number, code?: string) {
    super(kind === "http" && status ? code ?? `extension coupon request failed (${status})` : `extension coupon request ${kind}`);
    this.name = "ExtensionCouponApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export interface ExtensionCouponResult {
  success: true;
  license: {
    id: string;
    license_end: string;
    grace_expires_at: null;
    status: "active";
  };
  months: number;
  tier_level: number;
  cancelled_lottery_entries: number;
}

export interface ExtensionCouponRequestStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function getExtensionCouponBackend(
  value: string | undefined = import.meta.env?.VITE_EXTENSION_COUPON_BACKEND,
): ExtensionCouponBackend {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new ExtensionCouponApiError("configuration");
}

export function buildExtensionCouponApplyUrl(baseUrl: string): URL {
  let endpoint: URL;
  try {
    endpoint = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new ExtensionCouponApiError("configuration");
  }
  endpoint.pathname = APPLY_PATH;
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function couponRequestKey(licenseId: string, couponCode: string): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) throw new ExtensionCouponApiError("configuration");
  const input = new TextEncoder().encode(`${licenseId.toLowerCase()}:${couponCode.trim().toUpperCase()}`);
  const digest = new Uint8Array(await cryptoApi.subtle.digest("SHA-256", input));
  const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `fanmark.extension-coupon-request:${hash}`;
}

export async function getOrCreateExtensionCouponRequestId(
  licenseId: string,
  couponCode: string,
  options: {
    storage?: ExtensionCouponRequestStorage;
    createId?: () => string;
  } = {},
): Promise<string> {
  const normalizedCode = couponCode.trim().toUpperCase();
  if (!UUID.test(licenseId) || !COUPON_CODE.test(normalizedCode)) {
    throw new ExtensionCouponApiError("configuration");
  }
  const storage = options.storage ?? (typeof window === "undefined" ? undefined : window.sessionStorage);
  if (!storage) throw new ExtensionCouponApiError("storage");
  const key = await couponRequestKey(licenseId, normalizedCode);
  try {
    const previous = storage.getItem(key);
    if (previous && UUID.test(previous)) return previous.toLowerCase();
    const requestId = (options.createId?.() ?? globalThis.crypto.randomUUID()).toLowerCase();
    if (!UUID.test(requestId)) throw new ExtensionCouponApiError("configuration");
    storage.setItem(key, requestId);
    return requestId;
  } catch (error) {
    if (error instanceof ExtensionCouponApiError) throw error;
    throw new ExtensionCouponApiError("storage");
  }
}

export async function clearExtensionCouponRequestId(
  licenseId: string,
  couponCode: string,
  storage: ExtensionCouponRequestStorage = window.sessionStorage,
): Promise<void> {
  const key = await couponRequestKey(licenseId, couponCode);
  try {
    storage.removeItem(key);
  } catch {
    throw new ExtensionCouponApiError("storage");
  }
}

function parseSuccess(value: unknown, requestedLicenseId: string): ExtensionCouponResult | null {
  if (!isRecord(value) || Object.keys(value).length !== 5 || value.success !== true ||
      !isRecord(value.license) || Object.keys(value.license).length !== 4) return null;
  const license = value.license;
  if (typeof license.id !== "string" || license.id.toLowerCase() !== requestedLicenseId.toLowerCase() ||
      typeof license.license_end !== "string" || !Number.isFinite(Date.parse(license.license_end)) ||
      license.grace_expires_at !== null || license.status !== "active" ||
      !Number.isSafeInteger(value.months) || !ALLOWED_MONTHS.has(value.months as number) ||
      !Number.isSafeInteger(value.tier_level) || (value.tier_level as number) < 1 ||
      !Number.isSafeInteger(value.cancelled_lottery_entries) || (value.cancelled_lottery_entries as number) < 0) {
    return null;
  }
  return value as unknown as ExtensionCouponResult;
}

export async function applyExtensionCouponThroughWorker(
  input: { licenseId: string; couponCode: string; requestId: string },
  options: {
    baseUrl?: string;
    authBaseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<ExtensionCouponResult> {
  const couponCode = input.couponCode.trim().toUpperCase();
  if (!UUID.test(input.licenseId) || !UUID.test(input.requestId) || !COUPON_CODE.test(couponCode)) {
    throw new ExtensionCouponApiError("configuration");
  }
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  const authBaseUrl = options.authBaseUrl ?? import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (!baseUrl || !authBaseUrl) throw new ExtensionCouponApiError("configuration");

  let endpoint: URL;
  try {
    endpoint = buildExtensionCouponApplyUrl(baseUrl);
    if (endpoint.origin !== buildRecentFanmarksApiUrl(authBaseUrl).origin) {
      throw new ExtensionCouponApiError("configuration");
    }
  } catch {
    throw new ExtensionCouponApiError("configuration");
  }

  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new ExtensionCouponApiError("configuration");
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
        coupon_code: couponCode,
        request_id: input.requestId.toLowerCase(),
      }),
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) throw new ExtensionCouponApiError("timeout");
    throw new ExtensionCouponApiError("network");
  } finally {
    clearTimeout(timer);
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new ExtensionCouponApiError("invalid_response");
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new ExtensionCouponApiError("invalid_response");
  }
  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch {
    throw new ExtensionCouponApiError("invalid_response");
  }
  if (new TextEncoder().encode(bodyText).byteLength > MAX_RESPONSE_BYTES) {
    throw new ExtensionCouponApiError("invalid_response");
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyText) as unknown;
  } catch {
    throw new ExtensionCouponApiError("invalid_response");
  }
  if (!response.ok) {
    const code = isRecord(body) && typeof body.error === "string" && /^[a-z0-9_]{1,64}$/u.test(body.error)
      ? body.error
      : undefined;
    throw new ExtensionCouponApiError("http", response.status, code);
  }
  const result = parseSuccess(body, input.licenseId);
  if (!result) throw new ExtensionCouponApiError("invalid_response");
  return result;
}
