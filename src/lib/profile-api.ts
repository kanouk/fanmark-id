import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const PROFILE_PATH = "/api/me/profile";
const MAX_RESPONSE_BYTES = 16 * 1024;
const TIMEOUT_MS = 5_000;
const LANGUAGES = new Set(["en", "ja", "ko", "id"]);
const PLANS = new Set(["free", "creator", "max", "business", "enterprise", "admin"]);

export interface OwnProfile {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  plan_type: string;
  preferred_language: string;
  created_at: string;
  updated_at: string;
  requires_password_setup: boolean;
}

export type OwnProfilePatch = Partial<Pick<OwnProfile, "display_name" | "avatar_url" | "preferred_language">>;

export type ProfileApiErrorKind = "configuration" | "http" | "invalid_response" | "network" | "timeout";

export class ProfileApiError extends Error {
  readonly kind: ProfileApiErrorKind;
  readonly status?: number;

  constructor(kind: ProfileApiErrorKind, status?: number) {
    super(kind === "http" && status ? `profile request failed (${status})` : `profile request ${kind}`);
    this.name = "ProfileApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getOwnProfileBackend(value: string | undefined = import.meta.env?.VITE_PROFILE_BACKEND): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new ProfileApiError("configuration");
}

export function buildOwnProfileApiUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new ProfileApiError("configuration");
  }
  url.pathname = PROFILE_PATH;
  url.search = "";
  url.hash = "";
  return url;
}

function assertAuthOrigin(baseUrl: string, authBaseUrl?: string): void {
  if (!authBaseUrl?.trim()) return;
  try {
    if (buildOwnProfileApiUrl(baseUrl).origin !== buildRecentFanmarksApiUrl(authBaseUrl.trim()).origin) {
      throw new ProfileApiError("configuration");
    }
  } catch {
    throw new ProfileApiError("configuration");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableText(value: unknown): value is string | null {
  return value === null || isText(value);
}

function parseProfile(value: unknown): OwnProfile {
  const expectedKeys = ["id", "user_id", "username", "display_name", "avatar_url", "plan_type", "preferred_language", "created_at", "updated_at", "requires_password_setup"];
  if (!isRecord(value) || Object.keys(value).length !== expectedKeys.length || expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
      !isText(value.id) || !isText(value.user_id) || !isText(value.username) ||
      !isNullableText(value.display_name) || !isNullableText(value.avatar_url) ||
      !isText(value.plan_type) || !PLANS.has(value.plan_type) ||
      !isText(value.preferred_language) || !LANGUAGES.has(value.preferred_language) ||
      !isText(value.created_at) || !isText(value.updated_at) ||
      typeof value.requires_password_setup !== "boolean") {
    throw new ProfileApiError("invalid_response");
  }
  return value as unknown as OwnProfile;
}

async function readProfileResponse(response: Response): Promise<OwnProfile> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new ProfileApiError("invalid_response");
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new ProfileApiError("invalid_response");
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new ProfileApiError("invalid_response");
  }
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new ProfileApiError("invalid_response");
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ProfileApiError("invalid_response");
  }
  if (!isRecord(payload) || payload.schemaVersion !== 1 || !Object.prototype.hasOwnProperty.call(payload, "profile")) {
    throw new ProfileApiError("invalid_response");
  }
  return parseProfile(payload.profile);
}

async function requestProfile(patch?: OwnProfilePatch, options: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  authBaseUrl?: string;
} = {}): Promise<OwnProfile> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!baseUrl) throw new ProfileApiError("configuration");
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new ProfileApiError("configuration");
  const url = buildOwnProfileApiUrl(baseUrl);
  const authBaseUrl = options.authBaseUrl ?? (import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ||
    (typeof window === "undefined" ? undefined : window.location.origin));
  assertAuthOrigin(baseUrl, authBaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: patch ? "PATCH" : "GET",
      ...(patch ? { headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(patch) } : { headers: { accept: "application/json" } }),
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new ProfileApiError("http", response.status);
    return await readProfileResponse(response);
  } catch (error) {
    if (error instanceof ProfileApiError) throw error;
    if (controller.signal.aborted) throw new ProfileApiError("timeout");
    throw new ProfileApiError("network");
  } finally {
    clearTimeout(timeout);
  }
}

export function loadOwnProfile(options: Parameters<typeof requestProfile>[1] = {}): Promise<OwnProfile> {
  return requestProfile(undefined, options);
}

export function updateOwnProfile(patch: OwnProfilePatch, options: Parameters<typeof requestProfile>[1] = {}): Promise<OwnProfile> {
  if (!isRecord(patch) || Object.keys(patch).length === 0 || Object.keys(patch).some((key) => !["display_name", "avatar_url", "preferred_language"].includes(key))) {
    throw new ProfileApiError("configuration");
  }
  return requestProfile(patch, options);
}

export async function checkOwnUsernameAvailability(username: string, options: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  authBaseUrl?: string;
} = {}): Promise<boolean> {
  if (typeof username !== "string" || new TextEncoder().encode(username).byteLength > 256) {
    throw new ProfileApiError("configuration");
  }
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!baseUrl) throw new ProfileApiError("configuration");
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new ProfileApiError("configuration");
  const url = buildOwnProfileApiUrl(baseUrl);
  url.pathname = "/api/me/username-availability";
  url.searchParams.set("username", username);
  const authBaseUrl = options.authBaseUrl ?? (import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ||
    (typeof window === "undefined" ? undefined : window.location.origin));
  assertAuthOrigin(baseUrl, authBaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new ProfileApiError("http", response.status);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") throw new ProfileApiError("invalid_response");
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > 1024) throw new ProfileApiError("invalid_response");
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ProfileApiError("invalid_response");
    }
    if (!isRecord(payload) || Object.keys(payload).length !== 2 || payload.schemaVersion !== 1 || typeof payload.available !== "boolean") {
      throw new ProfileApiError("invalid_response");
    }
    return payload.available;
  } catch (error) {
    if (error instanceof ProfileApiError) throw error;
    if (controller.signal.aborted) throw new ProfileApiError("timeout");
    throw new ProfileApiError("network");
  } finally {
    clearTimeout(timeout);
  }
}
