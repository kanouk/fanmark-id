import { selectD1Database, type Env } from "./repository";

const API_PATH = "/api/admin/availability-rules";
const MAX_BODY_BYTES = 8 * 1024;
const MAX_RULES = 64;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
const PREFIX_EMOJIS = new Set(["🎄", "🏢", "💎"]);
const RULE_TYPES = new Set(["specific_pattern", "duplicate_pattern", "prefix_pattern", "count_based"]);
const MAX_MONEY_CENTS = 9_999_999_999;

export interface AvailabilityRuleAdminDto {
  id: string;
  rule_type: "specific_pattern" | "duplicate_pattern" | "prefix_pattern" | "count_based";
  priority: number;
  rule_config: Record<string, unknown>;
  is_available: boolean;
  price_usd: string | null;
  description: string | null;
  updated_at: string;
}

export type AvailabilityRulesAdminAuthorizer = (
  request: Request,
  responseHeaders: Headers,
) => Promise<{ userId: string; sessionId: string } | Response>;

export class AvailabilityRulesAdminApiError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "AvailabilityRulesAdminApiError";
  }
}

function fail(code: string, status = 503): never {
  throw new AvailabilityRulesAdminApiError(code, status);
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
  headers.set("access-control-allow-methods", "GET, PATCH, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return true;
}

function database(env: Env): D1Database {
  if (env.AVAILABILITY_RULES_ADMIN_BACKEND?.trim() !== "d1" || env.D1_TOPOLOGY?.trim() !== "split") {
    fail("availability_rules_admin_unavailable", env.AVAILABILITY_RULES_ADMIN_BACKEND ? 500 : 503);
  }
  const selected = selectD1Database(env, "business");
  if (!selected) fail("availability_rules_admin_unavailable", 500);
  return selected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRuleConfig(value: unknown): Record<string, unknown> {
  let parsed = value;
  if (typeof value === "string") {
    if (new TextEncoder().encode(value).byteLength > MAX_BODY_BYTES) fail("availability_rules_admin_unavailable");
    try { parsed = JSON.parse(value) as unknown; } catch { fail("availability_rules_admin_unavailable"); }
  }
  if (!isRecord(parsed) || Object.keys(parsed).some((key) => !["prefixes", "patterns", "pricing", "enabled"].includes(key))) {
    fail("availability_rules_admin_unavailable");
  }
  if (Object.hasOwn(parsed, "enabled") && typeof parsed.enabled !== "boolean") fail("availability_rules_admin_unavailable");
  if (Object.hasOwn(parsed, "patterns") && (!Array.isArray(parsed.patterns) || parsed.patterns.length > 100 ||
      parsed.patterns.some((item) => typeof item !== "string" || item.length > 256))) {
    fail("availability_rules_admin_unavailable");
  }
  if (Object.hasOwn(parsed, "prefixes")) {
    const prefixes = parsed.prefixes;
    if (!isRecord(prefixes) || Object.keys(prefixes).length > 50 || Object.entries(prefixes).some(([key, amount]) =>
      key.length === 0 || key.length > 16 || typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > MAX_MONEY_CENTS / 100)) {
      fail("availability_rules_admin_unavailable");
    }
  }
  if (Object.hasOwn(parsed, "pricing")) {
    const pricing = parsed.pricing;
    if (!isRecord(pricing) || Object.keys(pricing).some((key) => !/^[1-5]$/u.test(key)) ||
        Object.values(pricing).some((amount) => typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > MAX_MONEY_CENTS / 100)) {
      fail("availability_rules_admin_unavailable");
    }
  }
  return parsed;
}

function moneyText(cents: unknown): string | null {
  if (cents === null) return null;
  if (typeof cents !== "number" || !Number.isSafeInteger(cents) || Math.abs(cents) > MAX_MONEY_CENTS) {
    fail("availability_rules_admin_unavailable");
  }
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function parseRule(row: Record<string, unknown>): AvailabilityRuleAdminDto {
  if (typeof row.id !== "string" || !UUID.test(row.id) || typeof row.rule_type !== "string" || !RULE_TYPES.has(row.rule_type) ||
      typeof row.priority !== "number" || !Number.isInteger(row.priority) || row.priority < 1 || row.priority > 4 ||
      (row.is_available !== 0 && row.is_available !== 1) ||
      !(row.description === null || typeof row.description === "string") ||
      typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at))) {
    fail("availability_rules_admin_unavailable");
  }
  return {
    id: row.id.toLowerCase(),
    rule_type: row.rule_type as AvailabilityRuleAdminDto["rule_type"],
    priority: row.priority,
    rule_config: parseRuleConfig(row.rule_config),
    is_available: row.is_available === 1,
    price_usd: moneyText(row.price_usd),
    description: row.description as string | null,
    updated_at: row.updated_at,
  };
}

async function readRules(db: D1Database): Promise<AvailabilityRuleAdminDto[]> {
  const result = await db.prepare(`
    SELECT id, rule_type, priority, rule_config, is_available, price_usd, description, updated_at
    FROM fanmark_availability_rules ORDER BY priority ASC, id ASC LIMIT ?
  `).bind(MAX_RULES + 1).all<Record<string, unknown>>();
  if (!result.success || !Array.isArray(result.results) || result.results.length > MAX_RULES) {
    fail("availability_rules_admin_unavailable");
  }
  return result.results.map(parseRule);
}

async function readBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    fail("json_content_type_required", 415);
  }
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) fail("request_too_large", 413);
  const reader = request.body?.getReader();
  if (!reader) fail("invalid_request", 400);
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
    if (error instanceof AvailabilityRulesAdminApiError) throw error;
    fail("invalid_request", 400);
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { fail("invalid_request", 400); }
}

