import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const RUN_PATH = "/api/admin/license-expiry/run";
const TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 8 * 1024;

export interface LifecycleRunPhase {
  status: "completed" | "running" | "deferred_active_to_grace_running" | "deferred_page_budget";
  candidateCount: number;
  processed: number;
  conflicts: number;
  pagesProcessed: number;
}

export interface LifecycleRunResult {
  schemaVersion: 1;
  status: "completed" | "in_progress";
  activeToGrace: Omit<LifecycleRunPhase, "status"> & { status: "completed" | "running" };
  graceFinalization: LifecycleRunPhase;
  pagesLimit: number;
  elapsedMs: number;
}

export class LifecycleRunApiError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network" | "timeout";
  readonly status?: number;

  constructor(kind: LifecycleRunApiError["kind"], status?: number) {
    super(kind === "http" && status ? `lifecycle run request failed (${status})` : `lifecycle run request ${kind}`);
    this.name = "LifecycleRunApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getLifecycleRunBackend(
  value: string | undefined = import.meta.env?.VITE_LIFECYCLE_RUN_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new LifecycleRunApiError("configuration");
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function counter(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parsePhase(value: unknown, activeToGrace: boolean): LifecycleRunPhase | LifecycleRunResult["activeToGrace"] {
  const fields = ["status", "candidateCount", "processed", "conflicts", "pagesProcessed"];
  if (!isRecord(value) || !exactKeys(value, fields) ||
      !(value.status === "completed" || value.status === "running" ||
        (!activeToGrace && (value.status === "deferred_active_to_grace_running" || value.status === "deferred_page_budget"))) ||
      !counter(value.candidateCount) || !counter(value.processed) || !counter(value.conflicts) || !counter(value.pagesProcessed)) {
    throw new LifecycleRunApiError("invalid_response");
  }
  return value as unknown as LifecycleRunPhase;
}

export function parseLifecycleRunPayload(value: unknown): LifecycleRunResult {
  if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "status", "activeToGrace", "graceFinalization", "pagesLimit", "elapsedMs"]) ||
      value.schemaVersion !== 1 || !(value.status === "completed" || value.status === "in_progress") ||
      !counter(value.pagesLimit) || value.pagesLimit < 1 || !counter(value.elapsedMs)) {
    throw new LifecycleRunApiError("invalid_response");
  }
  const activeToGrace = parsePhase(value.activeToGrace, true) as LifecycleRunResult["activeToGrace"];
  const graceFinalization = parsePhase(value.graceFinalization, false) as LifecycleRunPhase;
  const complete = activeToGrace.status === "completed" && graceFinalization.status === "completed";
  if ((value.status === "completed") !== complete) throw new LifecycleRunApiError("invalid_response");
  return {
    schemaVersion: 1,
    status: value.status,
    activeToGrace,
    graceFinalization,
    pagesLimit: value.pagesLimit,
    elapsedMs: value.elapsedMs,
  };
}

function endpoint(baseUrl: string): URL {
  try {
    const url = buildRecentFanmarksApiUrl(baseUrl);
    url.pathname = RUN_PATH;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    throw new LifecycleRunApiError("configuration");
  }
}

function assertSameOrigin(apiBaseUrl: string, authBaseUrl?: string): void {
  if (!authBaseUrl?.trim()) return;
  try {
    if (endpoint(apiBaseUrl).origin !== buildRecentFanmarksApiUrl(authBaseUrl.trim()).origin) {
      throw new LifecycleRunApiError("configuration");
    }
  } catch {
    throw new LifecycleRunApiError("configuration");
  }
}

async function readJson(response: Response): Promise<unknown> {
  if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !response.body) {
    throw new LifecycleRunApiError("invalid_response");
  }
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/u.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
    await response.body.cancel();
    throw new LifecycleRunApiError("invalid_response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new LifecycleRunApiError("invalid_response");
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
    throw new LifecycleRunApiError("invalid_response");
  }
}

export async function runLicenseExpiryInWorker(options: {
  apiBaseUrl?: string;
  authBaseUrl?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
} = {}): Promise<LifecycleRunResult> {
  const apiBaseUrl = options.apiBaseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!apiBaseUrl) throw new LifecycleRunApiError("configuration");
  const authBaseUrl = options.authBaseUrl ?? (import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ||
    (typeof window === "undefined" ? undefined : window.location.origin));
  assertSameOrigin(apiBaseUrl, authBaseUrl);
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new LifecycleRunApiError("configuration");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetcher ?? fetch)(endpoint(apiBaseUrl), {
      method: "POST",
      headers: { accept: "application/json" },
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new LifecycleRunApiError("http", response.status);
    }
    return parseLifecycleRunPayload(await readJson(response));
  } catch (error) {
    if (error instanceof LifecycleRunApiError) throw error;
    if (controller.signal.aborted) throw new LifecycleRunApiError("timeout");
    throw new LifecycleRunApiError("network");
  } finally {
    clearTimeout(timer);
  }
}
