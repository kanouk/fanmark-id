import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const API_PATH = "/api/admin/broadcast-emails";
const MAX_RESPONSE_BYTES = 512 * 1024;
const TIMEOUT_MS = 5_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EMAIL_TYPES = new Set(["broadcast_announcement", "broadcast_maintenance", "broadcast_security"]);
const PLAN_TYPES = new Set(["free", "creator", "max", "business", "enterprise", "admin"]);
const LANGUAGES = new Set(["en", "ja", "ko", "id"]);
const STATUSES = new Set(["draft", "scheduled", "sending", "completed", "failed", "cancelled"]);

export interface BroadcastRecipientFilter {
  plan_types?: string[];
  languages?: string[];
  registered_after?: string;
  registered_before?: string;
}

export interface AdminBroadcastEmail {
  id: string;
  subject: string;
  body_text: string;
  email_type: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  status: "draft" | "scheduled" | "sending" | "completed" | "failed" | "cancelled";
  recipient_filter: BroadcastRecipientFilter | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface AdminBroadcastEmailTemplate {
  id: string;
  email_type: string;
  language: string;
  subject: string;
  body_text: string;
  button_text: string;
}

export interface AdminBroadcastEmailSnapshot {
  broadcasts: AdminBroadcastEmail[];
  templates: AdminBroadcastEmailTemplate[];
}

export class AdminBroadcastEmailApiError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network" | "timeout";
  readonly status?: number;

  constructor(kind: AdminBroadcastEmailApiError["kind"], status?: number) {
    super(kind === "http" && status ? `broadcast email request failed (${status})` : `broadcast email request ${kind}`);
    this.name = "AdminBroadcastEmailApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getAdminBroadcastEmailBackend(
  value: string | undefined = import.meta.env?.VITE_BROADCAST_EMAIL_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new AdminBroadcastEmailApiError("configuration");
}

export function getAdminBroadcastTestSendBackend(
  value: string | undefined = import.meta.env?.VITE_BROADCAST_TEST_SEND_BACKEND,
): "disabled" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "disabled") return "disabled";
  if (backend === "worker") return "worker";
  throw new AdminBroadcastEmailApiError("configuration");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function validTime(value: unknown, nullable = false): value is string | null {
  return nullable && value === null || typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function parseFilter(value: unknown): BroadcastRecipientFilter | null {
  if (value === null) return null;
  const allowed = ["plan_types", "languages", "registered_after", "registered_before"];
  if (!isRecord(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new AdminBroadcastEmailApiError("invalid_response");
  const result: BroadcastRecipientFilter = {};
  for (const key of ["plan_types", "languages"] as const) {
    const item = value[key];
    if (item === undefined) continue;
    const accepted = key === "plan_types" ? PLAN_TYPES : LANGUAGES;
    if (!Array.isArray(item) || item.length > accepted.size || item.some((entry) => typeof entry !== "string" || !accepted.has(entry)) ||
        new Set(item).size !== item.length) throw new AdminBroadcastEmailApiError("invalid_response");
    if (item.length) result[key] = [...item] as string[];
  }
  for (const key of ["registered_after", "registered_before"] as const) {
    const item = value[key];
    if (item === undefined) continue;
    if (typeof item !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(item) || !Number.isFinite(Date.parse(`${item}T00:00:00.000Z`))) {
      throw new AdminBroadcastEmailApiError("invalid_response");
    }
    result[key] = item;
  }
  if (result.registered_after && result.registered_before && result.registered_after > result.registered_before) {
    throw new AdminBroadcastEmailApiError("invalid_response");
  }
  return Object.keys(result).length ? result : null;
}

function parseBroadcast(value: unknown): AdminBroadcastEmail {
  const keys = ["id", "subject", "body_text", "email_type", "total_recipients", "sent_count", "failed_count", "status", "recipient_filter", "created_at", "started_at", "completed_at"];
  if (!isRecord(value) || !exactKeys(value, keys) || typeof value.id !== "string" || !UUID.test(value.id) ||
      typeof value.subject !== "string" || value.subject.length > 256 || typeof value.body_text !== "string" || value.body_text.length > 10_000 ||
      typeof value.email_type !== "string" || !EMAIL_TYPES.has(value.email_type) ||
      !Number.isSafeInteger(value.total_recipients) || Number(value.total_recipients) < 0 ||
      !Number.isSafeInteger(value.sent_count) || Number(value.sent_count) < 0 ||
      !Number.isSafeInteger(value.failed_count) || Number(value.failed_count) < 0 ||
      typeof value.status !== "string" || !STATUSES.has(value.status) ||
      !validTime(value.created_at) || !validTime(value.started_at, true) || !validTime(value.completed_at, true)) {
    throw new AdminBroadcastEmailApiError("invalid_response");
  }
  return { ...value, recipient_filter: parseFilter(value.recipient_filter) } as unknown as AdminBroadcastEmail;
}

function parseTemplate(value: unknown): AdminBroadcastEmailTemplate {
  const keys = ["id", "email_type", "language", "subject", "body_text", "button_text"];
  if (!isRecord(value) || !exactKeys(value, keys) || typeof value.id !== "string" || !UUID.test(value.id) ||
      typeof value.email_type !== "string" || !EMAIL_TYPES.has(value.email_type) ||
      typeof value.language !== "string" || !LANGUAGES.has(value.language) ||
      typeof value.subject !== "string" || value.subject.length > 256 ||
      typeof value.body_text !== "string" || value.body_text.length > 10_000 ||
      typeof value.button_text !== "string" || value.button_text.length > 128) throw new AdminBroadcastEmailApiError("invalid_response");
  return value as unknown as AdminBroadcastEmailTemplate;
}

interface RequestOptions {
  baseUrl?: string;
  authBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function endpoint(baseUrl: string, suffix = ""): URL {
  try {
    const url = buildRecentFanmarksApiUrl(baseUrl);
    url.pathname = `${API_PATH}${suffix}`;
    url.search = "";
    url.hash = "";
    return url;
  } catch { throw new AdminBroadcastEmailApiError("configuration"); }
}

async function request(path: string, method: "GET" | "POST", body: unknown, options: RequestOptions): Promise<unknown> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!baseUrl) throw new AdminBroadcastEmailApiError("configuration");
  const authBaseUrl = options.authBaseUrl ??
    (import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() || (typeof window === "undefined" ? undefined : window.location.origin));
  try {
    if (authBaseUrl && endpoint(baseUrl).origin !== buildRecentFanmarksApiUrl(authBaseUrl).origin) {
      throw new AdminBroadcastEmailApiError("configuration");
    }
  } catch { throw new AdminBroadcastEmailApiError("configuration"); }
  const timeout = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) throw new AdminBroadcastEmailApiError("configuration");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint(baseUrl, path), {
      method,
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AdminBroadcastEmailApiError("http", response.status);
    }
    if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !response.body) {
      throw new AdminBroadcastEmailApiError("invalid_response");
    }
    const declared = response.headers.get("content-length");
    if (declared && /^\d+$/u.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
      await response.body.cancel();
      throw new AdminBroadcastEmailApiError("invalid_response");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new AdminBroadcastEmailApiError("invalid_response");
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
    catch { throw new AdminBroadcastEmailApiError("invalid_response"); }
  } catch (error) {
    if (controller.signal.aborted) throw new AdminBroadcastEmailApiError("timeout");
    if (error instanceof AdminBroadcastEmailApiError) throw error;
    throw new AdminBroadcastEmailApiError("network");
  } finally { clearTimeout(timer); }
}

