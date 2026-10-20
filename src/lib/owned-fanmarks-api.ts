import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

export const OWNED_FANMARKS_TIMEOUT_MS = 5_000;
const OWNED_FANMARKS_PATH = "/api/me/fanmarks";
const MAX_ITEMS = 500;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface OwnedFanmark {
  id: string;
  user_input_fanmark: string;
  emoji_ids: string[];
  fanmark: string;
  emoji_key: string;
  fanmark_name: string | null;
  short_id: string;
  access_type: string;
  tier_level: number | null;
  current_license_id: string;
  is_transferable: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  current_license: {
    id: string;
    license_start: string;
    license_end: string | null;
    status: string;
    created_at: string;
  };
  fanmark_licenses: {
    license_start: string;
    license_end: string | null;
    grace_expires_at: string | null;
    status: string;
    is_returned: boolean;
    excluded_at: string | null;
    excluded_from_plan: string | null;
  };
}

export type OwnedFanmarksApiErrorKind = "aborted" | "configuration" | "http" | "invalid_response" | "network" | "timeout";

export class OwnedFanmarksApiError extends Error {
  readonly kind: OwnedFanmarksApiErrorKind;
  readonly status?: number;

  constructor(kind: OwnedFanmarksApiErrorKind, status?: number) {
    super(kind === "http" && status ? `owned fanmarks request failed (${status})` : `owned fanmarks request ${kind}`);
    this.name = "OwnedFanmarksApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getOwnedFanmarksBackend(
  value: string | undefined = import.meta.env?.VITE_OWNED_FANMARKS_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new OwnedFanmarksApiError("configuration");
}

export function buildOwnedFanmarksApiUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new OwnedFanmarksApiError("configuration");
  }
  url.pathname = OWNED_FANMARKS_PATH;
  url.search = "";
  url.hash = "";
  return url;
}

export function assertOwnedFanmarksAuthOrigin(baseUrl: string, authBaseUrl: string | undefined): void {
  if (!authBaseUrl?.trim()) return;
  try {
    const authUrl = buildRecentFanmarksApiUrl(authBaseUrl.trim());
    if (authUrl.origin !== buildOwnedFanmarksApiUrl(baseUrl).origin) {
      throw new OwnedFanmarksApiError("configuration");
    }
  } catch {
    throw new OwnedFanmarksApiError("configuration");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string";
}

function nullableText(value: unknown): value is string | null {
  return value === null || text(value);
}

function parseItem(value: unknown): OwnedFanmark {
  if (!isRecord(value) || !isRecord(value.current_license) || !isRecord(value.fanmark_licenses)) {
    throw new OwnedFanmarksApiError("invalid_response");
  }
  const current = value.current_license;
  const license = value.fanmark_licenses;
  if (
    !text(value.id) || !text(value.user_input_fanmark) ||
    !Array.isArray(value.emoji_ids) || value.emoji_ids.some((id) => !text(id)) ||
    !text(value.fanmark) || !text(value.emoji_key) || !nullableText(value.fanmark_name) ||
    !text(value.short_id) || !text(value.access_type) ||
    !(value.tier_level === null || Number.isInteger(value.tier_level)) ||
    !text(value.current_license_id) || value.is_transferable !== true ||
    !text(value.status) || !text(value.created_at) || !text(value.updated_at) ||
    !text(current.id) || !text(current.license_start) || !nullableText(current.license_end) ||
    !text(current.status) || !text(current.created_at) ||
    !text(license.license_start) || !nullableText(license.license_end) ||
    !nullableText(license.grace_expires_at) || !text(license.status) ||
    typeof license.is_returned !== "boolean" || !nullableText(license.excluded_at) ||
    !nullableText(license.excluded_from_plan)
  ) {
    throw new OwnedFanmarksApiError("invalid_response");
  }
  return value as unknown as OwnedFanmark;
}

export function parseOwnedFanmarksApiPayload(payload: unknown): OwnedFanmark[] {
  if (!isRecord(payload) || payload.schemaVersion !== 1 || !Array.isArray(payload.items) || payload.items.length > MAX_ITEMS) {
    throw new OwnedFanmarksApiError("invalid_response");
  }
  return payload.items.map(parseItem);
}

export async function loadOwnedFanmarks(options: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): Promise<OwnedFanmark[]> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!baseUrl) throw new OwnedFanmarksApiError("configuration");
  const timeoutMs = options.timeoutMs ?? OWNED_FANMARKS_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new OwnedFanmarksApiError("configuration");
  }
  const apiUrl = buildOwnedFanmarksApiUrl(baseUrl);
  const authBaseUrl = import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ||
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (authBaseUrl) assertOwnedFanmarksAuthOrigin(baseUrl, authBaseUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(apiUrl, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new OwnedFanmarksApiError("http", response.status);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 1024 * 1024) {
      throw new OwnedFanmarksApiError("invalid_response");
    }
    let responseText: string;
    try {
      responseText = await response.text();
    } catch {
      throw new OwnedFanmarksApiError("invalid_response");
    }
    if (new TextEncoder().encode(responseText).byteLength > MAX_RESPONSE_BYTES) {
      throw new OwnedFanmarksApiError("invalid_response");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new OwnedFanmarksApiError("invalid_response");
    }
    return parseOwnedFanmarksApiPayload(payload);
  } catch (error) {
    if (error instanceof OwnedFanmarksApiError) throw error;
    if (controller.signal.aborted) throw new OwnedFanmarksApiError("timeout");
    throw new OwnedFanmarksApiError("network");
  } finally {
    clearTimeout(timeout);
  }
}
