import bcrypt from "bcryptjs";
import { selectD1Database, type Env } from "./repository";
import type { StorageAuthResolver } from "./storage-r2";

const SETTINGS_PREFIX = "/api/me/fanmarks/";
const SETTINGS_SUFFIX = "/settings";
const SETTINGS_METHODS = "GET, PATCH, OPTIONS";
const MAX_REQUEST_BYTES = 24 * 1024;
const MAX_TEXT_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ACCESS_TYPES = new Set(["profile", "redirect", "text", "inactive"]);

interface SettingsRow extends Record<string, unknown> {
  fanmarkId: unknown;
  userInputFanmark: unknown;
  displayFanmark: unknown;
  emojiIds: unknown;
  shortId: unknown;
  fanmarkName: unknown;
  accessType: unknown;
  targetUrl: unknown;
  textContent: unknown;
  isPasswordProtected: unknown;
  status: unknown;
  licenseId: unknown;
  licenseStatus: unknown;
  licenseEnd: unknown;
  isPublic: unknown;
}

interface SettingsPatch {
  fanmarkName: string;
  accessType: "profile" | "redirect" | "text" | "inactive";
  targetUrl?: string;
  textContent?: string;
  isPasswordProtected: boolean;
  accessPassword?: string;
  isPublic: boolean;
}

export class FanmarkSettingsApiError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "FanmarkSettingsApiError";
  }
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const resultHeaders = new Headers(headers);
  resultHeaders.set("cache-control", "no-store");
  resultHeaders.set("content-type", "application/json; charset=utf-8");
  resultHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: resultHeaders });
}

function originHeaders(request: Request, env: Env): Headers | null {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (!origin) return headers;
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  if (!allowed.has(origin)) return null;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", SETTINGS_METHODS);
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return headers;
}

function routeFanmarkId(pathname: string): string | null | undefined {
  if (!pathname.startsWith(SETTINGS_PREFIX) || !pathname.endsWith(SETTINGS_SUFFIX)) return undefined;
  const rawId = pathname.slice(SETTINGS_PREFIX.length, -SETTINGS_SUFFIX.length);
  return UUID.test(rawId) ? rawId.toLowerCase() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new FanmarkSettingsApiError("json_content_type_required", 415);
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) {
    throw new FanmarkSettingsApiError("request_too_large", 413);
  }
  if (!request.body) throw new FanmarkSettingsApiError("invalid_request", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new FanmarkSettingsApiError("request_too_large", 413);
      }
      chunks.push(value);
    }
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
    throw new FanmarkSettingsApiError("invalid_json", 400);
  }
}

