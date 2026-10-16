import {
  buildPublicAccessApiUrl,
  PUBLIC_ACCESS_API_TIMEOUT_MS,
  PublicAccessApiError,
  type PublicProfileThemeSettings,
} from "./public-access-api.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_TEXT_BYTES = 16 * 1024;
const SOCIAL_KEYS = new Set([
  "instagram", "tiktok", "x", "youtube", "bereal", "line", "threads", "bluesky",
  "github", "discord", "snapchat", "twitch", "facebook", "website",
]);
const THEME_KEYS = new Set([
  "cover_image_url", "cover_image_dimensions", "cover_image_position",
  "profile_image_url", "theme_color", "button_style",
]);

export type VerifiedAccessApiErrorKind = "aborted" | "configuration" | "http" | "invalid_response" | "network" | "timeout";

export class VerifiedAccessApiError extends Error {
  readonly kind: VerifiedAccessApiErrorKind;
  readonly status?: number;

  constructor(kind: VerifiedAccessApiErrorKind, status?: number) {
    super(kind === "http" && status ? `verified access request failed (${status})` : `verified access request ${kind}`);
    this.name = "VerifiedAccessApiError";
    this.kind = kind;
    this.status = status;
  }
}

export type VerifiedAccessSelector =
  | { kind: "short"; shortId: string }
  | { kind: "emoji"; emojiIds: string[] };

export interface ProtectedFanmarkProfile {
  name: string | null;
  bio: string | null;
  socialLinks: Record<string, string>;
  themeSettings: PublicProfileThemeSettings;
}

export type ProtectedFanmarkProjection =
  | { fanmarkId: string; licenseId: string; accessType: "redirect"; targetUrl: string }
  | { fanmarkId: string; licenseId: string; accessType: "text"; textContent: string }
  | { fanmarkId: string; licenseId: string; accessType: "profile"; profile: ProtectedFanmarkProfile };

interface RequestOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function getVerifiedAccessBackend(
  value: string | undefined = import.meta.env?.VITE_VERIFIED_ACCESS_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new VerifiedAccessApiError("configuration");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isNullableString(value: unknown, maxLength: number): value is string | null {
  return value === null || (typeof value === "string" && value.length <= maxLength);
}

function validProfileUrl(value: string): boolean {
  if (value.length > 2048) return false;
  for (const character of value) {
    const codepoint = character.codePointAt(0) ?? 0;
    if (codepoint <= 0x20 || codepoint === 0x7f) return false;
  }
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return Boolean(url.hostname) && !url.username && !url.password;
    }
    return url.protocol === "tel:" && url.hostname === "";
  } catch {
    return false;
  }
}

function parseSocialLinks(value: unknown): Record<string, string> | null {
  if (!isRecord(value) || Object.keys(value).length > 32) return null;
  const links: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!SOCIAL_KEYS.has(key) || typeof candidate !== "string" || !validProfileUrl(candidate)) return null;
    links[key] = candidate;
  }
  return links;
}

function parseThemeSettings(value: unknown): PublicProfileThemeSettings | null {
  if (!isRecord(value) || Object.keys(value).length > 8) return null;
  const theme: PublicProfileThemeSettings = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!THEME_KEYS.has(key)) return null;
    if (key === "cover_image_dimensions") {
      if (
        !isRecord(candidate) ||
        !exactKeys(candidate, ["width", "height"]) ||
        !Number.isInteger(candidate.width) || Number(candidate.width) < 1 || Number(candidate.width) > 10_000 ||
        !Number.isInteger(candidate.height) || Number(candidate.height) < 1 || Number(candidate.height) > 10_000
      ) return null;
      theme.cover_image_dimensions = { width: Number(candidate.width), height: Number(candidate.height) };
    } else if (key === "cover_image_position") {
      if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0 || candidate > 100) return null;
      theme.cover_image_position = candidate;
    } else if (key === "cover_image_url" || key === "profile_image_url") {
      if (typeof candidate !== "string" || (candidate !== "" && !validProfileUrl(candidate))) return null;
      theme[key] = candidate;
    } else if (key === "theme_color") {
      if (typeof candidate !== "string" || !/^#[0-9a-f]{3,8}$/iu.test(candidate)) return null;
      theme.theme_color = candidate;
    } else if (key === "button_style") {
      if (typeof candidate !== "string" || new TextEncoder().encode(candidate).byteLength > 64) return null;
      theme.button_style = candidate;
    }
  }
  return theme;
}

function parseProtectedProfile(value: unknown): ProtectedFanmarkProfile | null {
  if (!isRecord(value) || !exactKeys(value, ["name", "bio", "socialLinks", "themeSettings"])) return null;
  if (!isNullableString(value.name, 50) || !isNullableString(value.bio, 500)) return null;
  const socialLinks = parseSocialLinks(value.socialLinks);
  const themeSettings = parseThemeSettings(value.themeSettings);
  if (!socialLinks || !themeSettings) return null;
  return { name: value.name, bio: value.bio, socialLinks, themeSettings };
}

