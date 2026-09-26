import { buildRecentFanmarksApiUrl } from "./recent-fanmarks.ts";

const SETTINGS_API_PREFIX = "/api/me/fanmarks/";
const MAX_RESPONSE_BYTES = 32 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface OwnerFanmarkSettings {
  id: string;
  user_input_fanmark: string;
  display_fanmark: string | null;
  emoji_ids: string[];
  fanmark_name: string | null;
  access_type: "profile" | "redirect" | "text" | "inactive";
  target_url: string | null;
  text_content: string | null;
  is_password_protected: boolean;
  status: string;
  short_id: string;
  license_id: string;
  is_public: boolean;
  has_active_license: boolean;
}

export interface OwnerFanmarkSettingsPatch {
  fanmarkName: string;
  accessType: OwnerFanmarkSettings["access_type"];
  targetUrl?: string;
  textContent?: string;
  isPasswordProtected: boolean;
  accessPassword?: string;
  isPublic: boolean;
}

export type FanmarkSettingsApiErrorKind = "configuration" | "http" | "invalid_response" | "network" | "timeout";

export class FanmarkSettingsApiError extends Error {
  readonly kind: FanmarkSettingsApiErrorKind;
  readonly status?: number;

  constructor(kind: FanmarkSettingsApiErrorKind, status?: number) {
    super(kind === "http" && status ? `fanmark settings request failed (${status})` : `fanmark settings request ${kind}`);
    this.name = "FanmarkSettingsApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getFanmarkSettingsBackend(
  value: string | undefined = import.meta.env?.VITE_FANMARK_SETTINGS_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new FanmarkSettingsApiError("configuration");
}

export function buildFanmarkSettingsApiUrl(baseUrl: string, fanmarkId: string): URL {
  if (!UUID_PATTERN.test(fanmarkId)) throw new FanmarkSettingsApiError("configuration");
  let url: URL;
  try {
    url = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new FanmarkSettingsApiError("configuration");
  }
  url.pathname = `${SETTINGS_API_PREFIX}${encodeURIComponent(fanmarkId.toLowerCase())}/settings`;
  url.search = "";
  url.hash = "";
  return url;
}

function assertAuthOrigin(baseUrl: string, authBaseUrl?: string): void {
  if (!authBaseUrl?.trim()) return;
  try {
    if (buildFanmarkSettingsApiUrl(baseUrl, "45111111-1111-4111-8111-111111111111").origin !==
        buildRecentFanmarksApiUrl(authBaseUrl.trim()).origin) {
      throw new FanmarkSettingsApiError("configuration");
    }
  } catch {
    throw new FanmarkSettingsApiError("configuration");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseSettings(value: unknown): OwnerFanmarkSettings {
  const keys = [
    "id", "user_input_fanmark", "display_fanmark", "emoji_ids", "fanmark_name", "access_type",
    "target_url", "text_content", "is_password_protected", "status", "short_id", "license_id",
    "is_public", "has_active_license",
  ];
  if (!isRecord(value) || Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
      typeof value.id !== "string" || !UUID_PATTERN.test(value.id) ||
      typeof value.user_input_fanmark !== "string" || !isNullableString(value.display_fanmark) ||
      !Array.isArray(value.emoji_ids) || value.emoji_ids.length > 5 || value.emoji_ids.some((id) => typeof id !== "string") ||
      !isNullableString(value.fanmark_name) || !["profile", "redirect", "text", "inactive"].includes(String(value.access_type)) ||
      !isNullableString(value.target_url) || !isNullableString(value.text_content) ||
      typeof value.is_password_protected !== "boolean" || typeof value.status !== "string" ||
      typeof value.short_id !== "string" || typeof value.license_id !== "string" || !UUID_PATTERN.test(value.license_id) ||
      typeof value.is_public !== "boolean" || typeof value.has_active_license !== "boolean") {
    throw new FanmarkSettingsApiError("invalid_response");
  }
  return value as unknown as OwnerFanmarkSettings;
}

async function readResponse(response: Response): Promise<OwnerFanmarkSettings> {
  if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new FanmarkSettingsApiError("invalid_response");
  }
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new FanmarkSettingsApiError("invalid_response");
    }
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new FanmarkSettingsApiError("invalid_response");
  }
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new FanmarkSettingsApiError("invalid_response");
  try {
    const payload = JSON.parse(text) as unknown;
    if (!isRecord(payload) || payload.schemaVersion !== 1 || !isRecord(payload.fanmark)) {
      throw new FanmarkSettingsApiError("invalid_response");
    }
    return parseSettings(payload.fanmark);
  } catch (error) {
    if (error instanceof FanmarkSettingsApiError) throw error;
    throw new FanmarkSettingsApiError("invalid_response");
  }
}

async function requestOwnerSettings(
  fanmarkId: string,
  patch?: OwnerFanmarkSettingsPatch,
  options: {
    baseUrl?: string;
    authBaseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<OwnerFanmarkSettings> {
  const baseUrl = options.baseUrl ?? import.meta.env?.VITE_FANMARK_API_BASE_URL;
  if (!baseUrl) throw new FanmarkSettingsApiError("configuration");
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new FanmarkSettingsApiError("configuration");
  const url = buildFanmarkSettingsApiUrl(baseUrl, fanmarkId);
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
    if (!response.ok) throw new FanmarkSettingsApiError("http", response.status);
    return await readResponse(response);
  } catch (error) {
    if (error instanceof FanmarkSettingsApiError) throw error;
    if (controller.signal.aborted) throw new FanmarkSettingsApiError("timeout");
    throw new FanmarkSettingsApiError("network");
  } finally {
    clearTimeout(timer);
  }
}

export function getOwnerFanmarkSettings(
  fanmarkId: string,
  options?: Parameters<typeof requestOwnerSettings>[2],
): Promise<OwnerFanmarkSettings> {
  return requestOwnerSettings(fanmarkId, undefined, options);
}

export function saveOwnerFanmarkSettings(
  fanmarkId: string,
  patch: OwnerFanmarkSettingsPatch,
  options?: Parameters<typeof requestOwnerSettings>[2],
): Promise<OwnerFanmarkSettings> {
  return requestOwnerSettings(fanmarkId, patch, options);
}