function safeTargetUrl(value: string): boolean {
  if (byteLength(value) > 2_048 || Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x20 || code === 0x7f;
  })) return false;
  if (/^tel:\+?[0-9]{1,32}$/u.test(value)) return true;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username && !url.password && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function parsePatch(value: unknown): SettingsPatch {
  if (!isRecord(value)) throw new FanmarkSettingsApiError("invalid_request", 400);
  const allowed = new Set([
    "fanmarkName", "accessType", "targetUrl", "textContent",
    "isPasswordProtected", "accessPassword", "isPublic",
  ]);
  const keys = Object.keys(value);
  if (keys.length < 4 || keys.some((key) => !allowed.has(key))) {
    throw new FanmarkSettingsApiError("invalid_request", 400);
  }
  if (typeof value.fanmarkName !== "string" || !value.fanmarkName.trim() || byteLength(value.fanmarkName) > 512 ||
      typeof value.accessType !== "string" || !ACCESS_TYPES.has(value.accessType) ||
      typeof value.isPasswordProtected !== "boolean" || typeof value.isPublic !== "boolean") {
    throw new FanmarkSettingsApiError("invalid_request", 400);
  }
  const patch: SettingsPatch = {
    fanmarkName: value.fanmarkName,
    accessType: value.accessType as SettingsPatch["accessType"],
    isPasswordProtected: value.isPasswordProtected,
    isPublic: value.isPublic,
  };
  if (Object.hasOwn(value, "targetUrl")) {
    if (typeof value.targetUrl !== "string" || !safeTargetUrl(value.targetUrl)) {
      throw new FanmarkSettingsApiError("invalid_request", 400);
    }
    patch.targetUrl = value.targetUrl;
  }
  if (patch.accessType === "redirect" && !patch.targetUrl) {
    throw new FanmarkSettingsApiError("invalid_request", 400);
  }
  if (Object.hasOwn(value, "textContent")) {
    if (typeof value.textContent !== "string" || byteLength(value.textContent) > MAX_TEXT_BYTES) {
      throw new FanmarkSettingsApiError("invalid_request", 400);
    }
    patch.textContent = value.textContent;
  }
  if (patch.accessType === "text" && patch.textContent === undefined) patch.textContent = "";
  if (Object.hasOwn(value, "accessPassword")) {
    if (typeof value.accessPassword !== "string" || !/^\d{4}$/u.test(value.accessPassword) ||
        !patch.isPasswordProtected || patch.accessType === "inactive") {
      throw new FanmarkSettingsApiError("invalid_request", 400);
    }
    patch.accessPassword = value.accessPassword;
  }
  if (patch.accessType === "inactive") patch.isPasswordProtected = false;
  return patch;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new FanmarkSettingsApiError("fanmark_settings_unavailable");
  return value;
}

function bool(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  throw new FanmarkSettingsApiError("fanmark_settings_unavailable");
}

function parseEmojiIds(value: unknown): string[] {
  let ids = value;
  if (typeof value === "string") {
    try {
      ids = JSON.parse(value) as unknown;
    } catch {
      throw new FanmarkSettingsApiError("fanmark_settings_unavailable");
    }
  }
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    throw new FanmarkSettingsApiError("fanmark_settings_unavailable");
  }
  return ids as string[];
}

function timestampNow(): string {
  return new Date().toISOString().replace(/\.(\d{3})Z$/u, (_match, millis: string) => `.${millis}000Z`);
}

function hasActiveLicense(row: SettingsRow, now: string): boolean {
  return row.licenseStatus === "active" &&
    (row.licenseEnd === null || row.licenseEnd === undefined ||
      (typeof row.licenseEnd === "string" && row.licenseEnd > now));
}

function database(env: Env): D1Database {
  if (env.FANMARK_SETTINGS_BACKEND?.trim() !== "d1") {
    throw new FanmarkSettingsApiError("fanmark_settings_unavailable", 503);
  }
  if (env.AUTH_BACKEND?.trim() !== "better-auth") {
    throw new FanmarkSettingsApiError("server_misconfigured", 500);
  }
  const db = selectD1Database(env, "business");
  if (!db) throw new FanmarkSettingsApiError("server_misconfigured", 500);
  return db;
}

async function readContext(db: D1Database, fanmarkId: string, userId: string, now: string): Promise<SettingsRow | null> {
  const result = await db.prepare(`
    SELECT
      f.id AS fanmarkId,
      f.user_input_fanmark AS userInputFanmark,
      l.display_fanmark AS displayFanmark,
      f.emoji_ids AS emojiIds,
      f.short_id AS shortId,
      b.fanmark_name AS fanmarkName,
      COALESCE(b.access_type, 'inactive') AS accessType,
      r.target_url AS targetUrl,
      m.content AS textContent,
      COALESCE(pw.is_enabled, 0) AS isPasswordProtected,
      f.status AS status,
      l.id AS licenseId,
      l.status AS licenseStatus,
      l.license_end AS licenseEnd,
      COALESCE(p.is_public, 0) AS isPublic
    FROM fanmarks AS f
    JOIN fanmark_licenses AS l ON l.fanmark_id = f.id
    LEFT JOIN fanmark_basic_configs AS b ON b.license_id = l.id
    LEFT JOIN fanmark_redirect_configs AS r ON r.license_id = l.id
    LEFT JOIN fanmark_messageboard_configs AS m ON m.license_id = l.id
    LEFT JOIN fanmark_password_configs AS pw ON pw.license_id = l.id
    LEFT JOIN fanmark_profiles AS p ON p.license_id = l.id
    WHERE f.id = ? AND l.user_id = ?
      AND l.id = (
        SELECT candidate.id FROM fanmark_licenses AS candidate
        WHERE candidate.fanmark_id = f.id
        ORDER BY (candidate.license_end IS NULL) DESC, candidate.license_end DESC
        LIMIT 1
      )
    LIMIT 2
  `).bind(fanmarkId, userId).all<SettingsRow>();
  if (!result.success || result.results.length > 1) throw new FanmarkSettingsApiError("fanmark_settings_unavailable");
  return result.results[0] ?? null;
}

