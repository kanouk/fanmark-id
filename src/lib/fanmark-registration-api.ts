import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const REGISTER_PATH = "/api/fanmarks/register";
const MAX_RESPONSE_BYTES = 12 * 1024;

export type FanmarkRegistrationErrorKind = "configuration" | "http" | "invalid_response" | "network" | "timeout";

export class FanmarkRegistrationApiError extends Error {
  readonly kind: FanmarkRegistrationErrorKind;
  readonly status?: number;

  constructor(kind: FanmarkRegistrationErrorKind, status?: number, message?: string) {
    super(message || (kind === "http" && status
      ? `fanmark registration request failed (${status})`
      : `fanmark registration request ${kind}`));
    this.name = "FanmarkRegistrationApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getFanmarkRegistrationBackend(
  value: string | undefined = import.meta.env?.VITE_FANMARK_REGISTRATION_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new FanmarkRegistrationApiError("configuration");
}

export function buildFanmarkRegistrationApiUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new FanmarkRegistrationApiError("configuration");
  }
  url.pathname = REGISTER_PATH;
  url.search = "";
  url.hash = "";
  return url;
}

function assertAuthOrigin(baseUrl: string, authBaseUrl?: string): void {
  if (!authBaseUrl?.trim()) return;
  try {
    if (buildFanmarkRegistrationApiUrl(baseUrl).origin !== buildRecentFanmarksApiUrl(authBaseUrl.trim()).origin) {
      throw new FanmarkRegistrationApiError("configuration");
    }
  } catch {
    throw new FanmarkRegistrationApiError("configuration");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readResponse(response: Response): Promise<unknown> {
  if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new FanmarkRegistrationApiError("invalid_response");
  }
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel();
    throw new FanmarkRegistrationApiError("invalid_response");
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new FanmarkRegistrationApiError("invalid_response");
  }
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new FanmarkRegistrationApiError("invalid_response");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new FanmarkRegistrationApiError("invalid_response");
  }
}

export async function registerFanmarkThroughWorker<T>(
  body: unknown,
  options: {
    baseUrl?: string;
    authBaseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (!baseUrl) throw new FanmarkRegistrationApiError("configuration");
  const authBaseUrl = options.authBaseUrl ?? import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  assertAuthOrigin(baseUrl, authBaseUrl);
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new FanmarkRegistrationApiError("configuration");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(buildFanmarkRegistrationApiUrl(baseUrl), {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new FanmarkRegistrationApiError("timeout");
      throw new FanmarkRegistrationApiError("network", undefined,
        error instanceof Error ? error.message : undefined);
    }
    const payload = await readResponse(response);
    if (!response.ok) {
      const message = isRecord(payload) && typeof payload.error === "string" ? payload.error : undefined;
      throw new FanmarkRegistrationApiError("http", response.status, message);
    }
    if (!isRecord(payload) || payload.success !== true || !isRecord(payload.fanmark)) {
      throw new FanmarkRegistrationApiError("invalid_response");
    }
    return payload as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface SupabaseRegistrationResult<T> {
  data: T | null;
  error: { message: string } | null;
}

export async function invokeFanmarkRegistration<T>(
  body: unknown,
  supabaseInvoke: () => Promise<SupabaseRegistrationResult<T>>,
  options: Parameters<typeof registerFanmarkThroughWorker>[1] & { backend?: string } = {},
): Promise<SupabaseRegistrationResult<T>> {
  const backend = getFanmarkRegistrationBackend(options.backend);
  if (backend === "supabase") return supabaseInvoke();
  try {
    return { data: await registerFanmarkThroughWorker<T>(body, options), error: null };
  } catch (error) {
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : "fanmark registration request failed" },
    };
  }
}
