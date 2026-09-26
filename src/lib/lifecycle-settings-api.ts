import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const PUBLIC_PATH = "/api/system/lifecycle";
const ADMIN_PATH = "/api/admin/system-settings/lifecycle";
const TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 4 * 1024;

export interface LifecycleSettings {
  grace_period_days: number;
}

export class LifecycleSettingsApiError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network" | "timeout";
  readonly status?: number;

  constructor(kind: LifecycleSettingsApiError["kind"], status?: number) {
    super(kind === "http" && status
      ? `lifecycle settings request failed (${status})`
      : `lifecycle settings request ${kind}`);
    this.name = "LifecycleSettingsApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getLifecycleSettingsBackend(
  value: string | undefined = import.meta.env?.VITE_LIFECYCLE_SETTINGS_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new LifecycleSettingsApiError("configuration");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseLifecycleSettingsPayload(value: unknown): LifecycleSettings {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.settings) ||
      Object.keys(value.settings).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(value.settings, "grace_period_days") ||
      !Number.isSafeInteger(value.settings.grace_period_days) ||
      Number(value.settings.grace_period_days) < 1 || Number(value.settings.grace_period_days) > 365) {
    throw new LifecycleSettingsApiError("invalid_response");
  }
  return { grace_period_days: Number(value.settings.grace_period_days) };
}

function endpoint(baseUrl: string, path: string): URL {
  try {
    const url = buildRecentFanmarksApiUrl(baseUrl);
    url.pathname = path;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    throw new LifecycleSettingsApiError("configuration");
  }
}

function assertSameOrigin(apiBaseUrl: string, authBaseUrl?: string): void {
  if (!authBaseUrl?.trim()) return;
  try {
    if (endpoint(apiBaseUrl, PUBLIC_PATH).origin !== buildRecentFanmarksApiUrl(authBaseUrl.trim()).origin) {
      throw new LifecycleSettingsApiError("configuration");
    }
  } catch {
    throw new LifecycleSettingsApiError("configuration");
  }
}

async function readJson(response: Response): Promise<unknown> {
  if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !response.body) {
    throw new LifecycleSettingsApiError("invalid_response");
  }
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/u.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
    await response.body.cancel();
    throw new LifecycleSettingsApiError("invalid_response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new LifecycleSettingsApiError("invalid_response");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new LifecycleSettingsApiError("invalid_response");
  }
}

async function request(
  method: "GET" | "PATCH",
  days: number | undefined,
  options: { apiBaseUrl?: string; authBaseUrl?: string; fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<LifecycleSettings> {
  const apiBaseUrl = options.apiBaseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!apiBaseUrl) throw new LifecycleSettingsApiError("configuration");
  const authBaseUrl = options.authBaseUrl ?? (import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ||
    (typeof window === "undefined" ? undefined : window.location.origin));
  assertSameOrigin(apiBaseUrl, authBaseUrl);
  if (method === "PATCH" && (!Number.isSafeInteger(days) || Number(days) < 1 || Number(days) > 365)) {
    throw new LifecycleSettingsApiError("configuration");
  }
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new LifecycleSettingsApiError("configuration");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetcher ?? fetch)(endpoint(apiBaseUrl, method === "GET" ? PUBLIC_PATH : ADMIN_PATH), {
      method,
      headers: method === "PATCH"
        ? { accept: "application/json", "content-type": "application/json" }
        : { accept: "application/json" },
      ...(method === "PATCH" ? { body: JSON.stringify({ grace_period_days: days }) } : {}),
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new LifecycleSettingsApiError("http", response.status);
    }
    return parseLifecycleSettingsPayload(await readJson(response));
  } catch (error) {
    if (error instanceof LifecycleSettingsApiError) throw error;
    if (controller.signal.aborted) throw new LifecycleSettingsApiError("timeout");
    throw new LifecycleSettingsApiError("network");
  } finally {
    clearTimeout(timer);
  }
}

export function fetchLifecycleSettingsFromWorker(options?: Parameters<typeof request>[2]): Promise<LifecycleSettings> {
  return request("GET", undefined, options);
}

export function updateGracePeriodInWorker(
  days: number,
  options?: Parameters<typeof request>[2],
): Promise<LifecycleSettings> {
  return request("PATCH", days, options);
}
