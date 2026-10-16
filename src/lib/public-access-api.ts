export const PUBLIC_ACCESS_API_TIMEOUT_MS = 5_000;
const PUBLIC_ACCESS_API_MAX_BYTES = 64 * 1024;
const PUBLIC_ACCESS_SHORT_ID_PATH = "/api/fanmarks/access/short/";
const PUBLIC_ACCESS_EMOJI_PATH = "/api/fanmarks/access/emoji";
const PUBLIC_PROFILE_PATH = "/api/fanmarks/public-profile/";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCESS_TYPES = new Set(["profile", "redirect", "text", "inactive"]);

export type PublicAccessApiErrorKind =
  | "aborted"
  | "configuration"
  | "http"
  | "invalid_response"
  | "network"
  | "timeout";

export class PublicAccessApiError extends Error {
  readonly kind: PublicAccessApiErrorKind;
  readonly status?: number;

  constructor(kind: PublicAccessApiErrorKind, status?: number) {
    super(kind === "http" && status ? `public access request failed (${status})` : `public access request ${kind}`);
    this.name = "PublicAccessApiError";
    this.kind = kind;
    this.status = status;
  }
}

export interface PublicFanmarkAccessRecord {
  id: string;
  user_input_fanmark: string;
  display_fanmark: string;
  emoji_ids: string[];
  fanmark: string;
  short_id: string;
  fanmark_name: string;
  access_type: "profile" | "redirect" | "text" | "inactive";
  target_url: string | null;
  text_content: string | null;
  is_password_protected: boolean;
  status: "active";
  license_id: string | null;
  license_status: string | null;
  license_end: string | null;
  grace_expires_at: string | null;
  is_returned: boolean | null;
}

export interface PublicEmojiProfileRecord {
  license_id: string;
  display_name?: string;
  bio?: string;
  social_links?: Record<string, string>;
  theme_settings?: PublicProfileThemeSettings;
  created_at: string;
  updated_at: string;
}

export interface PublicProfileThemeSettings extends Record<
  string,
  string | number | Record<string, number> | undefined
> {
  cover_image_url?: string;
  cover_image_dimensions?: Record<string, number>;
  cover_image_position?: number;
  profile_image_url?: string;
  theme_color?: string;
  button_style?: string;
}

interface FetchOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function getPublicAccessReadBackend(
  value: string | undefined = import.meta.env?.VITE_PUBLIC_ACCESS_READ_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new PublicAccessApiError("configuration");
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

export function buildPublicAccessApiUrl(baseUrl: string, path: string): URL {
  const rawUrl = baseUrl.trim();
  if (!rawUrl || !path.startsWith("/api/")) throw new PublicAccessApiError("configuration");

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PublicAccessApiError("configuration");
  }

  const allowedProtocol = url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHostname(url.hostname));
  if (
    !allowedProtocol ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new PublicAccessApiError("configuration");
  }

  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parsePublicFanmarkAccess(payload: unknown): PublicFanmarkAccessRecord {
  if (
    !isRecord(payload) ||
    payload.schemaVersion !== 1 ||
    !nonEmptyString(payload.id) ||
    !UUID_PATTERN.test(payload.id) ||
    !nonEmptyString(payload.shortId) ||
    !nonEmptyString(payload.userInputFanmark) ||
    !nullableString(payload.displayFanmark) ||
    !Array.isArray(payload.emojiIds) ||
    payload.emojiIds.length > 5 ||
    payload.emojiIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id)) ||
    !nonEmptyString(payload.accessType) ||
    !ACCESS_TYPES.has(payload.accessType) ||
    !nullableString(payload.fanmarkName) ||
    !nullableString(payload.targetUrl) ||
    !nullableString(payload.textContent) ||
    typeof payload.isPasswordProtected !== "boolean" ||
    payload.status !== "active" ||
    !nullableString(payload.licenseId) ||
    (payload.licenseId !== null && !UUID_PATTERN.test(payload.licenseId)) ||
    !nullableString(payload.licenseStatus) ||
    !nullableString(payload.licenseEnd) ||
    !nullableString(payload.graceExpiresAt) ||
    (payload.isReturned !== null && typeof payload.isReturned !== "boolean") ||
    (payload.accessState !== "open" && payload.accessState !== "locked" && payload.accessState !== "unavailable")
  ) {
    throw new PublicAccessApiError("invalid_response");
  }

  if (
    (payload.accessState === "locked") !== payload.isPasswordProtected ||
    (payload.accessState === "unavailable") !== (payload.licenseId === null)
  ) {
    throw new PublicAccessApiError("invalid_response");
  }

  const displayFanmark = payload.displayFanmark ?? payload.userInputFanmark;
  return {
    id: payload.id,
    user_input_fanmark: payload.userInputFanmark,
    display_fanmark: displayFanmark,
    emoji_ids: payload.emojiIds as string[],
    fanmark: displayFanmark,
    short_id: payload.shortId,
    fanmark_name: payload.fanmarkName ?? displayFanmark,
    access_type: payload.accessType as PublicFanmarkAccessRecord["access_type"],
    target_url: payload.targetUrl,
    text_content: payload.textContent,
    is_password_protected: payload.isPasswordProtected,
    status: "active",
    license_id: payload.licenseId,
    license_status: payload.licenseStatus,
    license_end: payload.licenseEnd,
    grace_expires_at: payload.graceExpiresAt,
    is_returned: payload.isReturned as boolean | null,
  };
}

