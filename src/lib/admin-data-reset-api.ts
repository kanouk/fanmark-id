import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";
import { getAdminDataResetMode } from "./admin-data-reset-mode.ts";

const TABLES = ["fanmark_basic_configs", "fanmark_redirect_configs", "fanmark_messageboard_configs",
  "fanmark_password_configs", "fanmark_profiles", "fanmark_favorites", "fanmark_licenses", "fanmarks"] as const;
export interface AdminDataResetResult {
  success: true;
  deletedCounts: Record<typeof TABLES[number], number>;
  totalDeleted: number;
}
export class AdminDataResetApiError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "timeout" | "network";
  readonly status?: number;
  constructor(kind: AdminDataResetApiError["kind"], status?: number) {
    super(`data reset request ${kind}${status ? ` (${status})` : ""}`);
    this.name = "AdminDataResetApiError";
    this.kind = kind;
    this.status = status;
  }
}

export async function resetDataThroughWorker(requestId: string, confirmation: string,
  options: { backend?: string; baseUrl?: string; authBaseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<AdminDataResetResult> {
  if (getAdminDataResetMode(options.backend) !== "worker" || confirmation !== "DELETE" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestId)) {
    throw new AdminDataResetApiError("configuration");
  }
  let url: URL;
  try {
    const base = options.baseUrl ?? getRecentFanmarksApiBaseUrl();
    if (!base) throw new Error();
    url = buildRecentFanmarksApiUrl(base);
    const authBase = options.authBaseUrl ?? import.meta.env?.VITE_AUTH_API_BASE_URL ??
      (typeof window === "undefined" ? undefined : window.location.origin);
    if (authBase && buildRecentFanmarksApiUrl(authBase).origin !== url.origin) throw new Error();
    url.pathname = "/api/admin/data-reset"; url.search = ""; url.hash = "";
  } catch { throw new AdminDataResetApiError("configuration"); }
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new AdminDataResetApiError("configuration");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ requestId: requestId.toLowerCase(), confirmation }),
      credentials: "include", cache: "no-store", signal: controller.signal,
    });
    if (!response.ok) throw new AdminDataResetApiError("http", response.status);
    if (response.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new AdminDataResetApiError("invalid_response");
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > 8192) throw new AdminDataResetApiError("invalid_response");
    let result: Record<string, unknown>;
    try { result = JSON.parse(text) as Record<string, unknown>; } catch { throw new AdminDataResetApiError("invalid_response"); }
    const counts = result?.deletedCounts as Record<string, unknown> | undefined;
    if (!result || typeof result !== "object" || Object.keys(result).length !== 3 || result.success !== true ||
      !counts || typeof counts !== "object" || Object.keys(counts).length !== TABLES.length ||
      TABLES.some((table) => !Number.isSafeInteger(counts[table]) || Number(counts[table]) < 0) ||
      !Number.isSafeInteger(result.totalDeleted) || result.totalDeleted !== TABLES.reduce((sum, table) => sum + Number(counts[table]), 0)) {
      throw new AdminDataResetApiError("invalid_response");
    }
    return result as unknown as AdminDataResetResult;
  } catch (error) {
    if (error instanceof AdminDataResetApiError) throw error;
    throw new AdminDataResetApiError(controller.signal.aborted ? "timeout" : "network");
  } finally { clearTimeout(timeout); }
}
