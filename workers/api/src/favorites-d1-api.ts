import { selectD1Database, type Env } from "./repository";
import type { StorageAuthResolver } from "./storage-r2";

const FAVORITES_PATH = "/api/me/favorites";
const FAVORITES_METHODS = "GET, POST, DELETE, OPTIONS";
const MAX_BODY_BYTES = 4 * 1024;
const MAX_FAVORITES = 500;
const MAX_EMOJI_IDS = 64;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SKIN_TONES = new Set(["1F3FB", "1F3FC", "1F3FD", "1F3FE", "1F3FF"]);

interface FavoriteRow extends Record<string, unknown> {
  favoriteId: unknown;
  discoveryId: unknown;
  favoritedAt: unknown;
  fanmarkId: unknown;
  displayFanmark: unknown;
  normalizedEmojiIds: unknown;
  emojiIds: unknown;
  availabilityStatus: unknown;
  searchCount: unknown;
  favoriteCount: unknown;
  shortId: unknown;
  fanmarkName: unknown;
  accessType: unknown;
  targetUrl: unknown;
  textContent: unknown;
  currentOwnerUsername: unknown;
  currentOwnerDisplayName: unknown;
  currentLicenseStart: unknown;
  currentLicenseEnd: unknown;
  currentLicenseStatus: unknown;
  isPasswordProtected: unknown;
}

interface MasterRow extends Record<string, unknown> {
  id: unknown;
  codepointsJson: unknown;
}

export class FavoritesApiError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "FavoritesApiError";
  }
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const resultHeaders = new Headers(headers);
  resultHeaders.set("cache-control", "no-store");
  resultHeaders.set("content-type", "application/json; charset=utf-8");
  let serialized = JSON.stringify(body);
  let responseStatus = status;
  if (new TextEncoder().encode(serialized).byteLength > 1024 * 1024) {
    serialized = JSON.stringify({ error: "favorites_unavailable" });
    responseStatus = 503;
  }
  return new Response(serialized, { status: responseStatus, headers: resultHeaders });
}

function originHeaders(request: Request, env: Env): Headers | null {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (!origin) return headers;
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  if (!allowed.has(origin)) return null;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", FAVORITES_METHODS);
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function database(env: Env): D1Database {
  if (env.FAVORITES_BACKEND?.trim() !== "d1") throw new FavoritesApiError("favorites_unavailable");
  const selected = selectD1Database(env, "business");
  if (!selected || env.AUTH_BACKEND?.trim() !== "better-auth") {
    throw new FavoritesApiError("server_misconfigured", 500);
  }
  return selected;
}

function masterDatabase(env: Env): D1Database {
  const selected = selectD1Database(env, "master");
  if (!selected) throw new FavoritesApiError("server_misconfigured", 500);
  return selected;
}

function parseEmojiIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EMOJI_IDS ||
      value.some((id) => typeof id !== "string" || !UUID_RE.test(id))) {
    throw new FavoritesApiError("invalid_request", 400);
  }
  return value.map((id) => (id as string).toLowerCase());
}

async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new FavoritesApiError("json_content_type_required", 415);
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new FavoritesApiError("request_too_large", 413);
  }
  let source: string;
  try {
    source = await request.text();
  } catch {
    throw new FavoritesApiError("invalid_request", 400);
  }
  if (new TextEncoder().encode(source).byteLength > MAX_BODY_BYTES) throw new FavoritesApiError("request_too_large", 413);
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new FavoritesApiError("invalid_request", 400);
  }
}

async function activeRelease(master: D1Database): Promise<string> {
  let result: D1Result<{ releaseVersion: unknown }>;
  try {
    result = await master.prepare(
      "SELECT release_version AS releaseVersion FROM fanmark_emoji_master_active_release WHERE singleton_id = 1 LIMIT 2",
    ).all<{ releaseVersion: unknown }>();
  } catch {
    throw new FavoritesApiError("favorites_unavailable");
  }
  const rows = result.results ?? [];
  if (result.success !== true || rows.length !== 1 || typeof rows[0].releaseVersion !== "string") {
    throw new FavoritesApiError("emoji_master_unavailable");
  }
  return rows[0].releaseVersion;
}

function codepoints(value: unknown): string[] {
  if (typeof value !== "string") throw new FavoritesApiError("emoji_master_unavailable");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new FavoritesApiError("emoji_master_unavailable");
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.some((item) => typeof item !== "string" || !/^[0-9A-F]{4,6}$/u.test(item))) {
    throw new FavoritesApiError("emoji_master_unavailable");
  }
  return parsed;
}

