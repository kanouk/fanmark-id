import { selectD1Database, type Env } from "./repository";

const PUBLIC_PATH = "/api/system/settings";
const ADMIN_PATH = "/api/admin/system-settings";
const METHODS = "GET, PATCH, OPTIONS";
const MAX_BODY_BYTES = 2 * 1024;
const MAX_SETTING_VALUE_LENGTH = 256;

export const SYSTEM_SETTING_PUBLIC_KEYS = [
  "invitation_mode",
  "social_login_enabled",
  "free_fanmarks_limit",
  "creator_fanmarks_limit",
  "max_fanmarks_limit",
  "business_fanmarks_limit",
  "premium_pricing",
  "max_pricing",
  "business_pricing",
  "max_emoji_characters",
  "creator_stripe_price_id",
  "max_stripe_price_id",
  "business_stripe_price_id",
  "creator_stripe_price_id_live",
  "max_stripe_price_id_live",
  "business_stripe_price_id_live",
  "stripe_mode",
] as const;

const PRIVATE_SETTING_KEYS = ["enterprise_fanmarks_limit", "enterprise_pricing"] as const;
const ADMIN_SETTING_KEYS = [...SYSTEM_SETTING_PUBLIC_KEYS, ...PRIVATE_SETTING_KEYS] as const;
const EDITABLE_SETTING_KEYS = new Set<string>([
  "invitation_mode",
  "free_fanmarks_limit",
  "creator_fanmarks_limit",
  "premium_pricing",
  "business_fanmarks_limit",
  "business_pricing",
  "enterprise_fanmarks_limit",
  "enterprise_pricing",
  "creator_stripe_price_id",
  "business_stripe_price_id",
]);
const PRIVATE_SETTING_KEY_SET = new Set<string>(PRIVATE_SETTING_KEYS);
const BOOLEAN_SETTING_KEYS = new Set(["invitation_mode", "social_login_enabled"]);
const PRICE_ID_SETTING_KEYS = new Set([
  "creator_stripe_price_id",
  "max_stripe_price_id",
  "business_stripe_price_id",
  "creator_stripe_price_id_live",
  "max_stripe_price_id_live",
  "business_stripe_price_id_live",
]);
const NUMERIC_SETTING_KEYS = new Set([
  "free_fanmarks_limit",
  "creator_fanmarks_limit",
  "max_fanmarks_limit",
  "business_fanmarks_limit",
  "enterprise_fanmarks_limit",
  "premium_pricing",
  "max_pricing",
  "business_pricing",
  "enterprise_pricing",
  "max_emoji_characters",
]);

export type SystemSettingsAdminAuthorizer = (
  request: Request,
  responseHeaders: Headers,
) => Promise<{ userId: string; sessionId: string } | Response>;

interface SettingRow extends Record<string, unknown> {
  setting_key?: unknown;
  setting_value?: unknown;
  is_public?: unknown;
}

export class SystemSettingsD1Error extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "SystemSettingsD1Error";
  }
}

function fail(code: string, status = 503): never {
  throw new SystemSettingsD1Error(code, status);
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function allowedOrigin(request: Request, env: Env, headers: Headers): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  if (!allowed.has(origin)) return false;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", METHODS);
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return true;
}

function database(env: Env): D1Database {
  if (env.SYSTEM_SETTINGS_BACKEND?.trim() !== "d1" || env.D1_TOPOLOGY?.trim() !== "split") {
    fail(env.SYSTEM_SETTINGS_BACKEND ? "server_misconfigured" : "system_settings_unavailable", env.SYSTEM_SETTINGS_BACKEND ? 500 : 503);
  }
  const selected = selectD1Database(env, "business");
  if (!selected) fail("system_settings_unavailable");
  return selected;
}

function valueIsValid(key: string, value: string): boolean {
  if (value.length > MAX_SETTING_VALUE_LENGTH) return false;
  if (BOOLEAN_SETTING_KEYS.has(key)) return value === "true" || value === "false";
  if (NUMERIC_SETTING_KEYS.has(key)) {
    if (!/^(?:0|[1-9]\d*)$/u.test(value)) return false;
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric)) return false;
    const isCount = key.endsWith("_limit") || key === "max_emoji_characters";
    return isCount ? numeric >= 1 && numeric <= 1_000_000 : numeric <= 100_000_000;
  }
  if (PRICE_ID_SETTING_KEYS.has(key)) return value === "" || /^price_[A-Za-z0-9_]{1,250}$/u.test(value);
  if (key === "stripe_mode") return value === "test" || value === "live";
  return false;
}

function expectedKeys(includePrivate: boolean): readonly string[] {
  return includePrivate ? ADMIN_SETTING_KEYS : SYSTEM_SETTING_PUBLIC_KEYS;
}

