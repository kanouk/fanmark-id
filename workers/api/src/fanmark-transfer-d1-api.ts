import { selectD1Database, type Env } from "./repository";
import type { StorageAuthResolver } from "./storage-r2";

const PREFIX = "/api/me/transfers";
const METHODS = "GET, POST, OPTIONS";
const MAX_BODY_BYTES = 8 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/u;
type JsonObject = Record<string, unknown>;

export class FanmarkTransferApiError extends Error {
  constructor(readonly code: string, readonly status: number, readonly details: JsonObject = {}) {
    super(code);
    this.name = "FanmarkTransferApiError";
  }
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const result = new Headers(headers);
  result.set("cache-control", "no-store");
  result.set("content-type", "application/json; charset=utf-8");
  result.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: result });
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
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  if (!allowed.has(origin)) return null;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", METHODS);
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return headers;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(request: Request): Promise<JsonObject> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new FanmarkTransferApiError("json_content_type_required", 415);
  }
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new FanmarkTransferApiError("request_too_large", 413);
  }
  if (!request.body) throw new FanmarkTransferApiError("invalid_request", 400);
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
        throw new FanmarkTransferApiError("request_too_large", 413);
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
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!isRecord(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new FanmarkTransferApiError("invalid_json", 400);
  }
}

function requiredUuid(body: JsonObject, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new FanmarkTransferApiError(field + "_is_required", 400);
  }
  return value.toLowerCase();
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/\.(\d{3})Z$/u, (_match, millis: string) => "." + millis + "000Z");
}

function database(env: Env): D1Database {
  if (env.FANMARK_TRANSFER_BACKEND?.trim() !== "d1") {
    throw new FanmarkTransferApiError("transfer_unavailable", 503);
  }
  if (env.AUTH_BACKEND?.trim() !== "better-auth") {
    throw new FanmarkTransferApiError("server_misconfigured", 500);
  }
  const db = selectD1Database(env, "business");
  if (!db) throw new FanmarkTransferApiError("server_misconfigured", 500);
  return db;
}

function makeTransferCode(): string {
  const random = crypto.getRandomValues(new Uint8Array(12));
  const raw = Array.from(random, (byte) => CODE_ALPHABET[byte & 31]).join("");
  return raw.slice(0, 4) + "-" + raw.slice(4, 8) + "-" + raw.slice(8, 12);
}

function mapCode(row: Record<string, unknown>): JsonObject {
  return {
    id: row.id, license_id: row.license_id, fanmark_id: row.fanmark_id,
    transfer_code: row.transfer_code, status: row.status, expires_at: row.expires_at,
    created_at: row.created_at,
    fanmark: {
      user_input_fanmark: row.user_input_fanmark,
      display_fanmark: row.display_fanmark,
      short_id: row.short_id,
    },
  };
}

function mapRequest(row: Record<string, unknown>): JsonObject {
  return {
    id: row.id, transfer_code_id: row.transfer_code_id, fanmark_id: row.fanmark_id,
    license_id: row.license_id, requester_user_id: row.requester_user_id,
    requester_username: row.requester_username, requester_display_name: row.requester_display_name,
    status: row.status, applied_at: row.applied_at,
    fanmark: {
      user_input_fanmark: row.user_input_fanmark,
      display_fanmark: row.display_fanmark,
      short_id: row.short_id,
    },
  };
}

async function listTransfers(db: D1Database, userId: string): Promise<Response> {
  const codes = await db.prepare(`
    SELECT c.id, c.license_id, c.fanmark_id, c.transfer_code, c.status, c.expires_at, c.created_at,
           l.display_fanmark, f.user_input_fanmark, f.short_id
    FROM fanmark_transfer_codes AS c
    JOIN fanmark_licenses AS l ON l.id = c.license_id
    JOIN fanmarks AS f ON f.id = c.fanmark_id
    WHERE c.issuer_user_id = ? AND c.status IN ('active', 'applied')
    ORDER BY c.created_at DESC LIMIT 100
  `).bind(userId).all<Record<string, unknown>>();
  const pending = await db.prepare(`
    SELECT r.id, r.transfer_code_id, r.license_id, r.fanmark_id, r.requester_user_id,
           r.requester_username, r.requester_display_name, r.status, r.applied_at,
           l.display_fanmark, f.user_input_fanmark, f.short_id
    FROM fanmark_transfer_requests AS r
    JOIN fanmark_transfer_codes AS c ON c.id = r.transfer_code_id
    JOIN fanmark_licenses AS l ON l.id = r.license_id
    JOIN fanmarks AS f ON f.id = r.fanmark_id
    WHERE c.issuer_user_id = ? AND c.status IN ('active', 'applied') AND r.status = 'pending'
    ORDER BY r.applied_at DESC LIMIT 100
  `).bind(userId).all<Record<string, unknown>>();
  const mine = await db.prepare(`
    SELECT r.id, r.transfer_code_id, r.license_id, r.fanmark_id, r.requester_user_id,
           r.requester_username, r.requester_display_name, r.status, r.applied_at,
           l.display_fanmark, f.user_input_fanmark, f.short_id
    FROM fanmark_transfer_requests AS r
    JOIN fanmark_licenses AS l ON l.id = r.license_id
    JOIN fanmarks AS f ON f.id = r.fanmark_id
    WHERE r.requester_user_id = ? AND r.status = 'pending'
    ORDER BY r.applied_at DESC LIMIT 100
  `).bind(userId).all<Record<string, unknown>>();
  return json({
    issuedCodes: (codes.results ?? []).map(mapCode),
    pendingRequests: (pending.results ?? []).map(mapRequest),
    myRequests: (mine.results ?? []).map(mapRequest),
  }, 200);
}

