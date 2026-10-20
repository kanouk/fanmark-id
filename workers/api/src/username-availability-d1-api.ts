import { selectD1Database, type Env } from "./repository.ts";
import type { StorageAuthResolver } from "./storage-r2.ts";

const USERNAME_AVAILABILITY_PATH = "/api/me/username-availability";
const METHODS = "GET, OPTIONS";
const MAX_USERNAME_BYTES = 256;

export class UsernameAvailabilityD1ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 503) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "UsernameAvailabilityD1ApiError";
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
  headers.set("access-control-allow-methods", METHODS);
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return headers;
}

function database(env: Env): D1Database {
  if (env.PROFILE_BACKEND?.trim() !== "d1" || env.AUTH_BACKEND?.trim() !== "better-auth") {
    throw new UsernameAvailabilityD1ApiError("username_availability_unavailable");
  }
  const selected = selectD1Database(env, "business");
  if (!selected) throw new UsernameAvailabilityD1ApiError("server_misconfigured", 500);
  return selected;
}

async function isAvailable(db: D1Database, username: string, userId: string): Promise<boolean> {
  let row: { taken?: unknown } | null;
  try {
    row = await db.prepare(`
      SELECT EXISTS(
        SELECT 1 FROM user_settings
        WHERE username = ? AND user_id <> ?
      ) AS taken
    `).bind(username.toLowerCase(), userId).first<{ taken?: unknown }>();
  } catch {
    throw new UsernameAvailabilityD1ApiError("username_availability_unavailable");
  }
  if (!row || (row.taken !== 0 && row.taken !== 1 && row.taken !== false && row.taken !== true)) {
    throw new UsernameAvailabilityD1ApiError("username_availability_unavailable");
  }
  return row.taken === 0 || row.taken === false;
}

export function isUsernameAvailabilityPath(pathname: string): boolean {
  return pathname === USERNAME_AVAILABILITY_PATH;
}

export async function handleUsernameAvailabilityRequest(
  request: Request,
  env: Env,
  resolveAuth: StorageAuthResolver,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isUsernameAvailabilityPath(url.pathname)) return null;
  const headers = originHeaders(request, env);
  if (!headers) return json({ error: "forbidden_origin" }, 403);
  if (request.method === "OPTIONS") {
    headers.set("allow", METHODS);
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET") {
    headers.set("allow", METHODS);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  if ([...url.searchParams.keys()].some((key) => key !== "username") || url.searchParams.getAll("username").length !== 1) {
    return json({ error: "invalid_request" }, 400, headers);
  }
  const username = url.searchParams.get("username") ?? "";
  if (new TextEncoder().encode(username).byteLength > MAX_USERNAME_BYTES) {
    return json({ error: "invalid_request" }, 400, headers);
  }

  let db: D1Database;
  try {
    db = database(env);
  } catch (error) {
    const failure = error instanceof UsernameAvailabilityD1ApiError
      ? error
      : new UsernameAvailabilityD1ApiError("username_availability_unavailable");
    return json({ error: failure.code }, failure.status, headers);
  }
  const auth = await resolveAuth(request, env);
  if (!auth.available) return json({ error: "auth_unavailable" }, 503, headers);
  if (!auth.userId) return json({ error: "unauthorized" }, 401, headers);
  if (!username) return json({ schemaVersion: 1, available: false }, 200, headers);

  try {
    return json({ schemaVersion: 1, available: await isAvailable(db, username, auth.userId) }, 200, headers);
  } catch (error) {
    const failure = error instanceof UsernameAvailabilityD1ApiError
      ? error
      : new UsernameAvailabilityD1ApiError("username_availability_unavailable");
    return json({ error: failure.code }, failure.status, headers);
  }
}
