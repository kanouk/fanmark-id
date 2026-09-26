export interface Env {
  ASSETS?: Fetcher;
  FANMARK_DB?: D1Database;
  AUTH_DB?: D1Database;
  MASTER_DB?: D1Database;
  D1_TOPOLOGY?: string;
  AVATARS_BUCKET?: R2Bucket;
  COVER_IMAGES_BUCKET?: R2Bucket;
  AUTH_BACKEND?: string;
  AUTH_USER_STATUS_BACKEND?: string;
  AUTH_SOCIAL_BACKEND?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
  DISCORD_OAUTH_CLIENT_ID?: string;
  DISCORD_OAUTH_CLIENT_SECRET?: string;
  APPLE_OAUTH_CLIENT_ID?: string;
  APPLE_OAUTH_CLIENT_SECRET?: string;
  AUTH_EMAIL_BACKEND?: string;
  AUTH_EMAIL_TEMPLATE_BACKEND?: string;
  INVITATION_SIGNUP_BACKEND?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  STORAGE_BACKEND?: string;
  OWNED_FANMARKS_BACKEND?: string;
  PROFILE_BACKEND?: string;
  FANMARK_PROFILE_BACKEND?: string;
  FANMARK_SETTINGS_BACKEND?: string;
  FANMARK_RETURN_BACKEND?: string;
  FANMARK_REGISTRATION_BACKEND?: string;
  FANMARK_LOTTERY_BACKEND?: string;
  FANMARK_TRANSFER_BACKEND?: string;
  FANMARK_SEARCH_BACKEND?: string;
  FANMARK_DETAILS_BACKEND?: string;
  NOTIFICATIONS_BACKEND?: string;
  NOTIFICATION_MASTER_BACKEND?: string;
  AVAILABILITY_RULES_ADMIN_BACKEND?: string;
  ADMIN_USER_MANAGEMENT_BACKEND?: string;
  EMAIL_TEMPLATE_ADMIN_BACKEND?: string;
  INVITATION_ADMIN_BACKEND?: string;
  NOTIFICATION_PROCESSOR_BACKEND?: string;
  MAINTENANCE_SETTINGS_BACKEND?: string;
  LIFECYCLE_SETTINGS_BACKEND?: string;
  STRIPE_WEBHOOK_BACKEND?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_DISPATCH_BACKEND?: string;
  STRIPE_DISPATCH_BATCH_SIZE?: string;
  STRIPE_DISPATCH_MAX_ATTEMPTS?: string;
  STRIPE_SECRET_KEY_TEST?: string;
  STRIPE_SECRET_KEY_LIVE?: string;
  STRIPE_EXTENSION_CHECKOUT_BACKEND?: string;
  EXTENSION_COUPON_BACKEND?: string;
  EXTENSION_COUPON_ADMIN_BACKEND?: string;
  STRIPE_CUSTOMER_PORTAL_BACKEND?: string;
  STRIPE_PLAN_CHECKOUT_BACKEND?: string;
  STRIPE_PLAN_CHANGE_BACKEND?: string;
  STRIPE_SECRET_KEY?: string;
  FAVORITES_BACKEND?: string;
  FANMARK_ACCESS_ANALYTICS_BACKEND?: string;
  FANMARK_ANALYTICS_BACKEND?: string;
  LICENSE_EXPIRY_BACKEND?: string;
  LICENSE_EXPIRY_CRON?: string;
  LICENSE_EXPIRY_TARGET_INCARNATION?: string;
  LICENSE_EXPIRY_SCHEMA_EXTENSION_DIGEST?: string;
  LICENSE_EXPIRY_MAX_PAGES?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  AVAILABILITY_BACKEND?: string;
  EMOJI_CATALOG_BACKEND?: string;
  EMOJI_MASTER_ADMIN_BACKEND?: string;
  PUBLIC_ACCESS_BACKEND?: string;
  RECENT_FANMARKS_BACKEND?: string;
  REFERENCE_MASTER_BACKEND?: string;
  REFERENCE_MASTER_ADMIN_BACKEND?: string;
  REFERENCE_MASTER_SERVICE_SECRET?: string;
  VERIFIED_ACCESS_BACKEND?: string;
  VERIFIED_ACCESS_SECRET?: string;
  VERIFIED_ACCESS_TEST?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  CORS_ALLOWED_ORIGINS?: string;
  STAGING_NO_INDEX?: string;
  SUPABASE_REQUEST_TIMEOUT_MS?: string;
}

export type D1DatabaseRole = "business" | "auth" | "master";

/**
 * Select an explicit D1 boundary. Legacy single-database test/staging configs
 * may use FANMARK_DB for all roles; split topology never falls back across
 * databases when a required binding is missing.
 */
export function selectD1Database(env: Env, role: D1DatabaseRole): D1Database | undefined {
  const topology = env.D1_TOPOLOGY?.trim();
  if (topology && topology !== "legacy" && topology !== "split") return undefined;
  if (topology === "split") {
    if (role === "business") return env.FANMARK_DB;
    if (role === "auth") return env.AUTH_DB;
    return env.MASTER_DB;
  }

  if (role === "business") return env.FANMARK_DB;
  if (role === "auth") return env.AUTH_DB ?? env.FANMARK_DB;
  return env.MASTER_DB ?? env.FANMARK_DB;
}

export interface RecentFanmarkRpcRow {
  license_id?: unknown;
  fanmark_id?: unknown;
  fanmark_short_id?: unknown;
  display_emoji?: unknown;
  license_created_at?: unknown;
  [key: string]: unknown;
}

