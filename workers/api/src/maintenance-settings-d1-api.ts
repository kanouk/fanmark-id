import { selectD1Database, type Env } from "./repository";

const PUBLIC_PATH = "/api/system/maintenance";
const ADMIN_PATH = "/api/admin/system-settings/maintenance";
const SETTINGS = ["maintenance_mode", "maintenance_message", "maintenance_end_time"] as const;
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_BODY_BYTES = 4 * 1024;

export interface MaintenanceSettings {
  maintenance_mode: boolean;
  maintenance_message: string;
  maintenance_end_time: string | null;
}

export interface MaintenanceSettingsPatch {
  maintenance_mode?: boolean;
  maintenance_message?: string;
  maintenance_end_time?: string | null;
}

export type MaintenanceAdminAuthorizer = (
  request: Request,
  responseHeaders: Headers,
) => Promise<{ userId: string; sessionId: string } | Response>;

interface SettingRow extends Record<string, unknown> {
  setting_key?: unknown;
  setting_value?: unknown;
  is_public?: unknown;
}

export class MaintenanceSettingsError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "MaintenanceSettingsError";
  }
}

function fail(code: string, status = 503): never {
  throw new MaintenanceSettingsError(code, status);
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function cors(request: Request, env: Env, headers: Headers): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const allowed = new Set(
    (env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  );
  if (!allowed.has(origin)) return false;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET, PATCH, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return true;
}

function database(env: Env): D1Database {
  const backend = env.MAINTENANCE_SETTINGS_BACKEND?.trim();
  if (backend !== "d1") {
    fail(backend ? "server_misconfigured" : "maintenance_settings_unavailable", backend ? 500 : 503);
  }
  if (env.D1_TOPOLOGY?.trim() !== "split") fail("server_misconfigured", 500);
  const selected = selectD1Database(env, "business");
  if (!selected) fail("server_misconfigured", 500);
  return selected;
}

function parseSettingRows(rows: SettingRow[]): MaintenanceSettings {
  if (rows.length > SETTINGS.length) fail("maintenance_settings_unavailable");
  const values = new Map<string, string>();
  for (const row of rows) {
    if (
      typeof row.setting_key !== "string" || !SETTINGS.includes(row.setting_key as typeof SETTINGS[number]) ||
      typeof row.setting_value !== "string" || values.has(row.setting_key)
    ) fail("maintenance_settings_unavailable");
    values.set(row.setting_key, row.setting_value);
  }

  const mode = values.get("maintenance_mode") ?? "false";
  if (mode !== "true" && mode !== "false") fail("maintenance_settings_unavailable");
  const message = values.get("maintenance_message") ?? "";
  if (message.length > MAX_MESSAGE_LENGTH) fail("maintenance_settings_unavailable");
  const rawEndTime = values.get("maintenance_end_time") ?? "";
  const endTime = rawEndTime === "" ? null : rawEndTime;
  if (endTime !== null && (!Number.isFinite(Date.parse(endTime)) || endTime.length > 64)) {
    fail("maintenance_settings_unavailable");
  }

  return {
    maintenance_mode: mode === "true",
    maintenance_message: message,
    maintenance_end_time: endTime,
  };
}

async function readSettings(db: D1Database): Promise<MaintenanceSettings> {
  try {
    const result = await db.prepare(`
      SELECT setting_key, setting_value
      FROM system_settings
      WHERE is_public = 1 AND setting_key IN (?, ?, ?)
      ORDER BY setting_key
    `).bind(...SETTINGS).all<SettingRow>();
    if (!result || result.success !== true || !Array.isArray(result.results)) {
      fail("maintenance_settings_unavailable");
    }
    return parseSettingRows(result.results);
  } catch (error) {
    if (error instanceof MaintenanceSettingsError) throw error;
    fail("maintenance_settings_unavailable");
  }
}

function parsePatch(value: unknown): MaintenanceSettingsPatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_request", 400);
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0 || keys.some((key) => !SETTINGS.includes(key as typeof SETTINGS[number]))) {
    fail("invalid_request", 400);
  }
  const patch: MaintenanceSettingsPatch = {};
  if (Object.hasOwn(record, "maintenance_mode")) {
    if (typeof record.maintenance_mode !== "boolean") fail("invalid_request", 400);
    patch.maintenance_mode = record.maintenance_mode;
  }
  if (Object.hasOwn(record, "maintenance_message")) {
    if (typeof record.maintenance_message !== "string" || record.maintenance_message.length > MAX_MESSAGE_LENGTH) {
      fail("invalid_request", 400);
    }
    patch.maintenance_message = record.maintenance_message;
  }
  if (Object.hasOwn(record, "maintenance_end_time")) {
    const endTime = record.maintenance_end_time;
    if (endTime !== null && (typeof endTime !== "string" || endTime.length > 64 || !Number.isFinite(Date.parse(endTime)))) {
      fail("invalid_request", 400);
    }
    patch.maintenance_end_time = endTime as string | null;
  }
  return patch;
}

