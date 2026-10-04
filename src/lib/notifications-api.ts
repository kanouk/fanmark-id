import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const NOTIFICATIONS_PATH = "/api/me/notifications";
const MAX_RESPONSE_BYTES = 256 * 1024;
const TIMEOUT_MS = 5_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CHANNELS = new Set(["in_app", "email", "webpush"]);

export interface UserNotification {
  id: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  triggered_at: string;
  priority: number;
  channel: string;
}

export class NotificationsApiError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network" | "timeout";
  readonly status?: number;

  constructor(kind: NotificationsApiError["kind"], status?: number) {
    super(kind === "http" && status ? `notifications request failed (${status})` : `notifications request ${kind}`);
    this.name = "NotificationsApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getNotificationsBackend(
  value: string | undefined = import.meta.env?.VITE_NOTIFICATIONS_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new NotificationsApiError("configuration");
}

function apiUrl(baseUrl: string, suffix = ""): URL {
  let url: URL;
  try {
    url = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new NotificationsApiError("configuration");
  }
  url.pathname = `${NOTIFICATIONS_PATH}${suffix}`;
  url.search = "";
  url.hash = "";
  return url;
}

function assertAuthOrigin(baseUrl: string, authBaseUrl?: string): void {
  if (!authBaseUrl?.trim()) return;
  try {
    if (apiUrl(baseUrl).origin !== buildRecentFanmarksApiUrl(authBaseUrl.trim()).origin) {
      throw new NotificationsApiError("configuration");
    }
  } catch {
    throw new NotificationsApiError("configuration");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function parseNotification(value: unknown): UserNotification {
  const fields = ["id", "payload", "read_at", "triggered_at", "priority", "channel"];
  if (
    !isRecord(value) || !exactKeys(value, fields) ||
    typeof value.id !== "string" || !UUID_RE.test(value.id) ||
    !isRecord(value.payload) || JSON.stringify(value.payload).length > 16 * 1024 ||
    !(value.read_at === null || (typeof value.read_at === "string" && Number.isFinite(Date.parse(value.read_at)))) ||
    typeof value.triggered_at !== "string" || !Number.isFinite(Date.parse(value.triggered_at)) ||
    typeof value.priority !== "number" || !Number.isInteger(value.priority) || value.priority < 1 || value.priority > 10 ||
    typeof value.channel !== "string" || !CHANNELS.has(value.channel)
  ) throw new NotificationsApiError("invalid_response");
  return value as unknown as UserNotification;
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json" || !response.body) throw new NotificationsApiError("invalid_response");
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/u.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
    await response.body.cancel();
    throw new NotificationsApiError("invalid_response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new NotificationsApiError("invalid_response");
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof NotificationsApiError) throw error;
    throw new NotificationsApiError("invalid_response");
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new NotificationsApiError("invalid_response");
  }
}

interface RequestOptions {
  baseUrl?: string;
  authBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function request(url: URL, method: string, body: unknown, options: RequestOptions): Promise<unknown> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!baseUrl) throw new NotificationsApiError("configuration");
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new NotificationsApiError("configuration");
  assertAuthOrigin(baseUrl, options.authBaseUrl ?? (import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ||
    (typeof window === "undefined" ? undefined : window.location.origin)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) }),
      ...(body === undefined ? { headers: { accept: "application/json" } } : {}),
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new NotificationsApiError("http", response.status);
    }
    return await readJson(response);
  } catch (error) {
    if (error instanceof NotificationsApiError) throw error;
    if (controller.signal.aborted) throw new NotificationsApiError("timeout");
    throw new NotificationsApiError("network");
  } finally {
    clearTimeout(timer);
  }
}

export async function loadOwnNotifications(limit = 50, options: RequestOptions = {}): Promise<UserNotification[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new NotificationsApiError("configuration");
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!baseUrl) throw new NotificationsApiError("configuration");
  const url = apiUrl(baseUrl);
  url.searchParams.set("limit", String(limit));
  const payload = await request(url, "GET", undefined, options);
  if (!isRecord(payload) || !exactKeys(payload, ["schemaVersion", "notifications"]) || payload.schemaVersion !== 1 ||
      !Array.isArray(payload.notifications) || payload.notifications.length > limit) {
    throw new NotificationsApiError("invalid_response");
  }
  return payload.notifications.map(parseNotification);
}

export async function loadOwnUnreadNotificationCount(options: RequestOptions = {}): Promise<number> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!baseUrl) throw new NotificationsApiError("configuration");
  const payload = await request(apiUrl(baseUrl, "/unread-count"), "GET", undefined, options);
  if (!isRecord(payload) || !exactKeys(payload, ["schemaVersion", "count"]) || payload.schemaVersion !== 1 ||
      typeof payload.count !== "number" || !Number.isSafeInteger(payload.count) || payload.count < 0) {
    throw new NotificationsApiError("invalid_response");
  }
  return payload.count;
}

export async function markOwnNotificationRead(
  id: string,
  readVia: "app" | "menu",
  options: RequestOptions = {},
): Promise<boolean> {
  if (!UUID_RE.test(id) || (readVia !== "app" && readVia !== "menu")) throw new NotificationsApiError("configuration");
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!baseUrl) throw new NotificationsApiError("configuration");
  const payload = await request(apiUrl(baseUrl, `/${id.toLowerCase()}/read`), "PATCH", { readVia }, options);
  if (!isRecord(payload) || !exactKeys(payload, ["schemaVersion", "updated"]) || payload.schemaVersion !== 1 || typeof payload.updated !== "boolean") {
    throw new NotificationsApiError("invalid_response");
  }
  return payload.updated;
}

export async function markAllOwnNotificationsRead(options: RequestOptions = {}): Promise<number> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!baseUrl) throw new NotificationsApiError("configuration");
  const payload = await request(apiUrl(baseUrl, "/read-all"), "POST", undefined, options);
  if (!isRecord(payload) || !exactKeys(payload, ["schemaVersion", "updatedCount"]) || payload.schemaVersion !== 1 ||
      typeof payload.updatedCount !== "number" || !Number.isSafeInteger(payload.updatedCount) || payload.updatedCount < 0) {
    throw new NotificationsApiError("invalid_response");
  }
  return payload.updatedCount;
}