export interface RecentFanmarkItem {
  id: string;
  emoji: string;
  createdAt: string | null;
  shortId: string | null;
  fanmarkId: string | null;
}

export interface RecentFanmarksPayload {
  schemaVersion: 1;
  items: RecentFanmarkItem[];
}

export interface RecentFanmarksRepository {
  listRecent(limit: number): Promise<RecentFanmarkRpcRow[]>;
}

export type OutboundFetch = typeof fetch;

export const DEFAULT_SUPABASE_REQUEST_TIMEOUT_MS = 5_000;

export class RecentFanmarksConfigurationError extends Error {
  constructor() {
    super("recent fanmarks API is not configured");
    this.name = "RecentFanmarksConfigurationError";
  }
}

export class RecentFanmarksUpstreamError extends Error {
  constructor() {
    super("recent fanmarks upstream request failed");
    this.name = "RecentFanmarksUpstreamError";
  }
}

export class RecentFanmarksTimeoutError extends Error {
  constructor() {
    super("recent fanmarks upstream request timed out");
    this.name = "RecentFanmarksTimeoutError";
  }
}

function decodeJwtPayload(value: string): Record<string, unknown> | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isAllowedSupabaseKey(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("service_role") || normalized.startsWith("sb_secret_")) return false;
  if (normalized.startsWith("sb_publishable_") && normalized.length > "sb_publishable_".length) {
    return true;
  }

  // Legacy anon keys are JWTs. Accept only the public anon role; this rejects
  // service_role JWTs and arbitrary values even when they use an allowed name.
  return decodeJwtPayload(value)?.role === "anon";
}

export function configuredSupabaseKey(env: Env): string {
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const anonKey = env.SUPABASE_ANON_KEY?.trim();
  const key = publishableKey || anonKey;

  if (!key || !isAllowedSupabaseKey(key)) {
    throw new RecentFanmarksConfigurationError();
  }

  return key;
}

export function configuredSupabaseUrl(env: Env): URL {
  const rawUrl = env.SUPABASE_URL?.trim();
  if (!rawUrl) throw new RecentFanmarksConfigurationError();

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") {
      throw new RecentFanmarksConfigurationError();
    }
    if (
      (url.pathname !== "" && url.pathname !== "/") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new RecentFanmarksConfigurationError();
    }
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url;
  } catch (error) {
    if (error instanceof RecentFanmarksConfigurationError) throw error;
    throw new RecentFanmarksConfigurationError();
  }
}

export function configuredSupabaseTimeout(env: Env): number {
  const rawTimeout = env.SUPABASE_REQUEST_TIMEOUT_MS?.trim();
  if (!rawTimeout) return DEFAULT_SUPABASE_REQUEST_TIMEOUT_MS;

  const timeout = Number(rawTimeout);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30_000) {
    throw new RecentFanmarksConfigurationError();
  }
  return timeout;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function mapRecentFanmarkRows(rows: unknown, maxItems = 20): RecentFanmarksPayload {
  if (!Array.isArray(rows)) throw new RecentFanmarksUpstreamError();

  const items: RecentFanmarkItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as RecentFanmarkRpcRow;
    const id = stringOrNull(record.license_id) ?? stringOrNull(record.fanmark_id);
    if (!id) continue;

    items.push({
      id,
      emoji: stringOrNull(record.display_emoji) ?? "❓",
      createdAt: stringOrNull(record.license_created_at),
      shortId: stringOrNull(record.fanmark_short_id),
      fanmarkId: stringOrNull(record.fanmark_id),
    });
  }

  return { schemaVersion: 1, items: items.slice(0, maxItems) };
}

export function createSupabaseRecentFanmarksRepository(
  env: Env,
  outboundFetch: OutboundFetch,
): RecentFanmarksRepository {
  const key = configuredSupabaseKey(env);
  const baseUrl = configuredSupabaseUrl(env);
  const timeoutMs = configuredSupabaseTimeout(env);

  return {
    async listRecent(limit) {
      const endpoint = new URL("/rest/v1/rpc/list_recent_fanmarks", baseUrl);
      endpoint.searchParams.set("p_limit", String(limit));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;

      try {
        response = await outboundFetch(endpoint.toString(), {
          method: "GET",
          headers: {
            Accept: "application/json",
            apikey: key,
          },
          signal: controller.signal,
          // Workers only supports "follow" and "manual". Manual plus an
          // explicit 3xx rejection prevents a cross-host redirect.
          redirect: "manual",
        });
      } catch (error) {
        clearTimeout(timeoutId);
        if (controller.signal.aborted || isAbortError(error)) {
          throw new RecentFanmarksTimeoutError();
        }
        throw new RecentFanmarksUpstreamError();
      }

      try {
        if (response.status >= 300 && response.status < 400) {
          throw new RecentFanmarksUpstreamError();
        }
        if (!response.ok) throw new RecentFanmarksUpstreamError();

        const body: unknown = await response.json();
        if (controller.signal.aborted) throw new RecentFanmarksTimeoutError();
        if (!Array.isArray(body)) throw new RecentFanmarksUpstreamError();
        return body as RecentFanmarkRpcRow[];
      } catch (error) {
        if (error instanceof RecentFanmarksUpstreamError) throw error;
        if (controller.signal.aborted || isAbortError(error)) {
          throw new RecentFanmarksTimeoutError();
        }
        throw new RecentFanmarksUpstreamError();
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