async function readPatchBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    fail("json_content_type_required", 415);
  }
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    fail("request_too_large", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) fail("invalid_request", 400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) fail("request_too_large", 413);
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof MaintenanceSettingsError) throw error;
    fail("invalid_request", 400);
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    fail("invalid_request", 400);
  }
}

async function updateSettings(
  db: D1Database,
  patch: MaintenanceSettingsPatch,
  now: string,
): Promise<MaintenanceSettings> {
  const stored = new Map<string, string>([
    ["maintenance_mode", String(patch.maintenance_mode)],
    ["maintenance_message", patch.maintenance_message ?? ""],
    ["maintenance_end_time", patch.maintenance_end_time ?? ""],
  ]);
  const updates = SETTINGS.filter((key) => Object.hasOwn(patch, key));
  if (updates.length === 0) fail("invalid_request", 400);

  try {
    const existing = await db.prepare(`
      SELECT setting_key, is_public
      FROM system_settings
      WHERE setting_key IN (?, ?, ?)
    `).bind(...SETTINGS).all<SettingRow>();
    if (!existing || existing.success !== true || !Array.isArray(existing.results)) {
      fail("maintenance_settings_unavailable");
    }
    for (const row of existing.results) {
      if (typeof row.setting_key !== "string" || !SETTINGS.includes(row.setting_key as typeof SETTINGS[number])) {
        fail("maintenance_settings_unavailable");
      }
      if (Number(row.is_public) !== 1 && updates.includes(row.setting_key as typeof SETTINGS[number])) {
        fail("setting_not_public", 409);
      }
    }

    const statements = updates.map((key) => db.prepare(`
      INSERT INTO system_settings
        (setting_key, setting_value, description, is_public, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT (setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        updated_at = excluded.updated_at
      WHERE system_settings.is_public = 1
    `).bind(key, stored.get(key), `Public maintenance setting: ${key}`, now, now));
    const results = await db.batch(statements);
    if (!Array.isArray(results) || results.length !== updates.length || results.some((result) => result.success !== true)) {
      fail("maintenance_settings_unavailable");
    }
  } catch (error) {
    if (error instanceof MaintenanceSettingsError) throw error;
    fail("maintenance_settings_unavailable");
  }

  const settings = await readSettings(db);
  for (const key of updates) {
    const expected = key === "maintenance_mode"
      ? patch.maintenance_mode
      : key === "maintenance_message"
        ? patch.maintenance_message
        : patch.maintenance_end_time;
    const actual = settings[key];
    if (actual !== expected) fail("maintenance_settings_readback_mismatch");
  }
  return settings;
}

export function isMaintenanceSettingsPath(pathname: string): boolean {
  return pathname === PUBLIC_PATH || pathname === ADMIN_PATH;
}

export async function handleMaintenanceSettingsRequest(
  request: Request,
  env: Env,
  authorizeAdmin: MaintenanceAdminAuthorizer,
  clock: () => Date = () => new Date(),
): Promise<Response> {
  const url = new URL(request.url);
  const isPublic = url.pathname === PUBLIC_PATH;
  const isAdmin = url.pathname === ADMIN_PATH;
  if ((!isPublic && !isAdmin) || url.search || url.hash) return json({ error: "not_found" }, 404);
  const headers = new Headers();
  if (!cors(request, env, headers)) return json({ error: "forbidden_origin" }, 403);

  const method = request.method.toUpperCase();
  if (method === "OPTIONS") {
    headers.set("allow", "GET, PATCH, OPTIONS");
    return new Response(null, { status: 204, headers });
  }
  if ((isPublic && method !== "GET") || (isAdmin && method !== "PATCH")) {
    headers.set("allow", isPublic ? "GET, OPTIONS" : "PATCH, OPTIONS");
    return json({ error: "method_not_allowed" }, 405, headers);
  }

  try {
    const db = database(env);
    if (isPublic) {
      return json({ schemaVersion: 1, settings: await readSettings(db) }, 200, headers);
    }
    if (env.AUTH_BACKEND?.trim() !== "better-auth") return json({ error: "auth_unavailable" }, 503, headers);
    const authorization = await authorizeAdmin(request, headers);
    if (authorization instanceof Response) return authorization;
    const patch = parsePatch(await readPatchBody(request));
    const settings = await updateSettings(db, patch, clock().toISOString());
    return json({ schemaVersion: 1, settings }, 200, headers);
  } catch (error) {
    if (error instanceof MaintenanceSettingsError) return json({ error: error.code }, error.status, headers);
    return json({ error: "maintenance_settings_unavailable" }, 503, headers);
  }
}
