import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

export type FanmarkLotteryAction = "apply" | "cancel";
export type FanmarkLotteryBackend = "supabase" | "worker";
export interface SupabaseLotteryResult<T> {
  data: T | null;
  error: { message: string } | null;
}

const PATHS: Record<FanmarkLotteryAction, string> = {
  apply: "/api/fanmarks/lottery/apply",
  cancel: "/api/fanmarks/lottery/cancel",
};
const MAX_RESPONSE_BYTES = 8 * 1024;

export class FanmarkLotteryApiError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network" | "timeout";
  readonly status?: number;

  constructor(kind: "configuration" | "http" | "invalid_response" | "network" | "timeout", status?: number) {
    super(kind === "http" && status ? `fanmark lottery request failed (${status})` : `fanmark lottery request ${kind}`);
    this.name = "FanmarkLotteryApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getFanmarkLotteryBackend(
  value: string | undefined = import.meta.env?.VITE_FANMARK_LOTTERY_BACKEND,
): FanmarkLotteryBackend {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new FanmarkLotteryApiError("configuration");
}

export function buildFanmarkLotteryApiUrl(action: FanmarkLotteryAction, baseUrl: string): URL {
  let url: URL;
  try {
    url = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new FanmarkLotteryApiError("configuration");
  }
  url.pathname = PATHS[action];
  url.search = "";
  url.hash = "";
  return url;
}

export async function callFanmarkLotteryWorker<T>(
  action: FanmarkLotteryAction,
  body: unknown,
  options: { baseUrl?: string; authBaseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<T> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (!baseUrl) throw new FanmarkLotteryApiError("configuration");
  const authBaseUrl = options.authBaseUrl ?? import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  try {
    if (buildFanmarkLotteryApiUrl(action, baseUrl).origin !== buildRecentFanmarksApiUrl(authBaseUrl).origin) {
      throw new FanmarkLotteryApiError("configuration");
    }
  } catch {
    throw new FanmarkLotteryApiError("configuration");
  }
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new FanmarkLotteryApiError("configuration");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(buildFanmarkLotteryApiUrl(action, baseUrl), {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) throw new FanmarkLotteryApiError("timeout");
      throw new FanmarkLotteryApiError("network");
    }
    if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      throw new FanmarkLotteryApiError("invalid_response");
    }
    const declared = response.headers.get("content-length");
    if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
      await response.body?.cancel();
      throw new FanmarkLotteryApiError("invalid_response");
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new FanmarkLotteryApiError("invalid_response");
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new FanmarkLotteryApiError("invalid_response");
    }
    if (!response.ok) {
      const code = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : new FanmarkLotteryApiError("http", response.status).message;
      const error = new Error(code) as Error & { status?: number; context?: unknown };
      error.status = response.status;
      error.context = payload;
      throw error;
    }
    if (typeof payload !== "object" || payload === null || !("success" in payload) || payload.success !== true) {
      throw new FanmarkLotteryApiError("invalid_response");
    }
    return payload as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function invokeFanmarkLotteryAction<T>(
  action: FanmarkLotteryAction,
  body: unknown,
  supabaseInvoke: () => Promise<SupabaseLotteryResult<T>>,
  options: Parameters<typeof callFanmarkLotteryWorker>[2] & { backend?: string } = {},
): Promise<SupabaseLotteryResult<T>> {
  if (getFanmarkLotteryBackend(options.backend) === "supabase") return supabaseInvoke();
  try {
    return { data: await callFanmarkLotteryWorker<T>(action, body, options), error: null };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : "lottery request failed" } };
  }
}