function serialize(row: SettingsRow, now: string): Record<string, unknown> {
  if (typeof row.accessType !== "string" || !ACCESS_TYPES.has(row.accessType)) {
    throw new FanmarkSettingsApiError("fanmark_settings_unavailable");
  }
  const accessType = row.accessType;
  const fanmarkId = nullableString(row.fanmarkId);
  const userInputFanmark = nullableString(row.userInputFanmark);
  const shortId = nullableString(row.shortId);
  const licenseId = nullableString(row.licenseId);
  const status = nullableString(row.status);
  if (!fanmarkId || !userInputFanmark || !shortId || !licenseId || !status) {
    throw new FanmarkSettingsApiError("fanmark_settings_unavailable");
  }
  return {
    schemaVersion: 1,
    fanmark: {
      id: fanmarkId,
      user_input_fanmark: userInputFanmark,
      display_fanmark: nullableString(row.displayFanmark),
      emoji_ids: parseEmojiIds(row.emojiIds),
      fanmark_name: nullableString(row.fanmarkName),
      access_type: accessType,
      target_url: nullableString(row.targetUrl),
      text_content: nullableString(row.textContent),
      is_password_protected: bool(row.isPasswordProtected),
      status,
      short_id: shortId,
      license_id: licenseId,
      is_public: bool(row.isPublic),
      has_active_license: hasActiveLicense(row, now),
    },
  };
}

function eligibleLicenseSql(): string {
  return `EXISTS (
    SELECT 1 FROM fanmark_licenses
    WHERE id = ? AND user_id = ? AND status = 'active'
      AND (license_end IS NULL OR license_end > ?)
  )`;
}

