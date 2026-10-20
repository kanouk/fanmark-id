import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const RETURN_PATH = "/api/me/fanmarks/return";
const BULK_RETURN_PATH = "/api/me/fanmarks/bulk-return";
const MAX_RESPONSE_BYTES = 32 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export class FanmarkReturnApiError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network" | "timeout";
  readonly status?: number;

  constructor(kind: FanmarkReturnApiError["kind"], status?: number, code?: string) {
    super(kind === "http" && status
      ? `fanmark return request failed (${status}${code ? `: ${code}` : ""})`
      : `fanmark return request ${kind}`);
    this.name = "FanmarkReturnApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getFanmarkReturnBackend(
  value: string | undefined = import.meta.env?.VITE_FANMARK_RETURN_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new FanmarkReturnApiError("configuration");
}

export function buildFanmarkReturnApiUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new FanmarkReturnApiError("configuration");
  }
  url.pathname = RETURN_PATH;
  url.search = "";
  url.hash = "";
  return url;
}

export function buildFanmarkBulkReturnApiUrl(baseUrl: string): URL {
  const url = buildFanmarkReturnApiUrl(baseUrl);
  url.pathname = BULK_RETURN_PATH;
  return url;
}

function assertAuthOrigin(baseUrl: string, authBaseUrl?: string): void {
  if (!authBaseUrl?.trim()) return;
  try {
    if (buildFanmarkReturnApiUrl(baseUrl).origin !== buildRecentFanmarksApiUrl(authBaseUrl.trim()).origin) {
      throw new FanmarkReturnApiError("configuration");
    }
  } catch {
    throw new FanmarkReturnApiError("configuration");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function responseCode(response: Response): Promise<string | undefined> {
  if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return undefined;
  }
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel();
    throw new FanmarkReturnApiError("invalid_response");
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new FanmarkReturnApiError("invalid_response");
  }
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new FanmarkReturnApiError("invalid_response");
  try {
    const value = JSON.parse(text) as unknown;
    return isRecord(value) && typeof value.error === "string" && value.error.length <= 80 ? value.error : undefined;
  } catch {
    return undefined;
  }
}

export async function returnFanmarkThroughWorker(
  fanmarkId: string,
  options: {
    baseUrl?: string;
    authBaseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  if (!UUID.test(fanmarkId)) throw new FanmarkReturnApiError("configuration");
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (!baseUrl) throw new FanmarkReturnApiError("configuration");
  const url = buildFanmarkReturnApiUrl(baseUrl);
  const authBaseUrl = options.authBaseUrl ?? import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  assertAuthOrigin(baseUrl, authBaseUrl);
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new FanmarkReturnApiError("configuration");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ fanmark_id: fanmarkId.toLowerCase() }),
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      const code = await responseCode(response);
      throw new FanmarkReturnApiError("http", response.status, code);
    }
    if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      throw new FanmarkReturnApiError("invalid_response");
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new FanmarkReturnApiError("invalid_response");
    const payload = JSON.parse(text) as unknown;
    if (!isRecord(payload) || Object.keys(payload).length !== 1 || payload.success !== true) {
      throw new FanmarkReturnApiError("invalid_response");
    }
  } catch (error) {
    if (error instanceof FanmarkReturnApiError) throw error;
    if (controller.signal.aborted) throw new FanmarkReturnApiError("timeout");
    throw new FanmarkReturnApiError("network");
  } finally {
    clearTimeout(timer);
  }
}

export interface FanmarkBulkReturnResult {
  licenseId: string;
  fanmarkId: string;
  fanmark: string;
  fanmarkShortId: string;
  graceExpiresAt: string;
}

export interface FanmarkBulkReturnResponse {
  success: boolean;
  results: FanmarkBulkReturnResult[];
  failed?: Array<{ licenseId: string; error: string }>;
}

export async function bulkReturnFanmarksThroughWorker(
  licenseIds: string[],
  options: {
    baseUrl?: string;
    authBaseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<FanmarkBulkReturnResponse> {
  if (!Array.isArray(licenseIds) || licenseIds.length < 1 || licenseIds.length > 50 ||
      !licenseIds.every((id) => typeof id === "string" && UUID.test(id)) ||
      new Set(licenseIds.map((id) => id.toLowerCase())).size !== licenseIds.length) {
    throw new FanmarkReturnApiError("configuration");
  }
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (!baseUrl) throw new FanmarkReturnApiError("configuration");
  const url = buildFanmarkBulkReturnApiUrl(baseUrl);
  const authBaseUrl = options.authBaseUrl ?? import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  assertAuthOrigin(baseUrl, authBaseUrl);
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new FanmarkReturnApiError("configuration");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ license_ids: licenseIds.map((id) => id.toLowerCase()) }),
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      const code = await responseCode(response);
      throw new FanmarkReturnApiError("http", response.status, code);
    }
    if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      throw new FanmarkReturnApiError("invalid_response");
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new FanmarkReturnApiError("invalid_response");
    const payload = JSON.parse(text) as unknown;
    if (!isRecord(payload) || typeof payload.success !== "boolean" || !Array.isArray(payload.results) ||
        (payload.failed !== undefined && !Array.isArray(payload.failed))) {
      throw new FanmarkReturnApiError("invalid_response");
    }
    const results = payload.results as unknown[];
    if (!results.every((result) => isRecord(result) &&
        typeof result.licenseId === "string" && UUID.test(result.licenseId) &&
        typeof result.fanmarkId === "string" && UUID.test(result.fanmarkId) &&
        typeof result.fanmark === "string" && result.fanmark.length <= 256 &&
        typeof result.fanmarkShortId === "string" && result.fanmarkShortId.length <= 256 &&
        typeof result.graceExpiresAt === "string" && result.graceExpiresAt.length <= 64)) {
      throw new FanmarkReturnApiError("invalid_response");
    }
    const failed = (payload.failed ?? []) as unknown[];
    if (!failed.every((entry) => isRecord(entry) && typeof entry.licenseId === "string" &&
        UUID.test(entry.licenseId) && typeof entry.error === "string" && entry.error.length <= 80) ||
        results.length + failed.length !== licenseIds.length ||
        payload.success !== (failed.length === 0)) {
      throw new FanmarkReturnApiError("invalid_response");
    }
    return payload as unknown as FanmarkBulkReturnResponse;
  } catch (error) {
    if (error instanceof FanmarkReturnApiError) throw error;
    if (controller.signal.aborted) throw new FanmarkReturnApiError("timeout");
    throw new FanmarkReturnApiError("network");
  } finally {
    clearTimeout(timer);
  }
}
