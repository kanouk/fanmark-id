import { selectD1Database, type Env } from "./repository.ts";

const APPLY_PATH = "/api/me/licenses/extend-with-coupon";
const METHODS = "POST, OPTIONS";
const MAX_BODY_BYTES = 4 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COUPON_CODE = /^[A-Z0-9][A-Z0-9_-]{2,63}$/u;
const ALLOWED_MONTHS = new Set([1, 2, 3, 6]);

interface CouponRow {
  id: string;
  code: string;
  months: number;
  allowed_tier_levels: string | null;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  is_active: number;
}

interface LicenseRow {
  id: string;
  fanmark_id: string;
  user_id: string;
  status: string;
  license_end: string | null;
  grace_expires_at: string | null;
  is_returned: number;
  is_transferred: number;
  transfer_locked_until: string | null;
  display_fanmark: string | null;
  tier_level: number;
}

interface CommandRow {
  id: string;
  request_id: string;
  user_id: string;
  license_id: string;
  coupon_code: string;
  months: number;
  tier_level: number;
  new_license_end: string;
  cancelled_lottery_entries: number;
  status: string;
}

interface GracePlanSnapshot {
  planType: string;
  limitKey: string | null;
  settingValue: string | null;
  limit: number | null;
}

export class ExtensionCouponApplicationD1Error extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "ExtensionCouponApplicationD1Error";
  }
}

export interface ExtensionCouponApplicationD1Dependencies {
  resolveUser(request: Request): Promise<string | null>;
  createId?(): string;
  now?(): Date;
}

export function isExtensionCouponApplicationPath(pathname: string): boolean {
  return pathname === APPLY_PATH;
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function corsHeaders(request: Request, env: Env): Headers | null {
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

async function readRequest(request: Request): Promise<{
  licenseId: string;
  couponCode: string;
  requestId: string;
}> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new ExtensionCouponApplicationD1Error("json_content_type_required", 415);
  }
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new ExtensionCouponApplicationD1Error("request_too_large", 413);
  }
  if (!request.body) throw new ExtensionCouponApplicationD1Error("invalid_request", 400);
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
        throw new ExtensionCouponApplicationD1Error("request_too_large", 413);
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
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ExtensionCouponApplicationD1Error("invalid_json", 400);
  }
  if (!isRecord(body) || Object.keys(body).length !== 3 ||
      Object.keys(body).some((key) => !["license_id", "coupon_code", "request_id"].includes(key)) ||
      typeof body.license_id !== "string" || !UUID.test(body.license_id) ||
      typeof body.request_id !== "string" || !UUID.test(body.request_id) ||
      typeof body.coupon_code !== "string") {
    throw new ExtensionCouponApplicationD1Error("invalid_request", 400);
  }
  const couponCode = body.coupon_code.trim().toUpperCase();
  if (!COUPON_CODE.test(couponCode)) throw new ExtensionCouponApplicationD1Error("invalid_coupon_code", 400);
  return {
    licenseId: body.license_id.toLowerCase(),
    couponCode,
    requestId: body.request_id.toLowerCase(),
  };
}

function addMonthsClamped(base: Date, months: number): Date {
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    Math.min(base.getUTCDate(), lastDay),
    base.getUTCHours(),
    base.getUTCMinutes(),
    base.getUTCSeconds(),
    base.getUTCMilliseconds(),
  ));
}