function canonicalNow(clock: Date, expectedUpdatedAt: string): string {
  const expectedTime = Date.parse(expectedUpdatedAt);
  if (!Number.isFinite(clock.getTime()) || !Number.isFinite(expectedTime)) fail("invalid_request", 400);
  return new Date(Math.max(clock.getTime(), expectedTime + 1))
    .toISOString().replace(/\.(\d{3})Z$/u, (_match, fraction: string) => `.${fraction}000Z`);
}

function parsePatch(value: unknown): { expectedUpdatedAt: string; isAvailable?: boolean; prefixPrice?: { emoji: string; priceUsd: string } } {
  if (!isRecord(value)) fail("invalid_request", 400);
  const keys = Object.keys(value);
  if (keys.some((key) => !["expectedUpdatedAt", "isAvailable", "prefixPrice"].includes(key)) ||
      typeof value.expectedUpdatedAt !== "string" || value.expectedUpdatedAt.length > 64 ||
      !Number.isFinite(Date.parse(value.expectedUpdatedAt))) fail("invalid_request", 400);
  const hasAvailability = Object.hasOwn(value, "isAvailable");
  const hasPrefixPrice = Object.hasOwn(value, "prefixPrice");
  if (hasAvailability === hasPrefixPrice || (hasAvailability && typeof value.isAvailable !== "boolean")) {
    fail("invalid_request", 400);
  }
  if (hasAvailability) return { expectedUpdatedAt: value.expectedUpdatedAt, isAvailable: value.isAvailable as boolean };
  if (!isRecord(value.prefixPrice) || Object.keys(value.prefixPrice).some((key) => !["emoji", "priceUsd"].includes(key)) ||
      typeof value.prefixPrice.emoji !== "string" || !PREFIX_EMOJIS.has(value.prefixPrice.emoji) ||
      typeof value.prefixPrice.priceUsd !== "string") {
    fail("invalid_request", 400);
  }
  const priceUsd = value.prefixPrice.priceUsd as string;
  if (!/^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,2})?$/u.test(priceUsd)) fail("invalid_request", 400);
  return {
    expectedUpdatedAt: value.expectedUpdatedAt,
    prefixPrice: { emoji: value.prefixPrice.emoji, priceUsd },
  };
}

function centsFromMoney(value: string): number {
  const [whole, fractional = ""] = value.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fractional.padEnd(2, "0"));
  if (cents > BigInt(MAX_MONEY_CENTS)) fail("invalid_request", 400);
  return Number(cents);
}

