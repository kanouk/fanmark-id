import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const API_PATH = "/api/admin/email-templates";
const MAX_RESPONSE_BYTES = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EMAIL_TYPES = new Set(["signup", "recovery", "magiclink", "email_change"]);
const LANGUAGES = new Set(["en", "ja", "ko", "id"]);

export interface AdminEmailTemplate {
  id: string;
  email_type: string;
  language: string;
  subject: string;
  body_text: string;
  button_text: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export class AdminEmailTemplatesClientError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network" | "timeout";
  readonly status?: number;

  constructor(kind: AdminEmailTemplatesClientError["kind"], status?: number) {
    super(kind === "http" && status ? `email templates request failed (${status})` : `email templates request ${kind}`);
    this.name = "AdminEmailTemplatesClientError";
    this.kind = kind;
    this.status = status;
  }
}

export function getAdminEmailTemplatesBackend(
  value: string | undefined = import.meta.env?.VITE_EMAIL_TEMPLATES_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new AdminEmailTemplatesClientError("configuration");
}

interface RequestOptions {
  baseUrl?: string;
  authBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
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

function parseTemplate(value: unknown): AdminEmailTemplate {
  const keys = ["id", "email_type", "language", "subject", "body_text", "button_text", "is_active", "created_at", "updated_at"];
  if (!isRecord(value) || !exactKeys(value, keys) || typeof value.id !== "string" || !UUID.test(value.id) ||
      typeof value.email_type !== "string" || !EMAIL_TYPES.has(value.email_type) ||
      typeof value.language !== "string" || !LANGUAGES.has(value.language) ||
      typeof value.subject !== "string" || value.subject.length > 256 ||
      typeof value.body_text !== "string" || value.body_text.length > 10_000 ||
      typeof value.button_text !== "string" || value.button_text.length > 128 ||
      typeof value.is_active !== "boolean" || !validTime(value.created_at) || !validTime(value.updated_at)) {
    throw new AdminEmailTemplatesClientError("invalid_response");
  }
  return value as unknown as AdminEmailTemplate;
}

function endpoint(baseUrl: string, suffix = ""): URL {
  try {
    const url = buildRecentFanmarksApiUrl(baseUrl);
    url.pathname = `${API_PATH}${suffix}`;
    url.search = "";
    url.hash = "";
    return url;
  } catch { throw new AdminEmailTemplatesClientError("configuration"); }
}

async function request(path: string, method: "GET" | "PATCH", body: unknown, options: RequestOptions): Promise<unknown> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!baseUrl) throw new AdminEmailTemplatesClientError("configuration");
  const authBaseUrl = options.authBaseUrl ?? (import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ||
    (typeof window === "undefined" ? undefined : window.location.origin));
  try {
    if (authBaseUrl && endpoint(baseUrl).origin !== buildRecentFanmarksApiUrl(authBaseUrl).origin) {
      throw new AdminEmailTemplatesClientError("configuration");
    }
  } catch { throw new AdminEmailTemplatesClientError("configuration"); }
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new AdminEmailTemplatesClientError("configuration");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint(baseUrl, path), {
      method,
      headers: method === "PATCH" ? { accept: "application/json", "content-type": "application/json" } : { accept: "application/json" },
      ...(method === "PATCH" ? { body: JSON.stringify(body) } : {}),
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AdminEmailTemplatesClientError("http", response.status);
    }
    if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !response.body) {
      throw new AdminEmailTemplatesClientError("invalid_response");
    }
    const declared = response.headers.get("content-length");
    if (declared && /^\d+$/u.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
      await response.body.cancel();
      throw new AdminEmailTemplatesClientError("invalid_response");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new AdminEmailTemplatesClientError("invalid_response");
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
    catch { throw new AdminEmailTemplatesClientError("invalid_response"); }
  } catch (error) {
    if (controller.signal.aborted) throw new AdminEmailTemplatesClientError("timeout");
    if (error instanceof AdminEmailTemplatesClientError) throw error;
    throw new AdminEmailTemplatesClientError("network");
  } finally { clearTimeout(timer); }
}

export function createAdminEmailTemplatesApi(options: RequestOptions = {}) {
  return {
    async list(): Promise<AdminEmailTemplate[]> {
      const value = await request("", "GET", undefined, options);
      if (!isRecord(value) || !exactKeys(value, ["templates"]) || !Array.isArray(value.templates) || value.templates.length > 16) {
        throw new AdminEmailTemplatesClientError("invalid_response");
      }
      const templates = value.templates.map(parseTemplate);
      const unique = new Set(templates.map(({ email_type, language }) => `${email_type}/${language}`));
      if (unique.size !== templates.length) throw new AdminEmailTemplatesClientError("invalid_response");
      return templates;
    },
    async update(input: { id: string; expectedUpdatedAt: string; subject: string; bodyText: string; buttonText: string }): Promise<AdminEmailTemplate> {
      if (!UUID.test(input.id) || !validTime(input.expectedUpdatedAt) ||
          input.subject.length < 1 || input.subject.length > 256 ||
          input.bodyText.length < 1 || input.bodyText.length > 10_000 ||
          input.buttonText.length < 1 || input.buttonText.length > 128) {
        throw new AdminEmailTemplatesClientError("configuration");
      }
      const value = await request(`/${encodeURIComponent(input.id)}`, "PATCH", {
        expectedUpdatedAt: input.expectedUpdatedAt,
        subject: input.subject,
        bodyText: input.bodyText,
        buttonText: input.buttonText,
      }, options);
      if (!isRecord(value) || !exactKeys(value, ["template"])) throw new AdminEmailTemplatesClientError("invalid_response");
      const template = parseTemplate(value.template);
      if (template.id !== input.id || template.subject !== input.subject ||
          template.body_text !== input.bodyText || template.button_text !== input.buttonText) {
        throw new AdminEmailTemplatesClientError("invalid_response");
      }
      return template;
    },
  };
}
