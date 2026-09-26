import { selectD1Database, type Env } from "./repository.ts";

const API_PATH = "/api/admin/waitlist";
const MAX_ENTRIES = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const AUDIT_ACTIONS = [
  "ADMIN_CHECK",
  "AUTHORIZED_WAITLIST_ACCESS",
  "UNAUTHORIZED_WAITLIST_ACCESS",
  "EMAIL_ACCESS",
  "UNAUTHORIZED_EMAIL_ACCESS",
] as const;

export interface WaitlistEntryDto {
  id: string;
  email_hash: string;
  referral_source: string | null;
  status: "waiting" | "invited" | "converted";
  created_at: string;
}

export interface WaitlistSecurityLogDto {
  id: string;
  action: string;
  resource_type: "waitlist" | "system";
  created_at: string;
}

export type WaitlistAdminAuthorizer = (
  request: Request,
  responseHeaders: Headers,
) => Promise<{ userId: string; sessionId: string } | Response>;

export class WaitlistAdminApiError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "WaitlistAdminApiError";
  }
}

function fail(code: string, status = 503): never {
  throw new WaitlistAdminApiError(code, status);
}

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
  headers.set("access-control-allow-methods", "GET, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return true;
}

function database(env: Env): D1Database {
  if (env.WAITLIST_ADMIN_BACKEND?.trim() !== "d1" || env.D1_TOPOLOGY?.trim() !== "split") {
    fail("waitlist_admin_unavailable", env.WAITLIST_ADMIN_BACKEND ? 500 : 503);
  }
  const selected = selectD1Database(env, "business");
  if (!selected) fail("waitlist_admin_unavailable", 500);
  return selected;
}

export function isWaitlistAdminPath(pathname: string): boolean {
  return pathname === API_PATH || pathname.startsWith(`${API_PATH}/`);
}

