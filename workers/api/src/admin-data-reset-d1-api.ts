import { selectD1Database, type Env } from "./repository.ts";
import { toUtcMicrosecondTimestamp } from "./utc-timestamp.ts";

const PATH = "/api/admin/data-reset";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const RESET_TABLES = [
  "fanmark_basic_configs", "fanmark_redirect_configs", "fanmark_messageboard_configs",
  "fanmark_password_configs", "fanmark_profiles", "fanmark_favorites", "fanmark_licenses", "fanmarks",
] as const;
type Authorizer = (request: Request, headers: Headers) => Promise<{ userId: string; sessionId: string } | Response>;

function json(body: unknown, status: number, headers: Headers): Response {
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers });
}

async function readBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

export function isAdminDataResetPath(pathname: string): boolean {
  return pathname === PATH || pathname.startsWith(`${PATH}/`);
}

// Called only by the server's role gate after it has resolved a valid Auth session.
// Earlier anonymous/origin failures and missing MFA do not invent a source actor.
export async function recordUnauthorizedDataResetAttempt(env: Env, userId: string, clock = () => new Date()): Promise<void> {
  if (env.ADMIN_DATA_RESET_BACKEND?.trim() !== "d1") return;
  const db = env.D1_TOPOLOGY?.trim() === "split" ? selectD1Database(env, "business") : undefined;
  if (!db) throw new Error("data_reset_unavailable");
  const now = toUtcMicrosecondTimestamp(clock());
  const result = await db.prepare(`INSERT INTO audit_logs (id, user_id, action, resource_type, metadata, created_at)
    VALUES (?, ?, 'UNAUTHORIZED_DATA_RESET_ATTEMPT', 'system', ?, ?)`)
    .bind(crypto.randomUUID(), userId, JSON.stringify({ timestamp: now, security_level: "CRITICAL_RISK" }), now).run();
  if (!result.success || result.meta?.changes !== 1) throw new Error("data_reset_unavailable");
}

export async function handleAdminDataResetRequest(
  request: Request, env: Env, authorize: Authorizer, clock = () => new Date(),
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isAdminDataResetPath(url.pathname)) return null;
  const headers = new Headers();
  const origin = request.headers.get("origin");
  // A cookie-authorized destructive POST always requires an explicit allowed origin.
  const allowed = (env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return json({ error: "forbidden_origin" }, 403, headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-allow-methods", "POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("vary", "Origin");
  if (url.pathname !== PATH) return json({ error: "not_found" }, 404, headers);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, headers);
  if (env.AUTH_BACKEND?.trim() !== "better-auth") return json({ error: "auth_unavailable" }, 503, headers);
  const identity = await authorize(request, headers);
  if (identity instanceof Response) return identity;
  if (env.ADMIN_DATA_RESET_BACKEND?.trim() !== "d1") return json({ error: "data_reset_unavailable" }, 503, headers);
  if (env.D1_TOPOLOGY?.trim() !== "split") return json({ error: "data_reset_unavailable" }, 500, headers);
  const db = selectD1Database(env, "business");
  if (!db) return json({ error: "data_reset_unavailable" }, 500, headers);
  let body: unknown;
  try { body = await readBody(request); } catch { body = null; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_request" }, 400, headers);
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).length !== 2 || fields.confirmation !== "DELETE" ||
    typeof fields.requestId !== "string" || !UUID.test(fields.requestId)) {
    return json({ error: "invalid_request" }, 400, headers);
  }
  const requestId = fields.requestId.toLowerCase();
  try {
    // The native INSERT trigger counts, deletes, verifies and audits in one
    // transaction. A replay never runs the trigger or deletes newly created rows.
    await db.prepare(`INSERT INTO admin_data_reset_commands (request_id, actor_user_id, audit_id, created_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(request_id) DO NOTHING`)
      .bind(requestId, identity.userId, crypto.randomUUID(), toUtcMicrosecondTimestamp(clock())).run();
    const receipt = await db.prepare("SELECT actor_user_id, result_json FROM admin_data_reset_commands WHERE request_id = ?")
      .bind(requestId).first<{ actor_user_id: string; result_json: string | null }>();
    if (!receipt) return json({ error: "data_reset_unavailable" }, 503, headers);
    if (receipt.actor_user_id !== identity.userId) return json({ error: "request_id_conflict" }, 409, headers);
    const result = receipt.result_json ? JSON.parse(receipt.result_json) as Record<string, unknown> : null;
    const counts = result?.deletedCounts as Record<string, unknown> | undefined;
    if (result?.success !== true || Object.keys(result).length !== 3 || !counts || Object.keys(counts).length !== RESET_TABLES.length ||
      RESET_TABLES.some((table) => !Number.isSafeInteger(counts[table]) || Number(counts[table]) < 0) ||
      !Number.isSafeInteger(result.totalDeleted) ||
      result.totalDeleted !== RESET_TABLES.reduce((sum, table) => sum + Number(counts[table]), 0)) {
      return json({ error: "data_reset_unavailable" }, 503, headers);
    }
    return json(result, 200, headers);
  } catch (error) {
    // Existing non-cascading coupon/lifecycle histories are preserved, rather
    // than silently discarding them or returning success after partial deletion.
    if (error instanceof Error && /FOREIGN KEY constraint failed/iu.test(error.message)) {
      return json({ error: "data_reset_blocked_by_history" }, 409, headers);
    }
    return json({ error: "data_reset_unavailable" }, 503, headers);
  }
}
