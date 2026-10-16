import { configuredSupabaseKey, configuredSupabaseTimeout, configuredSupabaseUrl, type Env } from "./repository";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_RESPONSE_BYTES = 64 * 1024;

export class LegacySupabaseError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function legacyJwtPart(value: string): Record<string, unknown> | null {
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
    const text = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const result: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(text, character => character.charCodeAt(0)),
    ));
    return record(result) ? result : null;
  } catch { return null; }
}

// Shared bounded transport: credentials never follow redirects; timeout covers
// the body as well as headers. Caller-visible errors never include upstream data.
export async function legacySupabaseJson(
  url: URL, env: Env, init: RequestInit, outboundFetch: typeof fetch,
  authRequest = false,
): Promise<unknown> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  try { timeout = setTimeout(() => controller.abort(), configuredSupabaseTimeout(env)); }
  catch { throw new LegacySupabaseError("server_misconfigured", 500); }
  let response: Response | undefined;
  try {
    response = await outboundFetch(url.href, { ...init, redirect: "manual", signal: controller.signal });
    if (authRequest && (response.status === 401 || response.status === 403)) {
      throw new LegacySupabaseError("unauthorized", 401);
    }
    if (!response.ok || response.status >= 300 ||
        response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      throw new LegacySupabaseError("supabase_unavailable");
    }
    const declared = response.headers.get("content-length");
    if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
      throw new LegacySupabaseError("supabase_unavailable");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new LegacySupabaseError("supabase_unavailable");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new LegacySupabaseError("supabase_unavailable");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (controller.signal.aborted) throw new LegacySupabaseError("supabase_unavailable");
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof LegacySupabaseError) throw error;
    throw new LegacySupabaseError("supabase_unavailable");
  } finally {
    clearTimeout(timeout);
    try { await response?.body?.cancel(); } catch { /* Already consumed/locked. */ }
  }
}

export async function verifyLegacySupabaseUser(
  request: Request, env: Env, outboundFetch: typeof fetch = fetch, now = Date.now(),
): Promise<{ userId: string }> {
  let base: URL, key: string;
  try {
    if (env.AUTH_BACKEND?.trim() !== "supabase") throw new Error();
    base = configuredSupabaseUrl({ ...env, SUPABASE_URL: env.SUPABASE_AUTH_URL ?? env.SUPABASE_URL });
    key = configuredSupabaseKey(env);
  } catch { throw new LegacySupabaseError("server_misconfigured", 500); }
  const bearer = request.headers.get("authorization");
  const match = bearer && bearer.length <= 8192 && /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/iu.exec(bearer);
  if (!match) throw new LegacySupabaseError("unauthorized", 401);
  const token = match[1];
  const parts = token.split(".");
  const header = legacyJwtPart(parts[0]), claims = legacyJwtPart(parts[1]);
  const seconds = Math.floor(now / 1000);
  // Decoding is only a prefilter. Supabase Auth verifies the actual signature
  // and current user; neither these claims nor user_metadata authorize a call.
  if (!Number.isFinite(now) || !header || !["HS256", "RS256", "ES256"].includes(String(header.alg)) ||
      header.crit !== undefined || !claims || claims.role !== "authenticated" ||
      claims.aud !== "authenticated" || claims.iss !== new URL("/auth/v1", base).href ||
      typeof claims.sub !== "string" || !UUID.test(claims.sub) ||
      !Number.isSafeInteger(claims.exp) || Number(claims.exp) <= seconds ||
      (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || Number(claims.nbf) > seconds))) {
    throw new LegacySupabaseError("unauthorized", 401);
  }
  const user = await legacySupabaseJson(new URL("/auth/v1/user", base), env, {
    method: "GET", headers: { accept: "application/json", apikey: key, authorization: `Bearer ${token}` },
  }, outboundFetch, true);
  if (!record(user) || user.id !== claims.sub || user.role !== "authenticated") {
    throw new LegacySupabaseError("unauthorized", 401);
  }
  if (user.is_anonymous === true || user.deleted_at != null ||
      (user.banned_until != null &&
       (typeof user.banned_until !== "string" || !Number.isFinite(Date.parse(user.banned_until)) || Date.parse(user.banned_until) > now))) {
    throw new LegacySupabaseError("unauthorized", 401);
  }
  return { userId: claims.sub };
}
