import { selectD1Database, type Env } from "./repository";
import type { StorageAuthResolver } from "./storage-r2";

const APPLY_PATH = "/api/fanmarks/lottery/apply";
const CANCEL_PATH = "/api/fanmarks/lottery/cancel";
const METHODS = "POST, OPTIONS";
const MAX_BODY_BYTES = 4 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

interface GraceLicenseRow {
  id: unknown;
  fanmark_id: unknown;
  display_fanmark: unknown;
  grace_expires_at: unknown;
}

interface ExistingEntryRow {
  id: unknown;
  entry_status: unknown;
}

interface SettingsRow {
  plan_type: unknown;
}

export class FanmarkLotteryApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "FanmarkLotteryApiError";
  }
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function withHeaders(response: Response, headers: Headers): Response {
  const merged = new Headers(response.headers);
  headers.forEach((value, key) => merged.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readIdentifier(request: Request, field: "fanmark_id" | "entry_id"): Promise<string> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new FanmarkLotteryApiError("json_content_type_required", 415);
  }
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new FanmarkLotteryApiError("request_too_large", 413);
  }
  if (!request.body) throw new FanmarkLotteryApiError("invalid_request", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new FanmarkLotteryApiError("request_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new FanmarkLotteryApiError("invalid_json", 400);
  }
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value[field] !== "string" || !UUID.test(value[field])) {
    throw new FanmarkLotteryApiError(field === "fanmark_id" ? "fanmark_id is required" : "entry_id is required", 400);
  }
  return value[field].toLowerCase();
}

function database(env: Env): D1Database {
  if (env.FANMARK_LOTTERY_BACKEND?.trim() !== "d1") {
    throw new FanmarkLotteryApiError("lottery_unavailable", 503);
  }
  if (env.AUTH_BACKEND?.trim() !== "better-auth") {
    throw new FanmarkLotteryApiError("server_misconfigured", 500);
  }
  const db = selectD1Database(env, "business");
  if (!db) throw new FanmarkLotteryApiError("server_misconfigured", 500);
  return db;
}

function timestampNow(now: Date): string {
  return now.toISOString().replace(/\.(\d{3})Z$/u, (_match, millis: string) => `.${millis}000Z`);
}

function parseLimit(value: unknown): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 3;
}

async function pendingCount(db: D1Database, fanmarkId: string, licenseId: string): Promise<number> {
  const row = await db.prepare(`
    SELECT COUNT(*) AS count FROM fanmark_lottery_entries
    WHERE fanmark_id = ? AND license_id = ? AND entry_status = 'pending'
  `).bind(fanmarkId, licenseId).first<{ count: unknown }>();
  return typeof row?.count === "number" ? row.count : 1;
}