function parseProtectedProjection(value: unknown): ProtectedFanmarkProjection {
  if (!isRecord(value) || !UUID_PATTERN.test(String(value.fanmarkId ?? "")) || !UUID_PATTERN.test(String(value.licenseId ?? ""))) {
    throw new VerifiedAccessApiError("invalid_response");
  }
  const baseKeys = ["fanmarkId", "licenseId", "accessType"];
  if (value.accessType === "redirect" && exactKeys(value, [...baseKeys, "targetUrl"])) {
    if (typeof value.targetUrl !== "string" || !validProfileUrl(value.targetUrl)) throw new VerifiedAccessApiError("invalid_response");
    return { fanmarkId: value.fanmarkId as string, licenseId: value.licenseId as string, accessType: "redirect", targetUrl: value.targetUrl };
  }
  if (value.accessType === "text" && exactKeys(value, [...baseKeys, "textContent"])) {
    if (typeof value.textContent !== "string" || new TextEncoder().encode(value.textContent).byteLength > MAX_TEXT_BYTES) {
      throw new VerifiedAccessApiError("invalid_response");
    }
    return { fanmarkId: value.fanmarkId as string, licenseId: value.licenseId as string, accessType: "text", textContent: value.textContent };
  }
  if (value.accessType === "profile" && exactKeys(value, [...baseKeys, "profile"])) {
    const profile = parseProtectedProfile(value.profile);
    if (!profile) throw new VerifiedAccessApiError("invalid_response");
    return { fanmarkId: value.fanmarkId as string, licenseId: value.licenseId as string, accessType: "profile", profile };
  }
  throw new VerifiedAccessApiError("invalid_response");
}

function selectorPaths(selector: VerifiedAccessSelector): { verify: string; protected: string; body: (password?: string) => unknown } {
  if (selector.kind === "short") {
    if (!selector.shortId || selector.shortId.trim() !== selector.shortId || selector.shortId.includes("/") || selector.shortId.includes("\\") || new TextEncoder().encode(selector.shortId).byteLength > 256) {
      throw new VerifiedAccessApiError("configuration");
    }
    const pathValue = encodeURIComponent(selector.shortId);
    return {
      verify: `/api/fanmarks/access/short/${pathValue}/verify-password`,
      protected: `/api/fanmarks/access/short/${pathValue}/protected`,
      body: (password) => ({ password }),
    };
  }
  if (
    !Array.isArray(selector.emojiIds) || selector.emojiIds.length < 1 || selector.emojiIds.length > 5 ||
    selector.emojiIds.some((id) => !UUID_PATTERN.test(id))
  ) throw new VerifiedAccessApiError("configuration");
  const emojiIds = [...selector.emojiIds];
  return {
    verify: "/api/fanmarks/access/emoji/verify-password",
    protected: "/api/fanmarks/access/emoji/protected",
    body: (password) => password === undefined ? { emojiIds } : { emojiIds, password },
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_RESPONSE_BYTES) throw new VerifiedAccessApiError("invalid_response");
  }
  if (!response.body) throw new VerifiedAccessApiError("invalid_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        void reader.cancel();
        throw new VerifiedAccessApiError("invalid_response");
      }
      chunks.push(value);
    }
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
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new VerifiedAccessApiError("invalid_response");
  }
}

async function requestWorker(path: string, body: unknown | undefined, options: RequestOptions): Promise<unknown | null> {
  const {
    baseUrl = import.meta.env?.VITE_FANMARK_API_BASE_URL,
    fetchImpl = fetch,
    signal,
    timeoutMs = PUBLIC_ACCESS_API_TIMEOUT_MS,
  } = options;
  if (!baseUrl || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new VerifiedAccessApiError("configuration");

  let url: URL;
  try {
    url = buildPublicAccessApiUrl(baseUrl, path);
  } catch (error) {
    if (error instanceof PublicAccessApiError) throw new VerifiedAccessApiError("configuration");
    throw error;
  }

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
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new VerifiedAccessApiError("http", response.status);
    if (!(response.headers.get("cache-control") ?? "").split(",").some((directive) => directive.trim().toLowerCase() === "no-store")) {
      throw new VerifiedAccessApiError("invalid_response");
    }
    return response.status === 204 ? null : await readBoundedJson(response);
  } catch (error) {
    if (error instanceof VerifiedAccessApiError) throw error;
    if (signal?.aborted) throw new VerifiedAccessApiError("aborted");
    if (timedOut) throw new VerifiedAccessApiError("timeout");
    throw new VerifiedAccessApiError("network");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function verifyAndReadProtectedFanmark(
  selector: VerifiedAccessSelector,
  password: string,
  options: RequestOptions = {},
): Promise<ProtectedFanmarkProjection> {
  if (!/^\d{4}$/u.test(password)) throw new VerifiedAccessApiError("configuration");
  const paths = selectorPaths(selector);
  const verified = await requestWorker(paths.verify, paths.body(password), options);
  if (verified !== null) throw new VerifiedAccessApiError("invalid_response");
  const projection = await requestWorker(
    paths.protected,
    selector.kind === "emoji" ? paths.body() : undefined,
    options,
  );
  return parseProtectedProjection(projection);
}
