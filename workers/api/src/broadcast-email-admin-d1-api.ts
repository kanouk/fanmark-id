import { selectD1Database, type Env } from "./repository.ts";

const API_PATH = "/api/admin/broadcast-emails";
const MAX_BROADCASTS = 50;
const MAX_BODY_BYTES = 32 * 1024;
const EMAIL_TYPES = new Set(["broadcast_announcement", "broadcast_maintenance", "broadcast_security"]);
const PLAN_TYPES = new Set(["free", "creator", "max", "business", "enterprise", "admin"]);
const LANGUAGES = new Set(["en", "ja", "ko", "id"]);
const STATUSES = new Set(["draft", "scheduled", "sending", "completed", "failed", "cancelled"]);

type RecipientFilter = {
  plan_types?: string[];
  languages?: string[];
  registered_after?: string;
  registered_before?: string;
};

export type BroadcastEmailAdminAuthorizer = (
  request: Request,
  responseHeaders: Headers,
) => Promise<{ userId: string; sessionId: string } | Response>;

export class BroadcastEmailAdminApiError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "BroadcastEmailAdminApiError";
  }
}

function fail(code: string, status = 503): never {
  throw new BroadcastEmailAdminApiError(code, status);
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
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return true;
}

function database(env: Env): D1Database {
  if (env.BROADCAST_EMAIL_BACKEND?.trim() !== "d1" || env.D1_TOPOLOGY?.trim() !== "split") {
    fail("broadcast_email_unavailable", env.BROADCAST_EMAIL_BACKEND ? 500 : 503);
  }
  const selected = selectD1Database(env, "business");
  if (!selected) fail("broadcast_email_unavailable", 500);
  return selected;
}

