import { selectD1Database, type Env } from "./repository";

const API_PATH = "/api/admin/notification-masters";
const METHODS = "GET, POST, PATCH, OPTIONS";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_RULES = 100;
const MAX_TEMPLATES = 500;
const MAX_LOG_ROWS = 100;
const MAX_RESPONSE_BYTES = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CHANNELS = new Set(["in_app", "email", "webpush"]);
const MANUAL_EVENT_TYPES = new Set(["license_grace_started", "license_expired", "favorite_fanmark_available"]);

export interface NotificationRuleDto {
  id: string;
  event_type: string;
  channel: string;
  template_id: string;
  priority: number;
  delay_seconds: number;
  enabled: boolean;
  updated_at: string;
}

export interface NotificationTemplateDto {
  id: string;
  template_id: string;
  language: string;
  channel: string;
  version: number;
  title: string | null;
  body: string;
  summary: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationEventLogDto {
  id: string;
  event_type: string;
  status: string;
  source: string;
  created_at: string;
  processed_at: string | null;
  error_reason: string | null;
}

export interface NotificationDeliveryLogDto {
  id: string;
  user_id: string;
  channel: string;
  status: string;
  delivered_at: string | null;
  read_at: string | null;
  priority: number;
}

export type NotificationMasterAdminAuthorizer = (
  request: Request,
  responseHeaders: Headers,
) => Promise<{ userId: string; sessionId: string } | Response>;

type Route = { collection: "rules" | "templates" | "events" | "notifications"; id?: string };

export class NotificationMasterApiError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "NotificationMasterApiError";
  }
}

function fail(code: string, status = 503): never {
  throw new NotificationMasterApiError(code, status);
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function route(pathname: string): Route | null {
  const match = /^\/api\/admin\/notification-masters\/(rules|templates|events|notifications)(?:\/([0-9a-f-]+))?$/iu.exec(pathname);
  if (!match || (match[2] !== undefined && !UUID.test(match[2]))) return null;
  const collection = match[1]!.toLowerCase() as Route["collection"];
  if (match[2] && collection !== "rules" && collection !== "templates") return null;
  return { collection, ...(match[2] ? { id: match[2].toLowerCase() } : {}) };
}

export function isNotificationMasterPath(pathname: string): boolean {
  return pathname === API_PATH || route(pathname) !== null || pathname.startsWith(`${API_PATH}/`);
}

function allowedOrigin(request: Request, env: Env, headers: Headers): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  if (!allowed.has(origin)) return false;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", METHODS);
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return true;
}

function database(env: Env): D1Database {
  const backend = env.NOTIFICATION_MASTER_BACKEND?.trim();
  if (backend !== "d1") fail(backend ? "server_misconfigured" : "notification_master_unavailable", backend ? 500 : 503);
  if (env.D1_TOPOLOGY?.trim() !== "split") fail("server_misconfigured", 500);
  const selected = selectD1Database(env, "business");
  if (!selected) fail("notification_master_unavailable");
  return selected;
}

function exactObject(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function parseRule(value: Record<string, unknown>): NotificationRuleDto {
  if (typeof value.id !== "string" || !UUID.test(value.id) ||
      typeof value.event_type !== "string" || value.event_type.length < 1 || value.event_type.length > 200 ||
      typeof value.channel !== "string" || !CHANNELS.has(value.channel) ||
      typeof value.template_id !== "string" || value.template_id.length < 1 || value.template_id.length > 200 ||
      !Number.isSafeInteger(value.priority) || (value.priority as number) < 1 || (value.priority as number) > 10 ||
      !Number.isSafeInteger(value.delay_seconds) || (value.delay_seconds as number) < 0 ||
      typeof value.enabled !== "number" || ![0, 1].includes(value.enabled) || !validTime(value.updated_at)) {
    fail("notification_master_unavailable");
  }
  return { ...value, enabled: value.enabled === 1 } as NotificationRuleDto;
}

function parseTemplate(value: Record<string, unknown>): NotificationTemplateDto {
  if (typeof value.id !== "string" || !UUID.test(value.id) ||
      typeof value.template_id !== "string" || value.template_id.length < 1 || value.template_id.length > 200 ||
      typeof value.language !== "string" || value.language.length < 2 || value.language.length > 16 ||
      typeof value.channel !== "string" || !CHANNELS.has(value.channel) ||
      !Number.isSafeInteger(value.version) || (value.version as number) < 1 ||
      !(value.title === null || (typeof value.title === "string" && value.title.length <= 500)) ||
      typeof value.body !== "string" || value.body.length > 20_000 ||
      !(value.summary === null || (typeof value.summary === "string" && value.summary.length <= 2_000)) ||
      typeof value.is_active !== "number" || ![0, 1].includes(value.is_active) ||
      !validTime(value.created_at) || !validTime(value.updated_at)) {
    fail("notification_master_unavailable");
  }
  return { ...value, is_active: value.is_active === 1 } as NotificationTemplateDto;
}

async function readJsonBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    fail("json_content_type_required", 415);
  }
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) fail("request_too_large", 413);
  if (!request.body) fail("invalid_request", 400);
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
        fail("request_too_large", 413);
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

