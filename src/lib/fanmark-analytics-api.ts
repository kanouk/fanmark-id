import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface AnalyticsFanmark {
  id: string;
  short_id: string;
  user_input_fanmark: string;
  display_fanmark: string;
  fanmark_name: string | null;
}

export interface FanmarkAnalyticsMetrics {
  accessCount: number;
  uniqueVisitors: number;
  referrerDirect: number;
  referrerSearch: number;
  referrerSocial: number;
  referrerOther: number;
  deviceMobile: number;
  deviceTablet: number;
  deviceDesktop: number;
  accessTypeProfile: number;
  accessTypeRedirect: number;
  accessTypeText: number;
  accessTypeInactive: number;
}

export interface FanmarkAnalyticsResult {
  fanmarks: AnalyticsFanmark[];
  summary: FanmarkAnalyticsMetrics;
  dailyStats: Array<{ stat_date: string; access_count: number; unique_visitors: number }>;
  fanmarkTotals: Array<{ fanmark_id: string; access_count: number }>;
}

export type FanmarkAnalyticsBackend = "supabase" | "worker";

export class FanmarkAnalyticsApiError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network";
  readonly status?: number;

  constructor(kind: "configuration" | "http" | "invalid_response" | "network", status?: number) {
    super(kind === "http" && status ? `fanmark analytics request failed (${status})` : `fanmark analytics request ${kind}`);
    this.name = "FanmarkAnalyticsApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getFanmarkAnalyticsBackend(
  value: string | undefined = import.meta.env?.VITE_FANMARK_ANALYTICS_BACKEND,
): FanmarkAnalyticsBackend {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new FanmarkAnalyticsApiError("configuration");
}

function apiUrl(path: string, baseUrl: string): URL {
  if (!path.startsWith("/api/me/analytics")) throw new FanmarkAnalyticsApiError("configuration");
  try {
    const url = buildRecentFanmarksApiUrl(baseUrl);
    url.pathname = path;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    throw new FanmarkAnalyticsApiError("configuration");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new FanmarkAnalyticsApiError("invalid_response");
  }
  return value;
}

async function callWorker<T>(
  path: string,
  params: Record<string, string> = {},
  options: { baseUrl?: string; authBaseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  const authBaseUrl = options.authBaseUrl ?? import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (!baseUrl || !authBaseUrl) throw new FanmarkAnalyticsApiError("configuration");
  let target: URL;
  try {
    target = apiUrl(path, baseUrl);
    if (target.origin !== buildRecentFanmarksApiUrl(authBaseUrl).origin) {
      throw new FanmarkAnalyticsApiError("configuration");
    }
  } catch {
    throw new FanmarkAnalyticsApiError("configuration");
  }
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(target, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new FanmarkAnalyticsApiError("network");
  }
  if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new FanmarkAnalyticsApiError("invalid_response");
  }
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel();
    throw new FanmarkAnalyticsApiError("invalid_response");
  }
  let payload: unknown;
  try {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error("too_large");
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new FanmarkAnalyticsApiError("invalid_response");
  }
  if (!response.ok) throw new FanmarkAnalyticsApiError("http", response.status);
  return payload as T;
}

function parseEnvelope(payload: unknown): unknown {
  if (!isRecord(payload) || payload.schemaVersion !== 1 || !Object.prototype.hasOwnProperty.call(payload, "result")) {
    throw new FanmarkAnalyticsApiError("invalid_response");
  }
  return payload.result;
}

function parseFanmarks(value: unknown): AnalyticsFanmark[] {
  if (!Array.isArray(value) || value.length > 5000) throw new FanmarkAnalyticsApiError("invalid_response");
  return value.map((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.shortId !== "string" ||
        typeof item.userInputFanmark !== "string" || typeof item.displayFanmark !== "string" ||
        (item.fanmarkName !== null && typeof item.fanmarkName !== "string")) {
      throw new FanmarkAnalyticsApiError("invalid_response");
    }
    return {
      id: item.id,
      short_id: item.shortId,
      user_input_fanmark: item.userInputFanmark,
      display_fanmark: item.displayFanmark,
      fanmark_name: item.fanmarkName as string | null,
    };
  });
}

const METRIC_KEYS = [
  "accessCount", "uniqueVisitors", "referrerDirect", "referrerSearch", "referrerSocial", "referrerOther",
  "deviceMobile", "deviceTablet", "deviceDesktop", "accessTypeProfile", "accessTypeRedirect", "accessTypeText", "accessTypeInactive",
] as const;

function parseMetrics(value: unknown): FanmarkAnalyticsMetrics {
  if (!isRecord(value)) throw new FanmarkAnalyticsApiError("invalid_response");
  return Object.fromEntries(METRIC_KEYS.map((key) => [key, count(value[key])])) as unknown as FanmarkAnalyticsMetrics;
}

export async function fetchFanmarkAnalyticsFanmarksWorker(
  options: { baseUrl?: string; authBaseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<AnalyticsFanmark[]> {
  const result = parseEnvelope(await callWorker("/api/me/analytics/fanmarks", {}, options));
  return parseFanmarks(result);
}

export async function fetchFanmarkAnalyticsWorker(
  range: { startDate: string; endDate: string; fanmarkId?: string | null },
  options: { baseUrl?: string; authBaseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<FanmarkAnalyticsResult> {
  const params: Record<string, string> = { start_date: range.startDate, end_date: range.endDate };
  if (range.fanmarkId) params.fanmark_id = range.fanmarkId;
  const result = parseEnvelope(await callWorker("/api/me/analytics", params, options));
  if (!isRecord(result) || !Array.isArray(result.dailyStats) || !Array.isArray(result.fanmarkTotals)) {
    throw new FanmarkAnalyticsApiError("invalid_response");
  }
  const dailyStats = result.dailyStats.map((item) => {
    if (!isRecord(item) || typeof item.statDate !== "string") throw new FanmarkAnalyticsApiError("invalid_response");
    return { stat_date: item.statDate, access_count: count(item.accessCount), unique_visitors: count(item.uniqueVisitors) };
  });
  const fanmarkTotals = result.fanmarkTotals.map((item) => {
    if (!isRecord(item) || typeof item.fanmarkId !== "string") throw new FanmarkAnalyticsApiError("invalid_response");
    return { fanmark_id: item.fanmarkId, access_count: count(item.accessCount) };
  });
  return {
    fanmarks: parseFanmarks(result.fanmarks),
    summary: parseMetrics(result.summary),
    dailyStats,
    fanmarkTotals,
  };
}

export async function fetchFanmarkAnalyticsSummaryWorker(
  options: { days?: number; baseUrl?: string; authBaseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<number> {
  const params = options.days === undefined ? {} : { days: String(options.days) };
  const result = parseEnvelope(await callWorker("/api/me/analytics/summary", params, options));
  if (!isRecord(result)) throw new FanmarkAnalyticsApiError("invalid_response");
  return count(result.totalAccess);
}
