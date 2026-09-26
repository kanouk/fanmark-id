import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const API_PATH = "/api/admin/extension-coupons";
const MAX_RESPONSE_BYTES = 128 * 1024;
const TIMEOUT_MS = 8_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CODE = /^[A-Z0-9][A-Z0-9_-]{2,63}$/u;
const MONTHS = new Set([1, 2, 3, 6]);

export interface ExtensionCouponAdminRecord {
  id: string;
  code: string;
  months: number;
  allowed_tier_levels: number[] | null;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExtensionCouponUsageAdminRecord {
  id: string;
  coupon_id: string;
  user_id: string;
  fanmark_id: string;
  license_id: string;
  used_at: string;
  fanmark_emoji: string;
  user_display_name: string;
}

export type ExtensionCouponAdminBackend = "supabase" | "worker";

export class ExtensionCouponAdminClientError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network" | "timeout";
  readonly status?: number;
  readonly code?: string;

  constructor(kind: ExtensionCouponAdminClientError["kind"], status?: number, code?: string) {
    super(kind === "http" && status ? code ?? `extension coupon admin request failed (${status})` : `extension coupon admin request ${kind}`);
    this.name = "ExtensionCouponAdminClientError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export function getExtensionCouponAdminBackend(
  value: string | undefined = import.meta.env?.VITE_EXTENSION_COUPON_ADMIN_BACKEND,
): ExtensionCouponAdminBackend {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new ExtensionCouponAdminClientError("configuration");
}

function buildUrl(baseUrl: string, suffix = ""): URL {
  let endpoint: URL;
  try { endpoint = buildRecentFanmarksApiUrl(baseUrl); }
  catch { throw new ExtensionCouponAdminClientError("configuration"); }
  endpoint.pathname = `${API_PATH}${suffix}`;
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCoupon(value: unknown): ExtensionCouponAdminRecord | null {
  if (!isRecord(value) || Object.keys(value).length !== 11 ||
      typeof value.id !== "string" || !UUID.test(value.id) || typeof value.code !== "string" || !CODE.test(value.code) ||
      !Number.isSafeInteger(value.months) || !MONTHS.has(value.months as number) ||
      !Number.isSafeInteger(value.max_uses) || (value.max_uses as number) < 1 ||
      !Number.isSafeInteger(value.used_count) || (value.used_count as number) < 0 || (value.used_count as number) > (value.max_uses as number) ||
      !(value.allowed_tier_levels === null || (Array.isArray(value.allowed_tier_levels) && value.allowed_tier_levels.every((tier) => Number.isSafeInteger(tier) && tier > 0))) ||
      !(value.expires_at === null || (typeof value.expires_at === "string" && Number.isFinite(Date.parse(value.expires_at)))) ||
      typeof value.is_active !== "boolean" || !(value.created_by === null || typeof value.created_by === "string") ||
      typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at)) ||
      typeof value.updated_at !== "string" || !Number.isFinite(Date.parse(value.updated_at))) return null;
  return value as unknown as ExtensionCouponAdminRecord;
}

function parseUsage(value: unknown, expectedCouponId: string): ExtensionCouponUsageAdminRecord | null {
  if (!isRecord(value) || Object.keys(value).length !== 8 ||
      typeof value.id !== "string" || !UUID.test(value.id) || value.coupon_id !== expectedCouponId ||
      typeof value.user_id !== "string" || !UUID.test(value.user_id) ||
      typeof value.fanmark_id !== "string" || !UUID.test(value.fanmark_id) ||
      typeof value.license_id !== "string" || !UUID.test(value.license_id) ||
      typeof value.used_at !== "string" || !Number.isFinite(Date.parse(value.used_at)) ||
      typeof value.fanmark_emoji !== "string" || typeof value.user_display_name !== "string") return null;
  return value as unknown as ExtensionCouponUsageAdminRecord;
}