async function readSettings(db: D1Database, includePrivate: boolean): Promise<Record<string, string>> {
  const keys = expectedKeys(includePrivate);
  try {
    const placeholders = keys.map(() => "?").join(", ");
    const result = await db.prepare(`
      SELECT setting_key, setting_value, is_public
      FROM system_settings
      WHERE setting_key IN (${placeholders})
      ORDER BY setting_key
    `).bind(...keys).all<SettingRow>();
    if (!result.success || !Array.isArray(result.results) || result.results.length !== keys.length) {
      fail("system_settings_unavailable");
    }
    const values: Record<string, string> = {};
    const seen = new Set<string>();
    for (const row of result.results) {
      if (typeof row.setting_key !== "string" || !keys.includes(row.setting_key) || seen.has(row.setting_key) ||
          typeof row.setting_value !== "string" || !valueIsValid(row.setting_key, row.setting_value)) {
        fail("system_settings_unavailable");
      }
      const expectedPublic = !PRIVATE_SETTING_KEY_SET.has(row.setting_key);
      if ((Number(row.is_public) === 1) !== expectedPublic || ![0, 1].includes(Number(row.is_public))) {
        fail("system_settings_unavailable");
      }
      seen.add(row.setting_key);
      values[row.setting_key] = row.setting_value;
    }
    if (seen.size !== keys.length) fail("system_settings_unavailable");
    return values;
  } catch (error) {
    if (error instanceof SystemSettingsD1Error) throw error;
    fail("system_settings_unavailable");
  }
}

interface SettingUpdate {
  key: string;
  value: string;
  expectedValue: string;
}

async function readBody(request: Request): Promise<SettingUpdate> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    fail("json_content_type_required", 415);
  }
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) fail("request_too_large", 413);
  const reader = request.body?.getReader();
  if (!reader) fail("invalid_request", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        fail("request_too_large", 413);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof SystemSettingsD1Error) throw error;
    fail("invalid_request", 400);
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    fail("invalid_request", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("invalid_request", 400);
  const record = body as Record<string, unknown>;
  if (Object.keys(record).length !== 3 || !Object.hasOwn(record, "key") || !Object.hasOwn(record, "value") ||
      !Object.hasOwn(record, "expectedValue") || typeof record.key !== "string" ||
      !EDITABLE_SETTING_KEYS.has(record.key) || typeof record.expectedValue !== "string" ||
      !valueIsValid(record.key, String(record.value))) {
    fail("invalid_request", 400);
  }
  return { key: record.key, value: String(record.value), expectedValue: record.expectedValue };
}

export function isSystemSettingsPath(pathname: string): boolean {
  return pathname === PUBLIC_PATH || pathname === ADMIN_PATH;
}

export async function handleSystemSettingsRequest(
  request: Request,
  env: Env,
  authorizeAdmin: SystemSettingsAdminAuthorizer,
  options: { now?: () => Date } = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  const publicRoute = url.pathname === PUBLIC_PATH;
  const adminRoute = url.pathname === ADMIN_PATH;
  if ((!publicRoute && !adminRoute) || url.search || url.hash) return null;
  const headers = new Headers();
  if (!allowedOrigin(request, env, headers)) return json({ error: "origin_not_allowed" }, 403);
  const allowedMethods = publicRoute ? "GET, OPTIONS" : METHODS;
  if (request.method === "OPTIONS") {
    headers.set("allow", allowedMethods);
    return new Response(null, { status: 204, headers });
  }
  if ((publicRoute && request.method !== "GET") ||
      (adminRoute && request.method !== "GET" && request.method !== "PATCH")) {
    headers.set("allow", allowedMethods);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  let adminAuthorization: { userId: string; sessionId: string } | null = null;
  if (adminRoute) {
    if (env.AUTH_BACKEND?.trim() !== "better-auth") return json({ error: "auth_unavailable" }, 503, headers);
    const authorization = await authorizeAdmin(request, headers);
    if (authorization instanceof Response) return authorization;
    adminAuthorization = authorization;
  }
  try {
    const db = database(env);
    if (request.method === "GET") {
      return json({ schemaVersion: 1, settings: await readSettings(db, adminRoute) }, 200, headers);
    }
    const update = await readBody(request);
    const current = await readSettings(db, true);
    if (current[update.key] !== update.expectedValue) return json({ error: "stale_system_setting" }, 409, headers);
    if (current[update.key] === update.value) {
      return json({ schemaVersion: 1, updatedSetting: update.key }, 200, headers);
    }
    const now = (options.now?.() ?? new Date()).toISOString();
    const metadata = JSON.stringify({ settingKey: update.key });
    const auditId = crypto.randomUUID();
    const results = await db.batch([
      db.prepare(`
        UPDATE system_settings SET setting_value = ?, updated_at = ?
        WHERE setting_key = ? AND setting_value = ? AND is_public = ?
      `).bind(update.value, now, update.key, update.expectedValue, PRIVATE_SETTING_KEY_SET.has(update.key) ? 0 : 1),
      db.prepare(`
        INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata, created_at)
        SELECT ?, ?, 'ADMIN_UPDATE_SYSTEM_SETTING', 'system_setting', ?, ?, ? WHERE changes() = 1
      `).bind(auditId, adminAuthorization?.userId ?? null, update.key, metadata, now),
    ]);
    if (results.length !== 2 || results.some((result) => !result.success)) fail("system_settings_unavailable");
    if (results[0]?.meta.changes !== 1) return json({ error: "stale_system_setting" }, 409, headers);
    if (results[1]?.meta.changes !== 1) fail("system_settings_unavailable");
    const readback = await readSettings(db, true);
    if (readback[update.key] !== update.value) fail("system_settings_readback_mismatch");
    return json({ schemaVersion: 1, updatedSetting: update.key }, 200, headers);
  } catch (error) {
    if (error instanceof SystemSettingsD1Error) return json({ error: error.code }, error.status, headers);
    return json({ error: "system_settings_unavailable" }, 503, headers);
  }
}
