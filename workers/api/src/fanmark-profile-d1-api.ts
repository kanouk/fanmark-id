import { selectD1Database, type Env } from "./repository";
import type { StorageAuthResolver } from "./storage-r2";

const PROFILE_PREFIX = "/api/me/fanmarks/";
const PROFILE_SUFFIX = "/profile";
const PROFILE_METHODS = "GET, PATCH, OPTIONS";
const MAX_REQUEST_BYTES = 24 * 1024;
const MAX_PROFILE_JSON_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SOCIAL_KEYS = new Set([
  "instagram", "tiktok", "x", "youtube", "bereal", "line", "threads", "bluesky",
  "github", "discord", "snapchat", "twitch", "facebook", "website",
]);
const THEME_KEYS = new Set([
  "cover_image_url", "cover_image_dimensions", "cover_image_position", "profile_image_url",
  "theme_color", "button_style",
]);

interface ProfileRow extends Record<string, unknown> {
  id: unknown;
  licenseId: unknown;
  displayName: unknown;
  bio: unknown;
  socialLinks: unknown;
  themeSettings: unknown;
  isPublic: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

interface ContextRow extends ProfileRow {
  fanmarkId: unknown;
  userInputFanmark: unknown;
  displayFanmark: unknown;
  emojiIds: unknown;
  shortId: unknown;
  fanmarkName: unknown;
}

type ProfilePatch = Partial<{
  display_name: string;
  bio: string;
  social_links: Record<string, string>;
  theme_settings: Record<string, unknown>;
  is_public: boolean;
}>;

export class FanmarkProfileApiError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "FanmarkProfileApiError";
  }
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const resultHeaders = new Headers(headers);
  resultHeaders.set("cache-control", "no-store");
  resultHeaders.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: resultHeaders });
}

function originHeaders(request: Request, env: Env): Headers | null {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (!origin) return headers;
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  if (!allowed.has(origin)) return null;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", PROFILE_METHODS);
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return headers;
}

function routeFanmarkId(pathname: string): string | null | undefined {
  if (!pathname.startsWith(PROFILE_PREFIX) || !pathname.endsWith(PROFILE_SUFFIX)) return undefined;
  const rawId = pathname.slice(PROFILE_PREFIX.length, -PROFILE_SUFFIX.length);
  return UUID.test(rawId) ? rawId.toLowerCase() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined || value === "") return {};
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new FanmarkProfileApiError("fanmark_profile_unavailable");
    }
  }
  if (!isRecord(parsed)) throw new FanmarkProfileApiError("fanmark_profile_unavailable");
  const serialized = JSON.stringify(parsed);
  if (new TextEncoder().encode(serialized).byteLength > MAX_PROFILE_JSON_BYTES) {
    throw new FanmarkProfileApiError("fanmark_profile_unavailable");
  }
  return parsed;
}

function safeWebUrl(value: string): boolean {
  if (new TextEncoder().encode(value).byteLength > 2_048) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || codePoint === 0x7f) return false;
  }
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && !!url.hostname;
  } catch {
    return false;
  }
}

function parseSocialLinks(value: unknown, input: boolean): Record<string, string> {
  const record = value === null || value === undefined ? {} : value;
  if (!isRecord(record) || Object.keys(record).length > SOCIAL_KEYS.size) {
    throw new FanmarkProfileApiError(input ? "invalid_request" : "fanmark_profile_unavailable", input ? 400 : 503);
  }
  const links: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(record)) {
    if (!SOCIAL_KEYS.has(key) || typeof candidate !== "string" || new TextEncoder().encode(candidate).byteLength > 2_048) {
      throw new FanmarkProfileApiError(input ? "invalid_request" : "fanmark_profile_unavailable", input ? 400 : 503);
    }
    if (candidate === "") continue;
    if (!safeWebUrl(candidate)) {
      throw new FanmarkProfileApiError(input ? "invalid_request" : "fanmark_profile_unavailable", input ? 400 : 503);
    }
    links[key] = candidate;
  }
  if (new TextEncoder().encode(JSON.stringify(links)).byteLength > MAX_PROFILE_JSON_BYTES) {
    throw new FanmarkProfileApiError(input ? "invalid_request" : "fanmark_profile_unavailable", input ? 400 : 503);
  }
  return links;
}