async function send<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  suffix: string,
  options: {
    body?: unknown;
    baseUrl?: string;
    authBaseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    parse(value: unknown): T | null;
  },
): Promise<T> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  const authBaseUrl = options.authBaseUrl ?? import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (!baseUrl || !authBaseUrl) throw new ExtensionCouponAdminClientError("configuration");
  const endpoint = buildUrl(baseUrl, suffix);
  let authOrigin: string;
  try { authOrigin = buildRecentFanmarksApiUrl(authBaseUrl).origin; }
  catch { throw new ExtensionCouponAdminClientError("configuration"); }
  if (endpoint.origin !== authOrigin) throw new ExtensionCouponAdminClientError("configuration");
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new ExtensionCouponAdminClientError("configuration");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(endpoint, {
      method,
      credentials: "include",
      cache: "no-store",
      ...(options.body === undefined ? {} : {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(options.body),
      }),
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) throw new ExtensionCouponAdminClientError("timeout");
    throw new ExtensionCouponAdminClientError("network");
  } finally { clearTimeout(timer); }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new ExtensionCouponAdminClientError("invalid_response");
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/u.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new ExtensionCouponAdminClientError("invalid_response");
  }
  let text: string;
  try { text = await response.text(); }
  catch { throw new ExtensionCouponAdminClientError("invalid_response"); }
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new ExtensionCouponAdminClientError("invalid_response");
  let body: unknown;
  try { body = JSON.parse(text) as unknown; }
  catch { throw new ExtensionCouponAdminClientError("invalid_response"); }
  if (!response.ok) {
    const code = isRecord(body) && typeof body.error === "string" && /^[a-z0-9_]{1,64}$/u.test(body.error)
      ? body.error : undefined;
    throw new ExtensionCouponAdminClientError("http", response.status, code);
  }
  const parsed = options.parse(body);
  if (!parsed) throw new ExtensionCouponAdminClientError("invalid_response");
  return parsed;
}

export async function listExtensionCouponsThroughWorker(options: {
  baseUrl?: string; authBaseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number;
} = {}): Promise<ExtensionCouponAdminRecord[]> {
  return await send("GET", "", { ...options, parse(value) {
    if (!isRecord(value) || Object.keys(value).length !== 2 || value.schemaVersion !== 1 ||
        !Array.isArray(value.coupons) || value.coupons.length > 500) return null;
    const rows = value.coupons.map(parseCoupon);
    return rows.every((row) => row !== null) ? rows as ExtensionCouponAdminRecord[] : null;
  } });
}

export async function createExtensionCouponThroughWorker(input: {
  code: string | null; months: number; allowedTierLevels: number[] | null; maxUses: number; expiresAt: string | null;
}, options: {
  baseUrl?: string; authBaseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number;
} = {}): Promise<ExtensionCouponAdminRecord> {
  return await send("POST", "", { ...options, body: {
    code: input.code,
    months: input.months,
    allowed_tier_levels: input.allowedTierLevels,
    max_uses: input.maxUses,
    expires_at: input.expiresAt,
  }, parse(value) {
    if (!isRecord(value) || Object.keys(value).length !== 2 || value.schemaVersion !== 1) return null;
    return parseCoupon(value.coupon);
  } });
}

export async function updateExtensionCouponThroughWorker(
  id: string,
  input: { isActive: boolean; expectedUpdatedAt: string },
  options: { baseUrl?: string; authBaseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ExtensionCouponAdminRecord> {
  if (!UUID.test(id)) throw new ExtensionCouponAdminClientError("configuration");
  return await send("PATCH", `/${id.toLowerCase()}`, { ...options, body: {
    is_active: input.isActive,
    expected_updated_at: input.expectedUpdatedAt,
  }, parse(value) {
    if (!isRecord(value) || Object.keys(value).length !== 2 || value.schemaVersion !== 1) return null;
    return parseCoupon(value.coupon);
  } });
}

export async function deleteExtensionCouponThroughWorker(
  id: string,
  options: { baseUrl?: string; authBaseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<void> {
  if (!UUID.test(id)) throw new ExtensionCouponAdminClientError("configuration");
  await send("DELETE", `/${id.toLowerCase()}`, { ...options, parse(value) {
    return isRecord(value) && Object.keys(value).length === 2 && value.schemaVersion === 1 && value.deleted === true ? true : null;
  } });
}

export async function listExtensionCouponUsagesThroughWorker(
  id: string,
  options: { baseUrl?: string; authBaseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ExtensionCouponUsageAdminRecord[]> {
  if (!UUID.test(id)) throw new ExtensionCouponAdminClientError("configuration");
  const couponId = id.toLowerCase();
  return await send("GET", `/${couponId}/usages`, { ...options, parse(value) {
    if (!isRecord(value) || Object.keys(value).length !== 2 || value.schemaVersion !== 1 ||
        !Array.isArray(value.usages) || value.usages.length > 1000) return null;
    const rows = value.usages.map((row) => parseUsage(row, couponId));
    return rows.every((row) => row !== null) ? rows as ExtensionCouponUsageAdminRecord[] : null;
  } });
}
