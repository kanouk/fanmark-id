import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const PUBLIC_PATH = "/api/system/maintenance";
const ADMIN_PATH = "/api/admin/system-settings/maintenance";
const TIMEOUT_MS = 5_000;
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_RESPONSE_BYTES = 8 * 1024;

export interface MaintenanceSettings {
  maintenance_mode: boolean;
  maintenance_message: string;
  maintenance_end_time: string | null;
}

export type MaintenanceSettingsPatch = Partial<MaintenanceSettings>;

const DEFAULT_SETTINGS: MaintenanceSettings = {
  maintenance_mode: false,
  maintenance_message: "",
  maintenance_end_time: null,
};

export class MaintenanceSettingsApiError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network" | "timeout";
  readonly status?: number;

  constructor(kind: MaintenanceSettingsApiError["kind"], status?: number) {
    super(kind === "http" && status
      ? `maintenance settings request failed (${status})`
      : `maintenance settings request ${kind}`);
    this.name = "MaintenanceSettingsApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getMaintenanceSettingsBackend(
  value: string | undefined = import.meta.env?.VITE_MAINTENANCE_SETTINGS_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new MaintenanceSettingsApiError("configuration");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseMaintenanceSettingsPayload(value: unknown): MaintenanceSettings {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.settings)) {
    throw new MaintenanceSettingsApiError("invalid_response");
  }
  const settings = value.settings;
  if (
    Object.keys(settings).length !== 3 ||
    typeof settings.maintenance_mode !== "boolean" ||
    typeof settings.maintenance_message !== "string" ||
    settings.maintenance_message.length > MAX_MESSAGE_LENGTH ||
    !(settings.maintenance_end_time === null ||
      (typeof settings.maintenance_end_time === "string" &&
        settings.maintenance_end_time.length <= 64 &&
        Number.isFinite(Date.parse(settings.maintenance_end_time))))
  ) {
    throw new MaintenanceSettingsApiError("invalid_response");
  }
  return settings as unknown as MaintenanceSettings;
}

export function parseMaintenanceSettingsPatch(value: unknown): MaintenanceSettingsPatch {
  if (!isRecord(value)) throw new MaintenanceSettingsApiError("configuration");
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => ![
    "maintenance_mode", "maintenance_message", "maintenance_end_time",
  ].includes(key))) throw new MaintenanceSettingsApiError("configuration");
  if (Object.prototype.hasOwnProperty.call(value, "maintenance_mode") && typeof value.maintenance_mode !== "boolean") {
    throw new MaintenanceSettingsApiError("configuration");
  }
  if (Object.prototype.hasOwnProperty.call(value, "maintenance_message") &&
      (typeof value.maintenance_message !== "string" || value.maintenance_message.length > MAX_MESSAGE_LENGTH)) {
    throw new MaintenanceSettingsApiError("configuration");
  }
  if (Object.prototype.hasOwnProperty.call(value, "maintenance_end_time") && value.maintenance_end_time !== null &&
      (typeof value.maintenance_end_time !== "string" || value.maintenance_end_time.length > 64 ||
        !Number.isFinite(Date.parse(value.maintenance_end_time)))) {
    throw new MaintenanceSettingsApiError("configuration");
  }
  return value as MaintenanceSettingsPatch;
}

function workerUrl(path: string, baseUrl: string): URL {
  let url: URL;
  try {
    url = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new MaintenanceSettingsApiError("configuration");
  }
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url;
}

function assertSameOrigin(baseUrl: string, authBaseUrl?: string): void {
  if (!authBaseUrl?.trim()) return;
  try {
    if (workerUrl(PUBLIC_PATH, baseUrl).origin !== buildRecentFanmarksApiUrl(authBaseUrl.trim()).origin) {
      throw new MaintenanceSettingsApiError("configuration");
    }
  } catch {
    throw new MaintenanceSettingsApiError("configuration");
  }
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json" || !response.body) {
    throw new MaintenanceSettingsApiError("invalid_response");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    await response.body.cancel();
    throw new MaintenanceSettingsApiError("invalid_response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new MaintenanceSettingsApiError("invalid_response");
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
    throw new MaintenanceSettingsApiError("invalid_response");
  }
}

async function request(
  path: string,
  method: "GET" | "PATCH",
  patch: MaintenanceSettingsPatch | undefined,
  options: { apiBaseUrl?: string; authBaseUrl?: string; fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<MaintenanceSettings> {
  const apiBaseUrl = options.apiBaseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!apiBaseUrl) throw new MaintenanceSettingsApiError("configuration");
  const authBaseUrl = options.authBaseUrl ?? (import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ||
    (typeof window === "undefined" ? undefined : window.location.origin));
  assertSameOrigin(apiBaseUrl, authBaseUrl);
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new MaintenanceSettingsApiError("configuration");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetcher ?? fetch)(workerUrl(path, apiBaseUrl), {
      method,
      headers: patch ? { accept: "application/json", "content-type": "application/json" } : { accept: "application/json" },
      ...(patch ? { body: JSON.stringify(parseMaintenanceSettingsPatch(patch)) } : {}),
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new MaintenanceSettingsApiError("http", response.status);
    }
    return parseMaintenanceSettingsPayload(await readJson(response));
  } catch (error) {
    if (error instanceof MaintenanceSettingsApiError) throw error;
    if (controller.signal.aborted) throw new MaintenanceSettingsApiError("timeout");
    throw new MaintenanceSettingsApiError("network");
  } finally {
    clearTimeout(timer);
  }
}

export function fetchMaintenanceSettingsFromWorker(options?: Parameters<typeof request>[3]): Promise<MaintenanceSettings> {
  return request(PUBLIC_PATH, "GET", undefined, options);
}

export function updateMaintenanceSettingsInWorker(
  patch: MaintenanceSettingsPatch,
  options?: Parameters<typeof request>[3],
): Promise<MaintenanceSettings> {
  return request(ADMIN_PATH, "PATCH", patch, options);
}

export function defaultMaintenanceSettings(): MaintenanceSettings {
  return { ...DEFAULT_SETTINGS };
}
