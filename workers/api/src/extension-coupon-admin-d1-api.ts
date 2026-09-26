import { selectD1Database, type Env } from "./repository.ts";

const API_PATH = "/api/admin/extension-coupons";
const MAX_BODY_BYTES = 8 * 1024;
const MAX_COUPONS = 500;
const MAX_USAGES = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CODE = /^[A-Z0-9][A-Z0-9_-]{2,63}$/u;
const MONTHS = new Set([1, 2, 3, 6]);
const GENERATED_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface ExtensionCouponAdminAuthorizer {
  (request: Request, responseHeaders: Headers): Promise<{ userId: string; sessionId: string } | Response>;
}

export interface ExtensionCouponAdminDto {
  id: string;
  code: string;
  months: number;
  allowed_tier_levels: number[] | null;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExtensionCouponUsageAdminDto {
  id: string;
  coupon_id: string;
  user_id: string;
  fanmark_id: string;
  license_id: string;
  used_at: string;
  fanmark_emoji: string;
  user_display_name: string;
}

export class ExtensionCouponAdminD1Error extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 503) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "ExtensionCouponAdminD1Error";
  }
}

function fail(code: string, status = 503): never {
  throw new ExtensionCouponAdminD1Error(code, status);
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
  headers.set("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return true;
}

function database(env: Env): D1Database {
  if (env.EXTENSION_COUPON_ADMIN_BACKEND?.trim() !== "d1" || env.D1_TOPOLOGY?.trim() !== "split") {
    fail("extension_coupon_admin_unavailable", env.EXTENSION_COUPON_ADMIN_BACKEND ? 500 : 503);
  }
  const selected = selectD1Database(env, "business");
  if (!selected) fail("extension_coupon_admin_unavailable", 500);
  return selected;
}

function parseTiers(value: unknown, invalidStatus = 503): number[] | null {
  if (value === null || value === undefined || value === "") return null;
  let tiers: unknown = value;
  if (typeof tiers === "string") {
    try { tiers = JSON.parse(tiers) as unknown; }
    catch { fail(invalidStatus === 400 ? "invalid_request" : "extension_coupon_admin_unavailable", invalidStatus); }
  }
  if (!Array.isArray(tiers) || tiers.length > 32 ||
      tiers.some((tier) => !Number.isSafeInteger(tier) || Number(tier) < 1 || Number(tier) > 32767) ||
      new Set(tiers).size !== tiers.length) {
    fail(invalidStatus === 400 ? "invalid_request" : "extension_coupon_admin_unavailable", invalidStatus);
  }
  return tiers as number[];
}

function parseCoupon(value: Record<string, unknown>): ExtensionCouponAdminDto {
  const tiers = parseTiers(value.allowed_tier_levels);
  if (typeof value.id !== "string" || !UUID.test(value.id) || typeof value.code !== "string" || !CODE.test(value.code) ||
      !Number.isSafeInteger(value.months) || !MONTHS.has(Number(value.months)) ||
      !Number.isSafeInteger(value.max_uses) || Number(value.max_uses) < 1 ||
      !Number.isSafeInteger(value.used_count) || Number(value.used_count) < 0 || Number(value.used_count) > Number(value.max_uses) ||
      (value.expires_at !== null && typeof value.expires_at !== "string") ||
      (value.created_by !== null && typeof value.created_by !== "string") ||
      typeof value.is_active !== "number" || ![0, 1].includes(value.is_active) ||
      typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at)) ||
      typeof value.updated_at !== "string" || !Number.isFinite(Date.parse(value.updated_at))) {
    fail("extension_coupon_admin_unavailable");
  }
  return {
    id: value.id,
    code: value.code,
    months: Number(value.months),
    allowed_tier_levels: tiers,
    max_uses: Number(value.max_uses),
    used_count: Number(value.used_count),
    expires_at: value.expires_at as string | null,
    is_active: value.is_active === 1,
    created_by: value.created_by as string | null,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

async function readBody(request: Request): Promise<unknown> {
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
      if (size > MAX_BODY_BYTES) { await reader.cancel(); fail("request_too_large", 413); }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ExtensionCouponAdminD1Error) throw error;
    fail("invalid_request", 400);
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { fail("invalid_request", 400); }
}

function parseCreate(value: unknown): {
  code: string | null;
  months: number;
  tiers: number[] | null;
  maxUses: number;
  expiresAt: string | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_request", 400);
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.length !== 5 || keys.some((key) => !["code", "months", "allowed_tier_levels", "max_uses", "expires_at"].includes(key)) ||
      !(body.code === null || (typeof body.code === "string" && CODE.test(body.code.trim().toUpperCase()))) ||
      !Number.isSafeInteger(body.months) || !MONTHS.has(Number(body.months)) ||
      !Number.isSafeInteger(body.max_uses) || Number(body.max_uses) < 1 || Number(body.max_uses) > 2_147_483_647 ||
      !(body.expires_at === null || (typeof body.expires_at === "string" && body.expires_at.length <= 64 && Number.isFinite(Date.parse(body.expires_at))))) {
    fail("invalid_request", 400);
  }
  return {
    code: body.code === null ? null : (body.code as string).trim().toUpperCase(),
    months: Number(body.months),
    tiers: parseTiers(body.allowed_tier_levels, 400),
    maxUses: Number(body.max_uses),
    expiresAt: body.expires_at as string | null,
  };
}

