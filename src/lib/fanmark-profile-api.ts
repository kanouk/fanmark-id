import { buildRecentFanmarksApiUrl } from "./recent-fanmarks.ts";
import type { EmojiProfile } from "@/hooks/useEmojiProfile";

const PROFILE_API_PREFIX = "/api/me/fanmarks/";
const MAX_RESPONSE_BYTES = 32 * 1024;
const TIMEOUT_MS = 5_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface OwnerFanmarkProfileContext {
  licenseId: string;
  fanmark: {
    id: string;
    user_input_fanmark: string;
    fanmark: string | null;
    emoji_ids: string[];
    short_id: string;
    fanmark_name: string | null;
  };
  profile: EmojiProfile | null;
}

export type OwnerFanmarkProfilePatch = Partial<Pick<
  EmojiProfile,
  "display_name" | "bio" | "social_links" | "theme_settings" | "is_public"
>>;

export type FanmarkProfileApiErrorKind = "configuration" | "http" | "invalid_response" | "network" | "timeout";

export class FanmarkProfileApiError extends Error {
  readonly kind: FanmarkProfileApiErrorKind;
  readonly status?: number;

  constructor(kind: FanmarkProfileApiErrorKind, status?: number) {
    super(kind === "http" && status
      ? `fanmark profile request failed (${status})`
      : `fanmark profile request ${kind}`);
    this.name = "FanmarkProfileApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getFanmarkProfileBackend(
  value: string | undefined = import.meta.env?.VITE_FANMARK_PROFILE_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new FanmarkProfileApiError("configuration");
}

export function buildFanmarkProfileApiUrl(baseUrl: string, fanmarkId: string): URL {
  if (!UUID_PATTERN.test(fanmarkId)) throw new FanmarkProfileApiError("configuration");
  let url: URL;
  try {
    url = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new FanmarkProfileApiError("configuration");
  }
  url.pathname = `${PROFILE_API_PREFIX}${encodeURIComponent(fanmarkId.toLowerCase())}/profile`;
  url.search = "";
  url.hash = "";
  return url;
}

function assertAuthOrigin(baseUrl: string, authBaseUrl?: string): void {
  if (!authBaseUrl?.trim()) return;
  try {
    if (buildFanmarkProfileApiUrl(baseUrl, "45111111-1111-4111-8111-111111111111").origin !==
        buildRecentFanmarksApiUrl(authBaseUrl.trim()).origin) {
      throw new FanmarkProfileApiError("configuration");
    }
  } catch {
    throw new FanmarkProfileApiError("configuration");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(isString);
}

function isThemeSettings(value: unknown): value is NonNullable<EmojiProfile["theme_settings"]> {
  if (!isRecord(value) || Object.keys(value).length > 8) return false;
  for (const [key, candidate] of Object.entries(value)) {
    if (key === "cover_image_dimensions") {
      if (!isRecord(candidate) || Object.keys(candidate).length !== 2 ||
          !Number.isInteger(candidate.width) || !Number.isInteger(candidate.height) ||
          Number(candidate.width) < 1 || Number(candidate.width) > 10_000 ||
          Number(candidate.height) < 1 || Number(candidate.height) > 10_000) return false;
    } else if (key === "cover_image_position") {
      if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0 || candidate > 100) return false;
    } else if (["cover_image_url", "profile_image_url", "theme_color", "button_style"].includes(key)) {
      if (!isString(candidate)) return false;
    } else {
      return false;
    }
  }
  return true;
}

function parseProfile(value: unknown): EmojiProfile | null {
  if (value === null) return null;
  const keys = ["id", "license_id", "display_name", "bio", "social_links", "theme_settings", "is_public", "created_at", "updated_at"];
  if (!isRecord(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
      !isString(value.id) || !UUID_PATTERN.test(value.id) || !isString(value.license_id) || !UUID_PATTERN.test(value.license_id) ||
      !isNullableString(value.display_name) || !isNullableString(value.bio) || !isStringRecord(value.social_links) ||
      !isThemeSettings(value.theme_settings) || typeof value.is_public !== "boolean" ||
      !isString(value.created_at) || !isString(value.updated_at)) {
    throw new FanmarkProfileApiError("invalid_response");
  }
  return value as unknown as EmojiProfile;
}

function parseContext(payload: unknown): OwnerFanmarkProfileContext {
  if (!isRecord(payload) || payload.schemaVersion !== 1 || !isString(payload.licenseId) ||
      !UUID_PATTERN.test(payload.licenseId) || !isRecord(payload.fanmark)) {
    throw new FanmarkProfileApiError("invalid_response");
  }
  const fanmark = payload.fanmark;
  if (!isString(fanmark.id) || !UUID_PATTERN.test(fanmark.id) ||
      !isString(fanmark.user_input_fanmark) || !isNullableString(fanmark.fanmark) ||
      !Array.isArray(fanmark.emoji_ids) || fanmark.emoji_ids.length > 5 ||
      fanmark.emoji_ids.some((id) => !isString(id)) || !isString(fanmark.short_id) ||
      !isNullableString(fanmark.fanmark_name)) {
    throw new FanmarkProfileApiError("invalid_response");
  }
  const profile = parseProfile(payload.profile);
  if (profile && profile.license_id !== payload.licenseId) throw new FanmarkProfileApiError("invalid_response");
  return {
    licenseId: payload.licenseId,
    fanmark: {
      id: fanmark.id,
      user_input_fanmark: fanmark.user_input_fanmark,
      fanmark: fanmark.fanmark,
      emoji_ids: fanmark.emoji_ids as string[],
      short_id: fanmark.short_id,
      fanmark_name: fanmark.fanmark_name,
    },
    profile,
  };
}

async function readResponse(response: Response): Promise<OwnerFanmarkProfileContext> {
  if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new FanmarkProfileApiError("invalid_response");
  }
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new FanmarkProfileApiError("invalid_response");
    }
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new FanmarkProfileApiError("invalid_response");
  }
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new FanmarkProfileApiError("invalid_response");
  try {
    return parseContext(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof FanmarkProfileApiError) throw error;
    throw new FanmarkProfileApiError("invalid_response");
  }
}