async function readRules(db: D1Database): Promise<NotificationRuleDto[]> {
  const result = await db.prepare(`
    SELECT id, event_type, channel, template_id, priority, delay_seconds, enabled, updated_at
    FROM notification_rules ORDER BY priority ASC, event_type ASC, id ASC LIMIT ?
  `).bind(MAX_RULES + 1).all<Record<string, unknown>>();
  if (!result.success || !Array.isArray(result.results) || result.results.length > MAX_RULES) {
    fail("notification_master_unavailable");
  }
  return result.results.map(parseRule);
}

async function readTemplates(db: D1Database): Promise<NotificationTemplateDto[]> {
  const result = await db.prepare(`
    SELECT id, template_id, language, channel, version, title, body, summary, is_active, created_at, updated_at
    FROM notification_templates ORDER BY template_id ASC, language ASC, version DESC, id ASC LIMIT ?
  `).bind(MAX_TEMPLATES + 1).all<Record<string, unknown>>();
  if (!result.success || !Array.isArray(result.results) || result.results.length > MAX_TEMPLATES) {
    fail("notification_master_unavailable");
  }
  return result.results.map(parseTemplate);
}

async function readEventLog(db: D1Database): Promise<NotificationEventLogDto[]> {
  const result = await db.prepare(`
    SELECT id, event_type, status, source, created_at, processed_at, error_reason
    FROM notification_events ORDER BY created_at DESC, id ASC LIMIT ?
  `).bind(MAX_LOG_ROWS + 1).all<Record<string, unknown>>();
  if (!result.success || !Array.isArray(result.results) || result.results.length > MAX_LOG_ROWS) {
    fail("notification_master_unavailable");
  }
  return result.results.map((row) => {
    if (typeof row.id !== "string" || !UUID.test(row.id) ||
        typeof row.event_type !== "string" || typeof row.status !== "string" ||
        typeof row.source !== "string" || !validTime(row.created_at) ||
        !(row.processed_at === null || validTime(row.processed_at)) ||
        !(row.error_reason === null || typeof row.error_reason === "string")) {
      fail("notification_master_unavailable");
    }
    return {
      id: row.id,
      event_type: row.event_type,
      status: row.status,
      source: row.source,
      created_at: row.created_at,
      processed_at: row.processed_at,
      error_reason: row.error_reason,
    };
  });
}

async function readDeliveryLog(db: D1Database): Promise<NotificationDeliveryLogDto[]> {
  const result = await db.prepare(`
    SELECT id, substr(user_id, 1, 8) || '...' AS user_id, channel, status,
      delivered_at, read_at, priority
    FROM notifications ORDER BY created_at DESC, id ASC LIMIT ?
  `).bind(MAX_LOG_ROWS + 1).all<Record<string, unknown>>();
  if (!result.success || !Array.isArray(result.results) || result.results.length > MAX_LOG_ROWS) {
    fail("notification_master_unavailable");
  }
  return result.results.map((row) => {
    if (typeof row.id !== "string" || !UUID.test(row.id) ||
        typeof row.user_id !== "string" || row.user_id.length > 11 ||
        typeof row.channel !== "string" || !CHANNELS.has(row.channel) ||
        typeof row.status !== "string" ||
        !(row.delivered_at === null || validTime(row.delivered_at)) ||
        !(row.read_at === null || validTime(row.read_at)) ||
        !Number.isSafeInteger(row.priority) || (row.priority as number) < 1 || (row.priority as number) > 10) {
      fail("notification_master_unavailable");
    }
    return {
      id: row.id,
      user_id: row.user_id,
      channel: row.channel,
      status: row.status,
      delivered_at: row.delivered_at,
      read_at: row.read_at,
      priority: row.priority as number,
    };
  });
}