async function applyPatch(
  db: D1Database,
  fanmarkId: string,
  userId: string,
  licenseId: string,
  now: string,
  patch: SettingsPatch,
  current: SettingsRow,
): Promise<void> {
  if (!hasActiveLicense(current, now)) {
    throw new FanmarkSettingsApiError("fanmark_not_editable", 404);
  }
  const preservePassword = patch.accessType !== "inactive" && patch.isPasswordProtected && patch.accessPassword === undefined;
  if (preservePassword && !bool(current.isPasswordProtected)) {
    throw new FanmarkSettingsApiError("password_required", 400);
  }

  const statements: D1PreparedStatement[] = [];
  const guard = eligibleLicenseSql();
  statements.push(db.prepare(`
    INSERT INTO fanmark_basic_configs (license_id, fanmark_name, access_type, created_at, updated_at)
    SELECT ?, ?, ?, ?, ? WHERE ${guard}
    ON CONFLICT(license_id) DO UPDATE SET
      fanmark_name = excluded.fanmark_name,
      access_type = excluded.access_type,
      updated_at = excluded.updated_at
  `).bind(licenseId, patch.fanmarkName, patch.accessType, now, now, licenseId, userId, now));

  if (patch.accessType === "redirect" && patch.targetUrl) {
    statements.push(db.prepare(`
      INSERT INTO fanmark_redirect_configs (license_id, target_url, created_at, updated_at)
      SELECT ?, ?, ?, ? WHERE ${guard}
      ON CONFLICT(license_id) DO UPDATE SET target_url = excluded.target_url, updated_at = excluded.updated_at
    `).bind(licenseId, patch.targetUrl, now, now, licenseId, userId, now));
  }

  if (patch.accessType === "text") {
    statements.push(db.prepare(`
      INSERT INTO fanmark_messageboard_configs (license_id, content, created_at, updated_at)
      SELECT ?, ?, ?, ? WHERE ${guard}
      ON CONFLICT(license_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `).bind(licenseId, patch.textContent ?? "", now, now, licenseId, userId, now));
  }

  if (patch.accessType === "inactive" || !patch.isPasswordProtected) {
    const disabledHash = await bcrypt.hash("0000", 10);
    statements.push(db.prepare(`
      INSERT INTO fanmark_password_configs (license_id, access_password, is_enabled, created_at, updated_at)
      SELECT ?, ?, 0, ?, ? WHERE ${guard}
      ON CONFLICT(license_id) DO UPDATE SET
        access_password = excluded.access_password,
        is_enabled = 0,
        updated_at = excluded.updated_at
    `).bind(licenseId, disabledHash, now, now, licenseId, userId, now));
    statements.push(db.prepare(`
      INSERT INTO fanmark_password_runtime_evidence
        (license_id, license_incarnation, password_generation, enabled, codec_id, created_at, updated_at)
      SELECT l.id, li.incarnation, av.password_generation, 0, 'bcryptjs@3.0.3', ?, ?
      FROM fanmark_licenses AS l
      JOIN fanmark_license_incarnations AS li ON li.license_id = l.id
      JOIN fanmark_access_versions AS av ON av.license_id = l.id AND av.license_incarnation = li.incarnation
      JOIN fanmark_password_configs AS pc ON pc.license_id = l.id
      WHERE l.id = ? AND l.user_id = ? AND l.status = 'active'
        AND (l.license_end IS NULL OR l.license_end > ?)
        AND pc.is_enabled = 0 AND pc.access_password = ?
      ON CONFLICT(license_id) DO UPDATE SET
        license_incarnation = excluded.license_incarnation,
        password_generation = excluded.password_generation,
        enabled = excluded.enabled,
        codec_id = excluded.codec_id,
        updated_at = excluded.updated_at
    `).bind(now, now, licenseId, userId, now, disabledHash));
  } else if (patch.accessPassword !== undefined) {
    const passwordHash = await bcrypt.hash(patch.accessPassword, 10);
    statements.push(db.prepare(`
      INSERT INTO fanmark_password_configs (license_id, access_password, is_enabled, created_at, updated_at)
      SELECT ?, ?, 1, ?, ? WHERE ${guard}
      ON CONFLICT(license_id) DO UPDATE SET
        access_password = excluded.access_password,
        is_enabled = 1,
        updated_at = excluded.updated_at
    `).bind(licenseId, passwordHash, now, now, licenseId, userId, now));
    statements.push(db.prepare(`
      INSERT INTO fanmark_password_runtime_evidence
        (license_id, license_incarnation, password_generation, enabled, codec_id, created_at, updated_at)
      SELECT l.id, li.incarnation, av.password_generation, 1, 'bcryptjs@3.0.3', ?, ?
      FROM fanmark_licenses AS l
      JOIN fanmark_license_incarnations AS li ON li.license_id = l.id
      JOIN fanmark_access_versions AS av ON av.license_id = l.id AND av.license_incarnation = li.incarnation
      JOIN fanmark_password_configs AS pc ON pc.license_id = l.id
      WHERE l.id = ? AND l.user_id = ? AND l.status = 'active'
        AND (l.license_end IS NULL OR l.license_end > ?)
        AND pc.is_enabled = 1 AND pc.access_password = ?
      ON CONFLICT(license_id) DO UPDATE SET
        license_incarnation = excluded.license_incarnation,
        password_generation = excluded.password_generation,
        enabled = excluded.enabled,
        codec_id = excluded.codec_id,
        updated_at = excluded.updated_at
    `).bind(now, now, licenseId, userId, now, passwordHash));
  }

  if (patch.accessType === "profile") {
    statements.push(db.prepare(`
      INSERT INTO fanmark_profiles
        (id, license_id, bio, social_links, theme_settings, is_public, created_at, updated_at)
      SELECT ?, ?, '', '{}', '{}', ?, ?, ? WHERE ${guard}
      ON CONFLICT(license_id) DO UPDATE SET
        is_public = excluded.is_public,
        updated_at = excluded.updated_at
    `).bind(crypto.randomUUID(), licenseId, patch.isPublic ? 1 : 0, now, now, licenseId, userId, now));
  }

  const results = await db.batch(statements);
  if (results.some((result) => !result.success)) throw new FanmarkSettingsApiError("fanmark_settings_update_failed");
  // Keep the selector in the prepared statements explicit, and verify the active owner still resolves.
  const after = await readContext(db, fanmarkId, userId, timestampNow());
  if (!after || after.licenseId !== licenseId || !hasActiveLicense(after, timestampNow())) {
    throw new FanmarkSettingsApiError("fanmark_not_editable", 404);
  }
}