function parseThemeSettings(value: unknown, input: boolean): Record<string, unknown> {
  const record = value === null || value === undefined ? {} : value;
  if (!isRecord(record) || Object.keys(record).some((key) => !THEME_KEYS.has(key))) {
    throw new FanmarkProfileApiError(input ? "invalid_request" : "fanmark_profile_unavailable", input ? 400 : 503);
  }
  const theme: Record<string, unknown> = {};
  for (const [key, candidate] of Object.entries(record)) {
    if (key === "cover_image_url" || key === "profile_image_url") {
      if (typeof candidate !== "string" || (candidate !== "" && !safeWebUrl(candidate))) {
        throw new FanmarkProfileApiError(input ? "invalid_request" : "fanmark_profile_unavailable", input ? 400 : 503);
      }
      theme[key] = candidate;
    } else if (key === "cover_image_dimensions") {
      if (!isRecord(candidate) || Object.keys(candidate).some((field) => field !== "width" && field !== "height")) {
        throw new FanmarkProfileApiError(input ? "invalid_request" : "fanmark_profile_unavailable", input ? 400 : 503);
      }
      const { width, height } = candidate;
      if (typeof width !== "number" || !Number.isInteger(width) || width < 1 || width > 10_000 ||
          typeof height !== "number" || !Number.isInteger(height) || height < 1 || height > 10_000) {
        throw new FanmarkProfileApiError(input ? "invalid_request" : "fanmark_profile_unavailable", input ? 400 : 503);
      }
      theme[key] = { width, height };
    } else if (key === "cover_image_position") {
      if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0 || candidate > 100) {
        throw new FanmarkProfileApiError(input ? "invalid_request" : "fanmark_profile_unavailable", input ? 400 : 503);
      }
      theme[key] = candidate;
    } else if (key === "theme_color") {
      if (typeof candidate !== "string" || !/^#[0-9a-f]{3,8}$/iu.test(candidate)) {
        throw new FanmarkProfileApiError(input ? "invalid_request" : "fanmark_profile_unavailable", input ? 400 : 503);
      }
      theme[key] = candidate;
    } else if (key === "button_style") {
      if (typeof candidate !== "string" || candidate.length > 64) {
        throw new FanmarkProfileApiError(input ? "invalid_request" : "fanmark_profile_unavailable", input ? 400 : 503);
      }
      theme[key] = candidate;
    }
  }
  if (new TextEncoder().encode(JSON.stringify(theme)).byteLength > MAX_PROFILE_JSON_BYTES) {
    throw new FanmarkProfileApiError(input ? "invalid_request" : "fanmark_profile_unavailable", input ? 400 : 503);
  }
  return theme;
}

async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new FanmarkProfileApiError("json_content_type_required", 415);
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) {
    throw new FanmarkProfileApiError("request_too_large", 413);
  }
  if (!request.body) throw new FanmarkProfileApiError("invalid_request", 400);
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
        throw new FanmarkProfileApiError("request_too_large", 413);
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
    throw new FanmarkProfileApiError("invalid_json", 400);
  }
}

function parsePatch(value: unknown): ProfilePatch {
  if (!isRecord(value)) throw new FanmarkProfileApiError("invalid_request", 400);
  const keys = Object.keys(value);
  const allowed = new Set(["display_name", "bio", "social_links", "theme_settings", "is_public"]);
  if (keys.length === 0 || keys.some((key) => !allowed.has(key))) throw new FanmarkProfileApiError("invalid_request", 400);
  const patch: ProfilePatch = {};
  if (Object.hasOwn(value, "display_name")) {
    if (typeof value.display_name !== "string" || value.display_name.length < 1 || value.display_name.length > 50) {
      throw new FanmarkProfileApiError("invalid_request", 400);
    }
    patch.display_name = value.display_name;
  }
  if (Object.hasOwn(value, "bio")) {
    if (typeof value.bio !== "string" || value.bio.length > 500) throw new FanmarkProfileApiError("invalid_request", 400);
    patch.bio = value.bio;
  }
  if (Object.hasOwn(value, "social_links")) patch.social_links = parseSocialLinks(value.social_links, true);
  if (Object.hasOwn(value, "theme_settings")) patch.theme_settings = parseThemeSettings(value.theme_settings, true);
  if (Object.hasOwn(value, "is_public")) {
    if (typeof value.is_public !== "boolean") throw new FanmarkProfileApiError("invalid_request", 400);
    patch.is_public = value.is_public;
  }
  return patch;
}

