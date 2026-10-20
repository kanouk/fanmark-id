import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const API_PATH = "/api/admin/notification-masters";
const MAX_RESPONSE_BYTES = 256 * 1024;
const TIMEOUT_MS = 5_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CHANNELS = new Set(["in_app", "email", "webpush"]);

export interface NotificationRule {
  id: string;
  event_type: string;
  channel: string;
  template_id: string;
  priority: number;
  delay_seconds: number;
  enabled: boolean;
  updated_at: string;
}

export interface NotificationTemplate {
  id: string;
  template_id: string;
  language: string;
  channel: string;
  version: number;
  title: string | null;
  body: string;
  summary: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationTemplatePatch {
  title: string | null;
  body: string;
  summary: string | null;
  isActive: boolean;
  expectedUpdatedAt: string;
}

export interface NotificationEventLog {
  id: string;
  event_type: string;
  status: string;
  source: string;
  created_at: string;
  processed_at: string | null;
  error_reason: string | null;
}

export interface NotificationDeliveryLog {
  id: string;
  user_id: string;
  channel: string;
  status: string;
  delivered_at: string | null;
  read_at: string | null;
  priority: number;
}

export class NotificationMasterApiError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network" | "timeout";
  readonly status?: number;

  constructor(kind: NotificationMasterApiError["kind"], status?: number) {
    super(kind === "http" && status ? `notification master request failed (${status})` : `notification master request ${kind}`);
    this.name = "NotificationMasterApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getNotificationMasterBackend(
  value: string | undefined = import.meta.env?.VITE_NOTIFICATION_MASTER_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new NotificationMasterApiError("configuration");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function parseRule(value: unknown): NotificationRule {
  const keys = ["id", "event_type", "channel", "template_id", "priority", "delay_seconds", "enabled", "updated_at"];
  if (!isRecord(value) || !exactKeys(value, keys) || typeof value.id !== "string" || !UUID.test(value.id) ||
      typeof value.event_type !== "string" || value.event_type.length < 1 || value.event_type.length > 200 ||
      typeof value.channel !== "string" || !CHANNELS.has(value.channel) ||
      typeof value.template_id !== "string" || value.template_id.length < 1 || value.template_id.length > 200 ||
      typeof value.priority !== "number" || !Number.isInteger(value.priority) ||
      value.priority < 1 || value.priority > 10 || typeof value.delay_seconds !== "number" ||
      !Number.isSafeInteger(value.delay_seconds) || value.delay_seconds < 0 || typeof value.enabled !== "boolean" ||
      !validTime(value.updated_at)) throw new NotificationMasterApiError("invalid_response");
  return value as unknown as NotificationRule;
}

function parseTemplate(value: unknown): NotificationTemplate {
  const keys = ["id", "template_id", "language", "channel", "version", "title", "body", "summary", "is_active", "created_at", "updated_at"];
  if (!isRecord(value) || !exactKeys(value, keys) || typeof value.id !== "string" || !UUID.test(value.id) ||
      typeof value.template_id !== "string" || typeof value.language !== "string" ||
      value.template_id.length < 1 || value.template_id.length > 200 || value.language.length < 2 || value.language.length > 16 ||
      typeof value.channel !== "string" || !CHANNELS.has(value.channel) ||
      typeof value.version !== "number" || !Number.isSafeInteger(value.version) || value.version < 1 ||
      !(value.title === null || (typeof value.title === "string" && value.title.length <= 500)) ||
      typeof value.body !== "string" || value.body.length > 20_000 ||
      !(value.summary === null || (typeof value.summary === "string" && value.summary.length <= 2_000)) ||
      typeof value.is_active !== "boolean" ||
      !validTime(value.created_at) || !validTime(value.updated_at)) throw new NotificationMasterApiError("invalid_response");
  return value as unknown as NotificationTemplate;
}

function endpoint(baseUrl: string, suffix: string): URL {
  let url: URL;
  try {
    url = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new NotificationMasterApiError("configuration");
  }
  url.pathname = `${API_PATH}${suffix}`;
  url.search = "";
  url.hash = "";
  return url;
}

function assertSameOrigin(baseUrl: string, authBaseUrl?: string): void {
  if (!authBaseUrl?.trim()) return;
  try {
    if (endpoint(baseUrl, "/rules").origin !== buildRecentFanmarksApiUrl(authBaseUrl.trim()).origin) {
      throw new NotificationMasterApiError("configuration");
    }
  } catch {
    throw new NotificationMasterApiError("configuration");
  }
}

async function readJson(response: Response): Promise<unknown> {
  if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !response.body) {
    throw new NotificationMasterApiError("invalid_response");
  }
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/u.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
    await response.body.cancel();
    throw new NotificationMasterApiError("invalid_response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new NotificationMasterApiError("invalid_response");
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof NotificationMasterApiError) throw error;
    throw new NotificationMasterApiError("invalid_response");
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
    throw new NotificationMasterApiError("invalid_response");
  }
}

