import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";
import type { Json } from "@/integrations/supabase/types";

const API_PATH = "/api/admin/invitation-codes";
const MAX_RESPONSE_BYTES = 128 * 1024;
const TIMEOUT_MS = 5_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CODE = /^[A-Za-z0-9-]{3,64}$/u;

export interface InvitationAdminCode {
  id: string;
  code: string;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  special_perks: Json | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export class InvitationAdminClientError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network" | "timeout";
  readonly status?: number;
  constructor(kind: InvitationAdminClientError["kind"], status?: number) {
    super(kind === "http" && status ? `invitation admin request failed (${status})` : `invitation admin request ${kind}`);
    this.name = "InvitationAdminClientError";
    this.kind = kind;
    this.status = status;
  }
}

export function getInvitationAdminBackend(value: string | undefined = import.meta.env?.VITE_INVITATION_ADMIN_BACKEND): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new InvitationAdminClientError("configuration");
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

function parseCode(value: unknown): InvitationAdminCode {
  const keys = ["id", "code", "max_uses", "used_count", "expires_at", "special_perks", "is_active", "created_at", "updated_at"];
  if (!isRecord(value) || !exactKeys(value, keys) || typeof value.id !== "string" || !UUID.test(value.id) ||
      typeof value.code !== "string" || !CODE.test(value.code) ||
      typeof value.max_uses !== "number" || !Number.isSafeInteger(value.max_uses) || value.max_uses < 1 ||
      typeof value.used_count !== "number" || !Number.isSafeInteger(value.used_count) || value.used_count < 0 || value.used_count > value.max_uses ||
      !(value.expires_at === null || validTime(value.expires_at)) ||
      !(value.special_perks === null || isRecord(value.special_perks)) ||
      typeof value.is_active !== "boolean" || !validTime(value.created_at) || !validTime(value.updated_at)) {
    throw new InvitationAdminClientError("invalid_response");
  }
  return value as unknown as InvitationAdminCode;
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
  } catch { throw new InvitationAdminClientError("configuration"); }
}

async function request(path: string, method: "GET" | "POST" | "PATCH" | "DELETE", body: unknown, options: RequestOptions): Promise<unknown> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!baseUrl) throw new InvitationAdminClientError("configuration");
  const authBaseUrl = options.authBaseUrl ?? (import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() || (typeof window === "undefined" ? undefined : window.location.origin));
  try {
    if (authBaseUrl && endpoint(baseUrl).origin !== buildRecentFanmarksApiUrl(authBaseUrl).origin) throw new InvitationAdminClientError("configuration");
  } catch {
    throw new InvitationAdminClientError("configuration");
  }
  const timeout = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) throw new InvitationAdminClientError("configuration");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint(baseUrl, path), {
      method,
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: "include", cache: "no-store", redirect: "error", signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new InvitationAdminClientError("http", response.status);
    }
    if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !response.body) {
      throw new InvitationAdminClientError("invalid_response");
    }
    const declared = response.headers.get("content-length");
    if (declared && /^\d+$/u.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
      await response.body.cancel();
      throw new InvitationAdminClientError("invalid_response");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new InvitationAdminClientError("invalid_response");
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
    catch { throw new InvitationAdminClientError("invalid_response"); }
  } catch (error) {
    if (controller.signal.aborted) throw new InvitationAdminClientError("timeout");
    if (error instanceof InvitationAdminClientError) throw error;
    throw new InvitationAdminClientError("network");
  } finally { clearTimeout(timer); }
}

export async function loadInvitationCodes(options: RequestOptions = {}): Promise<InvitationAdminCode[]> {
  const payload = await request("", "GET", undefined, options);
  if (!isRecord(payload) || !exactKeys(payload, ["schemaVersion", "codes"]) || payload.schemaVersion !== 1 ||
      !Array.isArray(payload.codes) || payload.codes.length > 500) throw new InvitationAdminClientError("invalid_response");
  return payload.codes.map(parseCode);
}

export async function createInvitationCode(input: { code: string | null; max_uses: number; expires_at: string | null; special_perks: Json | null }, options: RequestOptions = {}): Promise<InvitationAdminCode> {
  const payload = await request("", "POST", input, options);
  if (!isRecord(payload) || !exactKeys(payload, ["schemaVersion", "code"]) || payload.schemaVersion !== 1) throw new InvitationAdminClientError("invalid_response");
  return parseCode(payload.code);
}

export async function updateInvitationCode(id: string, patch: { max_uses?: number; expires_at?: string | null; special_perks?: Json | null; is_active?: boolean; expectedUpdatedAt: string }, options: RequestOptions = {}): Promise<InvitationAdminCode> {
  if (!UUID.test(id) || !validTime(patch.expectedUpdatedAt)) throw new InvitationAdminClientError("configuration");
  const payload = await request(`/${id.toLowerCase()}`, "PATCH", patch, options);
  if (!isRecord(payload) || !exactKeys(payload, ["schemaVersion", "code"]) || payload.schemaVersion !== 1) throw new InvitationAdminClientError("invalid_response");
  return parseCode(payload.code);
}

export async function deleteInvitationCode(id: string, options: RequestOptions = {}): Promise<void> {
  if (!UUID.test(id)) throw new InvitationAdminClientError("configuration");
  const payload = await request(`/${id.toLowerCase()}`, "DELETE", undefined, options);
  if (!isRecord(payload) || !exactKeys(payload, ["schemaVersion", "deleted"]) || payload.schemaVersion !== 1 || payload.deleted !== true) {
    throw new InvitationAdminClientError("invalid_response");
  }
}