function parseSnapshot(value: unknown): AdminBroadcastEmailSnapshot {
  if (!isRecord(value) || !exactKeys(value, ["broadcasts", "templates"]) || !Array.isArray(value.broadcasts) ||
      value.broadcasts.length > 50 || !Array.isArray(value.templates) || value.templates.length > 12) {
    throw new AdminBroadcastEmailApiError("invalid_response");
  }
  const broadcasts = value.broadcasts.map(parseBroadcast);
  const templates = value.templates.map(parseTemplate);
  if (new Set(broadcasts.map((item) => item.id)).size !== broadcasts.length ||
      new Set(templates.map((item) => `${item.email_type}/${item.language}`)).size !== templates.length) {
    throw new AdminBroadcastEmailApiError("invalid_response");
  }
  return { broadcasts, templates };
}

export function createAdminBroadcastEmailApi(options: RequestOptions = {}) {
  return {
    async list(): Promise<AdminBroadcastEmailSnapshot> {
      return parseSnapshot(await request("", "GET", undefined, options));
    },
    async estimateRecipients(recipientFilter: BroadcastRecipientFilter | null): Promise<number> {
      const value = await request("/estimate", "POST", { recipientFilter }, options);
      if (!isRecord(value) || !exactKeys(value, ["count"]) || !Number.isSafeInteger(value.count) || Number(value.count) < 0) {
        throw new AdminBroadcastEmailApiError("invalid_response");
      }
      return Number(value.count);
    },
    async createDraft(input: { emailType: string; subject: string; bodyText: string; recipientFilter: BroadcastRecipientFilter | null }): Promise<AdminBroadcastEmail> {
      if (!EMAIL_TYPES.has(input.emailType) || input.subject.trim().length < 1 || input.subject.trim().length > 256 ||
          /[\r\n]/u.test(input.subject) || input.bodyText.trim().length < 1 || input.bodyText.length > 10_000) {
        throw new AdminBroadcastEmailApiError("configuration");
      }
      const value = await request("", "POST", input, options);
      if (!isRecord(value) || !exactKeys(value, ["broadcast"])) throw new AdminBroadcastEmailApiError("invalid_response");
      const broadcast = parseBroadcast(value.broadcast);
      if (broadcast.status !== "draft" || broadcast.subject !== input.subject.trim() ||
          broadcast.body_text !== input.bodyText || broadcast.email_type !== input.emailType) {
        throw new AdminBroadcastEmailApiError("invalid_response");
      }
      return broadcast;
    },
    async sendTest(input: { broadcastId: string; language: string; requestId: string }): Promise<{ success: true; message: string }> {
      if (!UUID.test(input.broadcastId) || !LANGUAGES.has(input.language) || !UUID.test(input.requestId)) {
        throw new AdminBroadcastEmailApiError("configuration");
      }
      const value = await request("/test-send", "POST", input, options);
      if (!isRecord(value) || !exactKeys(value, ["success"]) || value.success !== true) {
        throw new AdminBroadcastEmailApiError("invalid_response");
      }
      return { success: true, message: "テストメールを送信しました" };
    },
  };
}