export function isFanmarkSettingsPath(pathname: string): boolean {
  return pathname.startsWith(SETTINGS_PREFIX) && pathname.endsWith(SETTINGS_SUFFIX);
}

export async function handleFanmarkSettingsRequest(
  request: Request,
  env: Env,
  resolveAuth: StorageAuthResolver,
): Promise<Response> {
  const headers = originHeaders(request, env);
  if (!headers) return json({ error: "forbidden_origin" }, 403);
  const url = new URL(request.url);
  const fanmarkId = routeFanmarkId(url.pathname);
  if (!fanmarkId || url.search || url.hash) return json({ error: "invalid_request" }, 400, headers);
  if (request.method === "OPTIONS") {
    headers.set("allow", SETTINGS_METHODS);
    const requested = request.headers.get("access-control-request-method")?.toUpperCase();
    if (requested && !SETTINGS_METHODS.split(", ").includes(requested)) {
      return json({ error: "method_not_allowed" }, 405, headers);
    }
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET" && request.method !== "PATCH") {
    headers.set("allow", SETTINGS_METHODS);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  let db: D1Database;
  try {
    db = database(env);
  } catch (error) {
    return json({ error: error instanceof FanmarkSettingsApiError ? error.code : "server_misconfigured" },
      error instanceof FanmarkSettingsApiError ? error.status : 500, headers);
  }
  const auth = await resolveAuth(request, env);
  if (!auth.available) return json({ error: "auth_unavailable" }, 503, headers);
  if (!auth.userId) return json({ error: "unauthorized" }, 401, headers);

  try {
    const now = timestampNow();
    const current = await readContext(db, fanmarkId, auth.userId, now);
    if (!current) return json({ error: "fanmark_not_found" }, 404, headers);
    if (request.method === "PATCH") {
      const patch = parsePatch(await readJson(request));
      await applyPatch(db, fanmarkId, auth.userId, String(current.licenseId), now, patch, current);
    }
    const refreshed = request.method === "PATCH"
      ? await readContext(db, fanmarkId, auth.userId, timestampNow())
      : current;
    if (!refreshed) return json({ error: "fanmark_not_found" }, 404, headers);
    const serialized = serialize(refreshed, timestampNow());
    if (request.method === "PATCH" && !(serialized.fanmark as Record<string, unknown>).has_active_license) {
      return json({ error: "fanmark_not_editable" }, 404, headers);
    }
    return json(serialized, 200, headers);
  } catch (error) {
    if (error instanceof FanmarkSettingsApiError) return json({ error: error.code }, error.status, headers);
    return json({ error: "fanmark_settings_unavailable" }, 503, headers);
  }
}
