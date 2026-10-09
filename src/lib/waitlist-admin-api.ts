import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const API_PATH = "/api/admin/waitlist";
const MAX_RESPONSE_BYTES = 128 * 1024;
const TIMEOUT_MS = 5_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export interface WaitlistAdminEntry {
  id: string;
  email_hash: string;
  referral_source: string | null;
  status: "waiting" | "invited" | "converted";
  created_at: string;
}

export interface WaitlistAdminSecurityLog {
  id: string;
  action: string;
  resource_type: "waitlist" | "system";
  created_at: string;
}

export interface WaitlistAdminSnapshot {
  entries: WaitlistAdminEntry[];
  securityLogs: WaitlistAdminSecurityLog[];
}

export class WaitlistAdminClientError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network" | "timeout";
  readonly status?: number;

  constructor(kind: WaitlistAdminClientError["kind"], status?: number) {
    super(kind === "http" && status ? `waitlist admin request failed (${status})` : `waitlist admin request ${kind}`);
    this.name = "WaitlistAdminClientError";
    this.kind = kind;
    this.status = status;
  }
}

export function getWaitlistAdminBackend(
  value: string | undefined = import.meta.env?.VITE_WAITLIST_ADMIN_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new WaitlistAdminClientError("configuration");
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

function parseEntry(value: unknown): WaitlistAdminEntry {
  const keys = ["id", "email_hash", "referral_source", "status", "created_at"];
  if (!isRecord(value) || !exactKeys(value, keys) || typeof value.id !== "string" || !UUID.test(value.id) ||
      typeof value.email_hash !== "string" || !/^[0-9a-f]{64}$/u.test(value.email_hash) ||
      !(value.referral_source === null || (typeof value.referral_source === "string" && value.referral_source.length <= 500)) ||
      !(value.status === "waiting" || value.status === "invited" || value.status === "converted") ||
      !validTime(value.created_at)) throw new WaitlistAdminClientError("invalid_response");
  return value as unknown as WaitlistAdminEntry;
}

function parseSecurityLog(value: unknown): WaitlistAdminSecurityLog {
  const keys = ["id", "action", "resource_type", "created_at"];
  if (!isRecord(value) || !exactKeys(value, keys) || typeof value.id !== "string" || value.id.length > 64 ||
      typeof value.action !== "string" || value.action.length < 1 || value.action.length > 80 ||
      !(value.resource_type === "waitlist" || value.resource_type === "system") || !validTime(value.created_at)) {
    throw new WaitlistAdminClientError("invalid_response");
  }
  return value as unknown as WaitlistAdminSecurityLog;
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
  } catch { throw new WaitlistAdminClientError("configuration"); }
}

async function request(path: string, options: RequestOptions): Promise<unknown> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!baseUrl) throw new WaitlistAdminClientError("configuration");
  const authBaseUrl = options.authBaseUrl ??
    (import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() || (typeof window === "undefined" ? undefined : window.location.origin));
  try {
    if (authBaseUrl && endpoint(baseUrl).origin !== buildRecentFanmarksApiUrl(authBaseUrl).origin) {
      throw new WaitlistAdminClientError("configuration");
    }
  } catch { throw new WaitlistAdminClientError("configuration"); }
  const timeout = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) throw new WaitlistAdminClientError("configuration");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint(baseUrl, path), {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new WaitlistAdminClientError("http", response.status);
    }
    if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !response.body) {
      throw new WaitlistAdminClientError("invalid_response");
    }
    const declared = response.headers.get("content-length");
    if (declared && /^\d+$/u.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
      await response.body.cancel();
      throw new WaitlistAdminClientError("invalid_response");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new WaitlistAdminClientError("invalid_response");
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
    catch { throw new WaitlistAdminClientError("invalid_response"); }
  } catch (error) {
    if (controller.signal.aborted) throw new WaitlistAdminClientError("timeout");
    if (error instanceof WaitlistAdminClientError) throw error;
    throw new WaitlistAdminClientError("network");
  } finally { clearTimeout(timer); }
}

function parseSnapshot(value: unknown): WaitlistAdminSnapshot {
  if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "entries", "securityLogs"]) || value.schemaVersion !== 1 ||
      !Array.isArray(value.entries) || value.entries.length > 100 ||
      !Array.isArray(value.securityLogs) || value.securityLogs.length > 50) throw new WaitlistAdminClientError("invalid_response");
  return {
    entries: value.entries.map(parseEntry),
    securityLogs: value.securityLogs.map(parseSecurityLog),
  };
}

export async function loadWaitlistAdmin(options: RequestOptions = {}): Promise<WaitlistAdminSnapshot> {
  return parseSnapshot(await request("", options));
}

export async function revealWaitlistAdminEmail(
  id: string,
  options: RequestOptions = {},
): Promise<{ email: string; securityLogs: WaitlistAdminSecurityLog[] }> {
  if (!UUID.test(id)) throw new WaitlistAdminClientError("configuration");
  const value = await request(`/${id.toLowerCase()}/email`, options);
  if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "email", "securityLogs"]) || value.schemaVersion !== 1 ||
      typeof value.email !== "string" || value.email.length > 320 || !EMAIL.test(value.email) ||
      !Array.isArray(value.securityLogs) || value.securityLogs.length > 50) throw new WaitlistAdminClientError("invalid_response");
  return { email: value.email, securityLogs: value.securityLogs.map(parseSecurityLog) };
}