async function normalizeEmojiIds(master: D1Database, inputIds: string[]): Promise<string[]> {
  const release = await activeRelease(master);
  const uniqueInputIds = [...new Set(inputIds)];
  const inputRows = await master.prepare(
    `SELECT id, codepoints_json AS codepointsJson
       FROM fanmark_emoji_master_release_staging
      WHERE release_version = ? AND id IN (${uniqueInputIds.map(() => "?").join(",")})`,
  ).bind(release, ...uniqueInputIds).all<MasterRow>();
  if (inputRows.success !== true || !Array.isArray(inputRows.results)) throw new FavoritesApiError("emoji_master_unavailable");
  const originals = new Map<string, string[]>();
  for (const row of inputRows.results) {
    if (typeof row.id !== "string" || originals.has(row.id)) throw new FavoritesApiError("emoji_master_unavailable");
    originals.set(row.id, codepoints(row.codepointsJson));
  }
  if (uniqueInputIds.some((id) => !originals.has(id))) throw new FavoritesApiError("invalid_emoji_ids", 400);

  const normalizedCodepoints = new Map<string, string[]>();
  for (const id of uniqueInputIds) {
    const normalized = originals.get(id)?.filter((point) => !SKIN_TONES.has(point));
    if (!normalized?.length) throw new FavoritesApiError("invalid_emoji_ids", 400);
    normalizedCodepoints.set(id, normalized);
  }
  const serializedCandidates = [...new Set([...normalizedCodepoints.values()].map((points) => JSON.stringify(points)))];
  const normalizedRows = await master.prepare(
    `SELECT id, codepoints_json AS codepointsJson
       FROM fanmark_emoji_master_release_staging
      WHERE release_version = ? AND codepoints_json IN (${serializedCandidates.map(() => "?").join(",")})`,
  ).bind(release, ...serializedCandidates).all<MasterRow>();
  if (normalizedRows.success !== true || !Array.isArray(normalizedRows.results)) throw new FavoritesApiError("emoji_master_unavailable");
  const idsByCodepoints = new Map<string, string>();
  for (const row of normalizedRows.results) {
    if (typeof row.id !== "string" || typeof row.codepointsJson !== "string" || idsByCodepoints.has(row.codepointsJson)) {
      throw new FavoritesApiError("emoji_master_unavailable");
    }
    idsByCodepoints.set(row.codepointsJson, row.id);
  }
  return inputIds.map((id) => {
    const normalizedId = idsByCodepoints.get(JSON.stringify(normalizedCodepoints.get(id)));
    if (!normalizedId) throw new FavoritesApiError("invalid_emoji_ids", 400);
    return normalizedId;
  });
}

function text(value: unknown, maximum = 512): string {
  if (typeof value !== "string" || value.length > maximum) throw new FavoritesApiError("favorites_unavailable");
  return value;
}

function nullableText(value: unknown, maximum = 512): string | null {
  if (value === null) return null;
  return text(value, maximum);
}

function jsonArray(value: unknown): string[] {
  if (typeof value !== "string") throw new FavoritesApiError("favorites_unavailable");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new FavoritesApiError("favorites_unavailable");
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_EMOJI_IDS || parsed.some((item) => typeof item !== "string" || !UUID_RE.test(item))) {
    throw new FavoritesApiError("favorites_unavailable");
  }
  return parsed.map((id) => (id as string).toLowerCase());
}

function integer(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new FavoritesApiError("favorites_unavailable");
  return parsed;
}

function booleanValue(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  throw new FavoritesApiError("favorites_unavailable");
}

function mapFavorite(row: FavoriteRow): Record<string, unknown> {
  const normalizedIds = jsonArray(row.normalizedEmojiIds);
  const emojiIds = jsonArray(row.emojiIds);
  const favorite = {
    favorite_id: text(row.favoriteId, 64),
    discovery_id: text(row.discoveryId, 64),
    favorited_at: text(row.favoritedAt),
    fanmark_id: nullableText(row.fanmarkId),
    display_fanmark: nullableText(row.displayFanmark),
    normalized_emoji_ids: normalizedIds,
    emoji_ids: emojiIds,
    availability_status: text(row.availabilityStatus, 64),
    search_count: integer(row.searchCount),
    favorite_count: integer(row.favoriteCount),
    short_id: nullableText(row.shortId),
    fanmark_name: nullableText(row.fanmarkName),
    access_type: nullableText(row.accessType),
    target_url: nullableText(row.targetUrl, 8192),
    text_content: nullableText(row.textContent, 32 * 1024),
    current_owner_username: nullableText(row.currentOwnerUsername),
    current_owner_display_name: nullableText(row.currentOwnerDisplayName),
    current_license_start: nullableText(row.currentLicenseStart),
    current_license_end: nullableText(row.currentLicenseEnd),
    current_license_status: nullableText(row.currentLicenseStatus),
    is_password_protected: booleanValue(row.isPasswordProtected),
  };
  if (!UUID_RE.test(favorite.favorite_id) || !UUID_RE.test(favorite.discovery_id) ||
      (favorite.fanmark_id !== null && !UUID_RE.test(favorite.fanmark_id)) ||
      !Number.isFinite(Date.parse(favorite.favorited_at))) {
    throw new FavoritesApiError("favorites_unavailable");
  }
  return favorite;
}

