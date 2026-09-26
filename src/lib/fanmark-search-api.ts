import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const DETAILS_PATH = "/api/fanmarks/search/details";
const MAX_RESPONSE_BYTES = 8 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DETAIL_KEYS = [
  "id", "user_input_fanmark", "display_fanmark", "emoji_ids", "normalized_emoji", "short_id", "status",
  "current_owner_id", "has_active_license", "license_id", "current_license_status", "current_grace_expires_at",
  "is_blocked_for_registration", "next_available_at", "lottery_entry_count", "has_user_lottery_entry",
  "user_lottery_entry_id",
].sort();

export interface FanmarkSearchDetails {
  id: string;
  user_input_fanmark: string;
  display_fanmark: string | null;
  emoji_ids: string[];
  normalized_emoji: string;
  short_id: string;
  status: string;
  current_owner_id: string | null;
  has_active_license: boolean;
  license_id: string | null;
  current_license_status: string | null;
  current_grace_expires_at: string | null;
  is_blocked_for_registration: boolean;
  next_available_at: string | null;
  lottery_entry_count: number;
  has_user_lottery_entry: boolean;
  user_lottery_entry_id: string | null;
}

export type FanmarkSearchApiErrorKind = "configuration" | "http" | "invalid_response" | "network" | "timeout";

export class FanmarkSearchApiError extends Error {
  readonly kind: FanmarkSearchApiErrorKind;
  readonly status?: number;

  constructor(kind: FanmarkSearchApiErrorKind, status?: number) {
    super(kind === "http" && status
      ? `fanmark search request failed (${status})`
      : `fanmark search request ${kind}`);
    this.name = "FanmarkSearchApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getFanmarkSearchBackend(
  value: string | undefined = import.meta.env?.VITE_FANMARK_SEARCH_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new FanmarkSearchApiError("configuration");
}

export function buildFanmarkSearchDetailsUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new FanmarkSearchApiError("configuration");
  }
  url.pathname = DETAILS_PATH;
  url.search = "";
  url.hash = "";
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown, maxLength = 512): value is string | null {
  return value === null || (typeof value === "string" && value.length <= maxLength);
}

function nullableUuid(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && UUID_RE.test(value));
}

function isSearchDetails(value: unknown): value is FanmarkSearchDetails {
  if (!isRecord(value) || Object.keys(value).sort().join("\0") !== DETAIL_KEYS.join("\0")) return false;
  return typeof value.id === "string" && UUID_RE.test(value.id) &&
    typeof value.user_input_fanmark === "string" && value.user_input_fanmark.length <= 512 &&
    nullableString(value.display_fanmark) &&
    Array.isArray(value.emoji_ids) && value.emoji_ids.length >= 1 && value.emoji_ids.length <= 5 &&
    value.emoji_ids.every((id) => typeof id === "string" && UUID_RE.test(id)) &&
    typeof value.normalized_emoji === "string" && value.normalized_emoji.length <= 512 &&
    typeof value.short_id === "string" && value.short_id.length >= 1 && value.short_id.length <= 64 &&
    typeof value.status === "string" && value.status.length <= 32 &&
    nullableUuid(value.current_owner_id) && typeof value.has_active_license === "boolean" &&
    nullableUuid(value.license_id) && nullableString(value.current_license_status, 32) &&
    nullableString(value.current_grace_expires_at, 64) &&
    typeof value.is_blocked_for_registration === "boolean" && nullableString(value.next_available_at, 64) &&
    typeof value.lottery_entry_count === "number" && Number.isSafeInteger(value.lottery_entry_count) && value.lottery_entry_count >= 0 &&
    typeof value.has_user_lottery_entry === "boolean" && nullableUuid(value.user_lottery_entry_id);
}

export function parseFanmarkSearchDetailsPayload(value: unknown): FanmarkSearchDetails | null {
  if (!isRecord(value) || value.schemaVersion !== 1 ||
    Object.keys(value).sort().join("\0") !== ["result", "schemaVersion"].sort().join("\0")) {
    throw new FanmarkSearchApiError("invalid_response");
  }
  if (value.result === null) return null;
  if (!isSearchDetails(value.result)) throw new FanmarkSearchApiError("invalid_response");
  if (value.result.has_user_lottery_entry !== (value.result.user_lottery_entry_id !== null)) {
    throw new FanmarkSearchApiError("invalid_response");
  }
  return value.result;
}

export async function fetchFanmarkSearchDetailsFromWorker(
  fanmarkId: string,
  options: {
    baseUrl?: string;
    authBaseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<FanmarkSearchDetails | null> {
  if (!UUID_RE.test(fanmarkId)) throw new FanmarkSearchApiError("configuration");
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  const authBaseUrl = options.authBaseUrl ?? import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (!baseUrl || !authBaseUrl) throw new FanmarkSearchApiError("configuration");

  let endpoint: URL;
  try {
    endpoint = buildFanmarkSearchDetailsUrl(baseUrl);
    if (endpoint.origin !== buildRecentFanmarksApiUrl(authBaseUrl).origin) {
      throw new FanmarkSearchApiError("configuration");
    }
  } catch {
    throw new FanmarkSearchApiError("configuration");
  }

  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new FanmarkSearchApiError("configuration");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(endpoint, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ fanmarkId: fanmarkId.toLowerCase() }),
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw new FanmarkSearchApiError(controller.signal.aborted ? "timeout" : "network");
    }
    if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      await response.body?.cancel();
      throw new FanmarkSearchApiError("invalid_response");
    }
    const declaredLength = response.headers.get("content-length");
    if (declaredLength && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)) {
      await response.body?.cancel();
      throw new FanmarkSearchApiError("invalid_response");
    }
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
      throw new FanmarkSearchApiError("invalid_response");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body) as unknown;
    } catch {
      throw new FanmarkSearchApiError("invalid_response");
    }
    if (!response.ok) throw new FanmarkSearchApiError("http", response.status);
    return parseFanmarkSearchDetailsPayload(payload);
  } finally {
    clearTimeout(timer);
  }
}

export async function loadFanmarkSearchDetails(
  fanmarkId: string,
  options: Parameters<typeof fetchFanmarkSearchDetailsFromWorker>[1] & {
    backend?: string;
    fallback: () => Promise<unknown>;
  },
): Promise<unknown> {
  if (getFanmarkSearchBackend(options.backend) === "supabase") return options.fallback();
  return fetchFanmarkSearchDetailsFromWorker(fanmarkId, options);
}
