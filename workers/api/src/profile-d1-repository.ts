import { selectD1Database, type Env } from "./repository";
import type { StorageAuthResolver } from "./storage-r2";

const PROFILE_PATH = "/api/me/profile";
const PROFILE_METHODS = "GET, PATCH, OPTIONS";
const MAX_PROFILE_JSON_BYTES = 8 * 1024;
const LANGUAGES = new Set(["en", "ja", "ko", "id"]);
const PLANS = new Set(["free", "creator", "max", "business", "enterprise", "admin"]);
const AVATAR_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:avif|gif|jpg|png|webp)$/iu;

interface ProfileRow extends Record<string, unknown> {
  id: unknown;
  user_id: unknown;
  username: unknown;
  display_name: unknown;
  avatar_url: unknown;
  plan_type: unknown;
  preferred_language: unknown;
  created_at: unknown;
  updated_at: unknown;
  requires_password_setup: unknown;
}

interface ProfilePatch {
  display_name?: string | null;
  avatar_url?: string | null;
  preferred_language?: string;
}

export class ProfileApiError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "ProfileApiError";
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
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  if (!allowed.has(origin)) return null;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", PROFILE_METHODS);
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new ProfileApiError("profile_unavailable");
  return value;
}

function nullableText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new ProfileApiError("profile_unavailable");
  return value;
}

function booleanValue(value: unknown): boolean {
  if (value === 1 || value === true) return true;
  if (value === 0 || value === false) return false;
  throw new ProfileApiError("profile_unavailable");
}

function mapProfile(row: ProfileRow, userId: string): Record<string, unknown> {
  const result = {
    id: requiredText(row.id),
    user_id: requiredText(row.user_id),
    username: requiredText(row.username),
    display_name: nullableText(row.display_name),
    avatar_url: nullableText(row.avatar_url),
    plan_type: requiredText(row.plan_type),
    preferred_language: requiredText(row.preferred_language),
    created_at: requiredText(row.created_at),
    updated_at: requiredText(row.updated_at),
    requires_password_setup: booleanValue(row.requires_password_setup),
  };
  if (result.user_id !== userId || !PLANS.has(result.plan_type) || !LANGUAGES.has(result.preferred_language)) {
    throw new ProfileApiError("profile_unavailable");
  }
  return result;
}

function database(env: Env) {
  if (env.PROFILE_BACKEND?.trim() !== "d1") throw new ProfileApiError("profile_unavailable");
  const selected = selectD1Database(env, "business");
  if (!selected || env.AUTH_BACKEND?.trim() !== "better-auth") throw new ProfileApiError("server_misconfigured", 500);
  return selected;
}

async function readProfile(db: D1Database, userId: string): Promise<ProfileRow> {
  let result: D1Result<ProfileRow>;
  try {
    result = await db.prepare(
      `SELECT id, user_id, username, display_name, avatar_url, plan_type,
              preferred_language, created_at, updated_at, requires_password_setup
         FROM user_settings
        WHERE user_id = ?
        LIMIT 2`,
    ).bind(userId).all<ProfileRow>();
  } catch {
    throw new ProfileApiError("profile_unavailable");
  }
  if (!result || result.success !== true || !Array.isArray(result.results)) throw new ProfileApiError("profile_unavailable");
  if (result.results.length === 0) throw new ProfileApiError("profile_not_found", 404);
  if (result.results.length !== 1) throw new ProfileApiError("profile_unavailable");
  return result.results[0];
}

async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new ProfileApiError("json_content_type_required", 415);
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_PROFILE_JSON_BYTES)) {
    throw new ProfileApiError("request_too_large", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ProfileApiError("invalid_request", 400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PROFILE_JSON_BYTES) {
        void reader.cancel();
        throw new ProfileApiError("request_too_large", 413);
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
    throw new ProfileApiError("invalid_json", 400);
  }
}

function parsePatch(value: unknown): ProfilePatch {
  if (!isRecord(value)) throw new ProfileApiError("invalid_request", 400);
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => !["display_name", "avatar_url", "preferred_language"].includes(key))) {
    throw new ProfileApiError("invalid_request", 400);
  }
  const patch: ProfilePatch = {};
  if (Object.hasOwn(value, "display_name")) {
    const name = value.display_name;
    if (name !== null && (typeof name !== "string" || new TextEncoder().encode(name).byteLength > 2048)) {
      throw new ProfileApiError("invalid_request", 400);
    }
    patch.display_name = name as string | null;
  }
  if (Object.hasOwn(value, "preferred_language")) {
    if (typeof value.preferred_language !== "string" || !LANGUAGES.has(value.preferred_language)) {
      throw new ProfileApiError("invalid_request", 400);
    }
    patch.preferred_language = value.preferred_language;
  }
  if (Object.hasOwn(value, "avatar_url")) {
    const avatar = value.avatar_url;
    if (avatar !== null && (typeof avatar !== "string" || avatar.length > 2048)) {
      throw new ProfileApiError("invalid_request", 400);
    }
    patch.avatar_url = avatar as string | null;
  }
  return patch;
}