async function apply(
  db: D1Database,
  userId: string,
  fanmarkId: string,
  now: string,
): Promise<Response> {
  const licenses = await db.prepare(`
    SELECT l.id, l.fanmark_id, l.display_fanmark, l.grace_expires_at
    FROM fanmark_licenses AS l
    JOIN fanmarks AS f ON f.id = l.fanmark_id
    WHERE l.fanmark_id = ? AND l.status = 'grace' AND l.grace_expires_at > ?
      AND l.lifecycle_claim_id IS NULL
    LIMIT 2
  `).bind(fanmarkId, now).all<GraceLicenseRow>();
  const rows = licenses.results ?? [];
  if (rows.length === 0) throw new FanmarkLotteryApiError("Fanmark is not in grace period or not available for lottery", 400);
  if (rows.length !== 1 || typeof rows[0].id !== "string" || typeof rows[0].grace_expires_at !== "string") {
    throw new FanmarkLotteryApiError("Failed to fetch license information", 500);
  }
  const license = rows[0];
  const licenseId = license.id as string;

  const settings = await db.prepare("SELECT plan_type FROM user_settings WHERE user_id = ? LIMIT 2")
    .bind(userId).all<SettingsRow>();
  if (!settings.results?.length || settings.results.length !== 1) {
    throw new FanmarkLotteryApiError("Failed to fetch user settings", 500);
  }
  const planType = typeof settings.results[0].plan_type === "string" ? settings.results[0].plan_type : "free";
  let limit: number | null = null;
  if (planType !== "admin") {
    const limitKeys: Record<string, string> = {
      free: "free_fanmarks_limit",
      creator: "creator_fanmarks_limit",
      business: "business_fanmarks_limit",
      enterprise: "enterprise_fanmarks_limit",
      max: "max_fanmarks_limit",
    };
    const limitKey = limitKeys[planType] ?? "free_fanmarks_limit";
    let limitSetting: { setting_value: unknown } | null = null;
    try {
      limitSetting = await db.prepare("SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1")
        .bind(limitKey).first<{ setting_value: unknown }>();
    } catch {
      // Source ignores a settings-query error and uses the built-in default.
    }
    limit = limitSetting?.setting_value ? parseLimit(limitSetting.setting_value) : 3;
    const active = await db.prepare(`
      SELECT COUNT(*) AS count FROM fanmark_licenses
      WHERE user_id = ? AND status = 'active' AND is_returned = 0 AND license_end > ?
    `).bind(userId, now).first<{ count: unknown }>();
    if (typeof active?.count !== "number") throw new FanmarkLotteryApiError("Failed to count active fanmarks", 500);
    if (active.count >= limit) {
      return json({
        error: "fanmark_limit_reached",
        message: "You have reached your fanmark limit. Please upgrade your plan or return a fanmark before applying.",
        current_count: active.count,
        limit,
      }, 400);
    }
  }

  const existing = await db.prepare(`
    SELECT id, entry_status FROM fanmark_lottery_entries
    WHERE fanmark_id = ? AND user_id = ? AND license_id = ? LIMIT 2
  `).bind(fanmarkId, userId, licenseId).all<ExistingEntryRow>();
  const existingRows = existing.results ?? [];
  if (existingRows.length > 1) throw new FanmarkLotteryApiError("Failed to check existing entry", 500);
  const oldEntry = existingRows[0];
  if (oldEntry?.entry_status === "pending") {
    throw new FanmarkLotteryApiError("You have already applied for this fanmark", 400);
  }
  if (oldEntry && oldEntry.entry_status !== "cancelled") {
    throw new FanmarkLotteryApiError("Failed to create lottery entry", 500);
  }

  const entryId = typeof oldEntry?.id === "string" ? oldEntry.id : crypto.randomUUID();
  const statements: D1PreparedStatement[] = [];
  const capacityGuard = limit === null
    ? "1 = 1"
    : `(
        SELECT COUNT(*) FROM fanmark_licenses
        WHERE user_id = ? AND status = 'active' AND is_returned = 0 AND license_end > ?
      ) < ?`;
  const capacityBindings = limit === null ? [] : [userId, now, limit];
  const licenseGuard = `EXISTS (
    SELECT 1 FROM fanmark_licenses
    WHERE id = ? AND fanmark_id = ? AND status = 'grace' AND grace_expires_at > ?
      AND lifecycle_claim_id IS NULL
  )`;
  if (oldEntry) {
    statements.push(db.prepare(`
      UPDATE fanmark_lottery_entries
      SET entry_status = 'pending', applied_at = ?, lottery_probability = '1.0', updated_at = ?
      WHERE id = ? AND fanmark_id = ? AND user_id = ? AND license_id = ? AND entry_status = 'cancelled'
      AND ${licenseGuard} AND ${capacityGuard}
    `).bind(now, now, entryId, fanmarkId, userId, licenseId, licenseId, fanmarkId, now, ...capacityBindings));
    statements.push(db.prepare(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata, created_at)
      SELECT user_id, 'LOTTERY_ENTRY_STATUS_CHANGED', 'fanmark_lottery_entry', id,
        json_object('old_status', 'cancelled', 'new_status', 'pending', 'cancellation_reason', cancellation_reason), ?
      FROM fanmark_lottery_entries WHERE id = ? AND changes() = 1
    `).bind(now, entryId));
  } else {
    statements.push(db.prepare(`
      INSERT INTO fanmark_lottery_entries
        (id, fanmark_id, user_id, license_id, lottery_probability, entry_status, applied_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, '1.0', 'pending', ?, ?, ?
      WHERE ${licenseGuard} AND ${capacityGuard}
        AND NOT EXISTS (
          SELECT 1 FROM fanmark_lottery_entries
          WHERE fanmark_id = ? AND user_id = ? AND license_id = ?
        )
      ON CONFLICT(fanmark_id, user_id, license_id) DO NOTHING
    `).bind(entryId, fanmarkId, userId, licenseId, now, now, now,
      licenseId, fanmarkId, now, ...capacityBindings, fanmarkId, userId, licenseId));
    statements.push(db.prepare(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata, created_at)
      SELECT user_id, 'LOTTERY_ENTRY_CREATED', 'fanmark_lottery_entry', id,
        json_object('fanmark_id', fanmark_id, 'license_id', license_id,
          'lottery_probability', CAST(lottery_probability AS REAL)), ?
      FROM fanmark_lottery_entries WHERE id = ? AND changes() = 1
    `).bind(now, entryId));
  }

  try {
  const results = await db.batch(statements);
    if (results[0]?.meta.changes !== 1) {
      const concurrentEntry = await db.prepare(`
        SELECT entry_status FROM fanmark_lottery_entries
        WHERE fanmark_id = ? AND user_id = ? AND license_id = ? LIMIT 1
      `).bind(fanmarkId, userId, licenseId).first<{ entry_status: unknown }>();
      if (concurrentEntry?.entry_status === "pending") {
        throw new FanmarkLotteryApiError("You have already applied for this fanmark", 400);
      }
      const stillGrace = await db.prepare(`
        SELECT 1 AS found FROM fanmark_licenses
        WHERE id = ? AND fanmark_id = ? AND status = 'grace' AND grace_expires_at > ?
          AND lifecycle_claim_id IS NULL
      `).bind(licenseId, fanmarkId, now).first();
      if (!stillGrace) throw new FanmarkLotteryApiError("Fanmark is not in grace period or not available for lottery", 400);
      const active = limit === null ? null : await db.prepare(`
        SELECT COUNT(*) AS count FROM fanmark_licenses
        WHERE user_id = ? AND status = 'active' AND is_returned = 0 AND license_end > ?
      `).bind(userId, now).first<{ count: unknown }>();
      if (limit !== null && typeof active?.count === "number" && active.count >= limit) {
        return json({
          error: "fanmark_limit_reached",
          message: "You have reached your fanmark limit. Please upgrade your plan or return a fanmark before applying.",
          current_count: active.count,
          limit,
        }, 400);
      }
      throw new FanmarkLotteryApiError(oldEntry ? "Failed to update lottery entry" : "Failed to create lottery entry", 500);
    }
  } catch (error) {
    if (error instanceof FanmarkLotteryApiError) throw error;
    throw new FanmarkLotteryApiError(oldEntry ? "Failed to update lottery entry" : "Failed to create lottery entry", 500);
  }

  const probability = await db.prepare("SELECT lottery_probability, applied_at FROM fanmark_lottery_entries WHERE id = ?")
    .bind(entryId).first<{ lottery_probability: unknown; applied_at: unknown }>();
  if (typeof probability?.applied_at !== "string") throw new FanmarkLotteryApiError("Failed to create lottery entry", 500);

  try {
    await db.prepare(`
      INSERT INTO notification_events
        (event_type, event_version, source, payload, trigger_at, status, created_at, updated_at)
      VALUES ('lottery_application_submitted', 1, 'edge_function', ?, ?, 'pending', ?, ?)
    `).bind(JSON.stringify({
      user_id: userId,
      fanmark_id: fanmarkId,
      fanmark_name: typeof license.display_fanmark === "string" ? license.display_fanmark : "",
      entry_id: entryId,
      grace_expires_at: license.grace_expires_at,
    }), now, now, now).run();
  } catch {
    // The source creates the notification as best effort after saving the entry.
  }

  let totalEntries = 1;
  try {
    totalEntries = await pendingCount(db, fanmarkId, licenseId);
  } catch {
    // The source treats this count as optional response metadata.
  }
  return json({
    success: true,
    entry_id: entryId,
    fanmark_id: fanmarkId,
    lottery_probability: typeof probability.lottery_probability === "string"
      ? Number(probability.lottery_probability)
      : probability.lottery_probability,
    total_entries_count: totalEntries,
    grace_expires_at: license.grace_expires_at,
    applied_at: probability.applied_at,
  }, 200);
}