function parsePatch(value: unknown): { isActive: boolean; expectedUpdatedAt: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_request", 400);
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 2 || Object.keys(body).some((key) => !["is_active", "expected_updated_at"].includes(key)) ||
      typeof body.is_active !== "boolean" || typeof body.expected_updated_at !== "string" ||
      body.expected_updated_at.length > 64 || !Number.isFinite(Date.parse(body.expected_updated_at))) {
    fail("invalid_request", 400);
  }
  return { isActive: body.is_active, expectedUpdatedAt: body.expected_updated_at };
}

function generatedCode(): string {
  return `EXT${Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => GENERATED_CHARS[byte & 31]).join("")}`;
}

export function isExtensionCouponAdminPath(pathname: string): boolean {
  return pathname === API_PATH || pathname.startsWith(`${API_PATH}/`);
}

export async function handleExtensionCouponAdminRequest(
  request: Request,
  env: Env,
  authorizeAdmin: ExtensionCouponAdminAuthorizer,
  dependencies: { createId?: () => string; createCode?: () => string; now?: () => Date } = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isExtensionCouponAdminPath(url.pathname)) return null;
  if (url.search || url.hash) return json({ error: "not_found" }, 404);
  const headers = new Headers();
  if (!cors(request, env, headers)) return json({ error: "forbidden_origin" }, 403);
  const isCollection = url.pathname === API_PATH;
  const suffix = isCollection ? "" : url.pathname.slice(`${API_PATH}/`.length);
  const usageRoute = /^([0-9a-f-]+)\/usages$/iu.exec(suffix);
  const id = isCollection ? null : usageRoute?.[1] ?? suffix;
  if (id && !UUID.test(id)) return json({ error: "not_found" }, 404, headers);
  const method = request.method.toUpperCase();
  const allowed = isCollection ? "GET, POST, OPTIONS" : usageRoute ? "GET, OPTIONS" : "PATCH, DELETE, OPTIONS";
  if (method === "OPTIONS") { headers.set("allow", allowed); return new Response(null, { status: 204, headers }); }
  const methods = isCollection ? ["GET", "POST"] : usageRoute ? ["GET"] : ["PATCH", "DELETE"];
  if (!methods.includes(method)) { headers.set("allow", allowed); return json({ error: "method_not_allowed" }, 405, headers); }
  if (env.AUTH_BACKEND?.trim() !== "better-auth") return json({ error: "auth_unavailable" }, 503, headers);
  const authorization = await authorizeAdmin(request, headers);
  if (authorization instanceof Response) return authorization;

  try {
    const db = database(env);
    if (isCollection && method === "GET") {
      const result = await db.prepare(`
        SELECT id, code, months, allowed_tier_levels, max_uses, used_count, expires_at,
          is_active, created_by, created_at, updated_at
        FROM extension_coupons ORDER BY created_at DESC, id ASC LIMIT ?
      `).bind(MAX_COUPONS + 1).all<Record<string, unknown>>();
      if (!result.success || !Array.isArray(result.results) || result.results.length > MAX_COUPONS) fail("extension_coupon_admin_unavailable");
      return json({ schemaVersion: 1, coupons: result.results.map(parseCoupon) }, 200, headers);
    }
    if (usageRoute && method === "GET") {
      const result = await db.prepare(`
        SELECT u.id, u.coupon_id, u.user_id, u.fanmark_id, u.license_id, u.used_at,
          COALESCE(l.display_fanmark, '') AS fanmark_emoji,
          COALESCE(NULLIF(s.display_name, ''), s.username, '') AS user_display_name
        FROM extension_coupon_usages u
        LEFT JOIN fanmark_licenses l ON l.id = u.license_id
        LEFT JOIN user_settings s ON s.user_id = u.user_id
        WHERE u.coupon_id = ? ORDER BY u.used_at DESC, u.id ASC LIMIT ?
      `).bind(id, MAX_USAGES + 1).all<Record<string, unknown>>();
      if (!result.success || !Array.isArray(result.results) || result.results.length > MAX_USAGES) fail("extension_coupon_usage_list_too_large", 413);
      const usages = result.results.map((row) => {
        if (typeof row.id !== "string" || !UUID.test(row.id) || row.coupon_id !== id ||
            typeof row.user_id !== "string" || !UUID.test(row.user_id) ||
            typeof row.fanmark_id !== "string" || !UUID.test(row.fanmark_id) ||
            typeof row.license_id !== "string" || !UUID.test(row.license_id) ||
            typeof row.used_at !== "string" || !Number.isFinite(Date.parse(row.used_at)) ||
            typeof row.fanmark_emoji !== "string" || typeof row.user_display_name !== "string") {
          fail("extension_coupon_admin_unavailable");
        }
        return row as unknown as ExtensionCouponUsageAdminDto;
      });
      return json({ schemaVersion: 1, usages }, 200, headers);
    }

    const now = (dependencies.now?.() ?? new Date()).toISOString();
    if (isCollection && method === "POST") {
      const create = parseCreate(await readBody(request));
      let code = create.code;
      for (let attempt = 0; code === null && attempt < 8; attempt += 1) {
        const candidate = (dependencies.createCode?.() ?? generatedCode()).toUpperCase();
        if (!CODE.test(candidate)) fail("extension_coupon_admin_unavailable");
        const exists = await db.prepare("SELECT 1 AS found FROM extension_coupons WHERE code = ? LIMIT 1").bind(candidate).first();
        if (!exists) code = candidate;
      }
      if (code === null) fail("extension_coupon_code_generation_failed", 503);
      const id = (dependencies.createId?.() ?? crypto.randomUUID()).toLowerCase();
      if (!UUID.test(id)) fail("extension_coupon_admin_unavailable");
      const result = await db.prepare(`
        INSERT INTO extension_coupons (
          id, code, months, allowed_tier_levels, max_uses, used_count,
          expires_at, is_active, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, 1, ?, ?, ?)
      `).bind(id, code, create.months, create.tiers === null || create.tiers.length === 0 ? null : JSON.stringify(create.tiers),
        create.maxUses, create.expiresAt, authorization.userId, now, now).run();
      if (!result.success || result.meta?.changes !== 1) fail("extension_coupon_admin_unavailable");
      const row = await db.prepare(`
        SELECT id, code, months, allowed_tier_levels, max_uses, used_count, expires_at,
          is_active, created_by, created_at, updated_at FROM extension_coupons WHERE id = ? LIMIT 1
      `).bind(id).first<Record<string, unknown>>();
      if (!row) fail("extension_coupon_admin_unavailable");
      return json({ schemaVersion: 1, coupon: parseCoupon(row) }, 201, headers);
    }

    if (id && method === "PATCH") {
      const patch = parsePatch(await readBody(request));
      const result = await db.prepare(`
        UPDATE extension_coupons SET is_active = ?,
          updated_at = CASE
            WHEN julianday(updated_at) >= julianday(?)
              THEN strftime('%Y-%m-%dT%H:%M:%fZ', julianday(updated_at) + 0.000000011574074)
            ELSE ?
          END
        WHERE id = ? AND updated_at = ?
      `).bind(patch.isActive ? 1 : 0, now, now, id, patch.expectedUpdatedAt).run();
      if (!result.success) fail("extension_coupon_admin_unavailable");
      if (result.meta?.changes !== 1) {
        const exists = await db.prepare("SELECT id FROM extension_coupons WHERE id = ? LIMIT 1").bind(id).first();
        return json({ error: exists ? "stale_revision" : "not_found" }, exists ? 409 : 404, headers);
      }
      const row = await db.prepare(`
        SELECT id, code, months, allowed_tier_levels, max_uses, used_count, expires_at,
          is_active, created_by, created_at, updated_at FROM extension_coupons WHERE id = ? LIMIT 1
      `).bind(id).first<Record<string, unknown>>();
      if (!row) fail("extension_coupon_admin_unavailable");
      return json({ schemaVersion: 1, coupon: parseCoupon(row) }, 200, headers);
    }

    if (id && method === "DELETE") {
      const result = await db.prepare(`
        DELETE FROM extension_coupons
        WHERE id = ? AND used_count = 0
          AND NOT EXISTS (SELECT 1 FROM extension_coupon_usages WHERE coupon_id = extension_coupons.id)
          AND NOT EXISTS (SELECT 1 FROM extension_coupon_application_commands WHERE coupon_id = extension_coupons.id)
      `).bind(id).run();
      if (!result.success) fail("extension_coupon_admin_unavailable");
      if (result.meta?.changes !== 1) {
        const existing = await db.prepare("SELECT used_count FROM extension_coupons WHERE id = ? LIMIT 1").bind(id).first<{ used_count: number }>();
        if (!existing) return json({ error: "not_found" }, 404, headers);
        return json({ error: "coupon_in_use" }, 409, headers);
      }
      return json({ schemaVersion: 1, deleted: true }, 200, headers);
    }
    return json({ error: "not_found" }, 404, headers);
  } catch (error) {
    if (error instanceof ExtensionCouponAdminD1Error) return json({ error: error.code }, error.status, headers);
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint|foreign key/iu.test(message)) return json({ error: "extension_coupon_conflict" }, 409, headers);
    return json({ error: "extension_coupon_admin_unavailable" }, 503, headers);
  }
}