async function requestOwnerProfile(
  fanmarkId: string,
  patch?: OwnerFanmarkProfilePatch,
  options: {
    baseUrl?: string;
    authBaseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<OwnerFanmarkProfileContext> {
  const baseUrl = options.baseUrl ?? import.meta.env?.VITE_FANMARK_API_BASE_URL;
  if (!baseUrl) throw new FanmarkProfileApiError("configuration");
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new FanmarkProfileApiError("configuration");
  const url = buildFanmarkProfileApiUrl(baseUrl, fanmarkId);
  const authBaseUrl = options.authBaseUrl ?? (import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ||
    (typeof window === "undefined" ? undefined : window.location.origin));
  assertAuthOrigin(baseUrl, authBaseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: patch ? "PATCH" : "GET",
      headers: patch
        ? { Accept: "application/json", "Content-Type": "application/json" }
        : { Accept: "application/json" },
      ...(patch ? { body: JSON.stringify(patch) } : {}),
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new FanmarkProfileApiError("http", response.status);
    return await readResponse(response);
  } catch (error) {
    if (error instanceof FanmarkProfileApiError) throw error;
    if (controller.signal.aborted) throw new FanmarkProfileApiError("timeout");
    throw new FanmarkProfileApiError("network");
  } finally {
    clearTimeout(timer);
  }
}

export function getOwnerFanmarkProfileContext(
  fanmarkId: string,
  options?: Parameters<typeof requestOwnerProfile>[2],
): Promise<OwnerFanmarkProfileContext> {
  return requestOwnerProfile(fanmarkId, undefined, options);
}

export function updateOwnerFanmarkProfile(
  fanmarkId: string,
  patch: OwnerFanmarkProfilePatch,
  options?: Parameters<typeof requestOwnerProfile>[2],
): Promise<OwnerFanmarkProfileContext> {
  return requestOwnerProfile(fanmarkId, patch, options);
}