function assertOwnedR2Avatar(value: string, current: string | null, request: Request, userId: string, env: Env): void {
  if (value === current) return;
  if (env.STORAGE_BACKEND?.trim() !== "r2") throw new ProfileApiError("invalid_avatar_url", 400);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProfileApiError("invalid_avatar_url", 400);
  }
  const expectedPrefix = `/api/storage/public/avatars/${encodeURIComponent(userId)}/`;
  const name = url.pathname.startsWith(expectedPrefix) ? url.pathname.slice(expectedPrefix.length) : "";
  if (
    url.origin !== new URL(request.url).origin || url.username || url.password ||
    !AVATAR_KEY.test(name) || url.search || url.hash
  ) {
    throw new ProfileApiError("invalid_avatar_url", 400);
  }
}

async function applyPatch(db: D1Database, userId: string, patch: ProfilePatch): Promise<void> {
  const columns: Array<[keyof ProfilePatch, string]> = [
    ["display_name", "display_name"],
    ["avatar_url", "avatar_url"],
    ["preferred_language", "preferred_language"],
  ];
  const selected = columns.filter(([key]) => Object.hasOwn(patch, key));
  const assignments = selected.map(([, column]) => `${column} = ?`);
  const values = selected.map(([key]) => patch[key]);
  assignments.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(userId);
  try {
    const result = await db.prepare(
      `UPDATE user_settings SET ${assignments.join(", ")} WHERE user_id = ?`,
    ).bind(...values).run();
    if (!result || result.success !== true) throw new Error("profile update failed");
  } catch {
    throw new ProfileApiError("profile_update_failed");
  }
}

export function isProfilePath(pathname: string): boolean {
  return pathname === PROFILE_PATH;
}

export async function handleProfileRequest(
  request: Request,
  env: Env,
  resolveAuth: StorageAuthResolver,
): Promise<Response> {
  const headers = originHeaders(request, env);
  if (!headers) return json({ error: "forbidden_origin" }, 403);
  const url = new URL(request.url);
  if (url.search || url.hash) return json({ error: "invalid_request" }, 400, headers);

  if (request.method === "OPTIONS") {
    headers.set("allow", PROFILE_METHODS);
    const requested = request.headers.get("access-control-request-method")?.toUpperCase();
    if (requested && !PROFILE_METHODS.split(", ").includes(requested)) return json({ error: "method_not_allowed" }, 405, headers);
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET" && request.method !== "PATCH") {
    headers.set("allow", PROFILE_METHODS);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  if (env.PROFILE_BACKEND?.trim() !== "d1") return json({ error: "profile_unavailable" }, 503, headers);
  let db: D1Database;
  try {
    db = database(env);
  } catch (error) {
    const code = error instanceof ProfileApiError ? error.code : "server_misconfigured";
    const status = error instanceof ProfileApiError ? error.status : 500;
    return json({ error: code }, status, headers);
  }
  if (env.AUTH_BACKEND?.trim() !== "better-auth") return json({ error: "server_misconfigured" }, 500, headers);

  const auth = await resolveAuth(request, env);
  if (!auth.available) return json({ error: "auth_unavailable" }, 503, headers);
  if (!auth.userId) return json({ error: "unauthorized" }, 401, headers);

  try {
    if (request.method === "GET") {
      const row = await readProfile(db, auth.userId);
      return json({ schemaVersion: 1, profile: mapProfile(row, auth.userId) }, 200, headers);
    }
    const patch = parsePatch(await readJson(request));
    const current = await readProfile(db, auth.userId);
    const mapped = mapProfile(current, auth.userId);
    if (typeof patch.avatar_url === "string") {
      assertOwnedR2Avatar(patch.avatar_url, mapped.avatar_url as string | null, request, auth.userId, env);
    }
    await applyPatch(db, auth.userId, patch);
    const updated = await readProfile(db, auth.userId);
    return json({ schemaVersion: 1, profile: mapProfile(updated, auth.userId) }, 200, headers);
  } catch (error) {
    if (error instanceof ProfileApiError) return json({ error: error.code }, error.status, headers);
    return json({ error: "profile_unavailable" }, 503, headers);
  }
}
