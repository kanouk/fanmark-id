import { selectD1Database, type Env } from "./repository";
import type { StorageAuthResolver } from "./storage-r2";

const RETURN_PATH = "/api/me/fanmarks/return";
const BULK_RETURN_PATH = "/api/me/fanmarks/bulk-return";
const RETURN_METHODS = "POST, OPTIONS";
const MAX_REQUEST_BYTES = 4 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

interface ReturnLicenseRow extends Record<string, unknown> {
  licenseId: unknown;
  fanmarkId: unknown;
  shortId: unknown;
  displayFanmark: unknown;
}

export class FanmarkReturnApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "FanmarkReturnApiError";
  }
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const resultHeaders = new Headers(headers);
  resultHeaders.set("cache-control", "no-store");
  resultHeaders.set("content-type", "application/json; charset=utf-8");
  resultHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: resultHeaders });
}

function originHeaders(request: Request, env: Env): Headers | null {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (!origin) return headers;
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  if (!allowed.has(origin)) return null;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", RETURN_METHODS);
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readFanmarkId(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new FanmarkReturnApiError("json_content_type_required", 415);
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) {
    throw new FanmarkReturnApiError("request_too_large", 413);
  }
  if (!request.body) throw new FanmarkReturnApiError("invalid_request", 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new FanmarkReturnApiError("request_too_large", 413);
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
    throw new FanmarkReturnApiError("invalid_json", 400);
  }
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.fanmark_id !== "string" || !UUID.test(value.fanmark_id)) {
    throw new FanmarkReturnApiError("invalid_request", 400);
  }
  return value.fanmark_id.toLowerCase();
}

function graceExpiry(now: Date, configuredDays: unknown): string {
  const parsed = typeof configuredDays === "string" ? Number.parseInt(configuredDays, 10) : Number.NaN;
  const days = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const base = new Date(now);
  base.setUTCDate(base.getUTCDate() + days);
  if (!Number.isFinite(base.getTime())) throw new FanmarkReturnApiError("return_unavailable", 503);
  if (base.getUTCHours() || base.getUTCMinutes() || base.getUTCSeconds() || base.getUTCMilliseconds()) {
    base.setUTCHours(0, 0, 0, 0);
    base.setUTCDate(base.getUTCDate() + 1);
  }
  return base.toISOString();
}

async function enqueueEvent(
  database: D1Database,
  eventType: string,
  payload: Record<string, unknown>,
  dedupeKey: string,
  nowIso: string,
): Promise<void> {
  await database.prepare(`
    INSERT OR IGNORE INTO notification_events
      (event_type, event_version, source, payload, trigger_at, dedupe_key, status, created_at, updated_at)
    VALUES (?, 1, 'edge_function', ?, ?, ?, 'pending', ?, ?)
  `).bind(eventType, JSON.stringify(payload), nowIso, dedupeKey, nowIso, nowIso).run();
}