async function issueCode(db: D1Database, userId: string, body: JsonObject, now: Date): Promise<Response> {
  const licenseId = requiredUuid(body, "license_id");
  if (body.disclaimer_agreed !== true) throw new FanmarkTransferApiError("disclaimer_required", 400);
  const nowIso = timestamp(now);
  const minimumEnd = timestamp(new Date(now.getTime() + 48 * 60 * 60 * 1000));
  const expiration = minimumEnd;
  const codeId = crypto.randomUUID();
  const transferCode = makeTransferCode();
  const license = await db.prepare(`
    SELECT l.id, l.fanmark_id, l.display_fanmark, l.license_end, l.transfer_locked_until, f.short_id
    FROM fanmark_licenses AS l JOIN fanmarks AS f ON f.id = l.fanmark_id
    WHERE l.id = ? AND l.user_id = ? AND l.status = 'active' LIMIT 2
  `).bind(licenseId, userId).all<Record<string, unknown>>();
  const rows = license.results ?? [];
  if (rows.length === 0) throw new FanmarkTransferApiError("license_not_found", 404);
  if (rows.length !== 1) throw new FanmarkTransferApiError("license_unavailable", 503);
  const ownerLicense = rows[0];
  if (typeof ownerLicense.transfer_locked_until === "string" && ownerLicense.transfer_locked_until > nowIso) {
    throw new FanmarkTransferApiError("transfer_locked", 400, { locked_until: ownerLicense.transfer_locked_until });
  }
  if (typeof ownerLicense.license_end === "string" && ownerLicense.license_end < minimumEnd) {
    throw new FanmarkTransferApiError("insufficient_remaining_time", 400);
  }
  const applied = await db.prepare("SELECT id FROM fanmark_transfer_codes WHERE license_id = ? AND status = 'applied' LIMIT 1")
    .bind(licenseId).first<{ id: string }>();
  if (applied) throw new FanmarkTransferApiError("transfer_pending_approval", 400);
  const expiresAt = typeof ownerLicense.license_end === "string" && ownerLicense.license_end < expiration
    ? ownerLicense.license_end
    : expiration;

  const results = await db.batch([
    db.prepare(`
      INSERT INTO fanmark_transfer_codes
        (id, license_id, fanmark_id, issuer_user_id, transfer_code, status, expires_at,
         disclaimer_agreed_at, created_at, updated_at)
      SELECT ?, l.id, l.fanmark_id, ?, ?, 'active', ?, ?, ?, ?
      FROM fanmark_licenses AS l
      WHERE l.id = ? AND l.user_id = ? AND l.status = 'active'
        AND (l.transfer_locked_until IS NULL OR l.transfer_locked_until <= ?)
        AND (l.license_end IS NULL OR l.license_end >= ?)
        AND NOT EXISTS (
          SELECT 1 FROM fanmark_transfer_codes AS pending
          WHERE pending.license_id = l.id AND pending.status = 'applied'
        )
    `).bind(codeId, userId, transferCode, expiresAt, nowIso, nowIso, nowIso,
      licenseId, userId, nowIso, minimumEnd),
    db.prepare(`
      UPDATE fanmark_transfer_codes SET status = 'cancelled', updated_at = ?
      WHERE license_id = ? AND status = 'active' AND id <> ? AND changes() = 1
    `).bind(nowIso, licenseId, codeId),
    db.prepare(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata, created_at)
      SELECT ?, 'TRANSFER_CODE_ISSUED', 'fanmark_transfer_code', c.id,
             json_object('license_id', l.id, 'fanmark_id', l.fanmark_id,
                         'fanmark_name', l.display_fanmark, 'expires_at', c.expires_at), ?
      FROM fanmark_transfer_codes AS c
      JOIN fanmark_licenses AS l ON l.id = c.license_id
      WHERE c.id = ? AND c.status = 'active'
    `).bind(userId, nowIso, codeId),
  ]);
  if (results[0]?.meta?.changes !== 1) {
    const stillApplied = await db.prepare("SELECT id FROM fanmark_transfer_codes WHERE license_id = ? AND status = 'applied' LIMIT 1")
      .bind(licenseId).first<{ id: string }>();
    if (stillApplied) throw new FanmarkTransferApiError("transfer_pending_approval", 400);
    throw new FanmarkTransferApiError("license_not_found", 404);
  }
  return json({
    success: true, transfer_code: transferCode, transfer_code_id: codeId,
    expires_at: expiresAt, fanmark_name: ownerLicense.display_fanmark ?? "",
    fanmark_short_id: ownerLicense.short_id,
  }, 200);
}

async function planLimit(db: D1Database, userId: string, now: string): Promise<{ current: number; limit: number }> {
  const settings = await db.prepare("SELECT plan_type FROM user_settings WHERE user_id = ? LIMIT 2")
    .bind(userId).all<{ plan_type: unknown }>();
  if (settings.results?.length !== 1) throw new FanmarkTransferApiError("user_settings_unavailable", 503);
  const plan = typeof settings.results[0].plan_type === "string" ? settings.results[0].plan_type : "free";
  const keyByPlan: Record<string, string> = {
    free: "free_fanmarks_limit", creator: "creator_fanmarks_limit", business: "business_fanmarks_limit",
    enterprise: "enterprise_fanmarks_limit", max: "max_fanmarks_limit", admin: "max_fanmarks_limit",
  };
  const defaults: Record<string, number> = { free: 3, creator: 10, business: 50, enterprise: 100, max: 500, admin: 500 };
  const settingKey = keyByPlan[plan] ?? keyByPlan.free;
  const setting = await db.prepare("SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 2")
    .bind(settingKey).all<{ setting_value: unknown }>();
  let limit = defaults[plan] ?? defaults.free;
  if (setting.results?.length === 1) {
    const configured = Number(setting.results[0].setting_value);
    if (!Number.isSafeInteger(configured) || configured < 0) throw new FanmarkTransferApiError("plan_limit_unavailable", 503);
    limit = configured;
  } else if ((setting.results?.length ?? 0) > 1) {
    throw new FanmarkTransferApiError("plan_limit_unavailable", 503);
  }
  const count = await db.prepare(`
    SELECT COUNT(*) AS count FROM fanmark_licenses
    WHERE user_id = ? AND status = 'active' AND (license_end IS NULL OR license_end > ?)
  `).bind(userId, now).first<{ count: unknown }>();
  const current = typeof count?.count === "number" && Number.isSafeInteger(count.count) ? count.count : 0;
  return { current, limit };
}

async function applyCode(db: D1Database, userId: string, body: JsonObject, now: Date): Promise<Response> {
  if (body.disclaimer_agreed !== true) throw new FanmarkTransferApiError("disclaimer_required", 400);
  if (typeof body.transfer_code !== "string") throw new FanmarkTransferApiError("transfer_code_is_required", 400);
  const transferCode = body.transfer_code.trim().toUpperCase();
  if (!CODE_PATTERN.test(transferCode)) throw new FanmarkTransferApiError("invalid_code", 404);
  const nowIso = timestamp(now);
  const code = await db.prepare(`
    SELECT c.id, c.license_id, c.fanmark_id, c.issuer_user_id, c.status, c.expires_at,
           l.status AS license_status, l.display_fanmark, f.short_id
    FROM fanmark_transfer_codes AS c
    JOIN fanmark_licenses AS l ON l.id = c.license_id
    JOIN fanmarks AS f ON f.id = c.fanmark_id
    WHERE c.transfer_code = ? LIMIT 2
  `).bind(transferCode).all<Record<string, unknown>>();
  const rows = code.results ?? [];
  if (rows.length !== 1) throw new FanmarkTransferApiError("invalid_code", 404);
  const row = rows[0];
  if (row.status !== "active") throw new FanmarkTransferApiError("code_not_active", 400, { status: row.status });
  if (typeof row.expires_at !== "string" || row.expires_at <= nowIso) {
    await db.prepare("UPDATE fanmark_transfer_codes SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'active'")
      .bind(nowIso, row.id).run();
    throw new FanmarkTransferApiError("code_expired", 400);
  }
  if (row.issuer_user_id === userId) throw new FanmarkTransferApiError("self_transfer_not_allowed", 400);
  if (row.license_status !== "active") throw new FanmarkTransferApiError("license_not_active", 400);

  const requester = await db.prepare("SELECT username, display_name FROM user_settings WHERE user_id = ? LIMIT 2")
    .bind(userId).all<{ username: unknown; display_name: unknown }>();
  if (requester.results?.length !== 1 || typeof requester.results[0].username !== "string") {
    throw new FanmarkTransferApiError("user_settings_unavailable", 503);
  }
  const plan = await planLimit(db, userId, nowIso);
  if (plan.current >= plan.limit) {
    throw new FanmarkTransferApiError("fanmark_limit_exceeded", 400, { current: plan.current, limit: plan.limit });
  }
  const requestId = crypto.randomUUID();
  const username = requester.results[0].username;
  const displayName = typeof requester.results[0].display_name === "string" ? requester.results[0].display_name : null;
  const results = await db.batch([
    db.prepare(`
      UPDATE fanmark_transfer_codes SET status = 'applied', updated_at = ?
      WHERE id = ? AND status = 'active' AND expires_at > ? AND issuer_user_id <> ?
        AND EXISTS (SELECT 1 FROM fanmark_licenses WHERE id = fanmark_transfer_codes.license_id AND status = 'active')
        AND (SELECT COUNT(*) FROM fanmark_licenses
             WHERE user_id = ? AND status = 'active' AND (license_end IS NULL OR license_end > ?)) < ?
    `).bind(nowIso, row.id, nowIso, userId, userId, nowIso, plan.limit),
    db.prepare(`
      INSERT INTO fanmark_transfer_requests
        (id, transfer_code_id, license_id, fanmark_id, requester_user_id, status,
         disclaimer_agreed_at, applied_at, created_at, updated_at, requester_username, requester_display_name)
      SELECT ?, c.id, c.license_id, c.fanmark_id, ?, 'pending', ?, ?, ?, ?, ?, ?
      FROM fanmark_transfer_codes AS c
      JOIN fanmark_licenses AS l ON l.id = c.license_id
      WHERE c.id = ? AND c.status = 'applied' AND l.status = 'active' AND changes() = 1
    `).bind(requestId, userId, nowIso, nowIso, nowIso, nowIso, username, displayName, row.id),
    db.prepare(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata, created_at)
      SELECT r.requester_user_id, 'TRANSFER_REQUESTED', 'fanmark_transfer_request', r.id,
             json_object('transfer_code_id', r.transfer_code_id, 'license_id', r.license_id,
                         'fanmark_id', r.fanmark_id, 'issuer_user_id', c.issuer_user_id), ?
      FROM fanmark_transfer_requests AS r JOIN fanmark_transfer_codes AS c ON c.id = r.transfer_code_id
      WHERE r.id = ? AND r.status = 'pending'
    `).bind(nowIso, requestId),
    db.prepare(`
      INSERT OR IGNORE INTO notification_events
        (event_type, event_version, source, payload, trigger_at, dedupe_key, status, created_at, updated_at)
      SELECT 'transfer_requested', 1, 'edge_function',
             json_object('user_id', c.issuer_user_id, 'fanmark_id', c.fanmark_id,
                         'fanmark_name', COALESCE(l.display_fanmark, ''),
                         'requester_user_id', r.requester_user_id,
                         'requester_name', COALESCE(NULLIF(r.requester_display_name, ''), r.requester_username),
                         'request_id', r.id),
             ?, 'transfer_requested_' || r.id, 'pending', ?, ?
      FROM fanmark_transfer_requests AS r
      JOIN fanmark_transfer_codes AS c ON c.id = r.transfer_code_id
      JOIN fanmark_licenses AS l ON l.id = r.license_id
      WHERE r.id = ? AND r.status = 'pending'
    `).bind(nowIso, nowIso, nowIso, requestId),
  ]);
  if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1) {
    throw new FanmarkTransferApiError("code_not_active", 409);
  }
  return json({ success: true, request_id: requestId, fanmark_name: row.display_fanmark ?? "", fanmark_short_id: row.short_id }, 200);
}