async function createManualEvent(
  db: D1Database,
  value: unknown,
  clock: Date,
): Promise<{ id: string }> {
  if (!exactObject(value, ["eventType", "payload"]) ||
      typeof value.eventType !== "string" || !MANUAL_EVENT_TYPES.has(value.eventType) ||
      !value.payload || typeof value.payload !== "object" || Array.isArray(value.payload)) {
    fail("invalid_request", 400);
  }
  const payload = JSON.stringify(value.payload);
  if (new TextEncoder().encode(payload).byteLength > MAX_BODY_BYTES) fail("request_too_large", 413);
  if (!(clock instanceof Date) || !Number.isFinite(clock.getTime())) fail("notification_master_unavailable");
  const id = crypto.randomUUID();
  const timestamp = clock.toISOString().replace(/\.(\d{3})Z$/u, (_match, fraction: string) => `.${fraction}000Z`);
  const result = await db.prepare(`
    INSERT INTO notification_events (
      id, event_type, event_version, source, payload, payload_schema, trigger_at,
      dedupe_key, status, processed_at, error_reason, retry_count, created_at, updated_at
    ) VALUES (?, ?, 1, 'admin_manual', ?, NULL, ?, NULL, 'pending', NULL, NULL, 0, ?, ?)
  `).bind(id, value.eventType, payload, timestamp, timestamp, timestamp).run();
  if (!result.success || Number(result.meta?.changes ?? 0) !== 1) fail("notification_master_unavailable");
  return { id };
}

function canonicalNow(value: Date, expectedUpdatedAt: string): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("notification_master_unavailable");
  const expectedTime = Date.parse(expectedUpdatedAt);
  if (!Number.isFinite(expectedTime)) fail("invalid_request", 400);
  return new Date(Math.max(value.getTime(), expectedTime + 1))
    .toISOString().replace(/\.(\d{3})Z$/u, (_match, fraction: string) => `.${fraction}000Z`);
}

async function patchRule(db: D1Database, id: string, value: unknown, clock: Date): Promise<NotificationRuleDto> {
  if (!exactObject(value, ["enabled", "expectedUpdatedAt"]) || typeof value.enabled !== "boolean" ||
      !validTime(value.expectedUpdatedAt)) fail("invalid_request", 400);
  const now = canonicalNow(clock, value.expectedUpdatedAt);
  const result = await db.prepare(`
    UPDATE notification_rules SET enabled = ?, updated_at = ?
    WHERE id = ? AND updated_at = ?
  `).bind(value.enabled ? 1 : 0, now, id, value.expectedUpdatedAt).run();
  if (!result.success) fail("notification_master_unavailable");
  if (Number(result.meta?.changes ?? 0) !== 1) fail("notification_rule_conflict", 409);
  const row = await db.prepare(`
    SELECT id, event_type, channel, template_id, priority, delay_seconds, enabled, updated_at
    FROM notification_rules WHERE id = ? LIMIT 2
  `).bind(id).first<Record<string, unknown>>();
  if (!row) fail("notification_rule_conflict", 409);
  return parseRule(row);
}

