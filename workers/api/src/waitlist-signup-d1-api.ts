import { selectD1Database, type Env } from "./repository";

const API_PATH = "/api/waitlist";
const MAX_BODY_BYTES = 2 * 1024;
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/u;

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function cors(request: Request, env: Env, headers: Headers): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  if (!allowed.has(origin)) return false;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("vary", "Origin");
  return true;
}

function configuration(env: Env): D1Database | null {
  if (env.WAITLIST_SIGNUP_BACKEND?.trim() !== "d1" || env.D1_TOPOLOGY?.trim() !== "split" || !env.WAITLIST_SIGNUP_LIMITER) {
    return null;
  }
  return selectD1Database(env, "business") ?? null;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function limiterKey(request: Request): Promise<string> {
  // Keep the client address out of logs and D1; the hash is used only by the
  // short-lived Cloudflare Rate Limiting binding.
  const address = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address)));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `waitlist-signup:v1:${hex}`;
}

export function isWaitlistSignupPath(pathname: string): boolean {
  return pathname === API_PATH;
}

export async function handleWaitlistSignupRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isWaitlistSignupPath(url.pathname)) return null;

  const headers = new Headers();
  if (!cors(request, env, headers)) return json({ error: "forbidden_origin" }, 403, headers);
  if (url.search || url.hash) return json({ error: "not_found" }, 404, headers);

  const method = request.method.toUpperCase();
  if (method === "OPTIONS") {
    headers.set("allow", "POST, OPTIONS");
    return new Response(null, { status: 204, headers });
  }
  if (method !== "POST") {
    headers.set("allow", "POST, OPTIONS");
    return json({ error: "method_not_allowed" }, 405, headers);
  }

  const database = configuration(env);
  if (!database) return json({ error: "waitlist_signup_unavailable" }, 503, headers);

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return json({ error: "unsupported_media_type" }, 415, headers);
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
    return json({ error: "invalid_request" }, 400, headers);
  }

  try {
    const result = await env.WAITLIST_SIGNUP_LIMITER!.limit({ key: await limiterKey(request) });
    if (!result.success) return json({ error: "rate_limited" }, 429, headers);
  } catch {
    return json({ error: "waitlist_signup_unavailable" }, 503, headers);
  }

  const body = await readJsonObject(request);
  if (!body || Object.keys(body).some((key) => key !== "email" && key !== "referral_source")) {
    return json({ error: "invalid_request" }, 400, headers);
  }
  if (typeof body.email !== "string") return json({ error: "invalid_request" }, 400, headers);
  const email = body.email.trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !EMAIL.test(email)) return json({ error: "invalid_request" }, 400, headers);

  let referralSource = "landing_page";
  if (body.referral_source !== undefined) {
    if (typeof body.referral_source !== "string" || body.referral_source.length > 500) {
      return json({ error: "invalid_request" }, 400, headers);
    }
    referralSource = body.referral_source.trim() || "landing_page";
    if (referralSource.length > 500) return json({ error: "invalid_request" }, 400, headers);
  }

  try {
    const result = await database.prepare(`
      INSERT INTO waitlist (id, email, referral_source, status, created_at)
      VALUES (?, ?, ?, 'waiting', ?)
      ON CONFLICT(email) DO NOTHING
    `).bind(crypto.randomUUID(), email, referralSource, new Date().toISOString()).run();
    if (!result.success || ![0, 1].includes(Number(result.meta?.changes))) {
      return json({ error: "waitlist_signup_unavailable" }, 503, headers);
    }
    // A duplicate address is indistinguishable from a new submission.
    return json({ schemaVersion: 1, accepted: true }, 202, headers);
  } catch {
    return json({ error: "waitlist_signup_unavailable" }, 503, headers);
  }
}
