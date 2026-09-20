export const RECENT_FANMARKS_LIMIT = 20;
export const RECENT_FANMARKS_TIMEOUT_MS = 5_000;

const RECENT_FANMARKS_PATH = "/api/fanmarks/recent";
const MAX_TIMEOUT_MS = 30_000;

export interface RecentFanmark {
  id: string;
  emoji: string;
  created_at: string | null;
}

export interface RecentFanmarkApiItem {
  id: string;
  emoji: string;
  createdAt: string | null;
}

export type RecentFanmarksApiErrorKind =
  | "aborted"
  | "configuration"
  | "http"
  | "invalid_response"
  | "network"
  | "timeout";

export class RecentFanmarksApiError extends Error {
  readonly kind: RecentFanmarksApiErrorKind;
  readonly status?: number;

  constructor(kind: RecentFanmarksApiErrorKind, status?: number) {
    super(kind === "http" && status ? `recent fanmarks request failed (${status})` : `recent fanmarks request ${kind}`);
    this.name = "RecentFanmarksApiError";
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Returns the trimmed Worker base URL, or undefined when the Worker has not
 * been selected for this frontend build. An invalid non-empty value is kept
 * here and rejected by buildRecentFanmarksApiUrl so it cannot activate the
 * Supabase fallback accidentally.
 */
export function getRecentFanmarksApiBaseUrl(
  value: string | undefined = import.meta.env?.VITE_FANMARK_API_BASE_URL,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > RECENT_FANMARKS_LIMIT) {
    throw new RecentFanmarksApiError("configuration");
  }
}

function assertTimeout(timeoutMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new RecentFanmarksApiError("configuration");
  }
}

export function buildRecentFanmarksApiUrl(
  baseUrl: string,
  limit = RECENT_FANMARKS_LIMIT,
): URL {
  assertLimit(limit);

  const rawUrl = baseUrl.trim();
  if (!rawUrl) throw new RecentFanmarksApiError("configuration");

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RecentFanmarksApiError("configuration");
  }

  const isAllowedProtocol =
    url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHostname(url.hostname));
  if (
    !isAllowedProtocol ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new RecentFanmarksApiError("configuration");
  }

  url.pathname = RECENT_FANMARKS_PATH;
  url.search = "";
  url.searchParams.set("limit", String(limit));
  url.hash = "";
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function parseRecentFanmarksApiPayload(
  payload: unknown,
  limit = RECENT_FANMARKS_LIMIT,
): RecentFanmark[] {
  assertLimit(limit);

  if (!isRecord(payload) || payload.schemaVersion !== 1 || !Array.isArray(payload.items)) {
    throw new RecentFanmarksApiError("invalid_response");
  }

  const items: RecentFanmark[] = [];
  for (const item of payload.items.slice(0, limit)) {
    if (!isRecord(item)) throw new RecentFanmarksApiError("invalid_response");

    const id = nonEmptyString(item.id);
    const emoji = nonEmptyString(item.emoji);
    const createdAt = item.createdAt;
    if (!id || !emoji || (createdAt !== null && typeof createdAt !== "string")) {
      throw new RecentFanmarksApiError("invalid_response");
    }

    items.push({
      id,
      emoji,
      created_at: createdAt === null ? null : (createdAt as string),
    });
  }

  return items;
}

export function mapRecentFanmarkRpcRows(rows: unknown): RecentFanmark[] {
  if (!Array.isArray(rows)) return [];

  const items: RecentFanmark[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;

    const id = nonEmptyString(row.license_id) ?? nonEmptyString(row.fanmark_id);
    if (!id) continue;

    items.push({
      id,
      emoji: nonEmptyString(row.display_emoji) ?? "❓",
      created_at: nonEmptyString(row.license_created_at),
    });
  }

  return items.slice(0, RECENT_FANMARKS_LIMIT);
}

export interface RecentFanmarksFetchOptions {
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  limit?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RecentFanmarksLoadOptions extends RecentFanmarksFetchOptions {
  /** Used only when the Worker base URL is unset or blank. */
  fallback: () => Promise<RecentFanmark[]>;
  apiBaseUrl?: string;
}

export async function loadRecentFanmarks(
  options: RecentFanmarksLoadOptions,
): Promise<RecentFanmark[]> {
  const configuredApiBaseUrl =
    options.apiBaseUrl === undefined
      ? getRecentFanmarksApiBaseUrl()
      : getRecentFanmarksApiBaseUrl(options.apiBaseUrl);

  if (configuredApiBaseUrl) {
    const { fallback: _fallback, apiBaseUrl: _apiBaseUrl, ...fetchOptions } = options;
    return fetchRecentFanmarksFromWorker(configuredApiBaseUrl, fetchOptions);
  }

  return options.fallback();
}

function abortError(
  timedOut: boolean,
  callerSignal: AbortSignal | undefined,
): RecentFanmarksApiError | null {
  if (timedOut) return new RecentFanmarksApiError("timeout");
  if (callerSignal?.aborted) return new RecentFanmarksApiError("aborted");
  return null;
}

export async function fetchRecentFanmarksFromWorker(
  baseUrl: string,
  options: RecentFanmarksFetchOptions = {},
): Promise<RecentFanmark[]> {
  const limit = options.limit ?? RECENT_FANMARKS_LIMIT;
  const timeoutMs = options.timeoutMs ?? RECENT_FANMARKS_TIMEOUT_MS;
  const endpoint = buildRecentFanmarksApiUrl(baseUrl, limit);
  assertTimeout(timeoutMs);

  const callerSignal = options.signal;
  if (callerSignal?.aborted) throw new RecentFanmarksApiError("aborted");

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

  try {
    let response: Response;
    try {
      response = await (options.fetcher ?? fetch)(endpoint, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      const requestAbortError = abortError(timedOut, callerSignal);
      if (requestAbortError) throw requestAbortError;
      throw new RecentFanmarksApiError("network");
    }

    if (!response.ok) {
      throw new RecentFanmarksApiError("http", response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      const bodyAbortError = abortError(timedOut, callerSignal);
      if (bodyAbortError) throw bodyAbortError;
      throw new RecentFanmarksApiError("invalid_response");
    }

    const bodyAbortError = abortError(timedOut, callerSignal);
    if (bodyAbortError) throw bodyAbortError;
    return parseRecentFanmarksApiPayload(payload, limit);
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}