async function patchTemplate(db: D1Database, id: string, value: unknown, clock: Date): Promise<NotificationTemplateDto> {
  if (!exactObject(value, ["expectedUpdatedAt", "title", "body", "summary", "isActive"]) ||
      !validTime(value.expectedUpdatedAt) ||
      !(value.title === null || (typeof value.title === "string" && value.title.length <= 500)) ||
      typeof value.body !== "string" || value.body.length > 20_000 ||
      !(value.summary === null || (typeof value.summary === "string" && value.summary.length <= 2_000)) ||
      typeof value.isActive !== "boolean") fail("invalid_request", 400);
  const now = canonicalNow(clock, value.expectedUpdatedAt);
  const result = await db.prepare(`
    UPDATE notification_templates
    SET title = ?, body = ?, summary = ?, is_active = ?, updated_at = ?
    WHERE id = ? AND updated_at = ?
  `).bind(
    value.title, value.body, value.summary, value.isActive ? 1 : 0, now, id, value.expectedUpdatedAt,
  ).run();
  if (!result.success) fail("notification_master_unavailable");
  if (Number(result.meta?.changes ?? 0) !== 1) fail("notification_template_conflict", 409);
  const row = await db.prepare(`
    SELECT id, template_id, language, channel, version, title, body, summary, is_active, created_at, updated_at
    FROM notification_templates WHERE id = ? LIMIT 2
  `).bind(id).first<Record<string, unknown>>();
  if (!row) fail("notification_template_conflict", 409);
  return parseTemplate(row);
}

export async function handleNotificationMasterRequest(
  request: Request,
  env: Env,
  authorizeAdmin: NotificationMasterAdminAuthorizer,
  now: () => Date = () => new Date(),
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isNotificationMasterPath(url.pathname)) return null;
  const headers = new Headers();
  if (!allowedOrigin(request, env, headers)) return json({ error: "forbidden_origin" }, 403, headers);
  if (request.method === "OPTIONS") {
    headers.set("allow", METHODS);
    headers.set("access-control-max-age", "600");
    return new Response(null, { status: 204, headers });
  }
  const parsedRoute = route(url.pathname);
  if (!parsedRoute || url.search || url.hash) return json({ error: "not_found" }, 404, headers);
  const method = request.method.toUpperCase();
  const allowed = parsedRoute.id ? "PATCH, OPTIONS" : parsedRoute.collection === "events"
    ? "GET, POST, OPTIONS" : "GET, OPTIONS";
  headers.set("allow", allowed);
  if (!allowed.split(", ").includes(method)) return json({ error: "method_not_allowed" }, 405, headers);

  const authorization = await authorizeAdmin(request, headers);
  if (authorization instanceof Response) return authorization;
  try {
    const db = database(env);
    if (method === "GET") {
      if (parsedRoute.collection === "events") {
        const events = await readEventLog(db);
        const body = { schemaVersion: 1, events };
        if (new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_RESPONSE_BYTES) {
          fail("notification_master_unavailable");
        }
        return json(body, 200, headers);
      }
      if (parsedRoute.collection === "notifications") {
        const notifications = await readDeliveryLog(db);
        const body = { schemaVersion: 1, notifications };
        if (new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_RESPONSE_BYTES) {
          fail("notification_master_unavailable");
        }
        return json(body, 200, headers);
      }
      if (parsedRoute.collection === "rules") {
        const rules = await readRules(db);
        const body = { schemaVersion: 1, rules };
        if (new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_RESPONSE_BYTES) {
          fail("notification_master_unavailable");
        }
        return json(body, 200, headers);
      }
      const templates = await readTemplates(db);
      const body = { schemaVersion: 1, templates };
      if (new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_RESPONSE_BYTES) {
        fail("notification_master_unavailable");
      }
      return json(body, 200, headers);
    }
    if (parsedRoute.collection === "events" && method === "POST" && !parsedRoute.id) {
      const created = await createManualEvent(db, await readJsonBody(request), now());
      return json({ schemaVersion: 1, event: created }, 201, headers);
    }
    if (!parsedRoute.id) return json({ error: "method_not_allowed" }, 405, headers);
    const body = await readJsonBody(request);
    const clock = now();
    if (parsedRoute.collection === "rules") {
      return json({ schemaVersion: 1, rule: await patchRule(db, parsedRoute.id, body, clock) }, 200, headers);
    }
    return json({ schemaVersion: 1, template: await patchTemplate(db, parsedRoute.id, body, clock) }, 200, headers);
  } catch (error) {
    if (error instanceof NotificationMasterApiError) return json({ error: error.code }, error.status, headers);
    return json({ error: "notification_master_unavailable" }, 503, headers);
  }
}
