import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const PUBLIC_PATH = "/api/system/settings";
const ADMIN_PATH = "/api/admin/system-settings";
const TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 16 * 1024;

export const SYSTEM_SETTINGS_PUBLIC_KEYS = [
  "invitation_mode",
  "social_login_enabled",
  "free_fanmarks_limit",
  "creator_fanmarks_limit",
  "max_fanmarks_limit",
  "business_fanmarks_limit",
  "premium_pricing",
  "max_pricing",
  "business_pricing",
  "max_emoji_characters",
  "creator_stripe_price_id",
  "max_stripe_price_id",
  "business_stripe_price_id",
  "creator_stripe_price_id_live",
  "max_stripe_price_id_live",
  "business_stripe_price_id_live",
  "stripe_mode",
] as const;

export const SYSTEM_SETTINGS_ADMIN_KEYS = [
  ...SYSTEM_SETTINGS_PUBLIC_KEYS,
  "enterprise_fanmarks_limit",
  "enterprise_pricing",
] as const;

export type SystemSettingsBackend = "supabase" | "worker";

export class SystemSettingsApiError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network" | "timeout";
  readonly status?: number;

  constructor(kind: SystemSettingsApiError["kind"], status?: number) {
    super(kind === "http" && status
      ? `system settings request failed (${status})`
      : `system settings request ${kind}`);
    this.name = "SystemSettingsApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getSystemSettingsBackend(
  value: string | undefined = import.meta.env?.VITE_SYSTEM_SETTINGS_BACKEND,
): SystemSettingsBackend {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new SystemSettingsApiError("configuration");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function parseSettingsPayload(value: unknown, includePrivate: boolean): Record<string, string> {
  const expected = includePrivate ? SYSTEM_SETTINGS_ADMIN_KEYS : SYSTEM_SETTINGS_PUBLIC_KEYS;
  if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "settings"]) || value.schemaVersion !== 1 ||
      !isRecord(value.settings) || !exactKeys(value.settings, expected) ||
      Object.values(value.settings).some((setting) => typeof setting !== "string")) {
    throw new SystemSettingsApiError("invalid_response");
  }
  return value.settings as Record<string, string>;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new SystemSettingsApiError("http", response.status);
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json" || !response.body) throw new SystemSettingsApiError("invalid_response");
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/u.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
    await response.body.cancel();
    throw new SystemSettingsApiError("invalid_response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new SystemSettingsApiError("invalid_response");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new SystemSettingsApiError("invalid_response");
  }
}

interface RequestOptions {
  apiBaseUrl?: string;
  authBaseUrl?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

function endpoint(path: string, baseUrl: string): URL {
  try {
    const url = buildRecentFanmarksApiUrl(baseUrl);
    url.pathname = path;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    throw new SystemSettingsApiError("configuration");
  }
}

async function request(path: string, includePrivate: boolean, options: RequestOptions): Promise<Record<string, string>> {
  const apiBaseUrl = options.apiBaseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!apiBaseUrl) throw new SystemSettingsApiError("configuration");
  const url = endpoint(path, apiBaseUrl);
  const authBaseUrl = options.authBaseUrl ??
    (import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() || (typeof window === "undefined" ? undefined : window.location.origin));
  if (authBaseUrl) {
    try {
      if (url.origin !== new URL(authBaseUrl).origin) throw new SystemSettingsApiError("configuration");
    } catch {
      throw new SystemSettingsApiError("configuration");
    }
  }
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new SystemSettingsApiError("configuration");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    return parseSettingsPayload(await readJson(response), includePrivate);
  } catch (error) {
    if (controller.signal.aborted) throw new SystemSettingsApiError("timeout");
    if (error instanceof SystemSettingsApiError) throw error;
    throw new SystemSettingsApiError("network");
  } finally {
    clearTimeout(timer);
  }
}

export function fetchSystemSettingsFromWorker(
  options: RequestOptions & { includePrivate?: boolean } = {},
): Promise<Record<string, string>> {
  const includePrivate = options.includePrivate ?? false;
  return request(includePrivate ? ADMIN_PATH : PUBLIC_PATH, includePrivate, options);
}

export async function updateSystemSettingInWorker(
  input: { key: string; value: string; expectedValue: string },
  options: RequestOptions = {},
): Promise<void> {
  if (!SYSTEM_SETTINGS_ADMIN_KEYS.includes(input.key as typeof SYSTEM_SETTINGS_ADMIN_KEYS[number]) ||
      typeof input.value !== "string" || typeof input.expectedValue !== "string") {
    throw new SystemSettingsApiError("configuration");
  }
  const apiBaseUrl = options.apiBaseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!apiBaseUrl) throw new SystemSettingsApiError("configuration");
  const url = endpoint(ADMIN_PATH, apiBaseUrl);
  const authBaseUrl = options.authBaseUrl ??
    (import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() || (typeof window === "undefined" ? undefined : window.location.origin));
  if (authBaseUrl) {
    try {
      if (url.origin !== new URL(authBaseUrl).origin) throw new SystemSettingsApiError("configuration");
    } catch {
      throw new SystemSettingsApiError("configuration");
    }
  }
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new SystemSettingsApiError("configuration");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method: "PATCH",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(input),
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const payload = await readJson(response);
    if (!isRecord(payload) || !exactKeys(payload, ["schemaVersion", "updatedSetting"]) ||
        payload.schemaVersion !== 1 || payload.updatedSetting !== input.key) {
      throw new SystemSettingsApiError("invalid_response");
    }
  } catch (error) {
    if (controller.signal.aborted) throw new SystemSettingsApiError("timeout");
    if (error instanceof SystemSettingsApiError) throw error;
    throw new SystemSettingsApiError("network");
  } finally {
    clearTimeout(timer);
  }
}
