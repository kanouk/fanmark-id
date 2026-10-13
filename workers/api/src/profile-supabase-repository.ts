import { configuredSupabaseUrl, type Env } from "./repository";
import { mapProfile, parseProfilePatch, ProfileApiError, readProfileJson, type ProfileRow } from "./profile-d1-repository";
import { legacyJwtPart, legacySupabaseJson, LegacySupabaseError, verifyLegacySupabaseUser } from "./legacy-supabase-auth";

const METHODS = "GET, PATCH, OPTIONS";
const COLUMNS = "id,user_id,username,display_name,avatar_url,plan_type,preferred_language,created_at,updated_at,requires_password_setup";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function json(body: unknown, status: number, headers: Headers): Response {
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function serviceKey(env: Env): string {
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (key && !/\s/u.test(key) && key.length <= 8192 &&
      (/^sb_secret_[A-Za-z0-9_-]+$/u.test(key) ||
       (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(key) &&
        legacyJwtPart(key.split(".")[1])?.role === "service_role"))) return key;
  throw new LegacySupabaseError("server_misconfigured", 500);
}

function oneProfile(value: unknown, userId: string, env: Env): { row: ProfileRow; profile: Record<string, unknown> } {
  if (!Array.isArray(value) || value.length > 1) throw new LegacySupabaseError("profile_unavailable");
  if (!value.length) throw new LegacySupabaseError("profile_not_found", 404);
  const row = value[0] as ProfileRow;
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new LegacySupabaseError("profile_unavailable");
  if (typeof row.id !== "string" || !UUID.test(row.id)) throw new LegacySupabaseError("profile_unavailable");
  return { row, profile: mapProfile(row, userId, env) };
}

function assertSourceAvatar(value: string, current: unknown, userId: string, base: URL): void {
  if (value === current) return;
  let avatar: URL;
  try { avatar = new URL(value); }
  catch { throw new ProfileApiError("invalid_avatar_url", 400); }
  const prefix = `/storage/v1/object/public/avatars/${userId}/`;
  const name = avatar.pathname.startsWith(prefix) ? avatar.pathname.slice(prefix.length) : "";
  // Match the current Supabase uploader's timestamp filenames as well as UUIDs.
  if (avatar.origin !== base.origin || avatar.username || avatar.password || avatar.search || avatar.hash ||
      !/^(?:\d{10,16}|[0-9a-f-]{36})\.(?:avif|gif|jpe?g|png|webp)$/iu.test(name)) {
    throw new ProfileApiError("invalid_avatar_url", 400);
  }
}

export async function handleSupabaseProfileRequest(request: Request, env: Env, outboundFetch: typeof fetch): Promise<Response> {
  const headers = new Headers({ "cache-control": "no-store" });
  const origin = request.headers.get("origin");
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean));
  if (origin && !allowed.has(origin)) return json({ error: "forbidden_origin" }, 403, headers);
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", METHODS);
    headers.set("access-control-allow-headers", "authorization, content-type");
    headers.set("vary", "Origin");
  }
  const url = new URL(request.url);
  if (url.search || url.hash) return json({ error: "invalid_request" }, 400, headers);
  if (request.method === "OPTIONS") {
    headers.set("allow", METHODS);
    const method = request.headers.get("access-control-request-method")?.toUpperCase();
    if (method && !METHODS.split(", ").includes(method)) return json({ error: "method_not_allowed" }, 405, headers);
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET" && request.method !== "PATCH") {
    headers.set("allow", METHODS);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  try {
    if (env.PROFILE_BACKEND?.trim() !== "supabase" || env.AUTH_BACKEND?.trim() !== "supabase" || env.STORAGE_BACKEND?.trim() === "r2") {
      throw new LegacySupabaseError("server_misconfigured", 500);
    }
    let base: URL;
    try { base = configuredSupabaseUrl(env); }
    catch { throw new LegacySupabaseError("server_misconfigured", 500); }
    const key = serviceKey(env);
    const patch = request.method === "PATCH" ? parseProfilePatch(await readProfileJson(request)) : undefined;
    const { userId } = await verifyLegacySupabaseUser(request, env, outboundFetch);
    // All elevated reads/writes derive both filters from authenticated server
    // state; request bodies and user_metadata never select a user or privilege.
    const endpoint = new URL("/rest/v1/user_settings", base);
    endpoint.searchParams.set("select", COLUMNS);
    endpoint.searchParams.set("user_id", `eq.${userId}`);
    endpoint.searchParams.set("limit", "2");
    const upstreamHeaders = { accept: "application/json", apikey: key, authorization: `Bearer ${key}` };
    const current = oneProfile(await legacySupabaseJson(endpoint, env, { method: "GET", headers: upstreamHeaders }, outboundFetch), userId, env);
    if (!patch) return json({ schemaVersion: 1, profile: current.profile }, 200, headers);
    if (typeof patch.avatar_url === "string") assertSourceAvatar(patch.avatar_url, current.row.avatar_url, userId, base);
    // Pin the profile identity too. A concurrent removal/replacement must not
    // turn an authorized update into a write to a newly selected row.
    endpoint.searchParams.set("id", `eq.${current.profile.id}`);
    const updated = await legacySupabaseJson(endpoint, env, {
      method: "PATCH", headers: { ...upstreamHeaders, "content-type": "application/json", prefer: "return=representation" },
      body: JSON.stringify(patch),
    }, outboundFetch);
    const result = oneProfile(updated, userId, env);
    if (result.profile.id !== current.profile.id) throw new LegacySupabaseError("profile_unavailable");
    return json({ schemaVersion: 1, profile: result.profile }, 200, headers);
  } catch (error) {
    if (error instanceof LegacySupabaseError || error instanceof ProfileApiError) return json({ error: error.code }, error.status, headers);
    return json({ error: "profile_unavailable" }, 503, headers);
  }
}