const LIST_SQL = `
SELECT
  ff.id AS favoriteId,
  ff.discovery_id AS discoveryId,
  ff.created_at AS favoritedAt,
  d.fanmark_id AS fanmarkId,
  ff.display_fanmark AS displayFanmark,
  d.normalized_emoji_ids AS normalizedEmojiIds,
  d.emoji_ids AS emojiIds,
  d.availability_status AS availabilityStatus,
  d.search_count AS searchCount,
  d.favorite_count AS favoriteCount,
  f.short_id AS shortId,
  bc.fanmark_name AS fanmarkName,
  bc.access_type AS accessType,
  rc.target_url AS targetUrl,
  mc.content AS textContent,
  us.username AS currentOwnerUsername,
  us.display_name AS currentOwnerDisplayName,
  fl.license_start AS currentLicenseStart,
  fl.license_end AS currentLicenseEnd,
  fl.status AS currentLicenseStatus,
  COALESCE(pc.is_enabled, 0) AS isPasswordProtected
FROM fanmark_favorites AS ff
JOIN fanmark_discoveries AS d ON d.id = ff.discovery_id
LEFT JOIN fanmarks AS f ON f.id = d.fanmark_id
LEFT JOIN fanmark_licenses AS fl ON fl.id = (
  SELECT inner_fl.id
  FROM fanmark_licenses AS inner_fl
  WHERE inner_fl.fanmark_id = f.id
  ORDER BY (inner_fl.license_end IS NULL) ASC, inner_fl.license_end DESC, inner_fl.id ASC
  LIMIT 1
)
LEFT JOIN user_settings AS us ON us.user_id = fl.user_id
LEFT JOIN fanmark_basic_configs AS bc ON bc.license_id = fl.id
LEFT JOIN fanmark_redirect_configs AS rc ON rc.license_id = fl.id
LEFT JOIN fanmark_messageboard_configs AS mc ON mc.license_id = fl.id
LEFT JOIN fanmark_password_configs AS pc ON pc.license_id = fl.id
WHERE ff.user_id = ?
ORDER BY ff.created_at DESC, ff.id ASC
LIMIT ${MAX_FAVORITES + 1}
`;

async function listFavorites(db: D1Database, userId: string): Promise<Record<string, unknown>[]> {
  let result: D1Result<FavoriteRow>;
  try {
    result = await db.prepare(LIST_SQL).bind(userId).all<FavoriteRow>();
  } catch {
    throw new FavoritesApiError("favorites_unavailable");
  }
  if (result.success !== true || !Array.isArray(result.results) || result.results.length > MAX_FAVORITES) {
    throw new FavoritesApiError("favorites_unavailable");
  }
  return result.results.map(mapFavorite);
}

