import { formatAvailabilityNow } from "./availability";
import { selectD1Database, type Env } from "./repository";
import type { StorageAuthResolver } from "./storage-r2";

const PATH = "/api/fanmarks/search/details";
const MAX_BODY_BYTES = 1_024;
const MAX_RESPONSE_BYTES = 8_192;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const DETAILS_SQL = `
WITH latest_license AS (
  SELECT
    fl.id,
    fl.user_id,
    fl.status,
    fl.license_end,
    fl.grace_expires_at,
    fl.display_fanmark
  FROM fanmark_licenses fl
  WHERE fl.fanmark_id = ?
  ORDER BY (fl.license_end IS NULL) DESC, fl.license_end DESC
  LIMIT 1
)
SELECT
  f.id,
  f.user_input_fanmark,
  f.emoji_ids,
  f.normalized_emoji,
  f.short_id,
  f.status,
  l.user_id AS current_owner_id,
  l.id AS license_id,
  l.status AS current_license_status,
  l.license_end,
  l.grace_expires_at AS current_grace_expires_at,
  l.display_fanmark,
  (SELECT count(*) FROM fanmark_lottery_entries fle
    WHERE fle.fanmark_id = f.id AND fle.entry_status = 'pending') AS lottery_entry_count,
  CASE WHEN ? IS NOT NULL AND EXISTS (
    SELECT 1 FROM fanmark_lottery_entries fle
    WHERE fle.fanmark_id = f.id AND fle.user_id = ? AND fle.entry_status = 'pending'
  ) THEN 1 ELSE 0 END AS has_user_lottery_entry,
  (SELECT fle.id FROM fanmark_lottery_entries fle
    WHERE fle.fanmark_id = f.id AND fle.user_id = ? AND fle.entry_status = 'pending'
    LIMIT 1) AS user_lottery_entry_id
FROM fanmarks f
LEFT JOIN latest_license l ON 1 = 1
WHERE f.id = ?
LIMIT 2`;

interface SearchDetailsRow extends Record<string, unknown> {
  id: unknown;
  user_input_fanmark: unknown;
  emoji_ids: unknown;
  normalized_emoji: unknown;
  short_id: unknown;
  status: unknown;
  current_owner_id: unknown;
  license_id: unknown;
  current_license_status: unknown;
  license_end: unknown;
  current_grace_expires_at: unknown;
  display_fanmark: unknown;
  lottery_entry_count: unknown;
  has_user_lottery_entry: unknown;
  user_lottery_entry_id: unknown;
}

export class FanmarkSearchApiError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "FanmarkSearchApiError";
  }
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const resultHeaders = new Headers(headers);
  resultHeaders.set("cache-control", "no-store");
  resultHeaders.set("content-type", "application/json; charset=utf-8");
  let serialized = JSON.stringify(body);
  let resultStatus = status;
  if (new TextEncoder().encode(serialized).byteLength > MAX_RESPONSE_BYTES) {
    serialized = JSON.stringify({ error: "fanmark_search_unavailable" });
    resultStatus = 503;
  }
  return new Response(serialized, { status: resultStatus, headers: resultHeaders });
}

function corsHeaders(request: Request, env: Env): Headers | null {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (!origin) return headers;
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  if (!allowed.has(origin)) return null;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return headers;
}

async function readBody(request: Request): Promise<Uint8Array | null> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return null;
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BODY_BYTES) return null;
  }
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    try { reader.releaseLock(); } catch { /* The stream may already be detached. */ }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseFanmarkId(bytes: Uint8Array | null): string {
  if (!bytes) throw new FanmarkSearchApiError("invalid_request", 400);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new FanmarkSearchApiError("invalid_request", 400);
  }
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).length !== 1 || typeof (value as { fanmarkId?: unknown }).fanmarkId !== "string" ||
    !UUID_RE.test((value as { fanmarkId: string }).fanmarkId)
  ) throw new FanmarkSearchApiError("invalid_request", 400);
  return (value as { fanmarkId: string }).fanmarkId.toLowerCase();
}

function asRows(value: unknown): SearchDetailsRow[] {
  const result = value as { success?: unknown; results?: unknown };
  if (result.success === false || !Array.isArray(result.results)) throw new FanmarkSearchApiError("fanmark_search_unavailable");
  return result.results as SearchDetailsRow[];
}

function text(value: unknown, maxLength = 512): string {
  if (typeof value !== "string" || value.length > maxLength) throw new FanmarkSearchApiError("fanmark_search_unavailable");
  return value;
}

