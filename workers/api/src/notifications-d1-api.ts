import { selectD1Database, type Env } from "./repository";
import type { StorageAuthResolver } from "./storage-r2";

const NOTIFICATIONS_PATH = "/api/me/notifications";
const NOTIFICATIONS_METHODS = "GET, POST, PATCH, OPTIONS";
const MAX_JSON_BYTES = 2 * 1024;
const MAX_NOTIFICATION_PAYLOAD_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CHANNELS = new Set(["in_app", "email", "webpush"]);
const READ_VIA = new Set(["app", "menu"]);

type NotificationsRoute =
  | { kind: "list"; limit: number }
  | { kind: "unread_count" }
  | { kind: "read_all" }
  | { kind: "read_one"; id: string };

interface NotificationRow extends Record<string, unknown> {
  id: unknown;
  payload: unknown;
  read_at: unknown;
  triggered_at: unknown;
  priority: unknown;
  channel: unknown;
}

export class NotificationsApiError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "NotificationsApiError";
  }
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  let serialized = JSON.stringify(body);
  let responseStatus = status;
  if (new TextEncoder().encode(serialized).byteLength > MAX_RESPONSE_BYTES) {
    serialized = JSON.stringify({ error: "notifications_unavailable" });
    responseStatus = 503;
  }
  return new Response(serialized, { status: responseStatus, headers: responseHeaders });
}

function originHeaders(request: Request, env: Env): Headers | null {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (!origin) return headers;
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  if (!allowed.has(origin)) return null;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", NOTIFICATIONS_METHODS);
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function routeFor(url: URL): NotificationsRoute | null {
  if (url.pathname === NOTIFICATIONS_PATH) {
    const keys = new Set<string>();
    url.searchParams.forEach((_value, key) => keys.add(key));
    if ([...keys].some((key) => key !== "limit") || url.searchParams.getAll("limit").length > 1) {
      throw new NotificationsApiError("invalid_request", 400);
    }
    const rawLimit = url.searchParams.get("limit") ?? "50";
    if (!/^(?:[1-9]|[1-4][0-9]|50)$/u.test(rawLimit)) throw new NotificationsApiError("invalid_request", 400);
    return { kind: "list", limit: Number(rawLimit) };
  }
  if (url.pathname === `${NOTIFICATIONS_PATH}/unread-count`) {
    if (url.search) throw new NotificationsApiError("invalid_request", 400);
    return { kind: "unread_count" };
  }
  if (url.pathname === `${NOTIFICATIONS_PATH}/read-all`) {
    if (url.search) throw new NotificationsApiError("invalid_request", 400);
    return { kind: "read_all" };
  }
  const match = /^\/api\/me\/notifications\/([0-9a-f-]+)\/read$/iu.exec(url.pathname);
  if (match && UUID_RE.test(match[1]) && !url.search) return { kind: "read_one", id: match[1].toLowerCase() };
  return null;
}

function database(env: Env): D1Database {
  if (env.NOTIFICATIONS_BACKEND?.trim() !== "d1") throw new NotificationsApiError("notifications_unavailable");
  const selected = selectD1Database(env, "business");
  if (!selected || env.AUTH_BACKEND?.trim() !== "better-auth") {
    throw new NotificationsApiError("server_misconfigured", 500);
  }
  return selected;
}

function requiredText(value: unknown, maximum = 128): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new NotificationsApiError("notifications_unavailable");
  }
  return value;
}

function nullableText(value: unknown, maximum = 128): string | null {
  if (value === null) return null;
  return requiredText(value, maximum);
}

function parsePayload(value: unknown): Record<string, unknown> {
  let payload = value;
  if (typeof value === "string") {
    try {
      payload = JSON.parse(value);
    } catch {
      throw new NotificationsApiError("notifications_unavailable");
    }
  }
  if (!isRecord(payload) || new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_NOTIFICATION_PAYLOAD_BYTES) {
    throw new NotificationsApiError("notifications_unavailable");
  }
  return payload;
}

function mapNotification(row: NotificationRow): Record<string, unknown> {
  const id = requiredText(row.id, 36).toLowerCase();
  const triggeredAt = requiredText(row.triggered_at);
  const parsedDate = Date.parse(triggeredAt);
  const priority = row.priority;
  const channel = requiredText(row.channel, 32);
  if (
    !UUID_RE.test(id) || !Number.isFinite(parsedDate) ||
    typeof priority !== "number" || !Number.isInteger(priority) || priority < 1 || priority > 10 ||
    !CHANNELS.has(channel)
  ) throw new NotificationsApiError("notifications_unavailable");
  return {
    id,
    payload: parsePayload(row.payload),
    read_at: nullableText(row.read_at),
    triggered_at: triggeredAt,
    priority,
    channel,
  };
}

async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new NotificationsApiError("json_content_type_required", 415);
  }
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_JSON_BYTES)) {
    throw new NotificationsApiError("request_too_large", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new NotificationsApiError("invalid_request", 400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BYTES) throw new NotificationsApiError("request_too_large", 413);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new NotificationsApiError("invalid_request", 400);
  }
}