async function recordReturnEffects(
  database: D1Database,
  row: ReturnLicenseRow,
  userId: string,
  graceExpiresAt: string,
  nowIso: string,
  options: { accountDeletion?: boolean } = {},
): Promise<void> {
  const fanmarkId = String(row.fanmarkId);
  const displayFanmark = typeof row.displayFanmark === "string" ? row.displayFanmark : "";
  const fanmarkName = displayFanmark.trim() ? displayFanmark : "ファンマーク";
  const shortId = String(row.shortId);
  const auditAction = options.accountDeletion ? "FANMARK_RETURNED_ON_ACCOUNT_DELETE" : "return_fanmark";
  try {
    await database.prepare(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata, created_at)
      VALUES (?, ?, 'fanmark', ?, ?, ?)
    `).bind(userId, auditAction, fanmarkId, JSON.stringify({
      user_input_fanmark: displayFanmark,
      returned_at: nowIso,
      grace_expires_at: graceExpiresAt,
    }), nowIso).run();
  } catch {
    // Supabase's source helper treats audit failure as best effort.
  }

  if (!options.accountDeletion) {
    try {
      await enqueueEvent(database, "fanmark_returned_owner", {
        user_id: userId,
        fanmark_id: fanmarkId,
        fanmark_name: fanmarkName,
        fanmark_short_id: shortId,
        grace_expires_at: graceExpiresAt,
        link: shortId ? `/f/${shortId}` : null,
      }, `fanmark_returned_owner_${fanmarkId}_${userId}`, nowIso);
    } catch {
      // Notification enqueue failure does not undo a completed return.
    }
  }

  try {
    await database.prepare(`
      INSERT OR IGNORE INTO notification_events
        (event_type, event_version, source, payload, trigger_at, dedupe_key, status, created_at, updated_at)
      SELECT 'favorite_fanmark_available', 1, 'edge_function',
             json_object(
               'user_id', user_id,
               'fanmark_id', ?,
               'fanmark_name', COALESCE(display_fanmark, ''),
               'fanmark_short_id', ?,
               'grace_expires_at', ?,
               'link', CASE WHEN ? <> '' THEN '/f/' || ? ELSE NULL END
             ),
             ?, 'favorite_available_' || ? || '_' || user_id, 'pending', ?, ?
      FROM fanmark_favorites
      WHERE fanmark_id = ? AND user_id <> ?
    `).bind(
      fanmarkId, shortId, graceExpiresAt, shortId, shortId, nowIso,
      fanmarkId, nowIso, nowIso, fanmarkId, userId,
    ).run();
  } catch {
    // Failure to list favorites does not undo a completed return.
  }
}

export function isFanmarkReturnPath(pathname: string): boolean {
  return pathname === RETURN_PATH;
}

export function isFanmarkBulkReturnPath(pathname: string): boolean {
  return pathname === BULK_RETURN_PATH;
}

interface BulkReturnLicenseRow extends ReturnLicenseRow {
  licenseEnd: unknown;
  status: unknown;
  isReturned: unknown;
  graceExpiresAt: unknown;
}

interface ReturnSuccess {
  licenseId: string;
  fanmarkId: string;
  fanmark: string;
  fanmarkShortId: string;
  graceExpiresAt: string;
}

async function readLicenseIds(request: Request): Promise<string[]> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new FanmarkReturnApiError("json_content_type_required", 415);
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) {
    throw new FanmarkReturnApiError("request_too_large", 413);
  }
  if (!request.body) throw new FanmarkReturnApiError("invalid_request", 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new FanmarkReturnApiError("request_too_large", 413);
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
    throw new FanmarkReturnApiError("invalid_json", 400);
  }
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.license_ids) ||
      value.license_ids.length < 1 || value.license_ids.length > 50 ||
      !value.license_ids.every((id) => typeof id === "string" && UUID.test(id)) ||
      new Set(value.license_ids.map((id) => (id as string).toLowerCase())).size !== value.license_ids.length) {
    throw new FanmarkReturnApiError("invalid_request", 400);
  }
  return (value.license_ids as string[]).map((id) => id.toLowerCase());
}

async function returnLicenseById(
  database: D1Database,
  licenseId: string,
  userId: string,
  now: Date,
  nowIso: string,
  accountDeletion = false,
): Promise<ReturnSuccess> {
  const row = await database.prepare(`
    SELECT l.id AS licenseId, l.fanmark_id AS fanmarkId, l.license_end AS licenseEnd,
           l.status, l.is_returned AS isReturned, l.grace_expires_at AS graceExpiresAt,
           f.short_id AS shortId, l.display_fanmark AS displayFanmark
    FROM fanmark_licenses AS l
    JOIN fanmarks AS f ON f.id = l.fanmark_id
    WHERE l.id = ? AND l.user_id = ?
    LIMIT 1
  `).bind(licenseId, userId).first<BulkReturnLicenseRow>();
  if (!row || typeof row.fanmarkId !== "string" || typeof row.shortId !== "string") {
    throw new FanmarkReturnApiError("license_not_found", 404);
  }
  if (row.status !== "active" || (typeof row.licenseEnd === "string" && row.licenseEnd <= nowIso)) {
    throw new FanmarkReturnApiError("license_not_active", 409);
  }

  const setting = await database.prepare(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'grace_period_days'",
  ).first<{ setting_value: unknown }>();
  const graceExpiresAt = graceExpiry(now, setting?.setting_value);
  await database.prepare(`
    UPDATE fanmark_licenses
    SET status = 'grace', license_end = ?, grace_expires_at = ?,
        is_returned = 1, excluded_at = NULL, updated_at = ?
    WHERE id = ? AND fanmark_id = ? AND user_id = ? AND status = 'active'
      AND (license_end IS NULL OR license_end > ?)
      AND NOT EXISTS (
        SELECT 1 FROM fanmark_transfer_codes
        WHERE license_id = ? AND status IN ('active', 'applied')
      )
  `).bind(nowIso, graceExpiresAt, nowIso, licenseId, row.fanmarkId, userId, nowIso, licenseId).run();

  // D1 batch metadata can be stale after a committed write; verify the exact
  // terminal state before deciding whether this item succeeded.
  const updated = await database.prepare(`
    SELECT status, license_end AS licenseEnd, grace_expires_at AS graceExpiresAt,
           is_returned AS isReturned
    FROM fanmark_licenses WHERE id = ? AND user_id = ?
  `).bind(licenseId, userId).first<BulkReturnLicenseRow>();
  if (updated?.status !== "grace" || updated.licenseEnd !== nowIso ||
      updated.graceExpiresAt !== graceExpiresAt || updated.isReturned !== 1) {
    const activeTransfer = await database.prepare(
      "SELECT 1 AS found FROM fanmark_transfer_codes WHERE license_id = ? AND status IN ('active', 'applied') LIMIT 1",
    ).bind(licenseId).first();
    if (activeTransfer) throw new FanmarkReturnApiError("transfer_in_progress", 409);
    throw new FanmarkReturnApiError("license_state_changed", 409);
  }

  await recordReturnEffects(database, row, userId, graceExpiresAt, nowIso, { accountDeletion });
  return {
    licenseId,
    fanmarkId: row.fanmarkId,
    fanmark: typeof row.displayFanmark === "string" ? row.displayFanmark : "",
    fanmarkShortId: row.shortId,
    graceExpiresAt,
  };
}

/**
 * Return every currently valid active license before a self-service account
 * deletion. The per-license operation is deliberately reused so it keeps the
 * same compare-and-set, transfer-code guard, audit, and favorite notification
 * behavior as an ordinary return. Owner notifications are suppressed because
 * the receiving account is about to be deleted.
 */
export async function returnAllActiveFanmarksForAccountDeletion(
  database: D1Database,
  userId: string,
  now: Date,
): Promise<number> {
  const nowIso = now.toISOString();
  const candidates = await database.prepare(`
    SELECT id
    FROM fanmark_licenses
    WHERE user_id = ? AND status = 'active'
      AND (license_end IS NULL OR license_end > ?)
    ORDER BY CASE WHEN license_end IS NULL THEN 1 ELSE 0 END ASC,
             license_end DESC, id ASC
    LIMIT 1001
  `).bind(userId, nowIso).all<{ id: unknown }>();
  if (!candidates.success || candidates.results.length > 1000 ||
      candidates.results.some((row) => typeof row.id !== "string" || !UUID.test(row.id))) {
    throw new FanmarkReturnApiError("return_unavailable", 503);
  }

  for (const row of candidates.results) {
    await returnLicenseById(database, row.id as string, userId, now, nowIso, true);
  }
  return candidates.results.length;
}

export async function handleFanmarkBulkReturnRequest(
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
      headers.set("allow", RETURN_METHODS);
      return json({ error: "method_not_allowed" }, 405, headers);
    }
    headers.set("allow", RETURN_METHODS);
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") {
    headers.set("allow", RETURN_METHODS);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  if (env.FANMARK_RETURN_BACKEND?.trim() !== "d1") return json({ error: "return_unavailable" }, 503, headers);
  if (env.AUTH_BACKEND?.trim() !== "better-auth") return json({ error: "server_misconfigured" }, 500, headers);
  const database = selectD1Database(env, "business");
  if (!database) return json({ error: "server_misconfigured" }, 500, headers);

  let auth: Awaited<ReturnType<StorageAuthResolver>>;
  try {
    auth = await resolveAuth(request, env);
  } catch {
    return json({ error: "auth_unavailable" }, 503, headers);
  }
  if (!auth.available) return json({ error: "auth_unavailable" }, 503, headers);
  if (!auth.userId) return json({ error: "unauthorized" }, 401, headers);

  try {
    const licenseIds = await readLicenseIds(request);
    const now = clock();
    const nowIso = now.toISOString();
    const results: ReturnSuccess[] = [];
    const failed: Array<{ licenseId: string; error: string }> = [];
    for (const licenseId of licenseIds) {
      try {
        results.push(await returnLicenseById(database, licenseId, auth.userId, now, nowIso));
      } catch (error) {
        failed.push({
          licenseId,
          error: error instanceof FanmarkReturnApiError ? error.code : "return_unavailable",
        });
      }
    }
    const success = failed.length === 0;
    return json({ success, results, ...(success ? {} : { failed }) }, success ? 200 : 207, headers);
  } catch (error) {
    if (error instanceof FanmarkReturnApiError) return json({ error: error.code }, error.status, headers);
    return json({ error: "return_unavailable" }, 503, headers);
  }
}

export async function handleFanmarkReturnRequest(
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
      headers.set("allow", RETURN_METHODS);
      return json({ error: "method_not_allowed" }, 405, headers);
    }
    headers.set("allow", RETURN_METHODS);
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") {
    headers.set("allow", RETURN_METHODS);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  if (env.FANMARK_RETURN_BACKEND?.trim() !== "d1") return json({ error: "return_unavailable" }, 503, headers);
  if (env.AUTH_BACKEND?.trim() !== "better-auth") return json({ error: "server_misconfigured" }, 500, headers);
  const database = selectD1Database(env, "business");
  if (!database) return json({ error: "server_misconfigured" }, 500, headers);

  let auth: Awaited<ReturnType<StorageAuthResolver>>;
  try {
    auth = await resolveAuth(request, env);
  } catch {
    return json({ error: "auth_unavailable" }, 503, headers);
  }
  if (!auth.available) return json({ error: "auth_unavailable" }, 503, headers);
  if (!auth.userId) return json({ error: "unauthorized" }, 401, headers);

  try {
    const fanmarkId = await readFanmarkId(request);
    const now = clock();
    const nowIso = now.toISOString();
    const candidates = await database.prepare(`
      SELECT l.id AS licenseId, l.fanmark_id AS fanmarkId,
             f.short_id AS shortId, l.display_fanmark AS displayFanmark
      FROM fanmark_licenses AS l
      JOIN fanmarks AS f ON f.id = l.fanmark_id
      WHERE l.fanmark_id = ? AND l.user_id = ? AND l.status = 'active'
        AND (l.license_end IS NULL OR l.license_end > ?)
      ORDER BY CASE WHEN l.license_end IS NULL THEN 1 ELSE 0 END ASC,
               l.license_end DESC, l.id ASC
      LIMIT 2
    `).bind(fanmarkId, auth.userId, nowIso).all<ReturnLicenseRow>();
    const rows = candidates.results ?? [];
    if (rows.length === 0) return json({ error: "no_active_license" }, 404, headers);
    if (rows.length !== 1 || typeof rows[0].licenseId !== "string" ||
        typeof rows[0].fanmarkId !== "string" || typeof rows[0].shortId !== "string") {
      return json({ error: "return_unavailable" }, 503, headers);
    }
    const row = rows[0];
    const licenseId = row.licenseId as string;
    const setting = await database.prepare(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'grace_period_days'",
    ).first<{ setting_value: unknown }>();
    const graceExpiresAt = graceExpiry(now, setting?.setting_value);
    const result = await database.prepare(`
      UPDATE fanmark_licenses
      SET status = 'grace', license_end = ?, grace_expires_at = ?,
          is_returned = 1, excluded_at = NULL, updated_at = ?
      WHERE id = ? AND fanmark_id = ? AND user_id = ? AND status = 'active'
        AND (license_end IS NULL OR license_end > ?)
        AND NOT EXISTS (
          SELECT 1 FROM fanmark_transfer_codes
          WHERE license_id = ? AND status IN ('active', 'applied')
        )
    `).bind(nowIso, graceExpiresAt, nowIso, licenseId, fanmarkId, auth.userId, nowIso, licenseId).run();
    if (result.meta.changes !== 1) {
      const activeTransfer = await database.prepare(
        "SELECT 1 AS found FROM fanmark_transfer_codes WHERE license_id = ? AND status IN ('active', 'applied') LIMIT 1",
      ).bind(licenseId).first();
      if (activeTransfer) return json({ error: "transfer_in_progress" }, 400, headers);
      return json({ error: "license_state_changed" }, 409, headers);
    }

    await recordReturnEffects(database, row, auth.userId, graceExpiresAt, nowIso);
    return json({ success: true }, 200, headers);
  } catch (error) {
    if (error instanceof FanmarkReturnApiError) return json({ error: error.code }, error.status, headers);
    return json({ error: "return_unavailable" }, 503, headers);
  }
}