function nullableText(value: unknown, maxLength = 512): string | null {
  if (value === null) return null;
  return text(value, maxLength);
}

function uuid(value: unknown, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new FanmarkSearchApiError("fanmark_search_unavailable");
  return value.toLowerCase();
}

function boolInt(value: unknown): boolean {
  if (value !== 0 && value !== 1) throw new FanmarkSearchApiError("fanmark_search_unavailable");
  return value === 1;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new FanmarkSearchApiError("fanmark_search_unavailable");
  return value;
}

function emojiIds(value: unknown): string[] {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { throw new FanmarkSearchApiError("fanmark_search_unavailable"); }
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 5) throw new FanmarkSearchApiError("fanmark_search_unavailable");
  return parsed.map((item) => uuid(item) as string);
}

function mapRow(row: SearchDetailsRow, now: string): Record<string, unknown> {
  const id = uuid(row.id) as string;
  const ownerId = uuid(row.current_owner_id, true);
  const licenseId = uuid(row.license_id, true);
  const status = text(row.status, 32);
  const licenseStatus = nullableText(row.current_license_status, 32);
  const licenseEnd = nullableText(row.license_end);
  const graceExpiresAt = nullableText(row.current_grace_expires_at);
  const active = licenseStatus === "active" && (licenseEnd === null || licenseEnd > now);
  const graceDeadline = graceExpiresAt ?? licenseEnd;
  const grace = licenseStatus === "grace" && graceDeadline !== null && graceDeadline > now;
  const hasUserLotteryEntry = boolInt(row.has_user_lottery_entry);
  const entryId = uuid(row.user_lottery_entry_id, true);
  if (hasUserLotteryEntry !== (entryId !== null)) throw new FanmarkSearchApiError("fanmark_search_unavailable");
  return {
    id,
    user_input_fanmark: text(row.user_input_fanmark),
    display_fanmark: nullableText(row.display_fanmark),
    emoji_ids: emojiIds(row.emoji_ids),
    normalized_emoji: text(row.normalized_emoji),
    short_id: text(row.short_id, 64),
    status,
    current_owner_id: ownerId,
    has_active_license: active,
    license_id: licenseId,
    current_license_status: licenseStatus,
    current_grace_expires_at: graceExpiresAt,
    is_blocked_for_registration: active || grace,
    next_available_at: grace ? graceDeadline : active ? licenseEnd : null,
    lottery_entry_count: number(row.lottery_entry_count),
    has_user_lottery_entry: hasUserLotteryEntry,
    user_lottery_entry_id: entryId,
  };
}

export function isFanmarkSearchDetailsPath(pathname: string): boolean {
  return pathname === PATH;
}

export async function handleFanmarkSearchDetailsRequest(
  request: Request,
  env: Env,
  resolveAuth: StorageAuthResolver,
  clock: () => Date = () => new Date(),
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isFanmarkSearchDetailsPath(url.pathname)) return null;
  const headers = corsHeaders(request, env);
  if (!headers) return json({ error: "forbidden" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (url.search || request.method !== "POST") {
    headers.set("allow", "POST, OPTIONS");
    return json({ error: "method_not_allowed" }, 405, headers);
  }

  try {
    if (env.FANMARK_SEARCH_BACKEND?.trim() !== "d1" || env.AUTH_BACKEND?.trim() !== "better-auth") {
      throw new FanmarkSearchApiError("fanmark_search_unavailable");
    }
    const auth = await resolveAuth(request, env);
    if (!auth.available) throw new FanmarkSearchApiError("fanmark_search_unavailable");
    const database = selectD1Database(env, "business");
    if (!database) throw new FanmarkSearchApiError("fanmark_search_unavailable");
    const fanmarkId = parseFanmarkId(await readBody(request));
    const currentUserId = auth.userId === null ? null : uuid(auth.userId);
    const currentTime = formatAvailabilityNow(clock());
    const result = await database.prepare(DETAILS_SQL)
      .bind(fanmarkId, currentUserId, currentUserId, currentUserId, fanmarkId)
      .all<SearchDetailsRow>();
    const rows = asRows(result);
    if (rows.length > 1) throw new FanmarkSearchApiError("fanmark_search_unavailable");
    return json({ schemaVersion: 1, result: rows.length === 0 ? null : mapRow(rows[0], currentTime) }, 200, headers);
  } catch (error) {
    const failure = error instanceof FanmarkSearchApiError ? error : new FanmarkSearchApiError("fanmark_search_unavailable");
    return json({ error: failure.code }, failure.status, headers);
  }
}
