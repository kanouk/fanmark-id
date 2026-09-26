import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const ACCESS_PATH = "/api/fanmarks/access";

export type FanmarkAccessAnalyticsBackend = "supabase" | "worker";

export interface FanmarkAccessAnalyticsInput {
  fanmark_id: string;
  short_id: string;
  referrer: string | null;
  user_agent: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  access_type: string | null;
}

export class FanmarkAccessAnalyticsApiError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network";
  readonly status?: number;

  constructor(kind: "configuration" | "http" | "invalid_response" | "network", status?: number) {
    super(kind === "http" && status ? `fanmark analytics request failed (${status})` : `fanmark analytics request ${kind}`);
    this.name = "FanmarkAccessAnalyticsApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getFanmarkAccessAnalyticsBackend(
  value: string | undefined = import.meta.env?.VITE_FANMARK_ACCESS_ANALYTICS_BACKEND,
): FanmarkAccessAnalyticsBackend {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new FanmarkAccessAnalyticsApiError("configuration");
}

export function buildFanmarkAccessAnalyticsApiUrl(baseUrl: string): URL {
  try {
    const url = buildRecentFanmarksApiUrl(baseUrl);
    url.pathname = ACCESS_PATH;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    throw new FanmarkAccessAnalyticsApiError("configuration");
  }
}

export async function recordFanmarkAccessWithWorker(
  input: FanmarkAccessAnalyticsInput,
  options: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (!baseUrl) throw new FanmarkAccessAnalyticsApiError("configuration");

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(buildFanmarkAccessAnalyticsApiUrl(baseUrl), {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(input),
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    throw new FanmarkAccessAnalyticsApiError("network");
  }

  if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new FanmarkAccessAnalyticsApiError("invalid_response");
  }
  let payload: unknown;
  try {
    payload = await response.json() as unknown;
  } catch {
    throw new FanmarkAccessAnalyticsApiError("invalid_response");
  }
  if (!response.ok) throw new FanmarkAccessAnalyticsApiError("http", response.status);
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      (payload as Record<string, unknown>).success !== true ||
      typeof (payload as Record<string, unknown>).recorded !== "boolean") {
    throw new FanmarkAccessAnalyticsApiError("invalid_response");
  }
  return (payload as { recorded: boolean }).recorded;
}