function assertOwnedR2ProfileImages(patch: ProfilePatch, userId: string, apiOrigin: string): void {
  const theme = patch.theme_settings;
  if (!theme) return;
  for (const [field, bucket] of [
    ["cover_image_url", "cover-images"],
    ["profile_image_url", "avatars"],
  ] as const) {
    const value = theme[field];
    if (typeof value !== "string" || value === "") continue;
    const imageUrl = new URL(value);
    if (imageUrl.origin !== apiOrigin || !imageUrl.pathname.startsWith("/api/storage/")) continue;
    const match = /^\/api\/storage\/public\/(avatars|cover-images)\/([^/]+)\/.+$/u.exec(imageUrl.pathname);
    let pathOwner: string | null = null;
    try {
      pathOwner = match ? decodeURIComponent(match[2]) : null;
    } catch {
      pathOwner = null;
    }
    if (imageUrl.search || imageUrl.hash || !match || match[1] !== bucket ||
        !pathOwner || pathOwner.toLowerCase() !== userId.toLowerCase()) {
      throw new FanmarkProfileApiError("invalid_request", 400);
    }
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new FanmarkProfileApiError("fanmark_profile_unavailable");
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new FanmarkProfileApiError("fanmark_profile_unavailable");
  return value;
}

function bool(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  throw new FanmarkProfileApiError("fanmark_profile_unavailable");
}

function parseEmojiIds(value: unknown): string[] {
  let ids = value;
  if (typeof value === "string") {
    try {
      ids = JSON.parse(value) as unknown;
    } catch {
      throw new FanmarkProfileApiError("fanmark_profile_unavailable");
    }
  }
  if (!Array.isArray(ids) || ids.length > 5 || ids.some((id) => typeof id !== "string")) {
    throw new FanmarkProfileApiError("fanmark_profile_unavailable");
  }
  return ids as string[];
}

function timestampNow(): string {
  return new Date().toISOString().replace(/\.(\d{3})Z$/u, (_match, millis: string) => `.${millis}000Z`);
}

function mapContext(row: ContextRow): Record<string, unknown> {
  const fanmark = {
    id: requiredString(row.fanmarkId),
    user_input_fanmark: requiredString(row.userInputFanmark),
    fanmark: nullableString(row.displayFanmark),
    emoji_ids: parseEmojiIds(row.emojiIds),
    short_id: requiredString(row.shortId),
    fanmark_name: nullableString(row.fanmarkName),
  };
  const licenseId = requiredString(row.licenseId);
  const profile = row.id === null || row.id === undefined ? null : {
    id: requiredString(row.id),
    license_id: licenseId,
    display_name: nullableString(row.displayName),
    bio: nullableString(row.bio),
    social_links: parseSocialLinks(jsonObject(row.socialLinks), false),
    theme_settings: parseThemeSettings(jsonObject(row.themeSettings), false),
    is_public: bool(row.isPublic),
    created_at: requiredString(row.createdAt),
    updated_at: requiredString(row.updatedAt),
  };
  return { licenseId, fanmark, profile };
}

function database(env: Env): D1Database {
  if (env.FANMARK_PROFILE_BACKEND?.trim() !== "d1") throw new FanmarkProfileApiError("fanmark_profile_unavailable", 503);
  if (env.AUTH_BACKEND?.trim() !== "better-auth") throw new FanmarkProfileApiError("server_misconfigured", 500);
  const db = selectD1Database(env, "business");
  if (!db) throw new FanmarkProfileApiError("server_misconfigured", 500);
  return db;
}

async function readContext(db: D1Database, fanmarkId: string, userId: string, now: string): Promise<ContextRow> {
  let result: D1Result<ContextRow>;
  try {
    result = await db.prepare(
      `SELECT f.id AS fanmarkId, f.user_input_fanmark AS userInputFanmark,
              fl.display_fanmark AS displayFanmark, f.emoji_ids AS emojiIds,
              f.short_id AS shortId, b.fanmarkName AS fanmarkName, fl.id AS licenseId,
              p.id AS id, p.display_name AS displayName, p.bio AS bio,
              p.social_links AS socialLinks, p.theme_settings AS themeSettings,
              p.is_public AS isPublic, p.created_at AS createdAt, p.updated_at AS updatedAt
         FROM fanmark_licenses AS fl
         JOIN fanmarks AS f ON f.id = fl.fanmark_id
         LEFT JOIN (
           SELECT license_id, MAX(fanmark_name) AS fanmarkName
             FROM fanmark_basic_configs GROUP BY license_id
         ) AS b ON b.license_id = fl.id
         LEFT JOIN fanmark_profiles AS p ON p.license_id = fl.id
        WHERE f.id = ? AND fl.user_id = ? AND fl.status = 'active'
          AND fl.license_end > ?
        ORDER BY fl.created_at DESC, fl.id ASC
        LIMIT 2`,
    ).bind(fanmarkId, userId, now).all<ContextRow>();
  } catch {
    throw new FanmarkProfileApiError("fanmark_profile_unavailable");
  }
  if (!result || result.success !== true || !Array.isArray(result.results)) {
    throw new FanmarkProfileApiError("fanmark_profile_unavailable");
  }
  if (result.results.length === 0) throw new FanmarkProfileApiError("fanmark_profile_not_found", 404);
  if (result.results.length !== 1) throw new FanmarkProfileApiError("fanmark_profile_unavailable");
  return result.results[0];
}

async function applyPatch(
  db: D1Database,
  fanmarkId: string,
  userId: string,
  now: string,
  patch: ProfilePatch,
): Promise<void> {
  const columns: Array<[keyof ProfilePatch, string, (value: unknown) => unknown]> = [
    ["display_name", "display_name", (value) => value],
    ["bio", "bio", (value) => value],
    ["social_links", "social_links", (value) => JSON.stringify(value)],
    ["theme_settings", "theme_settings", (value) => JSON.stringify(value)],
    ["is_public", "is_public", (value) => value ? 1 : 0],
  ];
  const selected = columns.filter(([key]) => Object.hasOwn(patch, key));
  const assignments = selected.map(([, column]) => `${column} = excluded.${column}`);
  assignments.push("updated_at = excluded.updated_at");
  const insertValues: Record<string, unknown> = {
    display_name: null,
    bio: "",
    social_links: "{}",
    theme_settings: "{}",
    is_public: 0,
  };
  for (const [key, , encode] of columns) {
    if (Object.hasOwn(patch, key)) insertValues[key] = encode(patch[key]);
  }
  try {
    const result = await db.prepare(
      `INSERT INTO fanmark_profiles
         (id, license_id, display_name, bio, social_links, theme_settings, is_public, created_at, updated_at)
       SELECT ?, fl.id, ?, ?, ?, ?, ?, ?, ?
         FROM fanmark_licenses AS fl
        WHERE fl.fanmark_id = ? AND fl.user_id = ? AND fl.status = 'active'
          AND fl.license_end > ?
       ON CONFLICT(license_id) DO UPDATE SET ${assignments.join(", ")}
       WHERE EXISTS (
         SELECT 1 FROM fanmark_licenses AS owned
          WHERE owned.id = fanmark_profiles.license_id AND owned.user_id = ?
       )`,
    ).bind(
      crypto.randomUUID(),
      insertValues.display_name,
      insertValues.bio,
      insertValues.social_links,
      insertValues.theme_settings,
      insertValues.is_public,
      now,
      now,
      fanmarkId,
      userId,
      now,
      userId,
    ).run();
    if (!result || result.success !== true) throw new Error("write failed");
  } catch {
    throw new FanmarkProfileApiError("fanmark_profile_update_failed");
  }
}

export function isFanmarkProfilePath(pathname: string): boolean {
  return pathname.startsWith(PROFILE_PREFIX) && pathname.endsWith(PROFILE_SUFFIX);
}

export async function handleFanmarkProfileRequest(
  request: Request,
  env: Env,
  resolveAuth: StorageAuthResolver,
): Promise<Response> {
  const headers = originHeaders(request, env);
  if (!headers) return json({ error: "forbidden_origin" }, 403);
  const url = new URL(request.url);
  const fanmarkId = routeFanmarkId(url.pathname);
  if (fanmarkId === undefined || fanmarkId === null || url.search || url.hash) {
    return json({ error: "invalid_request" }, 400, headers);
  }
  if (request.method === "OPTIONS") {
    headers.set("allow", PROFILE_METHODS);
    const requested = request.headers.get("access-control-request-method")?.toUpperCase();
    if (requested && !PROFILE_METHODS.split(", ").includes(requested)) {
      return json({ error: "method_not_allowed" }, 405, headers);
    }
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET" && request.method !== "PATCH") {
    headers.set("allow", PROFILE_METHODS);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  let db: D1Database;
  try {
    db = database(env);
  } catch (error) {
    return json({ error: error instanceof FanmarkProfileApiError ? error.code : "server_misconfigured" },
      error instanceof FanmarkProfileApiError ? error.status : 500, headers);
  }
  const auth = await resolveAuth(request, env);
  if (!auth.available) return json({ error: "auth_unavailable" }, 503, headers);
  if (!auth.userId) return json({ error: "unauthorized" }, 401, headers);

  try {
    const now = timestampNow();
    const current = await readContext(db, fanmarkId, auth.userId, now);
    if (request.method === "PATCH") {
      const patch = parsePatch(await readJson(request));
      assertOwnedR2ProfileImages(patch, auth.userId, url.origin);
      await applyPatch(db, fanmarkId, auth.userId, now, patch);
    }
    const row = request.method === "PATCH"
      ? await readContext(db, fanmarkId, auth.userId, timestampNow())
      : current;
    return json({ schemaVersion: 1, ...mapContext(row) }, 200, headers);
  } catch (error) {
    if (error instanceof FanmarkProfileApiError) return json({ error: error.code }, error.status, headers);
    return json({ error: "fanmark_profile_unavailable" }, 503, headers);
  }
}