export function isAvailabilityRulesAdminPath(pathname: string): boolean {
  return pathname === API_PATH || pathname.startsWith(`${API_PATH}/`);
}

export async function handleAvailabilityRulesAdminRequest(
  request: Request,
  env: Env,
  authorizeAdmin: AvailabilityRulesAdminAuthorizer,
  clock: () => Date = () => new Date(),
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isAvailabilityRulesAdminPath(url.pathname)) return null;
  if (url.search || url.hash) return json({ error: "not_found" }, 404);
  const headers = new Headers();
  if (!cors(request, env, headers)) return json({ error: "forbidden_origin" }, 403);
  const collection = url.pathname === API_PATH;
  const id = collection ? null : url.pathname.slice(`${API_PATH}/`.length);
  if (id && !UUID.test(id)) return json({ error: "not_found" }, 404);
  const method = request.method.toUpperCase();
  const allowed = collection ? "GET, OPTIONS" : "PATCH, OPTIONS";
  if (method === "OPTIONS") { headers.set("allow", allowed); return new Response(null, { status: 204, headers }); }
  if (!(collection ? method === "GET" : method === "PATCH")) {
    headers.set("allow", allowed);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  if (env.AUTH_BACKEND?.trim() !== "better-auth") return json({ error: "auth_unavailable" }, 503, headers);
  const authorization = await authorizeAdmin(request, headers);
  if (authorization instanceof Response) return authorization;
  try {
    const db = database(env);
    if (collection) return json({ schemaVersion: 1, rules: await readRules(db) }, 200, headers);
    const patch = parsePatch(await readBody(request));
    const current = await db.prepare(`
      SELECT id, rule_type, priority, rule_config, is_available, price_usd, description, updated_at
      FROM fanmark_availability_rules WHERE id = ? LIMIT 1
    `).bind(id).first<Record<string, unknown>>();
    if (!current) return json({ error: "availability_rule_not_found" }, 404, headers);
    const existing = parseRule(current);
    const updatedAt = canonicalNow(clock(), patch.expectedUpdatedAt);
    let statement: D1PreparedStatement;
    if (patch.isAvailable !== undefined) {
      statement = db.prepare(`UPDATE fanmark_availability_rules SET is_available = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?`).bind(patch.isAvailable ? 1 : 0, updatedAt, id, patch.expectedUpdatedAt);
    } else {
      if (existing.rule_type !== "prefix_pattern" || !patch.prefixPrice) return json({ error: "invalid_availability_rule_edit" }, 400, headers);
      const prefixPriceCents = centsFromMoney(patch.prefixPrice.priceUsd);
      const config = parseRuleConfig(current.rule_config);
      const prefixMap = isRecord(config.prefixes) ? { ...config.prefixes } : {};
      prefixMap[patch.prefixPrice.emoji] = prefixPriceCents / 100;
      config.prefixes = prefixMap;
      statement = db.prepare(`UPDATE fanmark_availability_rules SET rule_config = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?`).bind(JSON.stringify(config), updatedAt, id, patch.expectedUpdatedAt);
    }
    const results = await db.batch([
      statement,
      db.prepare(`SELECT id, rule_type, priority, rule_config, is_available, price_usd, description, updated_at
        FROM fanmark_availability_rules WHERE id = ? LIMIT 1`).bind(id),
    ]);
    if (!Array.isArray(results) || results.length !== 2 || results[0]?.success !== true || results[1]?.success !== true) {
      fail("availability_rules_admin_unavailable");
    }
    if (Number(results[0]?.meta?.changes ?? 0) !== 1) return json({ error: "availability_rule_conflict" }, 409, headers);
    const updatedRows = results[1]?.results;
    if (!Array.isArray(updatedRows) || updatedRows.length !== 1) fail("availability_rules_admin_unavailable");
    return json({ schemaVersion: 1, rule: parseRule(updatedRows[0] as Record<string, unknown>) }, 200, headers);
  } catch (error) {
    if (error instanceof AvailabilityRulesAdminApiError) return json({ error: error.code }, error.status, headers);
    return json({ error: "availability_rules_admin_unavailable" }, 503, headers);
  }
}