function assertD1Rows<T>(result: D1Result<T>): T[] {
  if (!result || result.success !== true || !Array.isArray(result.results)) {
    throw new NotificationsApiError("notifications_unavailable");
  }
  return result.results;
}

function changedRows(result: D1Result<unknown>): number {
  const changes = result?.meta?.changes;
  if (result?.success !== true || typeof changes !== "number" || !Number.isSafeInteger(changes) || changes < 0) {
    throw new NotificationsApiError("notifications_unavailable");
  }
  return changes;
}

export function isNotificationsPath(pathname: string): boolean {
  return pathname === NOTIFICATIONS_PATH || pathname.startsWith(`${NOTIFICATIONS_PATH}/`);
}

export async function handleNotificationsRequest(
  request: Request,
  env: Env,
  resolveAuth: StorageAuthResolver,
  clock: () => Date = () => new Date(),
): Promise<Response> {
  const headers = originHeaders(request, env);
  if (!headers) return json({ error: "forbidden_origin" }, 403);
  const url = new URL(request.url);
  let route: NotificationsRoute | null;
  try {
    route = routeFor(url);
  } catch (error) {
    if (error instanceof NotificationsApiError) return json({ error: error.code }, error.status, headers);
    return json({ error: "notifications_unavailable" }, 503, headers);
  }
  if (!route) return json({ error: "not_found" }, 404, headers);

  const expectedMethod = route.kind === "list" || route.kind === "unread_count" ? "GET" : route.kind === "read_all" ? "POST" : "PATCH";
  if (request.method === "OPTIONS") {
    const requested = request.headers.get("access-control-request-method")?.toUpperCase();
    if (requested && requested !== expectedMethod) {
      headers.set("allow", `${expectedMethod}, OPTIONS`);
      return json({ error: "method_not_allowed" }, 405, headers);
    }
    headers.set("allow", `${expectedMethod}, OPTIONS`);
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== expectedMethod) {
    headers.set("allow", `${expectedMethod}, OPTIONS`);
    return json({ error: "method_not_allowed" }, 405, headers);
  }

  let db: D1Database;
  try {
    db = database(env);
  } catch (error) {
    const known = error instanceof NotificationsApiError ? error : new NotificationsApiError("notifications_unavailable");
    return json({ error: known.code }, known.status, headers);
  }
  const auth = await resolveAuth(request, env);
  if (!auth.available) return json({ error: "auth_unavailable" }, 503, headers);
  if (!auth.userId) return json({ error: "unauthorized" }, 401, headers);

  try {
    if (route.kind === "list") {
      const rows = assertD1Rows(await db.prepare(`
        SELECT id, payload, read_at, triggered_at, priority, channel
        FROM notifications
        WHERE user_id = ?
        ORDER BY triggered_at DESC, id ASC
        LIMIT ?
      `).bind(auth.userId, route.limit).all<NotificationRow>());
      if (rows.length > route.limit) throw new NotificationsApiError("notifications_unavailable");
      return json({ schemaVersion: 1, notifications: rows.map(mapNotification) }, 200, headers);
    }

    if (route.kind === "unread_count") {
      const now = clock().toISOString();
      const row = await db.prepare(`
        SELECT count(*) AS unread_count
        FROM notifications
        WHERE user_id = ? AND read_at IS NULL AND status = 'delivered'
          AND (expires_at IS NULL OR expires_at > ?)
      `).bind(auth.userId, now).first<{ unread_count?: unknown }>();
      if (!row || typeof row.unread_count !== "number" || !Number.isSafeInteger(row.unread_count) || row.unread_count < 0) {
        throw new NotificationsApiError("notifications_unavailable");
      }
      return json({ schemaVersion: 1, count: row.unread_count }, 200, headers);
    }

    if (route.kind === "read_one") {
      const body = await readJson(request);
      if (!isRecord(body) || Object.keys(body).length !== 1 || typeof body.readVia !== "string" || !READ_VIA.has(body.readVia)) {
        throw new NotificationsApiError("invalid_request", 400);
      }
      const now = clock().toISOString();
      const result = await db.prepare(`
        UPDATE notifications SET read_at = ?, read_via = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND read_at IS NULL
      `).bind(now, body.readVia, now, route.id, auth.userId).run();
      return json({ schemaVersion: 1, updated: changedRows(result) === 1 }, 200, headers);
    }

    if (request.body !== null) throw new NotificationsApiError("invalid_request", 400);
    const now = clock().toISOString();
    const result = await db.prepare(`
      UPDATE notifications SET read_at = ?, read_via = 'app', updated_at = ?
      WHERE user_id = ? AND read_at IS NULL AND status = 'delivered'
        AND (expires_at IS NULL OR expires_at > ?)
    `).bind(now, now, auth.userId, now).run();
    return json({ schemaVersion: 1, updatedCount: changedRows(result) }, 200, headers);
  } catch (error) {
    if (error instanceof NotificationsApiError) return json({ error: error.code }, error.status, headers);
    return json({ error: "notifications_unavailable" }, 503, headers);
  }
}
