import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const FAVORITES_PATH = "/api/me/favorites";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const TIMEOUT_MS = 5_000;
const MAX_FAVORITES = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface FavoriteFanmarkRow {
  favorite_id: string;
  discovery_id: string;
  favorited_at: string;
  fanmark_id: string | null;
  display_fanmark: string | null;
  normalized_emoji_ids: (string | null)[];
  emoji_ids: (string | null)[];
  availability_status: string;
  search_count: number;
  favorite_count: number;
  short_id: string | null;
  fanmark_name: string | null;
  access_type: string | null;
  target_url: string | null;
  text_content: string | null;
  current_owner_username: string | null;
  current_owner_display_name: string | null;
  current_license_start: string | null;
  current_license_end: string | null;
  current_license_status: string | null;
  is_password_protected: boolean;
}

export type FavoritesApiErrorKind = "configuration" | "http" | "invalid_response" | "network" | "timeout";

export class FavoritesApiError extends Error {
  readonly kind: FavoritesApiErrorKind;
  readonly status?: number;

  constructor(kind: FavoritesApiErrorKind, status?: number) {
    super(kind === "http" && status ? `favorites request failed (${status})` : `favorites request ${kind}`);
    this.name = "FavoritesApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getFavoritesBackend(value: string | undefined = import.meta.env?.VITE_FAVORITES_BACKEND): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new FavoritesApiError("configuration");
}

function favoritesUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new FavoritesApiError("configuration");
  }
  url.pathname = FAVORITES_PATH;
  url.search = "";
  url.hash = "";
  return url;
}

function assertAuthOrigin(baseUrl: string, authBaseUrl?: string): void {
  if (!authBaseUrl?.trim()) return;
  try {
    if (favoritesUrl(baseUrl).origin !== buildRecentFanmarksApiUrl(authBaseUrl.trim()).origin) {
      throw new FavoritesApiError("configuration");
    }
  } catch {
    throw new FavoritesApiError("configuration");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isText(value: unknown, maximum = 512): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function isNullableText(value: unknown, maximum = 512): value is string | null {
  return value === null || isText(value, maximum);
}

const FAVORITE_FIELDS = [
  "favorite_id", "discovery_id", "favorited_at", "fanmark_id", "display_fanmark",
  "normalized_emoji_ids", "emoji_ids", "availability_status", "search_count", "favorite_count",
  "short_id", "fanmark_name", "access_type", "target_url", "text_content",
  "current_owner_username", "current_owner_display_name", "current_license_start",
  "current_license_end", "current_license_status", "is_password_protected",
] as const;

function parseFavoriteRow(value: unknown): FavoriteFanmarkRow {
  const validArray = (item: unknown): item is string[] => Array.isArray(item) && item.length > 0 && item.length <= 64 &&
    item.every((id) => typeof id === "string" && UUID_RE.test(id));
  const validTime = (item: unknown): item is string => typeof item === "string" && Number.isFinite(Date.parse(item));
  if (
    !isRecord(value) || !exactKeys(value, FAVORITE_FIELDS) ||
    !isText(value.favorite_id, 64) || !UUID_RE.test(value.favorite_id) ||
    !isText(value.discovery_id, 64) || !UUID_RE.test(value.discovery_id) ||
    !validTime(value.favorited_at) || !isNullableText(value.fanmark_id, 64) ||
    (value.fanmark_id !== null && !UUID_RE.test(value.fanmark_id)) || !isNullableText(value.display_fanmark) ||
    !validArray(value.normalized_emoji_ids) || !validArray(value.emoji_ids) ||
    !isText(value.availability_status, 64) ||
    typeof value.search_count !== "number" || !Number.isSafeInteger(value.search_count) || value.search_count < 0 ||
    typeof value.favorite_count !== "number" || !Number.isSafeInteger(value.favorite_count) || value.favorite_count < 0 ||
    !isNullableText(value.short_id, 128) || !isNullableText(value.fanmark_name) ||
    !isNullableText(value.access_type, 64) || !isNullableText(value.target_url, 8192) ||
    !isNullableText(value.text_content, 32 * 1024) || !isNullableText(value.current_owner_username, 128) ||
    !isNullableText(value.current_owner_display_name) ||
    !isNullableText(value.current_license_start, 128) || !isNullableText(value.current_license_end, 128) ||
    !isNullableText(value.current_license_status, 64) || typeof value.is_password_protected !== "boolean"
  ) throw new FavoritesApiError("invalid_response");
  return value as unknown as FavoriteFanmarkRow;
}

export function parseFavoriteFanmarksPayload(payload: unknown): FavoriteFanmarkRow[] {
  if (!isRecord(payload) || !exactKeys(payload, ["schemaVersion", "items"]) || payload.schemaVersion !== 1 ||
      !Array.isArray(payload.items) || payload.items.length > MAX_FAVORITES) {
    throw new FavoritesApiError("invalid_response");
  }
  return payload.items.map(parseFavoriteRow);
}

export interface FavoritesWorkerOptions {
  backend?: string;
  baseUrl?: string;
  authBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json" || !response.body) throw new FavoritesApiError("invalid_response");
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/u.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
    await response.body.cancel();
    throw new FavoritesApiError("invalid_response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new FavoritesApiError("invalid_response");
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof FavoritesApiError) throw error;
    throw new FavoritesApiError("invalid_response");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new FavoritesApiError("invalid_response");
  }
}

async function requestWorker<T>(method: "GET" | "POST" | "DELETE", body: unknown, options: {
  baseUrl?: string;
  authBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): Promise<T> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!baseUrl) throw new FavoritesApiError("configuration");
  const authBaseUrl = options.authBaseUrl ?? (import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ||
    (typeof window === "undefined" ? undefined : window.location.origin));
  assertAuthOrigin(baseUrl, authBaseUrl);
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new FavoritesApiError("configuration");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(favoritesUrl(baseUrl), {
      method,
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (!response.ok) throw new FavoritesApiError("http", response.status);
    return await readJson(response) as T;
  } catch (error) {
    if (error instanceof FavoritesApiError) throw error;
    if (controller.signal.aborted) throw new FavoritesApiError("timeout");
    throw new FavoritesApiError("network");
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadWorkerFavoriteFanmarkRows(options: FavoritesWorkerOptions = {}): Promise<FavoriteFanmarkRow[]> {
  return parseFavoriteFanmarksPayload(await requestWorker("GET", undefined, options));
}

export async function addWorkerFavoriteFanmark(emojiIds: string[], displayFanmark: string, options: FavoritesWorkerOptions = {}): Promise<boolean> {
  const payload = await requestWorker<unknown>("POST", { input_emoji_ids: emojiIds, input_display_fanmark: displayFanmark }, options);
  if (!isRecord(payload) || !exactKeys(payload, ["added"]) || typeof payload.added !== "boolean") throw new FavoritesApiError("invalid_response");
  return payload.added;
}

export async function removeWorkerFavoriteFanmark(emojiIds: string[], options: FavoritesWorkerOptions = {}): Promise<boolean> {
  const payload = await requestWorker<unknown>("DELETE", { input_emoji_ids: emojiIds }, options);
  if (!isRecord(payload) || !exactKeys(payload, ["removed"]) || typeof payload.removed !== "boolean") throw new FavoritesApiError("invalid_response");
  return payload.removed;
}