function roundUpToUtcMidnight(input: Date): Date {
  const result = new Date(input);
  result.setUTCHours(0, 0, 0, 0);
  if (result.getTime() < input.getTime()) result.setUTCDate(result.getUTCDate() + 1);
  return result;
}

async function approveRequest(
  db: D1Database,
  master: D1Database,
  userId: string,
  body: JsonObject,
  now: Date,
): Promise<Response> {
  const requestId = requiredUuid(body, "request_id");
  let transferredName: string | null = null;
  if (body.transferredFanmarkName !== undefined && body.transferredFanmarkName !== null) {
    if (typeof body.transferredFanmarkName !== "string" || body.transferredFanmarkName.length > 100) {
      throw new FanmarkTransferApiError("invalid_transferred_fanmark_name", 400);
    }
    transferredName = body.transferredFanmarkName.trim() || null;
  }
  const request = await db.prepare(`
    SELECT r.id, r.transfer_code_id, r.license_id, r.fanmark_id, r.requester_user_id, r.status,
           c.issuer_user_id, c.status AS code_status, c.expires_at,
           l.user_id AS old_owner_id, l.status AS license_status, l.license_end,
           l.display_fanmark, f.normalized_emoji, f.tier_level, f.short_id
    FROM fanmark_transfer_requests AS r
    JOIN fanmark_transfer_codes AS c ON c.id = r.transfer_code_id
    JOIN fanmark_licenses AS l ON l.id = r.license_id
    JOIN fanmarks AS f ON f.id = r.fanmark_id
    WHERE r.id = ? LIMIT 2
  `).bind(requestId).all<Record<string, unknown>>();
  const rows = request.results ?? [];
  if (rows.length !== 1) throw new FanmarkTransferApiError("request_not_found", 404);
  const transfer = rows[0];
  if (transfer.issuer_user_id !== userId || transfer.old_owner_id !== userId) {
    throw new FanmarkTransferApiError("not_authorized", 403);
  }
  if (transfer.status !== "pending") {
    throw new FanmarkTransferApiError("request_not_pending", 400, { status: transfer.status });
  }
  if (transfer.code_status !== "applied") throw new FanmarkTransferApiError("code_not_active", 409);
  if (transfer.license_status !== "active") {
    const nowIso = timestamp(now);
    await db.batch([
      db.prepare("UPDATE fanmark_transfer_requests SET status = 'cancelled', resolved_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
        .bind(nowIso, nowIso, requestId),
      db.prepare("UPDATE fanmark_transfer_codes SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'applied'")
        .bind(nowIso, transfer.transfer_code_id),
    ]);
    throw new FanmarkTransferApiError("license_no_longer_active", 409);
  }
  if (typeof transfer.tier_level !== "number" || typeof transfer.fanmark_id !== "string" ||
      typeof transfer.requester_user_id !== "string" || typeof transfer.license_id !== "string" ||
      typeof transfer.transfer_code_id !== "string" || typeof transfer.short_id !== "string") {
    throw new FanmarkTransferApiError("transfer_unavailable", 503);
  }
  const tier = await master.prepare("SELECT initial_license_days FROM fanmark_tiers WHERE tier_level = ? LIMIT 2")
    .bind(transfer.tier_level).all<{ initial_license_days: unknown }>();
  if (tier.results?.length !== 1) throw new FanmarkTransferApiError("fanmark_tier_unavailable", 503);
  const days = tier.results[0].initial_license_days;
  if (days !== null && (typeof days !== "number" || !Number.isSafeInteger(days) || days < 0)) {
    throw new FanmarkTransferApiError("fanmark_tier_unavailable", 503);
  }
  let newEnd: string | null = null;
  if (typeof days === "number") {
    const end = new Date(now);
    end.setUTCDate(end.getUTCDate() + days);
    newEnd = roundUpToUtcMidnight(end).toISOString();
  }
  const nowIso = timestamp(now);
  const lockUntil = timestamp(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000));
  const newLicenseId = crypto.randomUUID();
  const canonicalDisplay = typeof transfer.normalized_emoji === "string" ? transfer.normalized_emoji : null;
  await db.batch([
    db.prepare(`
      UPDATE fanmark_licenses
      SET status = 'expired', is_returned = 1, license_end = ?, excluded_at = ?, updated_at = ?
      WHERE id = ? AND status = 'active' AND user_id = ?
        AND EXISTS (
          SELECT 1 FROM fanmark_transfer_requests AS r
          JOIN fanmark_transfer_codes AS c ON c.id = r.transfer_code_id
          WHERE r.id = ? AND r.status = 'pending' AND c.status = 'applied'
            AND c.issuer_user_id = ? AND r.license_id = fanmark_licenses.id
        )
    `).bind(nowIso, nowIso, nowIso, transfer.license_id, userId, requestId, userId),
    db.prepare(`
      INSERT INTO fanmark_licenses
        (id, fanmark_id, user_id, license_start, license_end, display_fanmark, status,
         is_initial_license, is_transferred, transfer_locked_until, created_at, updated_at)
      SELECT ?, l.fanmark_id, ?, ?, ?, ?, 'active', 0, 1, ?, ?, ?
      FROM fanmark_licenses AS l
      WHERE l.id = ? AND l.status = 'expired' AND changes() = 1
    `).bind(newLicenseId, transfer.requester_user_id, nowIso, newEnd, canonicalDisplay,
      lockUntil, nowIso, nowIso, transfer.license_id),
    db.prepare("DELETE FROM fanmark_basic_configs WHERE license_id = ? AND EXISTS (SELECT 1 FROM fanmark_licenses WHERE id = ?)")
      .bind(transfer.license_id, newLicenseId),
    db.prepare("DELETE FROM fanmark_redirect_configs WHERE license_id = ? AND EXISTS (SELECT 1 FROM fanmark_licenses WHERE id = ?)")
      .bind(transfer.license_id, newLicenseId),
    db.prepare("DELETE FROM fanmark_messageboard_configs WHERE license_id = ? AND EXISTS (SELECT 1 FROM fanmark_licenses WHERE id = ?)")
      .bind(transfer.license_id, newLicenseId),
    db.prepare("DELETE FROM fanmark_password_configs WHERE license_id = ? AND EXISTS (SELECT 1 FROM fanmark_licenses WHERE id = ?)")
      .bind(transfer.license_id, newLicenseId),
    db.prepare("DELETE FROM fanmark_profiles WHERE license_id = ? AND EXISTS (SELECT 1 FROM fanmark_licenses WHERE id = ?)")
      .bind(transfer.license_id, newLicenseId),
    db.prepare(`
      INSERT INTO fanmark_basic_configs (license_id, fanmark_name, access_type, created_at, updated_at)
      SELECT ?, ?, 'inactive', ?, ? FROM fanmark_licenses WHERE id = ?
    `).bind(newLicenseId, transferredName, nowIso, nowIso, newLicenseId),
    db.prepare("UPDATE fanmark_transfer_codes SET status = 'completed', updated_at = ? WHERE id = ? AND status = 'applied' AND EXISTS (SELECT 1 FROM fanmark_licenses WHERE id = ?)")
      .bind(nowIso, transfer.transfer_code_id, newLicenseId),
    db.prepare("UPDATE fanmark_transfer_requests SET status = 'approved', resolved_at = ?, updated_at = ? WHERE id = ? AND status = 'pending' AND EXISTS (SELECT 1 FROM fanmark_licenses WHERE id = ?)")
      .bind(nowIso, nowIso, requestId, newLicenseId),
    db.prepare(`
      UPDATE fanmark_lottery_entries
      SET entry_status = 'cancelled', cancelled_at = ?, cancellation_reason = 'system', updated_at = ?
      WHERE license_id = ? AND entry_status = 'pending'
        AND EXISTS (SELECT 1 FROM fanmark_transfer_requests WHERE id = ? AND status = 'approved')
    `).bind(nowIso, nowIso, transfer.license_id, requestId),
    db.prepare(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata, created_at)
      SELECT ?, 'LICENSE_TRANSFERRED', 'fanmark_license', ?, json_object(
        'old_license_id', ?, 'new_license_id', ?, 'from_user_id', ?, 'to_user_id', ?,
        'fanmark_id', ?, 'fanmark_name', ?, 'tier_level', ?, 'new_license_end', ?, 'request_id', ?
      ), ?
      WHERE EXISTS (SELECT 1 FROM fanmark_transfer_requests WHERE id = ? AND status = 'approved')
    `).bind(userId, newLicenseId, transfer.license_id, newLicenseId, userId, transfer.requester_user_id,
      transfer.fanmark_id, canonicalDisplay, transfer.tier_level, newEnd, requestId, nowIso, requestId),
    db.prepare(`
      INSERT OR IGNORE INTO notification_events
        (event_type, event_version, source, payload, trigger_at, dedupe_key, status, created_at, updated_at)
      SELECT 'transfer_approved', 1, 'edge_function',
             json_object('user_id', ?, 'fanmark_id', ?, 'fanmark_name', ?,
                         'fanmark_short_id', ?, 'license_id', ?, 'license_end', ?),
             ?, 'transfer_approved_' || ?, 'pending', ?, ?
      WHERE EXISTS (SELECT 1 FROM fanmark_transfer_requests WHERE id = ? AND status = 'approved')
    `).bind(transfer.requester_user_id, transfer.fanmark_id, canonicalDisplay, transfer.short_id,
      newLicenseId, newEnd, nowIso, requestId, nowIso, nowIso, requestId),
  ]);
  const finalized = await db.prepare(`
    SELECT CASE WHEN
      EXISTS (SELECT 1 FROM fanmark_transfer_requests
              WHERE id = ? AND transfer_code_id = ? AND status = 'approved')
      AND EXISTS (SELECT 1 FROM fanmark_transfer_codes
                  WHERE id = ? AND status = 'completed')
      AND EXISTS (SELECT 1 FROM fanmark_licenses
                  WHERE id = ? AND fanmark_id = ? AND user_id = ? AND status = 'active' AND is_transferred = 1)
      AND EXISTS (SELECT 1 FROM fanmark_licenses
                  WHERE id = ? AND fanmark_id = ? AND user_id = ? AND status = 'expired' AND is_returned = 1)
      THEN 1 ELSE 0 END AS completed
  `).bind(requestId, transfer.transfer_code_id, transfer.transfer_code_id, newLicenseId,
    transfer.fanmark_id, transfer.requester_user_id, transfer.license_id, transfer.fanmark_id, userId)
    .first<{ completed: number }>();
  if (finalized?.completed !== 1) {
    throw new FanmarkTransferApiError("request_not_pending", 409);
  }
  return json({ success: true, new_license_id: newLicenseId, new_license_end: newEnd, fanmark_name: canonicalDisplay }, 200);
}

async function rejectRequest(db: D1Database, userId: string, body: JsonObject, now: Date): Promise<Response> {
  const requestId = requiredUuid(body, "request_id");
  let reason: string | null = null;
  if (body.reason !== undefined && body.reason !== null) {
    if (typeof body.reason !== "string" || body.reason.length > 500) {
      throw new FanmarkTransferApiError("invalid_reason", 400);
    }
    reason = body.reason.trim() || null;
  }
  const request = await db.prepare(`
    SELECT r.id, r.transfer_code_id, r.status, c.issuer_user_id, r.requester_user_id,
           r.license_id, r.fanmark_id, l.display_fanmark, f.short_id
    FROM fanmark_transfer_requests AS r
    JOIN fanmark_transfer_codes AS c ON c.id = r.transfer_code_id
    JOIN fanmark_licenses AS l ON l.id = r.license_id
    JOIN fanmarks AS f ON f.id = r.fanmark_id
    WHERE r.id = ? LIMIT 2
  `).bind(requestId).all<Record<string, unknown>>();
  const rows = request.results ?? [];
  if (rows.length !== 1) throw new FanmarkTransferApiError("request_not_found", 404);
  const row = rows[0];
  if (row.issuer_user_id !== userId) throw new FanmarkTransferApiError("not_authorized", 403);
  if (row.status !== "pending") throw new FanmarkTransferApiError("request_not_pending", 400, { status: row.status });
  const nowIso = timestamp(now);
  const results = await db.batch([
    db.prepare(`
      UPDATE fanmark_transfer_requests SET status = 'rejected', resolved_at = ?, updated_at = ?, rejection_reason = ?
      WHERE id = ? AND status = 'pending'
        AND EXISTS (SELECT 1 FROM fanmark_transfer_codes WHERE id = fanmark_transfer_requests.transfer_code_id AND issuer_user_id = ?)
    `).bind(nowIso, nowIso, reason, requestId, userId),
    db.prepare(`
      UPDATE fanmark_transfer_codes SET status = 'active', updated_at = ?
      WHERE id = ? AND status = 'applied'
        AND EXISTS (SELECT 1 FROM fanmark_transfer_requests WHERE id = ? AND status = 'rejected')
    `).bind(nowIso, row.transfer_code_id, requestId),
    db.prepare(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata, created_at)
      SELECT ?, 'TRANSFER_REJECTED', 'fanmark_transfer_request', ?, json_object(
        'transfer_code_id', ?, 'license_id', ?, 'fanmark_id', ?, 'requester_user_id', ?, 'reason', ?
      ), ? WHERE EXISTS (SELECT 1 FROM fanmark_transfer_requests WHERE id = ? AND status = 'rejected')
    `).bind(userId, requestId, row.transfer_code_id, row.license_id, row.fanmark_id,
      row.requester_user_id, reason, nowIso, requestId),
    db.prepare(`
      INSERT OR IGNORE INTO notification_events
        (event_type, event_version, source, payload, trigger_at, dedupe_key, status, created_at, updated_at)
      SELECT 'transfer_rejected', 1, 'edge_function',
             json_object('user_id', ?, 'fanmark_id', ?, 'fanmark_name', ?,
                         'fanmark_short_id', ?, 'reason', ?),
             ?, 'transfer_rejected_' || ?, 'pending', ?, ?
      WHERE EXISTS (SELECT 1 FROM fanmark_transfer_requests WHERE id = ? AND status = 'rejected')
    `).bind(row.requester_user_id, row.fanmark_id, row.display_fanmark ?? "", row.short_id, reason,
      nowIso, requestId, nowIso, nowIso, requestId),
  ]);
  if (results[0]?.meta?.changes !== 1) throw new FanmarkTransferApiError("request_not_pending", 409);
  return json({ success: true, message: "Transfer request rejected" }, 200);
}

