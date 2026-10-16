import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const ACCOUNT_DELETION_PATH = "/api/me/account/delete";
const MAX_RESPONSE_BYTES = 8 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export type AccountDeletionBackend = "supabase" | "worker";
export type AccountDeletionErrorKind = "configuration" | "http" | "invalid_response" | "network" | "timeout";

export class AccountDeletionApiError extends Error {
  readonly kind: AccountDeletionErrorKind;
  readonly status?: number;

  constructor(kind: AccountDeletionErrorKind, status?: number) {
    super(kind === "http" && status ? `account deletion request failed (${status})` : `account deletion request ${kind}`);
    this.name = "AccountDeletionApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getAccountDeletionBackend(
  value: string | undefined = import.meta.env?.VITE_ACCOUNT_DELETION_BACKEND,
): AccountDeletionBackend {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new AccountDeletionApiError("configuration");
}

export function buildAccountDeletionApiUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new AccountDeletionApiError("configuration");
  }
  url.pathname = ACCOUNT_DELETION_PATH;
  url.search = "";
  url.hash = "";
  return url;
}

function assertAuthOrigin(baseUrl: string, authBaseUrl?: string): void {
  if (!authBaseUrl?.trim()) return;
  try {
    if (buildAccountDeletionApiUrl(baseUrl).origin !== buildRecentFanmarksApiUrl(authBaseUrl.trim()).origin) {
      throw new AccountDeletionApiError("configuration");
    }
  } catch {
    throw new AccountDeletionApiError("configuration");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readSuccessResponse(response: Response): Promise<void> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new AccountDeletionApiError("invalid_response");
  const length = response.headers.get("content-length");
  if (length && /^\d+$/u.test(length) && Number(length) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new AccountDeletionApiError("invalid_response");
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new AccountDeletionApiError("invalid_response");
  }
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new AccountDeletionApiError("invalid_response");
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new AccountDeletionApiError("invalid_response");
  }
  if (!isRecord(payload) || Object.keys(payload).length !== 2 || payload.success !== true ||
      payload.message !== "Account deleted successfully") {
    throw new AccountDeletionApiError("invalid_response");
  }
}

export async function deleteAccountThroughWorker(
  password: string,
  options: {
    backend?: string;
    baseUrl?: string;
    authBaseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  if (getAccountDeletionBackend(options.backend) !== "worker") throw new AccountDeletionApiError("configuration");
  if (typeof password !== "string" || password.length < 1 || password.length > 256) {
    throw new AccountDeletionApiError("configuration");
  }
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!baseUrl) throw new AccountDeletionApiError("configuration");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new AccountDeletionApiError("configuration");
  }
  const url = buildAccountDeletionApiUrl(baseUrl);
  const authBaseUrl = options.authBaseUrl ?? (import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ||
    (typeof window === "undefined" ? undefined : window.location.origin));
  assertAuthOrigin(baseUrl, authBaseUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ confirmation: "DELETE", password }),
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new AccountDeletionApiError("http", response.status);
    await readSuccessResponse(response);
  } catch (error) {
    if (error instanceof AccountDeletionApiError) throw error;
    if (controller.signal.aborted) throw new AccountDeletionApiError("timeout");
    throw new AccountDeletionApiError("network");
  } finally {
    clearTimeout(timeout);
  }
}
