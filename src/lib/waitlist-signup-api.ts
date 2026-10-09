import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const API_PATH = "/api/waitlist";
const MAX_RESPONSE_BYTES = 1_024;
const TIMEOUT_MS = 5_000;

export class WaitlistSignupApiError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network" | "timeout";
  readonly status?: number;

  constructor(kind: WaitlistSignupApiError["kind"], status?: number) {
    super(kind === "http" && status ? `waitlist signup request failed (${status})` : `waitlist signup request ${kind}`);
    this.name = "WaitlistSignupApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getWaitlistSignupBackend(
  value: string | undefined = import.meta.env?.VITE_WAITLIST_SIGNUP_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new WaitlistSignupApiError("configuration");
}

interface WaitlistSignupOptions {
  baseUrl?: string;
  appBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function endpoint(baseUrl: string): URL {
  let url: URL;
  try {
    url = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new WaitlistSignupApiError("configuration");
  }
  url.pathname = API_PATH;
  url.search = "";
  url.hash = "";
  return url;
}

async function readAcceptedResponse(response: Response): Promise<void> {
  if (response.status !== 202) {
    await response.body?.cancel();
    throw new WaitlistSignupApiError("http", response.status);
  }
  if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !response.body) {
    throw new WaitlistSignupApiError("invalid_response");
  }
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    await response.body.cancel();
    throw new WaitlistSignupApiError("invalid_response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new WaitlistSignupApiError("invalid_response");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new WaitlistSignupApiError("invalid_response");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new WaitlistSignupApiError("invalid_response");
  const record = payload as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || record.schemaVersion !== 1 || record.accepted !== true) {
    throw new WaitlistSignupApiError("invalid_response");
  }
}

export async function submitWaitlistSignup(
  email: string,
  referralSource?: string,
  options: WaitlistSignupOptions = {},
): Promise<void> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl() ??
    (typeof window === "undefined" ? undefined : window.location.origin);
  if (!baseUrl) throw new WaitlistSignupApiError("configuration");
  const target = endpoint(baseUrl);
  const appBaseUrl = options.appBaseUrl ?? (typeof window === "undefined" ? undefined : window.location.origin);
  if (appBaseUrl) {
    try {
      if (target.origin !== buildRecentFanmarksApiUrl(appBaseUrl).origin) throw new WaitlistSignupApiError("configuration");
    } catch {
      throw new WaitlistSignupApiError("configuration");
    }
  }
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new WaitlistSignupApiError("configuration");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(target, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ email, ...(referralSource === undefined ? {} : { referral_source: referralSource }) }),
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    await readAcceptedResponse(response);
  } catch (error) {
    if (controller.signal.aborted) throw new WaitlistSignupApiError("timeout");
    if (error instanceof WaitlistSignupApiError) throw error;
    throw new WaitlistSignupApiError("network");
  } finally {
    clearTimeout(timer);
  }
}