async function cancel(db: D1Database, userId: string, entryId: string, now: string): Promise<Response> {
  const entry = await db.prepare(`
    SELECT id, user_id, fanmark_id, entry_status
    FROM fanmark_lottery_entries WHERE id = ? LIMIT 1
  `).bind(entryId).first<ExistingEntryRow & { user_id: unknown; fanmark_id: unknown }>();
  if (!entry) throw new FanmarkLotteryApiError("Entry not found", 404);
  if (entry.user_id !== userId) throw new FanmarkLotteryApiError("You do not have permission to cancel this entry", 403);
  if (entry.entry_status !== "pending") {
    throw new FanmarkLotteryApiError(`Cannot cancel entry with status: ${String(entry.entry_status)}`, 400);
  }

  const updated = await db.batch([
    db.prepare(`
    UPDATE fanmark_lottery_entries
    SET entry_status = 'cancelled', cancelled_at = ?, cancellation_reason = 'user_request', updated_at = ?
    WHERE id = ? AND user_id = ? AND entry_status = 'pending'
      AND EXISTS (SELECT 1 FROM fanmark_licenses AS license
        WHERE license.id = fanmark_lottery_entries.license_id
          AND license.status = 'grace' AND license.lifecycle_claim_id IS NULL)
  `).bind(now, now, entryId, userId),
    db.prepare(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata, created_at)
      SELECT user_id, 'LOTTERY_ENTRY_STATUS_CHANGED', 'fanmark_lottery_entry', id,
        json_object('old_status', 'pending', 'new_status', 'cancelled', 'cancellation_reason', 'user_request'), ?
      FROM fanmark_lottery_entries WHERE id = ? AND changes() = 1
    `).bind(now, entryId),
  ]);
  if (updated[0]?.meta.changes !== 1) {
    throw new FanmarkLotteryApiError("Cannot cancel entry with status: changed", 400);
  }
  return json({ success: true, entry_id: entryId, entry_status: "cancelled", cancelled_at: now }, 200);
}

export function isFanmarkLotteryPath(pathname: string): boolean {
  return pathname === APPLY_PATH || pathname === CANCEL_PATH;
}

export async function handleFanmarkLotteryRequest(
  request: Request,
  env: Env,
  resolveAuth: StorageAuthResolver,
  clock: () => Date = () => new Date(),
): Promise<Response> {
  const headers = originHeaders(request, env);
  if (!headers) return json({ error: "forbidden_origin" }, 403);
  if (request.method === "OPTIONS") {
    const requestedMethod = request.headers.get("access-control-request-method")?.toUpperCase();
    if (requestedMethod && requestedMethod !== "POST") {
      headers.set("allow", METHODS);
      return json({ error: "method_not_allowed" }, 405, headers);
    }
    headers.set("allow", METHODS);
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") {
    headers.set("allow", METHODS);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  let db: D1Database;
  try {
    db = database(env);
  } catch (error) {
    if (error instanceof FanmarkLotteryApiError) return json({ error: error.code }, error.status, headers);
    return json({ error: "lottery_unavailable" }, 503, headers);
  }
  let auth: Awaited<ReturnType<StorageAuthResolver>>;
  try {
    auth = await resolveAuth(request, env);
  } catch {
    return json({ error: "auth_unavailable" }, 503, headers);
  }
  if (!auth.available) return json({ error: "auth_unavailable" }, 503, headers);
  if (!auth.userId) return json({ error: "Authentication required" }, 401, headers);

  try {
    const now = timestampNow(clock());
    if (new URL(request.url).pathname === APPLY_PATH) {
      const fanmarkId = await readIdentifier(request, "fanmark_id");
      const response = await apply(db, auth.userId, fanmarkId, now);
      return withHeaders(response, headers);
    }
    const entryId = await readIdentifier(request, "entry_id");
    return withHeaders(await cancel(db, auth.userId, entryId, now), headers);
  } catch (error) {
    if (error instanceof FanmarkLotteryApiError) return json({ error: error.code }, error.status, headers);
    return json({ error: "lottery_unavailable" }, 503, headers);
  }
}
