import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const DETAILS_PATH = "/api/fanmarks/details";
const MAX_RESPONSE_BYTES = 48 * 1024;
const MAX_HISTORY_ROWS = 100;
const MAX_SHORT_ID_BYTES = 256;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DETAIL_KEYS = [
  "fanmark_id", "user_input_fanmark", "display_fanmark", "emoji_ids", "fanmark", "normalized_emoji", "short_id",
  "fanmark_created_at", "current_owner_username", "current_owner_display_name", "current_license_start",
  "current_license_end", "current_license_status", "current_grace_expires_at", "current_is_returned",
  "is_currently_active", "first_acquired_date", "first_owner_username", "first_owner_display_name", "license_history",
  "history_available", "is_favorited", "has_pending_lottery", "is_current_owner", "lottery_entry_count", "has_user_lottery_entry",
].sort();
const HISTORY_KEYS = [
  "license_start", "license_end", "grace_expires_at", "excluded_at", "is_returned", "username", "display_name",
  "status", "is_initial_license",
].sort();

export type FanmarkDetailsApiErrorKind = "configuration" | "http" | "invalid_response" | "network" | "timeout" | "auth_required";

export class FanmarkDetailsApiError extends Error {
  readonly kind: FanmarkDetailsApiErrorKind;
  readonly status?: number;

  constructor(kind: FanmarkDetailsApiErrorKind, status?: number) {
    super(kind === "http" && status
      ? `fanmark details request failed (${status})`
      : `fanmark details request ${kind}`);
    this.name = "FanmarkDetailsApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getFanmarkDetailsBackend(value: string | undefined = import.meta.env?.VITE_FANMARK_DETAILS_BACKEND): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new FanmarkDetailsApiError("configuration");
}

function detailsUrl(baseUrl: string): URL {
  let url: URL;
  try { url = buildRecentFanmarksApiUrl(baseUrl); } catch { throw new FanmarkDetailsApiError("configuration"); }
  url.pathname = DETAILS_PATH;
  url.search = "";
  url.hash = "";
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isText(value: unknown, max = 512): value is string {
  return typeof value === "string" && value.length <= max;
}

function isNullableText(value: unknown, max = 512): value is string | null {
  return value === null || isText(value, max);
}

function hasDisallowedShortIdCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f || character === "/" || character === "\\";
  });
}

function isBoundedShortId(value: unknown): value is string {
  return isText(value, MAX_SHORT_ID_BYTES) &&
    new TextEncoder().encode(value).byteLength <= MAX_SHORT_ID_BYTES &&
    !hasDisallowedShortIdCharacter(value);
}

function isBooleanOrNull(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

function isHistoryItem(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, HISTORY_KEYS)) return false;
  return isText(value.license_start, 64) && isNullableText(value.license_end, 64) &&
    isNullableText(value.grace_expires_at, 64) && isNullableText(value.excluded_at, 64) &&
    typeof value.is_returned === "boolean" && isNullableText(value.username, 64) &&
    isNullableText(value.display_name, 128) && isText(value.status, 32) && typeof value.is_initial_license === "boolean";
}

function isFanmarkDetails(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !exactKeys(value, DETAIL_KEYS)) return false;
  return typeof value.fanmark_id === "string" && UUID_RE.test(value.fanmark_id) &&
    isText(value.user_input_fanmark) && isNullableText(value.display_fanmark) &&
    Array.isArray(value.emoji_ids) && value.emoji_ids.length >= 1 && value.emoji_ids.length <= 5 &&
    value.emoji_ids.every((id) => typeof id === "string" && UUID_RE.test(id)) &&
    isText(value.fanmark) && isText(value.normalized_emoji) && isBoundedShortId(value.short_id) &&
    isText(value.fanmark_created_at, 64) && isNullableText(value.current_owner_username, 64) &&
    isNullableText(value.current_owner_display_name, 128) && isNullableText(value.current_license_start, 64) &&
    isNullableText(value.current_license_end, 64) && isNullableText(value.current_license_status, 32) &&
    isNullableText(value.current_grace_expires_at, 64) && isBooleanOrNull(value.current_is_returned) &&
    typeof value.is_currently_active === "boolean" && isNullableText(value.first_acquired_date, 64) &&
    isNullableText(value.first_owner_username, 64) && isNullableText(value.first_owner_display_name, 128) &&
    Array.isArray(value.license_history) && value.license_history.length <= MAX_HISTORY_ROWS &&
    value.license_history.every(isHistoryItem) && typeof value.history_available === "boolean" && typeof value.is_favorited === "boolean" &&
    typeof value.has_pending_lottery === "boolean" && typeof value.is_current_owner === "boolean" &&
    typeof value.lottery_entry_count === "number" && Number.isSafeInteger(value.lottery_entry_count) && value.lottery_entry_count >= 0 &&
    typeof value.has_user_lottery_entry === "boolean" &&
    (value.history_available || (
      value.license_history.length === 0 && value.current_owner_username === null &&
      value.current_owner_display_name === null && value.current_license_start === null &&
      value.first_acquired_date === null && value.first_owner_username === null &&
      value.first_owner_display_name === null && value.is_current_owner === false &&
      value.has_pending_lottery === false && value.has_user_lottery_entry === false &&
      value.lottery_entry_count === 0 && value.is_favorited === false
    ));
}

export function parseFanmarkDetailsPayload(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !exactKeys(value, ["schemaVersion", "result"])) {
    throw new FanmarkDetailsApiError("invalid_response");
  }
  if (value.result === null) return null;
  if (!isFanmarkDetails(value.result)) throw new FanmarkDetailsApiError("invalid_response");
  return value.result;
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_RESPONSE_BYTES) {
      throw new FanmarkDetailsApiError("invalid_response");
    }
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new FanmarkDetailsApiError("invalid_response");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof FanmarkDetailsApiError) throw error;
    throw new FanmarkDetailsApiError("network");
  } finally {
    try { reader.releaseLock(); } catch { /* The stream may already be detached. */ }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new FanmarkDetailsApiError("invalid_response"); }
}

export async function fetchFanmarkDetailsFromWorker(
  shortId: string,
  options: { baseUrl?: string; authBaseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Record<string, unknown> | null> {
  if (typeof shortId !== "string" || shortId.length < 1 ||
      new TextEncoder().encode(shortId).byteLength > MAX_SHORT_ID_BYTES || hasDisallowedShortIdCharacter(shortId)) {
    throw new FanmarkDetailsApiError("configuration");
  }
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  const authBaseUrl = options.authBaseUrl ?? import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (!baseUrl || !authBaseUrl) throw new FanmarkDetailsApiError("configuration");
  const url = detailsUrl(baseUrl);
  try {
    if (url.origin !== detailsUrl(authBaseUrl).origin) throw new FanmarkDetailsApiError("configuration");
  } catch (error) {
    if (error instanceof FanmarkDetailsApiError) throw error;
    throw new FanmarkDetailsApiError("configuration");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shortId }),
      signal: controller.signal,
    });
    if (response.status === 401) throw new FanmarkDetailsApiError("auth_required", 401);
    if (!response.ok) throw new FanmarkDetailsApiError("http", response.status);
    const body = await readBoundedResponse(response);
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { throw new FanmarkDetailsApiError("invalid_response"); }
    return parseFanmarkDetailsPayload(parsed);
  } catch (error) {
    if (controller.signal.aborted) throw new FanmarkDetailsApiError("timeout");
    if (error instanceof FanmarkDetailsApiError) throw error;
    throw new FanmarkDetailsApiError("network");
  } finally {
    clearTimeout(timeout);
  }
}