function parsePublicEmojiProfile(payload: unknown): PublicEmojiProfileRecord {
  if (
    !isRecord(payload) ||
    payload.schemaVersion !== 1 ||
    !nonEmptyString(payload.licenseId) ||
    !UUID_PATTERN.test(payload.licenseId) ||
    !nullableString(payload.displayName) ||
    !nullableString(payload.bio) ||
    !isRecord(payload.socialLinks) ||
    Object.values(payload.socialLinks).some((value) => typeof value !== "string") ||
    !isPublicProfileThemeSettings(payload.themeSettings) ||
    !nonEmptyString(payload.createdAt) ||
    !nonEmptyString(payload.updatedAt)
  ) {
    throw new PublicAccessApiError("invalid_response");
  }

  return {
    license_id: payload.licenseId,
    ...(payload.displayName === null ? {} : { display_name: payload.displayName }),
    ...(payload.bio === null ? {} : { bio: payload.bio }),
    social_links: payload.socialLinks as Record<string, string>,
    theme_settings: payload.themeSettings,
    created_at: payload.createdAt,
    updated_at: payload.updatedAt,
  };
}

function isPublicProfileThemeSettings(value: unknown): value is PublicProfileThemeSettings {
  if (!isRecord(value) || Object.keys(value).length > 8) return false;
  for (const [key, candidate] of Object.entries(value)) {
    if (key === "cover_image_dimensions") {
      if (
        !isRecord(candidate) ||
        Object.keys(candidate).length !== 2 ||
        !Object.prototype.hasOwnProperty.call(candidate, "width") ||
        !Object.prototype.hasOwnProperty.call(candidate, "height") ||
        !Number.isInteger(candidate.width) ||
        !Number.isInteger(candidate.height) ||
        Number(candidate.width) < 1 ||
        Number(candidate.width) > 10_000 ||
        Number(candidate.height) < 1 ||
        Number(candidate.height) > 10_000
      ) return false;
      continue;
    }
    if (key === "cover_image_position") {
      if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0 || candidate > 100) return false;
      continue;
    }
    if (["cover_image_url", "profile_image_url", "theme_color", "button_style"].includes(key)) {
      if (typeof candidate !== "string") return false;
      continue;
    }
    return false;
  }
  return true;
}

async function readWorkerPayload(
  path: string,
  { baseUrl = import.meta.env?.VITE_FANMARK_API_BASE_URL, fetchImpl = fetch, signal, timeoutMs = PUBLIC_ACCESS_API_TIMEOUT_MS }: FetchOptions,
  body?: unknown,
): Promise<unknown | null> {
  if (!baseUrl || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new PublicAccessApiError("configuration");
  }

  const url = buildPublicAccessApiUrl(baseUrl, path);
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined
        ? { Accept: "application/json" }
        : { Accept: "application/json", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new PublicAccessApiError("http", response.status);

    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
      const parsedLength = Number(declaredLength);
      if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > PUBLIC_ACCESS_API_MAX_BYTES) {
        throw new PublicAccessApiError("invalid_response");
      }
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > PUBLIC_ACCESS_API_MAX_BYTES) {
      throw new PublicAccessApiError("invalid_response");
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new PublicAccessApiError("invalid_response");
    }
  } catch (error) {
    if (error instanceof PublicAccessApiError) throw error;
    if (timedOut) throw new PublicAccessApiError("timeout");
    if (signal?.aborted) throw new PublicAccessApiError("aborted");
    throw new PublicAccessApiError("network");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function fetchPublicFanmarkByShortId(shortId: string, options?: FetchOptions): Promise<PublicFanmarkAccessRecord | null> {
  if (!shortId.trim()) throw new PublicAccessApiError("configuration");
  const payload = await readWorkerPayload(`${PUBLIC_ACCESS_SHORT_ID_PATH}${encodeURIComponent(shortId)}`, options ?? {});
  return payload === null ? null : parsePublicFanmarkAccess(payload);
}

export async function fetchPublicFanmarkByEmojiIds(emojiIds: string[], options?: FetchOptions): Promise<PublicFanmarkAccessRecord | null> {
  if (emojiIds.length < 1 || emojiIds.length > 5 || emojiIds.some((id) => !UUID_PATTERN.test(id))) {
    throw new PublicAccessApiError("configuration");
  }
  const payload = await readWorkerPayload(PUBLIC_ACCESS_EMOJI_PATH, options ?? {}, { emojiIds });
  return payload === null ? null : parsePublicFanmarkAccess(payload);
}

export async function fetchPublicEmojiProfile(licenseId: string, options?: FetchOptions): Promise<PublicEmojiProfileRecord | null> {
  if (!UUID_PATTERN.test(licenseId)) throw new PublicAccessApiError("configuration");
  const payload = await readWorkerPayload(`${PUBLIC_PROFILE_PATH}${encodeURIComponent(licenseId)}`, options ?? {});
  return payload === null ? null : parsePublicEmojiProfile(payload);
}