function roundUpToUtcMidnight(value: Date): Date {
  if (value.getUTCHours() === 0 && value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0) return value;
  const next = new Date(value);
  next.setUTCHours(0, 0, 0, 0);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function mapSqlError(error: unknown): ExtensionCouponApplicationD1Error | null {
  const message = error instanceof Error ? error.message : String(error);
  const statusByCode: Record<string, number> = {
    coupon_not_found: 404,
    coupon_expired: 400,
    coupon_usage_exceeded: 400,
    invalid_coupon_configuration: 400,
    tier_not_allowed: 400,
    coupon_already_used_on_fanmark: 400,
    perpetual_license: 400,
    transfer_in_progress: 400,
    fanmark_limit_exceeded: 400,
    plan_limit_changed: 409,
    invalid_plan_limit_snapshot: 503,
    no_eligible_license: 404,
  };
  for (const [code, status] of Object.entries(statusByCode)) {
    if (message.includes(code)) return new ExtensionCouponApplicationD1Error(code, status);
  }
  return null;
}

function responseFromCommand(command: CommandRow): Response {
  if (command.status !== "completed" || !UUID.test(command.id) || !UUID.test(command.license_id) ||
      !Number.isSafeInteger(command.months) || !ALLOWED_MONTHS.has(command.months) ||
      !Number.isSafeInteger(command.tier_level) || !Number.isSafeInteger(command.cancelled_lottery_entries) ||
      command.cancelled_lottery_entries < 0 || !Number.isFinite(Date.parse(command.new_license_end))) {
    throw new ExtensionCouponApplicationD1Error("coupon_application_state_unavailable", 503);
  }
  return json({
    success: true,
    license: {
      id: command.license_id,
      license_end: command.new_license_end,
      grace_expires_at: null,
      status: "active",
    },
    months: command.months,
    tier_level: command.tier_level,
    cancelled_lottery_entries: command.cancelled_lottery_entries,
  }, 200);
}

async function readCommand(
  database: D1Database,
  userId: string,
  requestId: string,
): Promise<CommandRow | null> {
  const result = await database.prepare(`
    SELECT id, request_id, user_id, license_id, coupon_code, months, tier_level,
      new_license_end, cancelled_lottery_entries, status
    FROM extension_coupon_application_commands
    WHERE user_id = ? AND request_id = ?
    LIMIT 2
  `).bind(userId, requestId).all<CommandRow>();
  const rows = result.results ?? [];
  if (rows.length > 1) throw new ExtensionCouponApplicationD1Error("coupon_application_state_ambiguous", 503);
  return rows[0] ?? null;
}

function assertSameCommand(
  command: CommandRow,
  userId: string,
  licenseId: string,
  couponCode: string,
): void {
  if (command.user_id.toLowerCase() !== userId.toLowerCase() ||
      command.license_id.toLowerCase() !== licenseId || command.coupon_code !== couponCode) {
    throw new ExtensionCouponApplicationD1Error("request_id_conflict", 409);
  }
}

async function findCoupon(database: D1Database, code: string): Promise<CouponRow | null> {
  const result = await database.prepare(`
    SELECT id, code, months, allowed_tier_levels, max_uses, used_count, expires_at, is_active
    FROM extension_coupons WHERE code = ? AND is_active = 1 LIMIT 2
  `).bind(code).all<CouponRow>();
  const rows = result.results ?? [];
  if (rows.length > 1) throw new ExtensionCouponApplicationD1Error("coupon_state_ambiguous", 503);
  return rows[0] ?? null;
}

async function findLicense(
  database: D1Database,
  userId: string,
  licenseId: string,
): Promise<LicenseRow | null> {
  const result = await database.prepare(`
    SELECT l.id, l.fanmark_id, l.user_id, l.status, l.license_end, l.grace_expires_at,
      l.is_returned, l.is_transferred, l.transfer_locked_until, l.display_fanmark,
      f.tier_level
    FROM fanmark_licenses l
    JOIN fanmarks f ON f.id = l.fanmark_id
    WHERE l.id = ? AND l.user_id = ? AND l.status IN ('active', 'grace')
    LIMIT 2
  `).bind(licenseId, userId).all<LicenseRow>();
  const rows = result.results ?? [];
  if (rows.length > 1) throw new ExtensionCouponApplicationD1Error("license_state_ambiguous", 503);
  return rows[0] ?? null;
}

async function validateCouponAndLicense(
  database: D1Database,
  userId: string,
  coupon: CouponRow,
  license: LicenseRow | null,
  appliedAt: string,
): Promise<{ license: LicenseRow; gracePlan: GracePlanSnapshot | null }> {
  if (!ALLOWED_MONTHS.has(coupon.months)) {
    throw new ExtensionCouponApplicationD1Error("invalid_coupon_configuration", 400);
  }
  if (coupon.expires_at && Date.parse(coupon.expires_at) < Date.parse(appliedAt)) {
    throw new ExtensionCouponApplicationD1Error("coupon_expired", 400);
  }
  if (coupon.used_count >= coupon.max_uses) {
    throw new ExtensionCouponApplicationD1Error("coupon_usage_exceeded", 400);
  }
  let allowedTiers: unknown;
  if (coupon.allowed_tier_levels) {
    try {
      allowedTiers = JSON.parse(coupon.allowed_tier_levels) as unknown;
    } catch {
      throw new ExtensionCouponApplicationD1Error("invalid_coupon_configuration", 400);
    }
    if (!Array.isArray(allowedTiers) || allowedTiers.some((tier) => !Number.isSafeInteger(tier) || tier < 1)) {
      throw new ExtensionCouponApplicationD1Error("invalid_coupon_configuration", 400);
    }
  }
  if (!license) throw new ExtensionCouponApplicationD1Error("no_eligible_license", 404);
  if (license.license_end === null) throw new ExtensionCouponApplicationD1Error("perpetual_license", 400);
  if (license.is_returned !== 0 || license.is_transferred !== 0 || !Number.isSafeInteger(license.tier_level)) {
    throw new ExtensionCouponApplicationD1Error("no_eligible_license", 404);
  }
  if (Array.isArray(allowedTiers) && allowedTiers.length > 0 && !allowedTiers.includes(license.tier_level)) {
    throw new ExtensionCouponApplicationD1Error("tier_not_allowed", 400);
  }
  const transfer = await database.prepare(`
    SELECT 1 AS found FROM fanmark_licenses l
    WHERE l.id = ? AND (
      (l.transfer_locked_until IS NOT NULL AND julianday(l.transfer_locked_until) > julianday(?))
      OR EXISTS (SELECT 1 FROM fanmark_transfer_codes tc WHERE tc.license_id = l.id AND tc.status IN ('active', 'applied'))
      OR EXISTS (SELECT 1 FROM fanmark_transfer_requests tr WHERE tr.license_id = l.id AND tr.status IN ('pending', 'approved'))
    )
    LIMIT 1
  `).bind(license.id, appliedAt).first<{ found: number }>();
  if (transfer) throw new ExtensionCouponApplicationD1Error("transfer_in_progress", 400);

  const existingUsage = await database.prepare(`
    SELECT 1 AS found FROM extension_coupon_usages
    WHERE coupon_id = ? AND user_id = ? AND fanmark_id = ? LIMIT 1
  `).bind(coupon.id, userId, license.fanmark_id).first<{ found: number }>();
  if (existingUsage) throw new ExtensionCouponApplicationD1Error("coupon_already_used_on_fanmark", 400);

  const gracePlan = license.status === "grace"
    ? await enforceGracePlanLimit(database, userId, appliedAt)
    : null;
  return { license, gracePlan };
}

async function enforceGracePlanLimit(
  database: D1Database,
  userId: string,
  now: string,
): Promise<GracePlanSnapshot> {
  const userSettings = await database.prepare(
    "SELECT plan_type FROM user_settings WHERE user_id = ? LIMIT 2",
  ).bind(userId).all<{ plan_type: string }>();
  const userRows = userSettings.results ?? [];
  if (userRows.length > 1) throw new ExtensionCouponApplicationD1Error("user_settings_ambiguous", 503);
  const planType = userRows[0]?.plan_type ?? "free";
  if (planType === "admin") return { planType, limitKey: null, settingValue: null, limit: null };
  const definitions: Record<string, { key: string; fallback: number }> = {
    free: { key: "free_fanmarks_limit", fallback: 3 },
    creator: { key: "creator_fanmarks_limit", fallback: 10 },
    business: { key: "business_fanmarks_limit", fallback: 50 },
    enterprise: { key: "enterprise_fanmarks_limit", fallback: 100 },
    max: { key: "max_fanmarks_limit", fallback: 500 },
  };
  const definition = definitions[planType] ?? definitions.free;
  const settings = await database.prepare(
    "SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 2",
  ).bind(definition.key).all<{ setting_value: string }>();
  const settingRows = settings.results ?? [];
  if (settingRows.length > 1) throw new ExtensionCouponApplicationD1Error("plan_limit_ambiguous", 503);
  const rawLimit = settingRows[0]?.setting_value;
  const limit = rawLimit === undefined ? definition.fallback : Number.parseInt(rawLimit, 10);
  if (!Number.isSafeInteger(limit) || limit < 0) throw new ExtensionCouponApplicationD1Error("plan_limit_invalid", 503);
  const count = await database.prepare(`
    SELECT COUNT(*) AS count FROM fanmark_licenses
    WHERE user_id = ? AND status = 'active'
      AND (license_end IS NULL OR julianday(license_end) > julianday(?))
  `).bind(userId, now).first<{ count: number }>();
  if (!count || !Number.isSafeInteger(count.count)) {
    throw new ExtensionCouponApplicationD1Error("active_license_count_unavailable", 503);
  }
  if (count.count >= limit) throw new ExtensionCouponApplicationD1Error("fanmark_limit_exceeded", 400);
  return { planType, limitKey: definition.key, settingValue: rawLimit ?? null, limit };
}

export async function handleExtensionCouponApplicationD1Request(
  request: Request,
  env: Env,
  dependencies: ExtensionCouponApplicationD1Dependencies,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isExtensionCouponApplicationPath(url.pathname)) return null;
  const headers = corsHeaders(request, env);
  if (!headers) return json({ error: "origin_not_allowed" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, headers);
  if (env.EXTENSION_COUPON_BACKEND?.trim() !== "d1") return json({ error: "not_found" }, 404, headers);

  try {
    const input = await readRequest(request);
    const userId = await dependencies.resolveUser(request);
    if (!userId) throw new ExtensionCouponApplicationD1Error("authentication_required", 401);
    const database = selectD1Database(env, "business");
    if (!database) throw new ExtensionCouponApplicationD1Error("business_database_unavailable", 503);

    const existing = await readCommand(database, userId, input.requestId);
    if (existing) {
      assertSameCommand(existing, userId, input.licenseId, input.couponCode);
      return responseFromCommand(existing);
    }

    const nowValue = dependencies.now?.() ?? new Date();
    if (!Number.isFinite(nowValue.getTime())) throw new ExtensionCouponApplicationD1Error("invalid_clock", 500);
    const appliedAt = nowValue.toISOString();
    const coupon = await findCoupon(database, input.couponCode);
    if (!coupon) throw new ExtensionCouponApplicationD1Error("coupon_not_found", 404);
    const license = await findLicense(database, userId, input.licenseId);
    const { license: checkedLicense, gracePlan } =
      await validateCouponAndLicense(database, userId, coupon, license, appliedAt);
    const oldEnd = Date.parse(checkedLicense.license_end ?? "");
    if (!Number.isFinite(oldEnd)) throw new ExtensionCouponApplicationD1Error("no_eligible_license", 404);
    const currentEnd = new Date(oldEnd);
    const base = currentEnd > nowValue ? currentEnd : nowValue;
    const nextEnd = roundUpToUtcMidnight(addMonthsClamped(base, coupon.months)).toISOString();
    const commandId = (dependencies.createId?.() ?? crypto.randomUUID()).toLowerCase();
    if (!UUID.test(commandId)) throw new ExtensionCouponApplicationD1Error("invalid_command_id", 500);

    try {
      await database.prepare(`
        INSERT INTO extension_coupon_application_commands (
          id, request_id, user_id, license_id, coupon_id, coupon_code, fanmark_id,
          tier_level, months, previous_status, previous_license_end,
          grace_plan_type, grace_plan_limit_key, grace_plan_setting_value, grace_plan_limit,
          new_license_end, applied_at, status, cancelled_lottery_entries
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', 0
        WHERE NOT EXISTS (
          SELECT 1 FROM extension_coupon_application_commands WHERE user_id = ? AND request_id = ?
        )
      `).bind(
        commandId, input.requestId, userId, checkedLicense.id, coupon.id, coupon.code,
        checkedLicense.fanmark_id, checkedLicense.tier_level, coupon.months,
        checkedLicense.status, checkedLicense.license_end,
        gracePlan?.planType ?? null, gracePlan?.limitKey ?? null,
        gracePlan?.settingValue ?? null, gracePlan?.limit ?? null,
        nextEnd, appliedAt,
        userId, input.requestId,
      ).run();
    } catch (error) {
      const mapped = mapSqlError(error);
      if (mapped) throw mapped;
      const raced = await readCommand(database, userId, input.requestId);
      if (raced) {
        assertSameCommand(raced, userId, input.licenseId, input.couponCode);
        return responseFromCommand(raced);
      }
      throw error;
    }

    const stored = await readCommand(database, userId, input.requestId);
    if (!stored) throw new ExtensionCouponApplicationD1Error("coupon_application_failed", 503);
    assertSameCommand(stored, userId, input.licenseId, input.couponCode);
    return responseFromCommand(stored);
  } catch (error) {
    const mapped = mapSqlError(error);
    if (mapped) return json({ error: mapped.code }, mapped.status, headers);
    if (error instanceof ExtensionCouponApplicationD1Error) {
      return json({ error: error.code }, error.status, headers);
    }
    return json({ error: "coupon_application_unavailable" }, 503, headers);
  }
}