async function cancelCode(db: D1Database, userId: string, body: JsonObject, now: Date): Promise<Response> {
  const codeId = requiredUuid(body, "transfer_code_id");
  const code = await db.prepare("SELECT id, license_id, fanmark_id, issuer_user_id, status FROM fanmark_transfer_codes WHERE id = ? LIMIT 2")
    .bind(codeId).all<Record<string, unknown>>();
  const rows = code.results ?? [];
  if (rows.length !== 1) throw new FanmarkTransferApiError("code_not_found", 404);
  const row = rows[0];
  if (row.issuer_user_id !== userId) throw new FanmarkTransferApiError("not_authorized", 403);
  if (row.status !== "active") throw new FanmarkTransferApiError("code_not_active", 400, { status: row.status });
  const nowIso = timestamp(now);
  const results = await db.batch([
    db.prepare("UPDATE fanmark_transfer_codes SET status = 'cancelled', updated_at = ? WHERE id = ? AND issuer_user_id = ? AND status = 'active'")
      .bind(nowIso, codeId, userId),
    db.prepare(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata, created_at)
      SELECT ?, 'TRANSFER_CODE_CANCELLED', 'fanmark_transfer_code', ?, json_object('license_id', ?, 'fanmark_id', ?), ?
      WHERE EXISTS (SELECT 1 FROM fanmark_transfer_codes WHERE id = ? AND status = 'cancelled')
    `).bind(userId, codeId, row.license_id, row.fanmark_id, nowIso, codeId),
  ]);
  if (results[0]?.meta?.changes !== 1) throw new FanmarkTransferApiError("code_not_active", 409);
  return json({ success: true, message: "Transfer code cancelled" }, 200);
}

export function isFanmarkTransferPath(pathname: string): boolean {
  return pathname === PREFIX || pathname.startsWith(PREFIX + "/");
}

export async function handleFanmarkTransferRequest(
  request: Request,
  env: Env,
  resolveAuth: StorageAuthResolver,
  clock: () => Date = () => new Date(),
): Promise<Response> {
  const headers = originHeaders(request, env);
  if (!headers) return json({ error: "forbidden_origin" }, 403);
  const path = new URL(request.url).pathname;
  if (request.method === "OPTIONS") {
    const requestedMethod = request.headers.get("access-control-request-method")?.toUpperCase();
    if (requestedMethod && !METHODS.split(", ").includes(requestedMethod)) {
      headers.set("allow", METHODS);
      return json({ error: "method_not_allowed" }, 405, headers);
    }
    headers.set("allow", METHODS);
    return new Response(null, { status: 204, headers });
  }
  const isList = path === PREFIX;
  if ((isList && request.method !== "GET") || (!isList && request.method !== "POST")) {
    headers.set("allow", METHODS);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  try {
    const db = database(env);
    let auth: Awaited<ReturnType<StorageAuthResolver>>;
    try {
      auth = await resolveAuth(request, env);
    } catch {
      throw new FanmarkTransferApiError("auth_unavailable", 503);
    }
    if (!auth.available) throw new FanmarkTransferApiError("auth_unavailable", 503);
    if (!auth.userId) throw new FanmarkTransferApiError("unauthorized", 401);
    if (isList) return withHeaders(await listTransfers(db, auth.userId), headers);
    const body = await readBody(request);
    const now = clock();
    if (path === PREFIX + "/issue") return withHeaders(await issueCode(db, auth.userId, body, now), headers);
    if (path === PREFIX + "/apply") return withHeaders(await applyCode(db, auth.userId, body, now), headers);
    if (path === PREFIX + "/cancel") return withHeaders(await cancelCode(db, auth.userId, body, now), headers);
    if (path === PREFIX + "/reject") return withHeaders(await rejectRequest(db, auth.userId, body, now), headers);
    if (path === PREFIX + "/approve") {
      const master = selectD1Database(env, "master");
      if (!master) throw new FanmarkTransferApiError("server_misconfigured", 500);
      return withHeaders(await approveRequest(db, master, auth.userId, body, now), headers);
    }
    return json({ error: "not_found" }, 404, headers);
  } catch (error) {
    if (error instanceof FanmarkTransferApiError) {
      return json({ error: error.code, ...error.details }, error.status, headers);
    }
    return json({ error: "internal_error" }, 500, headers);
  }
}
