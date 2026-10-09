import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

export type FanmarkTransferAction = "list" | "issue" | "apply" | "cancel" | "approve" | "reject";
export type FanmarkTransferBackend = "supabase" | "worker";

const PATHS: Record<FanmarkTransferAction, string> = {
  list: "/api/me/transfers",
  issue: "/api/me/transfers/issue",
  apply: "/api/me/transfers/apply",
  cancel: "/api/me/transfers/cancel",
  approve: "/api/me/transfers/approve",
  reject: "/api/me/transfers/reject",
};
const MAX_RESPONSE_BYTES = 128 * 1024;

export class FanmarkTransferApiError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network" | "timeout";
  readonly status?: number;
  readonly context?: unknown;

  constructor(
    kind: FanmarkTransferApiError["kind"],
    status?: number,
    code?: string,
    context?: unknown,
  ) {
    super(kind === "http" && status
      ? (code || "transfer request failed") + " (" + status + ")"
      : "fanmark transfer request " + kind);
    this.name = "FanmarkTransferApiError";
    this.kind = kind;
    this.status = status;
    this.context = context;
  }
}

export function getFanmarkTransferBackend(
  value: string | undefined = import.meta.env?.VITE_FANMARK_TRANSFER_BACKEND,
): FanmarkTransferBackend {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new FanmarkTransferApiError("configuration");
}

export function buildFanmarkTransferApiUrl(action: FanmarkTransferAction, baseUrl: string): URL {
  let url: URL;
  try {
    url = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new FanmarkTransferApiError("configuration");
  }
  url.pathname = PATHS[action];
  url.search = "";
  url.hash = "";
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function callFanmarkTransferWorker<T>(
  action: FanmarkTransferAction,
  body?: unknown,
  options: {
    baseUrl?: string;
    authBaseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (!baseUrl) throw new FanmarkTransferApiError("configuration");
  const authBaseUrl = options.authBaseUrl ?? import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  try {
    if (buildFanmarkTransferApiUrl(action, baseUrl).origin !== buildRecentFanmarksApiUrl(authBaseUrl).origin) {
      throw new FanmarkTransferApiError("configuration");
    }
  } catch {
    throw new FanmarkTransferApiError("configuration");
  }
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new FanmarkTransferApiError("configuration");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const method = action === "list" ? "GET" : "POST";
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(buildFanmarkTransferApiUrl(action, baseUrl), {
        method,
        headers: { Accept: "application/json", ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
        ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) throw new FanmarkTransferApiError("timeout");
      throw new FanmarkTransferApiError("network");
    }
    if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      throw new FanmarkTransferApiError("invalid_response");
    }
    const declared = response.headers.get("content-length");
    if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
      await response.body?.cancel();
      throw new FanmarkTransferApiError("invalid_response");
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new FanmarkTransferApiError("invalid_response");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new FanmarkTransferApiError("invalid_response");
    }
    if (!response.ok) {
      const code = isRecord(payload) && typeof payload.error === "string" ? payload.error : undefined;
      throw new FanmarkTransferApiError("http", response.status, code, payload);
    }
    if (!isRecord(payload)) throw new FanmarkTransferApiError("invalid_response");
    if (action !== "list" && payload.success !== true) throw new FanmarkTransferApiError("invalid_response");
    if (action === "list" && (!Array.isArray(payload.issuedCodes) ||
        !Array.isArray(payload.pendingRequests) || !Array.isArray(payload.myRequests))) {
      throw new FanmarkTransferApiError("invalid_response");
    }
    return payload as T;
  } catch (error) {
    if (error instanceof FanmarkTransferApiError) throw error;
    if (controller.signal.aborted) throw new FanmarkTransferApiError("timeout");
    throw new FanmarkTransferApiError("invalid_response");
  } finally {
    clearTimeout(timer);
  }
}