interface RequestOptions {
  baseUrl?: string;
  authBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function request(path: string, method: "GET" | "POST" | "PATCH", body: unknown, options: RequestOptions): Promise<unknown> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!baseUrl) throw new NotificationMasterApiError("configuration");
  const timeout = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) throw new NotificationMasterApiError("configuration");
  assertSameOrigin(baseUrl, options.authBaseUrl ?? (import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ||
    (typeof window === "undefined" ? undefined : window.location.origin)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint(baseUrl, path), {
      method,
      headers: body === undefined ? { accept: "application/json" } : {
        accept: "application/json", "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new NotificationMasterApiError("http", response.status);
    }
    return await readJson(response);
  } catch (error) {
    if (controller.signal.aborted) throw new NotificationMasterApiError("timeout");
    if (error instanceof NotificationMasterApiError) throw error;
    throw new NotificationMasterApiError("network");
  } finally {
    clearTimeout(timer);
  }
}

export async function loadNotificationRules(options: RequestOptions = {}): Promise<NotificationRule[]> {
  const payload = await request("/rules", "GET", undefined, options);
  if (!isRecord(payload) || !exactKeys(payload, ["schemaVersion", "rules"]) || payload.schemaVersion !== 1 ||
      !Array.isArray(payload.rules) || payload.rules.length > 100) throw new NotificationMasterApiError("invalid_response");
  return payload.rules.map(parseRule);
}

export async function loadNotificationTemplates(options: RequestOptions = {}): Promise<NotificationTemplate[]> {
  const payload = await request("/templates", "GET", undefined, options);
  if (!isRecord(payload) || !exactKeys(payload, ["schemaVersion", "templates"]) || payload.schemaVersion !== 1 ||
      !Array.isArray(payload.templates) || payload.templates.length > 500) throw new NotificationMasterApiError("invalid_response");
  return payload.templates.map(parseTemplate);
}

function parseEventLog(value: unknown): NotificationEventLog {
  const keys = ["id", "event_type", "status", "source", "created_at", "processed_at", "error_reason"];
  if (!isRecord(value) || !exactKeys(value, keys) || typeof value.id !== "string" || !UUID.test(value.id) ||
      typeof value.event_type !== "string" || typeof value.status !== "string" || typeof value.source !== "string" ||
      !validTime(value.created_at) || !(value.processed_at === null || validTime(value.processed_at)) ||
      !(value.error_reason === null || typeof value.error_reason === "string")) {
    throw new NotificationMasterApiError("invalid_response");
  }
  return value as unknown as NotificationEventLog;
}

function parseDeliveryLog(value: unknown): NotificationDeliveryLog {
  const keys = ["id", "user_id", "channel", "status", "delivered_at", "read_at", "priority"];
  if (!isRecord(value) || !exactKeys(value, keys) || typeof value.id !== "string" || !UUID.test(value.id) ||
      typeof value.user_id !== "string" || value.user_id.length > 11 ||
      typeof value.channel !== "string" || !CHANNELS.has(value.channel) || typeof value.status !== "string" ||
      !(value.delivered_at === null || validTime(value.delivered_at)) ||
      !(value.read_at === null || validTime(value.read_at)) || typeof value.priority !== "number" ||
      !Number.isSafeInteger(value.priority) || value.priority < 1 || value.priority > 10) {
    throw new NotificationMasterApiError("invalid_response");
  }
  return value as unknown as NotificationDeliveryLog;
}

export async function loadNotificationEvents(options: RequestOptions = {}): Promise<NotificationEventLog[]> {
  const payload = await request("/events", "GET", undefined, options);
  if (!isRecord(payload) || !exactKeys(payload, ["schemaVersion", "events"]) || payload.schemaVersion !== 1 ||
      !Array.isArray(payload.events) || payload.events.length > 100) throw new NotificationMasterApiError("invalid_response");
  return payload.events.map(parseEventLog);
}

export async function loadNotificationDeliveries(options: RequestOptions = {}): Promise<NotificationDeliveryLog[]> {
  const payload = await request("/notifications", "GET", undefined, options);
  if (!isRecord(payload) || !exactKeys(payload, ["schemaVersion", "notifications"]) || payload.schemaVersion !== 1 ||
      !Array.isArray(payload.notifications) || payload.notifications.length > 100) {
    throw new NotificationMasterApiError("invalid_response");
  }
  return payload.notifications.map(parseDeliveryLog);
}

export async function createManualNotificationEvent(
  eventType: "license_grace_started" | "license_expired" | "favorite_fanmark_available",
  payload: Record<string, unknown>,
  options: RequestOptions = {},
): Promise<{ id: string }> {
  if (!new Set(["license_grace_started", "license_expired", "favorite_fanmark_available"]).has(eventType) ||
      !isRecord(payload)) throw new NotificationMasterApiError("configuration");
  const result = await request("/events", "POST", { eventType, payload }, options);
  if (!isRecord(result) || !exactKeys(result, ["schemaVersion", "event"]) || result.schemaVersion !== 1 ||
      !isRecord(result.event) || !exactKeys(result.event, ["id"]) || typeof result.event.id !== "string" ||
      !UUID.test(result.event.id)) throw new NotificationMasterApiError("invalid_response");
  return { id: result.event.id };
}

export async function updateNotificationRule(
  id: string,
  enabled: boolean,
  expectedUpdatedAt: string,
  options: RequestOptions = {},
): Promise<NotificationRule> {
  if (!UUID.test(id) || typeof enabled !== "boolean" || !validTime(expectedUpdatedAt)) {
    throw new NotificationMasterApiError("configuration");
  }
  const payload = await request(`/rules/${id.toLowerCase()}`, "PATCH", { enabled, expectedUpdatedAt }, options);
  if (!isRecord(payload) || !exactKeys(payload, ["schemaVersion", "rule"]) || payload.schemaVersion !== 1) {
    throw new NotificationMasterApiError("invalid_response");
  }
  return parseRule(payload.rule);
}

export async function updateNotificationTemplate(
  id: string,
  patch: NotificationTemplatePatch,
  options: RequestOptions = {},
): Promise<NotificationTemplate> {
  if (!UUID.test(id) || !validTime(patch.expectedUpdatedAt) ||
      !(patch.title === null || (typeof patch.title === "string" && patch.title.length <= 500)) ||
      typeof patch.body !== "string" || patch.body.length > 20_000 ||
      !(patch.summary === null || (typeof patch.summary === "string" && patch.summary.length <= 2_000)) ||
      typeof patch.isActive !== "boolean") {
    throw new NotificationMasterApiError("configuration");
  }
  const payload = await request(`/templates/${id.toLowerCase()}`, "PATCH", patch, options);
  if (!isRecord(payload) || !exactKeys(payload, ["schemaVersion", "template"]) || payload.schemaVersion !== 1) {
    throw new NotificationMasterApiError("invalid_response");
  }
  return parseTemplate(payload.template);
}
