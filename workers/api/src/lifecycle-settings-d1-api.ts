import { selectD1Database, type Env } from "./repository";

const PUBLIC_PATH = "/api/system/lifecycle";
const ADMIN_PATH = "/api/admin/system-settings/lifecycle";
const BODY_LIMIT = 1024;
const MIN_DAYS = 1;
const MAX_DAYS = 365;

export interface LifecycleSettings {
  grace_period_days: number;
}

export type LifecycleSettingsAdminAuthorizer = (
  request: Request,
  responseHeaders: Headers,
) => Promise<{ userId: string; sessionId: string } | Response>;

interface SettingRow extends Record<string, unknown> {
  setting_value?: unknown;
  is_public?: unknown;
}

export class LifecycleSettingsError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "LifecycleSettingsError";
  }
}

function fail(code: string, status = 503): never {
  throw new LifecycleSettingsError(code, status);
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function cors(request: Request, env: Env, headers: Headers, allowedMethods: string): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const allowed = new Set(
    (env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  );
  if (!allowed.has(origin)) return false;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", allowedMethods);
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return true;
}

function database(env: Env): D1Database {
  if (env.LIFECYCLE_SETTINGS_BACKEND?.trim() !== "d1" || env.D1_TOPOLOGY?.trim() !== "split") {
    fail("lifecycle_settings_unavailable", env.LIFECYCLE_SETTINGS_BACKEND ? 500 : 503);
  }
  const selected = selectD1Database(env, "business");
  if (!selected) fail("lifecycle_settings_unavailable", 500);
  return selected;
}

function parseDays(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < MIN_DAYS || Number(value) > MAX_DAYS) {
    fail("invalid_grace_period_days", 400);
  }
  return Number(value);
}

function parseStoredSetting(rows: SettingRow[]): LifecycleSettings {
  if (rows.length !== 1 || Number(rows[0].is_public) !== 1 || typeof rows[0].setting_value !== "string" ||
      !/^[1-9]\d{0,2}$/u.test(rows[0].setting_value)) {
    fail("lifecycle_settings_unavailable");
  }
  const days = Number(rows[0].setting_value);
  if (!Number.isSafeInteger(days) || days < MIN_DAYS || days > MAX_DAYS) fail("lifecycle_settings_unavailable");
  return { grace_period_days: days };
}

async function readSettings(db: D1Database): Promise<LifecycleSettings> {
  try {
    const result = await db.prepare(`
      SELECT setting_value, is_public
      FROM system_settings
      WHERE setting_key = 'grace_period_days'
      LIMIT 2
    `).all<SettingRow>();
    if (!result || result.success !== true || !Array.isArray(result.results)) fail("lifecycle_settings_unavailable");
    return parseStoredSetting(result.results);
  } catch (error) {
    if (error instanceof LifecycleSettingsError) throw error;
    fail("lifecycle_settings_unavailable");
  }
}

async function readPatchBody(request: Request): Promise<number> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    fail("json_content_type_required", 415);
  }
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > BODY_LIMIT)) fail("request_too_large", 413);
  const reader = request.body?.getReader();
  if (!reader) fail("invalid_request", 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > BODY_LIMIT) fail("request_too_large", 413);
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof LifecycleSettingsError) throw error;
    fail("invalid_request", 400);
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
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
  if (Object.keys(record).length !== 1 || !Object.prototype.hasOwnProperty.call(record, "grace_period_days")) {
    fail("invalid_request", 400);
  }
  return parseDays(record.grace_period_days);
}

async function writeSettings(db: D1Database, days: number, now: string): Promise<LifecycleSettings> {
  try {
    const existing = await db.prepare(`
      SELECT is_public FROM system_settings WHERE setting_key = 'grace_period_days' LIMIT 2
    `).all<SettingRow>();
    if (!existing || existing.success !== true || !Array.isArray(existing.results) || existing.results.length > 1) {
      fail("lifecycle_settings_unavailable");
    }
    if (existing.results.length === 1 && Number(existing.results[0].is_public) !== 1) {
      fail("setting_not_public", 409);
    }
    const result = await db.prepare(`
      INSERT INTO system_settings
        (setting_key, setting_value, description, is_public, created_at, updated_at)
      VALUES ('grace_period_days', ?, 'License grace period in days', 1, ?, ?)
      ON CONFLICT (setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        updated_at = excluded.updated_at
      WHERE system_settings.is_public = 1
    `).bind(String(days), now, now).run();
    if (!result || result.success !== true) fail("lifecycle_settings_unavailable");
  } catch (error) {
    if (error instanceof LifecycleSettingsError) throw error;
    fail("lifecycle_settings_unavailable");
  }
  const readback = await readSettings(db);
  if (readback.grace_period_days !== days) fail("lifecycle_settings_readback_mismatch");
  return readback;
}

export function isLifecycleSettingsPath(pathname: string): boolean {
  return pathname === PUBLIC_PATH || pathname === ADMIN_PATH;
}

export async function handleLifecycleSettingsRequest(
  request: Request,
  env: Env,
  authorizeAdmin: LifecycleSettingsAdminAuthorizer,
  clock: () => Date = () => new Date(),
): Promise<Response> {
  const url = new URL(request.url);
  const publicRoute = url.pathname === PUBLIC_PATH;
  const adminRoute = url.pathname === ADMIN_PATH;
  if ((!publicRoute && !adminRoute) || url.search || url.hash) return json({ error: "not_found" }, 404);
  const allowedMethods = publicRoute ? "GET, OPTIONS" : "PATCH, OPTIONS";
  const headers = new Headers();
  if (!cors(request, env, headers, allowedMethods)) return json({ error: "forbidden_origin" }, 403);
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") {
    headers.set("allow", allowedMethods);
    return new Response(null, { status: 204, headers });
  }
  if ((publicRoute && method !== "GET") || (adminRoute && method !== "PATCH")) {
    headers.set("allow", allowedMethods);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  try {
    if (adminRoute) {
      if (env.AUTH_BACKEND?.trim() !== "better-auth") return json({ error: "auth_unavailable" }, 503, headers);
      const authorization = await authorizeAdmin(request, headers);
      if (authorization instanceof Response) return authorization;
    }
    const db = database(env);
    if (publicRoute) return json({ schemaVersion: 1, settings: await readSettings(db) }, 200, headers);
    const days = await readPatchBody(request);
    const settings = await writeSettings(db, days, clock().toISOString());
    return json({ schemaVersion: 1, settings }, 200, headers);
  } catch (error) {
    if (error instanceof LifecycleSettingsError) return json({ error: error.code }, error.status, headers);
    return json({ error: "lifecycle_settings_unavailable" }, 503, headers);
  }
}