export function isBroadcastEmailAdminPath(pathname: string): boolean {
  return pathname === API_PATH || pathname.startsWith(`${API_PATH}/`);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseRecipientFilter(value: unknown, allowNull = true): RecipientFilter | null {
  if (value === null && allowNull) return null;
  if (!record(value)) fail("invalid_recipient_filter", 400);
  const allowed = new Set(["plan_types", "languages", "registered_after", "registered_before"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail("invalid_recipient_filter", 400);
  const result: RecipientFilter = {};
  for (const key of ["plan_types", "languages"] as const) {
    const item = value[key];
    if (item === undefined) continue;
    const accepted = key === "plan_types" ? PLAN_TYPES : LANGUAGES;
    if (!Array.isArray(item) || item.length > accepted.size || item.some((entry) => typeof entry !== "string" || !accepted.has(entry))) {
      fail("invalid_recipient_filter", 400);
    }
    const unique = [...new Set(item as string[])];
    if (unique.length !== item.length) fail("invalid_recipient_filter", 400);
    if (unique.length) result[key] = unique;
  }
  for (const key of ["registered_after", "registered_before"] as const) {
    const item = value[key];
    if (item === undefined || item === "") continue;
    if (!isDate(item)) fail("invalid_recipient_filter", 400);
    result[key] = item;
  }
  if (result.registered_after && result.registered_before && result.registered_after > result.registered_before) {
    fail("invalid_recipient_filter", 400);
  }
  return Object.keys(result).length ? result : null;
}

function parseBroadcast(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof value.id !== "string" || value.id.length > 64 ||
      typeof value.subject !== "string" || value.subject.length > 256 ||
      typeof value.body_text !== "string" || value.body_text.length > 10_000 ||
      typeof value.email_type !== "string" || !EMAIL_TYPES.has(value.email_type) ||
      !Number.isSafeInteger(value.total_recipients) || Number(value.total_recipients) < 0 ||
      !Number.isSafeInteger(value.sent_count) || Number(value.sent_count) < 0 ||
      !Number.isSafeInteger(value.failed_count) || Number(value.failed_count) < 0 ||
      typeof value.status !== "string" || !STATUSES.has(value.status) ||
      !(value.created_at === null || (typeof value.created_at === "string" && Number.isFinite(Date.parse(value.created_at)))) ||
      !(value.started_at === null || (typeof value.started_at === "string" && Number.isFinite(Date.parse(value.started_at)))) ||
      !(value.completed_at === null || (typeof value.completed_at === "string" && Number.isFinite(Date.parse(value.completed_at))))) {
    fail("broadcast_email_unavailable");
  }
  let recipientFilter: RecipientFilter | null;
  try {
    recipientFilter = parseRecipientFilter(value.recipient_filter === null ? null : JSON.parse(String(value.recipient_filter)));
  } catch (error) {
    if (error instanceof BroadcastEmailAdminApiError) throw error;
    fail("broadcast_email_unavailable");
  }
  return {
    id: value.id,
    subject: value.subject,
    body_text: value.body_text,
    email_type: value.email_type,
    total_recipients: Number(value.total_recipients),
    sent_count: Number(value.sent_count),
    failed_count: Number(value.failed_count),
    status: value.status,
    recipient_filter: recipientFilter,
    created_at: value.created_at,
    started_at: value.started_at,
    completed_at: value.completed_at,
  };
}

function parseTemplate(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof value.id !== "string" || value.id.length > 64 ||
      typeof value.email_type !== "string" || !EMAIL_TYPES.has(value.email_type) ||
      typeof value.language !== "string" || !LANGUAGES.has(value.language) ||
      typeof value.subject !== "string" || value.subject.length > 256 ||
      typeof value.body_text !== "string" || value.body_text.length > 10_000 ||
      typeof value.button_text !== "string" || value.button_text.length > 128) fail("broadcast_email_unavailable");
  return {
    id: value.id,
    email_type: value.email_type,
    language: value.language,
    subject: value.subject,
    body_text: value.body_text,
    button_text: value.button_text,
  };
}

async function requireAdminPlan(db: D1Database, userId: string, action: string, now: string): Promise<void> {
  const setting = await db.prepare("SELECT plan_type FROM user_settings WHERE user_id = ? LIMIT 1")
    .bind(userId).first<{ plan_type?: unknown }>();
  if (setting?.plan_type === "admin") return;
  const results = await db.batch([
    db.prepare(`INSERT INTO audit_logs (id, user_id, action, resource_type, metadata, created_at)
      VALUES (?, ?, 'ADMIN_CHECK', 'system', ?, ?)`)
      .bind(crypto.randomUUID(), userId, JSON.stringify({ timestamp: now, session_valid: true, admin_check_result: false, attempted_action: action }), now),
    db.prepare(`INSERT INTO audit_logs (id, user_id, action, resource_type, metadata, created_at)
      VALUES (?, ?, 'UNAUTHORIZED_BROADCAST_EMAIL_ACCESS', 'broadcast_email', ?, ?)`)
      .bind(crypto.randomUUID(), userId, JSON.stringify({ timestamp: now, attempted_action: action, security_level: "HIGH_RISK" }), now),
  ]);
  if (!results.every((item) => item.success && item.meta?.changes === 1)) fail("broadcast_email_unavailable");
  fail("super_admin_required", 403);
}

async function listBroadcasts(db: D1Database): Promise<Record<string, unknown>[]> {
  const result = await db.prepare(`SELECT id, subject, body_text, email_type, total_recipients, sent_count,
      failed_count, status, recipient_filter, created_at, started_at, completed_at
    FROM broadcast_emails ORDER BY created_at DESC, id DESC LIMIT ?`).bind(MAX_BROADCASTS).all<Record<string, unknown>>();
  if (!result.success || !Array.isArray(result.results) || result.results.length > MAX_BROADCASTS) fail("broadcast_email_unavailable");
  return result.results.map(parseBroadcast);
}

async function listTemplates(db: D1Database): Promise<Record<string, unknown>[]> {
  const result = await db.prepare(`SELECT id, email_type, language, subject, body_text, button_text
    FROM email_templates WHERE email_type IN (?, ?, ?) AND is_active = 1 ORDER BY email_type, language`)
    .bind(...EMAIL_TYPES).all<Record<string, unknown>>();
  if (!result.success || !Array.isArray(result.results) || result.results.length > 12) fail("broadcast_email_unavailable");
  const templates = result.results.map(parseTemplate);
  if (new Set(templates.map((item) => `${item.email_type}/${item.language}`)).size !== templates.length) {
    fail("broadcast_email_unavailable");
  }
  return templates;
}

async function estimateRecipients(db: D1Database, filter: RecipientFilter | null): Promise<number> {
  const clauses = ["1 = 1"];
  const values: (string | number)[] = [];
  if (filter?.plan_types?.length) {
    clauses.push(`plan_type IN (${filter.plan_types.map(() => "?").join(",")})`);
    values.push(...filter.plan_types);
  }
  if (filter?.languages?.length) {
    clauses.push(`preferred_language IN (${filter.languages.map(() => "?").join(",")})`);
    values.push(...filter.languages);
  }
  if (filter?.registered_after) {
    clauses.push("created_at >= ?");
    values.push(filter.registered_after);
  }
  if (filter?.registered_before) {
    clauses.push("created_at <= ?");
    values.push(filter.registered_before);
  }
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM user_settings WHERE ${clauses.join(" AND ")}`)
    .bind(...values).first<{ count?: unknown }>();
  const count = Number(row?.count);
  if (!Number.isSafeInteger(count) || count < 0) fail("broadcast_email_unavailable");
  return count;
}

async function readJson(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/u.test(declared) && Number(declared) > MAX_BODY_BYTES) fail("invalid_request", 413);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !request.body) {
    fail("invalid_request", 400);
  }
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
        fail("invalid_request", 413);
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
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    fail("invalid_request", 400);
  }
}

async function handleEstimate(db: D1Database, userId: string, body: unknown, now: string, headers: Headers): Promise<Response> {
  if (!record(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, "recipientFilter")) fail("invalid_request", 400);
  const recipientFilter = parseRecipientFilter(body.recipientFilter);
  await requireAdminPlan(db, userId, "estimate_recipients", now);
  return json({ count: await estimateRecipients(db, recipientFilter) }, 200, headers);
}

async function handleCreateDraft(db: D1Database, userId: string, body: unknown, now: string, headers: Headers): Promise<Response> {
  if (!record(body) || Object.keys(body).some((key) => !["emailType", "subject", "bodyText", "recipientFilter"].includes(key)) ||
      typeof body.emailType !== "string" || !EMAIL_TYPES.has(body.emailType) ||
      typeof body.subject !== "string" || body.subject.trim().length < 1 || body.subject.trim().length > 256 || /[\r\n]/u.test(body.subject) ||
      typeof body.bodyText !== "string" || body.bodyText.trim().length < 1 || body.bodyText.length > 10_000 ||
      (body.recipientFilter !== undefined && body.recipientFilter !== null && !record(body.recipientFilter))) fail("invalid_request", 400);
  const recipientFilter = parseRecipientFilter(body.recipientFilter ?? null);
  await requireAdminPlan(db, userId, "create_draft", now);
  const id = crypto.randomUUID();
  const filterJson = recipientFilter ? JSON.stringify(recipientFilter) : null;
  const results = await db.batch([
    db.prepare(`INSERT INTO broadcast_emails
      (id, subject, body_text, email_type, recipient_filter, total_recipients, sent_count, failed_count, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, 0, 'draft', ?, ?, ?)`)
      .bind(id, body.subject.trim(), body.bodyText, body.emailType, filterJson, userId, now, now),
    db.prepare(`INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata, created_at)
      VALUES (?, ?, 'BROADCAST_DRAFT_CREATE', 'broadcast_email', ?, ?, ?)`)
      .bind(crypto.randomUUID(), userId, id, JSON.stringify({ email_type: body.emailType, recipient_filter_present: Boolean(recipientFilter) }), now),
  ]);
  if (!results.every((item) => item.success && item.meta?.changes === 1)) fail("broadcast_email_unavailable");
  const row = await db.prepare(`SELECT id, subject, body_text, email_type, total_recipients, sent_count,
      failed_count, status, recipient_filter, created_at, started_at, completed_at
    FROM broadcast_emails WHERE id = ? LIMIT 1`).bind(id).first<Record<string, unknown>>();
  if (!row) fail("broadcast_email_unavailable");
  return json({ broadcast: parseBroadcast(row) }, 201, headers);
}

export async function handleBroadcastEmailAdminRequest(
  request: Request,
  env: Env,
  authorizeAdmin: BroadcastEmailAdminAuthorizer,
  clock: () => Date = () => new Date(),
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isBroadcastEmailAdminPath(url.pathname)) return null;
  const isRoot = url.pathname === API_PATH;
  const isEstimate = url.pathname === `${API_PATH}/estimate`;
  if (!isRoot && !isEstimate) return json({ error: "not_found" }, 404);
  if (url.search || url.hash) return json({ error: "not_found" }, 404);
  const headers = new Headers();
  if (!cors(request, env, headers)) return json({ error: "forbidden_origin" }, 403);
  const allowed = isEstimate ? "POST, OPTIONS" : "GET, POST, OPTIONS";
  if (request.method.toUpperCase() === "OPTIONS") {
    headers.set("allow", allowed);
    return new Response(null, { status: 204, headers });
  }
  const method = request.method.toUpperCase();
  if ((isEstimate && method !== "POST") || (isRoot && method !== "GET" && method !== "POST")) {
    headers.set("allow", allowed);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  if (env.AUTH_BACKEND?.trim() !== "better-auth") return json({ error: "auth_unavailable" }, 503, headers);
  const authorization = await authorizeAdmin(request, headers);
  if (authorization instanceof Response) return authorization;

  try {
    const db = database(env);
    const now = clock().toISOString();
    if (isEstimate) return await handleEstimate(db, authorization.userId, await readJson(request), now, headers);
    if (method === "POST") return await handleCreateDraft(db, authorization.userId, await readJson(request), now, headers);
    await requireAdminPlan(db, authorization.userId, "list", now);
    return json({ broadcasts: await listBroadcasts(db), templates: await listTemplates(db) }, 200, headers);
  } catch (error) {
    if (error instanceof BroadcastEmailAdminApiError) return json({ error: error.code }, error.status, headers);
    return json({ error: "broadcast_email_unavailable" }, 503, headers);
  }
}