async function mutateFavorite(db: D1Database, userId: string, rawIds: string[], normalizedIds: string[], displayFanmark: string | null, add: boolean): Promise<boolean> {
  const rawJson = JSON.stringify(rawIds);
  const normalizedJson = JSON.stringify(normalizedIds);
  const now = new Date().toISOString();
  try {
    if (add) {
      const results = await db.batch([
        db.prepare(`INSERT INTO fanmark_discoveries
          (id, emoji_ids, normalized_emoji_ids, availability_status, first_seen_at, last_seen_at, search_count, favorite_count)
          VALUES (?, ?, ?, 'unknown', ?, ?, 0, 0)
          ON CONFLICT(normalized_emoji_ids) DO UPDATE SET
            emoji_ids = excluded.emoji_ids,
            last_seen_at = excluded.last_seen_at`)
          .bind(crypto.randomUUID(), rawJson, normalizedJson, now, now),
        db.prepare(`INSERT INTO fanmark_favorites
          (id, user_id, discovery_id, fanmark_id, normalized_emoji_ids, created_at, display_fanmark)
          SELECT ?, ?, d.id, d.fanmark_id, ?, ?, ?
          FROM fanmark_discoveries AS d
          WHERE d.normalized_emoji_ids = ?
          ON CONFLICT(user_id, normalized_emoji_ids) DO NOTHING`)
          .bind(crypto.randomUUID(), userId, normalizedJson, now, displayFanmark, normalizedJson),
        db.prepare(`INSERT INTO fanmark_events
          (event_type, user_id, discovery_id, normalized_emoji_ids, created_at)
          SELECT 'favorite_add', ?, d.id, ?, ?
          FROM fanmark_discoveries AS d
          WHERE d.normalized_emoji_ids = ? AND changes() = 1`)
          .bind(userId, normalizedJson, now, normalizedJson),
        db.prepare(`UPDATE fanmark_discoveries
          SET favorite_count = favorite_count + 1
          WHERE normalized_emoji_ids = ? AND changes() = 1`)
          .bind(normalizedJson),
      ]);
      return Number(results[1]?.meta?.changes) === 1;
    }

    const results = await db.batch([
      db.prepare("DELETE FROM fanmark_favorites WHERE user_id = ? AND normalized_emoji_ids = ?")
        .bind(userId, normalizedJson),
      db.prepare(`UPDATE fanmark_discoveries
        SET favorite_count = MAX(favorite_count - 1, 0)
        WHERE normalized_emoji_ids = ? AND changes() = 1`)
        .bind(normalizedJson),
      db.prepare(`INSERT INTO fanmark_events
        (event_type, user_id, discovery_id, normalized_emoji_ids, created_at)
        SELECT 'favorite_remove', ?, d.id, ?, ?
        FROM fanmark_discoveries AS d
        WHERE d.normalized_emoji_ids = ? AND changes() = 1`)
        .bind(userId, normalizedJson, now, normalizedJson),
    ]);
    return Number(results[0]?.meta?.changes) === 1;
  } catch {
    throw new FavoritesApiError("favorites_unavailable");
  }
}

export function isFavoritesPath(pathname: string): boolean {
  return pathname === FAVORITES_PATH;
}

export async function handleFavoritesRequest(request: Request, env: Env, resolveAuth: StorageAuthResolver): Promise<Response> {
  const headers = originHeaders(request, env);
  if (!headers) return json({ error: "forbidden_origin" }, 403);
  if (request.method === "OPTIONS") {
    const requestedMethod = request.headers.get("access-control-request-method")?.toUpperCase();
    if (requestedMethod && !["GET", "POST", "DELETE"].includes(requestedMethod)) {
      headers.set("allow", FAVORITES_METHODS);
      return json({ error: "method_not_allowed" }, 405, headers);
    }
    headers.set("allow", FAVORITES_METHODS);
    return new Response(null, { status: 204, headers });
  }
  if (!["GET", "POST", "DELETE"].includes(request.method)) {
    headers.set("allow", FAVORITES_METHODS);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  if (new URL(request.url).search) return json({ error: "invalid_request" }, 400, headers);

  let db: D1Database;
  try {
    db = database(env);
  } catch (error) {
    const failure = error instanceof FavoritesApiError ? error : new FavoritesApiError("favorites_unavailable");
    return json({ error: failure.code }, failure.status, headers);
  }
  if (request.method !== "GET" && !request.headers.get("Origin")) {
    return json({ error: "origin_required" }, 403, headers);
  }
  const auth = await resolveAuth(request, env);
  if (!auth.available) return json({ error: "auth_unavailable" }, 503, headers);
  if (!auth.userId) return json({ error: "unauthorized" }, 401, headers);

  try {
    if (request.method === "GET") {
      return json({ schemaVersion: 1, items: await listFavorites(db, auth.userId) }, 200, headers);
    }
    const value = await readJson(request);
    if (!isRecord(value)) throw new FavoritesApiError("invalid_request", 400);
    let rawIds: string[];
    let displayFanmark: string | null = null;
    const add = request.method === "POST";
    if (add) {
      if (!exactKeys(value, ["input_emoji_ids", "input_display_fanmark"]) ||
          typeof value.input_display_fanmark !== "string" || value.input_display_fanmark.length > 512) {
        throw new FavoritesApiError("invalid_request", 400);
      }
      rawIds = parseEmojiIds(value.input_emoji_ids);
      displayFanmark = value.input_display_fanmark;
    } else {
      if (!exactKeys(value, ["input_emoji_ids"])) throw new FavoritesApiError("invalid_request", 400);
      rawIds = parseEmojiIds(value.input_emoji_ids);
    }
    const normalizedIds = await normalizeEmojiIds(masterDatabase(env), rawIds);
    const changed = await mutateFavorite(db, auth.userId, rawIds, normalizedIds, displayFanmark, add);
    return json(add ? { added: changed } : { removed: changed }, 200, headers);
  } catch (error) {
    const failure = error instanceof FavoritesApiError ? error : new FavoritesApiError("favorites_unavailable");
    return json({ error: failure.code }, failure.status, headers);
  }
}