function parseWaitlistRow(value: Record<string, unknown>): Omit<WaitlistEntryDto, "email_hash"> & { email: string } {
  if (typeof value.id !== "string" || !UUID.test(value.id) ||
      typeof value.email !== "string" || value.email.length < 3 || value.email.length > 320 || /\s/u.test(value.email) ||
      !(value.referral_source === null || (typeof value.referral_source === "string" && value.referral_source.length <= 500)) ||
      !(value.status === "waiting" || value.status === "invited" || value.status === "converted") ||
      typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at))) {
    fail("waitlist_admin_unavailable");
  }
  return {
    id: value.id,
    email: value.email,
    referral_source: value.referral_source as string | null,
    status: value.status,
    created_at: value.created_at,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requireAdminPlan(db: D1Database, userId: string, action: string, now: string): Promise<void> {
  const setting = await db.prepare("SELECT plan_type FROM user_settings WHERE user_id = ? LIMIT 1")
    .bind(userId).first<{ plan_type?: unknown }>();
  if (setting?.plan_type === "admin") return;

  const metadata = JSON.stringify({
    timestamp: now,
    session_valid: true,
    admin_check_result: false,
    attempted_action: action,
  });
  const statements = [
    db.prepare(`INSERT INTO audit_logs (id, user_id, action, resource_type, metadata, created_at)
      VALUES (?, ?, 'ADMIN_CHECK', 'system', ?, ?)`)
      .bind(crypto.randomUUID(), userId, metadata, now),
    db.prepare(`INSERT INTO audit_logs (id, user_id, action, resource_type, metadata, created_at)
      VALUES (?, ?, ?, 'waitlist', ?, ?)`)
      .bind(crypto.randomUUID(), userId,
        action === "email" ? "UNAUTHORIZED_EMAIL_ACCESS" : "UNAUTHORIZED_WAITLIST_ACCESS",
        JSON.stringify({ timestamp: now, attempted_action: action, security_level: "HIGH_RISK" }), now),
  ];
  const result = await db.batch(statements);
  if (!result.every((item) => item.success && item.meta?.changes === 1)) fail("waitlist_admin_unavailable");
  fail("super_admin_required", 403);
}

async function writeAuthorizedAudit(
  db: D1Database,
  userId: string,
  action: "list" | "email",
  resourceId: string | null,
  now: string,
  recordCount?: number,
): Promise<void> {
  const metadata = action === "list"
    ? JSON.stringify({ timestamp: now, record_count: recordCount ?? 0, limit: MAX_ENTRIES, offset: 0, security_level: "ADMIN_VERIFIED" })
    : JSON.stringify({ timestamp: now, security_level: "ADMIN_VERIFIED", purpose: "email_retrieval" });
  const actions = action === "list" ? ["ADMIN_CHECK", "AUTHORIZED_WAITLIST_ACCESS"] : ["ADMIN_CHECK", "EMAIL_ACCESS"];
  const results = await db.batch(actions.map((auditAction, index) => db.prepare(`
    INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), userId, auditAction,
    index === 0 ? "system" : "waitlist",
    index === 0 ? null : resourceId,
    index === 0 ? JSON.stringify({ timestamp: now, session_valid: true, admin_check_result: true }) : metadata,
    now,
  )));
  if (!results.every((item) => item.success && item.meta?.changes === 1)) fail("waitlist_admin_unavailable");
}

async function readSecurityLogs(db: D1Database): Promise<WaitlistSecurityLogDto[]> {
  const result = await db.prepare(`SELECT id, action, resource_type, created_at
    FROM audit_logs
    WHERE (resource_type = 'waitlist' OR resource_type = 'system')
      AND action IN (${AUDIT_ACTIONS.map(() => "?").join(", ")})
    ORDER BY created_at DESC, id DESC LIMIT 50`).bind(...AUDIT_ACTIONS).all<Record<string, unknown>>();
  if (!result.success || !Array.isArray(result.results)) fail("waitlist_admin_unavailable");
  return result.results.map((row) => {
    if (typeof row.id !== "string" || typeof row.action !== "string" || row.action.length > 80 ||
        !(row.resource_type === "waitlist" || row.resource_type === "system") ||
        typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) {
      fail("waitlist_admin_unavailable");
    }
    return {
      id: row.id,
      action: row.action,
      resource_type: row.resource_type,
      created_at: row.created_at,
    };
  });
}

async function handleList(db: D1Database, userId: string, now: string, headers: Headers): Promise<Response> {
  await requireAdminPlan(db, userId, "list", now);
  const count = await db.prepare("SELECT COUNT(*) AS count FROM waitlist").first<{ count?: unknown }>();
  const recordCount = Number(count?.count);
  if (!Number.isSafeInteger(recordCount) || recordCount < 0) fail("waitlist_admin_unavailable");
  await writeAuthorizedAudit(db, userId, "list", null, now, recordCount);

  const result = await db.prepare(`SELECT id, email, referral_source, status, created_at
    FROM waitlist ORDER BY created_at DESC, id ASC LIMIT ?`).bind(MAX_ENTRIES).all<Record<string, unknown>>();
  if (!result.success || !Array.isArray(result.results) || result.results.length > MAX_ENTRIES) fail("waitlist_admin_unavailable");
  const entries: WaitlistEntryDto[] = [];
  for (const value of result.results) {
    const row = parseWaitlistRow(value);
    entries.push({
      id: row.id,
      email_hash: await sha256Hex(row.email),
      referral_source: row.referral_source,
      status: row.status,
      created_at: row.created_at,
    });
  }
  return json({ schemaVersion: 1, entries, securityLogs: await readSecurityLogs(db) }, 200, headers);
}

async function handleEmail(db: D1Database, userId: string, id: string, now: string, headers: Headers): Promise<Response> {
  await requireAdminPlan(db, userId, "email", now);
  const row = await db.prepare("SELECT email FROM waitlist WHERE id = ? LIMIT 1").bind(id).first<{ email?: unknown }>();
  if (typeof row?.email !== "string" || row.email.length < 3 || row.email.length > 320 || /\s/u.test(row.email)) {
    return json({ error: "not_found" }, 404, headers);
  }
  await writeAuthorizedAudit(db, userId, "email", id, now);
  return json({ schemaVersion: 1, email: row.email, securityLogs: await readSecurityLogs(db) }, 200, headers);
}

export async function handleWaitlistAdminRequest(
  request: Request,
  env: Env,
  authorizeAdmin: WaitlistAdminAuthorizer,
  clock: () => Date = () => new Date(),
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isWaitlistAdminPath(url.pathname)) return null;
  if (url.search || url.hash) return json({ error: "not_found" }, 404);
  const headers = new Headers();
  if (!cors(request, env, headers)) return json({ error: "forbidden_origin" }, 403);

  const isList = url.pathname === API_PATH;
  const emailMatch = url.pathname.match(/^\/api\/admin\/waitlist\/([0-9a-f-]+)\/email$/iu);
  const allowed = isList ? "GET, OPTIONS" : "GET, OPTIONS";
  if (request.method.toUpperCase() === "OPTIONS") {
    headers.set("allow", allowed);
    return new Response(null, { status: 204, headers });
  }
  if (request.method.toUpperCase() !== "GET") {
    headers.set("allow", allowed);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  if (!isList && (!emailMatch || !UUID.test(emailMatch[1]))) return json({ error: "not_found" }, 404, headers);
  if (env.AUTH_BACKEND?.trim() !== "better-auth") return json({ error: "auth_unavailable" }, 503, headers);
  const authorization = await authorizeAdmin(request, headers);
  if (authorization instanceof Response) return authorization;

  try {
    const db = database(env);
    const now = clock().toISOString();
    return isList
      ? await handleList(db, authorization.userId, now, headers)
      : await handleEmail(db, authorization.userId, emailMatch![1].toLowerCase(), now, headers);
  } catch (error) {
    if (error instanceof WaitlistAdminApiError) return json({ error: error.code }, error.status, headers);
    return json({ error: "waitlist_admin_unavailable" }, 503, headers);
  }
}
