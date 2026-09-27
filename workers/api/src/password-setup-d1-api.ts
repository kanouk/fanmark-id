import { selectD1Database, type Env } from "./repository.ts";

const PASSWORD_SETUP_PATH = "/api/me/password-setup";
const METHODS = "POST, OPTIONS";
const MAX_JSON_BYTES = 2 * 1024;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

export interface PasswordSetupAuth {
  resolveUser(request: Request): Promise<string | null>;
  setPassword(request: Request, newPassword: string): Promise<void>;
  verifyPassword(request: Request, password: string): Promise<boolean>;
}

export class PasswordSetupApiError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "PasswordSetupApiError";
  }
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function originHeaders(request: Request, env: Env): Headers | null {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (!origin) return headers;

  const allowed = new Set<string>();
  for (const value of [env.BETTER_AUTH_URL, ...(env.CORS_ALLOWED_ORIGINS ?? "").split(",")]) {
    if (!value?.trim()) continue;
    try {
      const parsed = new URL(value.trim());
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password) allowed.add(parsed.origin);
    } catch {
      return null;
    }
  }
  if (!allowed.has(origin)) return null;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", METHODS);
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return headers;
}

async function readNewPassword(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new PasswordSetupApiError("json_content_type_required", 415);
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_JSON_BYTES)) {
    throw new PasswordSetupApiError("request_too_large", 413);
  }

  const reader = request.body?.getReader();
  if (!reader) throw new PasswordSetupApiError("invalid_request", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) {
        void reader.cancel();
        throw new PasswordSetupApiError("request_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new PasswordSetupApiError("invalid_request", 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PasswordSetupApiError("invalid_request", 400);
  }
  const body = payload as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || !Object.hasOwn(body, "newPassword") || typeof body.newPassword !== "string") {
    throw new PasswordSetupApiError("invalid_request", 400);
  }
  const password = body.newPassword;
  const meetsProductPolicy = /[a-z]/u.test(password) &&
    /[A-Z]/u.test(password) &&
    /\d/u.test(password) &&
    /[!@#$%^&*(),.?":{}|<>_+=';/~\[\]\\`-]/u.test(password);
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH || !meetsProductPolicy) {
    throw new PasswordSetupApiError("invalid_password_length", 400);
  }
  return password;
}

async function readSetupFlag(database: D1Database, userId: string): Promise<boolean> {
  const result = await database.prepare(
    "SELECT requires_password_setup FROM user_settings WHERE user_id = ? LIMIT 2",
  ).bind(userId).all<{ requires_password_setup: unknown }>();
  if (!result.success || !Array.isArray(result.results)) throw new PasswordSetupApiError("password_setup_unavailable");
  if (result.results.length === 0) throw new PasswordSetupApiError("profile_not_found", 404);
  if (result.results.length !== 1) throw new PasswordSetupApiError("password_setup_unavailable");
  const value = result.results[0]?.requires_password_setup;
  if (value === 1 || value === true) return true;
  if (value === 0 || value === false) return false;
  throw new PasswordSetupApiError("password_setup_unavailable");
}

async function credentialHasPassword(authDatabase: D1Database, userId: string): Promise<boolean> {
  const result = await authDatabase.prepare(
    'SELECT password FROM "account" WHERE "userId" = ? AND "providerId" = ? LIMIT 2',
  ).bind(userId, "credential").all<{ password: unknown }>();
  if (!result.success || !Array.isArray(result.results) || result.results.length > 1) {
    throw new PasswordSetupApiError("auth_unavailable");
  }
  if (!result.results.length) return false;
  const password = result.results[0]?.password;
  if (password === null || password === undefined || password === "") return false;
  if (typeof password !== "string") throw new PasswordSetupApiError("auth_unavailable");
  return true;
}

async function clearSetupFlag(database: D1Database, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await database.prepare(
    "UPDATE user_settings SET requires_password_setup = 0, updated_at = ? WHERE user_id = ? AND requires_password_setup = 1",
  ).bind(now, userId).run();
  if (!await readSetupFlag(database, userId)) return;
  throw new PasswordSetupApiError("password_setup_unavailable");
}

export function isPasswordSetupPath(pathname: string): boolean {
  return pathname === PASSWORD_SETUP_PATH;
}

export async function handlePasswordSetupRequest(
  request: Request,
  env: Env,
  auth: PasswordSetupAuth,
): Promise<Response> {
  const headers = originHeaders(request, env);
  if (!headers) return json({ error: "forbidden_origin" }, 403);
  const url = new URL(request.url);
  if (url.search || url.hash) return json({ error: "invalid_request" }, 400, headers);

  if (request.method === "OPTIONS") {
    headers.set("allow", METHODS);
    const requestedMethod = request.headers.get("access-control-request-method")?.toUpperCase();
    if (requestedMethod && requestedMethod !== "POST") return json({ error: "method_not_allowed" }, 405, headers);
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") {
    headers.set("allow", METHODS);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  if (env.AUTH_BACKEND?.trim() !== "better-auth" || env.PROFILE_BACKEND?.trim() !== "d1") {
    return json({ error: "password_setup_unavailable" }, 503, headers);
  }

  const business = selectD1Database(env, "business");
  const authDatabase = selectD1Database(env, "auth");
  if (!business || !authDatabase) return json({ error: "password_setup_unavailable" }, 503, headers);

  let userId: string | null;
  try {
    userId = await auth.resolveUser(request);
  } catch {
    return json({ error: "auth_unavailable" }, 503, headers);
  }
  if (!userId) return json({ error: "unauthorized" }, 401, headers);

  try {
    if (!await readSetupFlag(business, userId)) return json({ error: "password_setup_not_required" }, 409, headers);
    const newPassword = await readNewPassword(request);
    const alreadyHasPassword = await credentialHasPassword(authDatabase, userId);

    if (alreadyHasPassword) {
      if (!await auth.verifyPassword(request, newPassword)) {
        return json({ error: "password_already_set" }, 409, headers);
      }
    } else {
      try {
        await auth.setPassword(request, newPassword);
      } catch {
        // Auth D1 and business D1 cannot share a transaction. If the Auth write
        // committed but the business flag update failed, a retry proves the
        // exact credential before completing the profile update.
        const passwordWasSet = await credentialHasPassword(authDatabase, userId);
        if (!passwordWasSet || !await auth.verifyPassword(request, newPassword)) {
          return json({ error: "password_setup_failed" }, 503, headers);
        }
      }
    }

    await clearSetupFlag(business, userId);
    return json({ schemaVersion: 1, status: true }, 200, headers);
  } catch (error) {
    if (error instanceof PasswordSetupApiError) return json({ error: error.code }, error.status, headers);
    return json({ error: "password_setup_unavailable" }, 503, headers);
  }
}
