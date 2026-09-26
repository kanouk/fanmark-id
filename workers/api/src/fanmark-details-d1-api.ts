import { selectD1Database, type Env } from "./repository";
import type { StorageAuthResolver } from "./storage-r2";

const PATH = "/api/fanmarks/details";
const MAX_BODY_BYTES = 1_024;
const MAX_RESPONSE_BYTES = 48 * 1_024;
const MAX_HISTORY_ROWS = 100;
const MAX_SHORT_ID_BYTES = 256;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const DETAILS_SQL = `
WITH target AS (
  SELECT id, user_input_fanmark, normalized_emoji, normalized_emoji_ids, short_id, emoji_ids, created_at
  FROM fanmarks
  WHERE short_id = ? AND status = 'active'
  LIMIT 2
), license_rows AS (
  SELECT
    l.id, l.fanmark_id, l.user_id, l.license_start, l.license_end,
    l.grace_expires_at, l.excluded_at, l.is_returned, l.status, l.display_fanmark,
    l.is_initial_license, us.username, us.display_name,
    ROW_NUMBER() OVER (ORDER BY l.license_start DESC, l.created_at DESC, l.id DESC) AS newest_rank,
    ROW_NUMBER() OVER (ORDER BY l.license_start ASC, l.created_at ASC, l.id ASC) AS oldest_rank
  FROM fanmark_licenses AS l
  LEFT JOIN user_settings AS us ON us.user_id = l.user_id
  WHERE EXISTS (SELECT 1 FROM target WHERE target.id = l.fanmark_id)
)
SELECT
  target.id AS fanmark_id,
  target.user_input_fanmark,
  target.normalized_emoji,
  target.short_id,
  target.emoji_ids,
  target.created_at AS fanmark_created_at,
  current.status AS current_license_status,
  current.license_start AS current_license_start,
  current.license_end AS current_license_end,
  current.grace_expires_at AS current_grace_expires_at,
  current.is_returned AS current_is_returned,
  current.display_fanmark,
  current.username AS current_owner_username,
  current.display_name AS current_owner_display_name,
  first_license.license_start AS first_acquired_date,
  first_license.username AS first_owner_username,
  first_license.display_name AS first_owner_display_name,
  CASE WHEN current.user_id = ? THEN 1 ELSE 0 END AS is_current_owner,
  COALESCE((
    SELECT json_group_array(json_object(
      'license_start', history.license_start,
      'license_end', history.license_end,
      'grace_expires_at', history.grace_expires_at,
      'excluded_at', history.excluded_at,
      'is_returned', history.is_returned,
      'username', history.username,
      'display_name', history.display_name,
      'status', history.status,
      'is_initial_license', history.is_initial_license
    ))
    FROM (SELECT * FROM license_rows ORDER BY newest_rank LIMIT 101) AS history
  ), '[]') AS license_history_json,
  (SELECT COUNT(*) FROM fanmark_lottery_entries AS entry
   WHERE entry.fanmark_id = target.id AND entry.entry_status = 'pending') AS lottery_entry_count,
  CASE WHEN EXISTS (
    SELECT 1 FROM fanmark_lottery_entries AS entry
    WHERE entry.fanmark_id = target.id AND entry.user_id = ? AND entry.entry_status = 'pending'
  ) THEN 1 ELSE 0 END AS has_user_lottery_entry,
  CASE WHEN EXISTS (
    SELECT 1 FROM fanmark_favorites AS favorite
    LEFT JOIN fanmark_discoveries AS discovery ON discovery.id = favorite.discovery_id
    WHERE favorite.user_id = ? AND (
      favorite.fanmark_id = target.id OR discovery.fanmark_id = target.id OR
      discovery.normalized_emoji_ids = target.normalized_emoji_ids
    )
  ) THEN 1 ELSE 0 END AS is_favorited,
  (SELECT COUNT(*) FROM license_rows) AS license_history_count
FROM target
LEFT JOIN license_rows AS current ON current.newest_rank = 1
LEFT JOIN license_rows AS first_license ON first_license.oldest_rank = 1
`;

const PUBLIC_DETAILS_SQL = `
WITH target AS (
  SELECT id, user_input_fanmark, normalized_emoji, normalized_emoji_ids, short_id, emoji_ids, created_at
  FROM fanmarks
  WHERE short_id = ? AND status = 'active'
  LIMIT 2
), current_license AS (
  SELECT display_fanmark, status, license_end, grace_expires_at, is_returned
  FROM fanmark_licenses
  WHERE fanmark_id = (SELECT id FROM target) AND status = 'active'
  ORDER BY (license_end IS NULL) DESC, license_end DESC
  LIMIT 1
)
SELECT
  target.id AS fanmark_id,
  target.user_input_fanmark,
  target.normalized_emoji,
  target.short_id,
  target.emoji_ids,
  target.created_at AS fanmark_created_at,
  current_license.status AS current_license_status,
  NULL AS current_license_start,
  current_license.license_end AS current_license_end,
  current_license.grace_expires_at AS current_grace_expires_at,
  current_license.is_returned AS current_is_returned,
  current_license.display_fanmark,
  NULL AS current_owner_username,
  NULL AS current_owner_display_name,
  NULL AS first_acquired_date,
  NULL AS first_owner_username,
  NULL AS first_owner_display_name,
  0 AS is_current_owner,
  '[]' AS license_history_json,
  0 AS lottery_entry_count,
  0 AS has_user_lottery_entry,
  0 AS is_favorited,
  0 AS license_history_count,
  0 AS history_available
FROM target
LEFT JOIN current_license ON 1 = 1
`;

interface DetailRow extends Record<string, unknown> {
  fanmark_id: unknown;
  user_input_fanmark: unknown;
  normalized_emoji: unknown;
  short_id: unknown;
  emoji_ids: unknown;
  fanmark_created_at: unknown;
  current_license_status: unknown;
  current_license_start: unknown;
  current_license_end: unknown;
  current_grace_expires_at: unknown;
  current_is_returned: unknown;
  display_fanmark: unknown;
  current_owner_username: unknown;
  current_owner_display_name: unknown;
  first_acquired_date: unknown;
  first_owner_username: unknown;
  first_owner_display_name: unknown;
  is_current_owner: unknown;
  license_history_json: unknown;
  lottery_entry_count: unknown;
  has_user_lottery_entry: unknown;
  is_favorited: unknown;
  license_history_count: unknown;
  history_available?: unknown;
}

export class FanmarkDetailsApiError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "FanmarkDetailsApiError";
  }
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const resultHeaders = new Headers(headers);
  resultHeaders.set("cache-control", "no-store");
  resultHeaders.set("content-type", "application/json; charset=utf-8");
  let serialized = JSON.stringify(body);
  let resultStatus = status;
  if (new TextEncoder().encode(serialized).byteLength > MAX_RESPONSE_BYTES) {
    serialized = JSON.stringify({ error: "fanmark_details_unavailable" });
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

async function readShortId(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new FanmarkDetailsApiError("invalid_request", 400);
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BODY_BYTES) throw new FanmarkDetailsApiError("invalid_request", 400);
  }
  if (!request.body) throw new FanmarkDetailsApiError("invalid_request", 400);
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
        throw new FanmarkDetailsApiError("invalid_request", 400);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof FanmarkDetailsApiError) throw error;
    throw new FanmarkDetailsApiError("invalid_request", 400);
  } finally {
    try { reader.releaseLock(); } catch { /* The stream may already be detached. */ }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new FanmarkDetailsApiError("invalid_request", 400);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 1 || typeof (value as { shortId?: unknown }).shortId !== "string") {
    throw new FanmarkDetailsApiError("invalid_request", 400);
  }
  const shortId = (value as { shortId: string }).shortId;
  if (shortId.length < 1 || new TextEncoder().encode(shortId).byteLength > MAX_SHORT_ID_BYTES || hasDisallowedShortIdCharacter(shortId)) {
    throw new FanmarkDetailsApiError("invalid_request", 400);
  }
  return shortId;
}

function text(value: unknown, maximum = 512): string {
  if (typeof value !== "string" || value.length > maximum) throw new FanmarkDetailsApiError("fanmark_details_unavailable");
  return value;
}

function hasDisallowedShortIdCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f || character === "/" || character === "\\";
  });
}

function nullableText(value: unknown, maximum = 512): string | null {
  return value === null ? null : text(value, maximum);
}

function nullableBoolean(value: unknown): boolean | null {
  if (value === null) return null;
  if (value !== 0 && value !== 1) throw new FanmarkDetailsApiError("fanmark_details_unavailable");
  return value === 1;
}

function booleanInt(value: unknown): boolean {
  if (value !== 0 && value !== 1) throw new FanmarkDetailsApiError("fanmark_details_unavailable");
  return value === 1;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new FanmarkDetailsApiError("fanmark_details_unavailable");
  return value;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new FanmarkDetailsApiError("fanmark_details_unavailable");
  return value.toLowerCase();
}

function parseEmojiIds(value: unknown): string[] {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { throw new FanmarkDetailsApiError("fanmark_details_unavailable"); }
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 5) throw new FanmarkDetailsApiError("fanmark_details_unavailable");
  return parsed.map(uuid);
}

function parseHistory(value: unknown): Record<string, unknown>[] {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { throw new FanmarkDetailsApiError("fanmark_details_unavailable"); }
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_HISTORY_ROWS) throw new FanmarkDetailsApiError("fanmark_details_unavailable");
  return parsed.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) throw new FanmarkDetailsApiError("fanmark_details_unavailable");
    const row = item as Record<string, unknown>;
    return {
      license_start: text(row.license_start, 64),
      license_end: nullableText(row.license_end, 64),
      grace_expires_at: nullableText(row.grace_expires_at, 64),
      excluded_at: nullableText(row.excluded_at, 64),
      is_returned: booleanInt(row.is_returned),
      username: nullableText(row.username, 64),
      display_name: nullableText(row.display_name, 128),
      status: text(row.status, 32),
      is_initial_license: booleanInt(row.is_initial_license),
    };
  });
}

function mapRow(row: DetailRow, now: string, historyAvailable: boolean): Record<string, unknown> {
  const historyCount = count(row.license_history_count);
  if (historyCount > MAX_HISTORY_ROWS) throw new FanmarkDetailsApiError("fanmark_details_unavailable");
  const currentStatus = nullableText(row.current_license_status, 32);
  const currentEnd = nullableText(row.current_license_end, 64);
  const shortId = text(row.short_id, MAX_SHORT_ID_BYTES);
  if (new TextEncoder().encode(shortId).byteLength > MAX_SHORT_ID_BYTES || hasDisallowedShortIdCharacter(shortId)) {
    throw new FanmarkDetailsApiError("fanmark_details_unavailable");
  }
  return {
    fanmark_id: uuid(row.fanmark_id),
    user_input_fanmark: text(row.user_input_fanmark),
    display_fanmark: nullableText(row.display_fanmark),
    emoji_ids: parseEmojiIds(row.emoji_ids),
    fanmark: text(row.normalized_emoji),
    normalized_emoji: text(row.normalized_emoji),
    short_id: shortId,
    fanmark_created_at: text(row.fanmark_created_at, 64),
    current_owner_username: nullableText(row.current_owner_username, 64),
    current_owner_display_name: nullableText(row.current_owner_display_name, 128),
    current_license_start: nullableText(row.current_license_start, 64),
    current_license_end: currentEnd,
    current_license_status: currentStatus,
    current_grace_expires_at: nullableText(row.current_grace_expires_at, 64),
    current_is_returned: nullableBoolean(row.current_is_returned),
    is_currently_active: currentStatus === "active" && (currentEnd === null || currentEnd > now),
    first_acquired_date: nullableText(row.first_acquired_date, 64),
    first_owner_username: nullableText(row.first_owner_username, 64),
    first_owner_display_name: nullableText(row.first_owner_display_name, 128),
    license_history: parseHistory(row.license_history_json),
    history_available: historyAvailable,
    is_favorited: booleanInt(row.is_favorited),
    has_pending_lottery: currentStatus === "grace" && booleanInt(row.is_current_owner) && booleanInt(row.has_user_lottery_entry),
    is_current_owner: booleanInt(row.is_current_owner),
    lottery_entry_count: count(row.lottery_entry_count),
    has_user_lottery_entry: booleanInt(row.has_user_lottery_entry),
  };
}

export function isFanmarkDetailsPath(pathname: string): boolean {
  return pathname === PATH;
}

export async function handleFanmarkDetailsRequest(
  request: Request,
  env: Env,
  resolveAuth: StorageAuthResolver,
  clock: () => Date = () => new Date(),
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isFanmarkDetailsPath(url.pathname)) return null;
  const headers = corsHeaders(request, env);
  if (!headers) return json({ error: "forbidden" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (url.search || request.method !== "POST") {
    headers.set("allow", "POST, OPTIONS");
    return json({ error: "method_not_allowed" }, 405, headers);
  }

  try {
    if (env.FANMARK_DETAILS_BACKEND?.trim() !== "d1" || env.AUTH_BACKEND?.trim() !== "better-auth") {
      throw new FanmarkDetailsApiError("fanmark_details_unavailable");
    }
    const auth = await resolveAuth(request, env);
    if (!auth.available) throw new FanmarkDetailsApiError("fanmark_details_unavailable");
    const currentUserId = auth.userId === null ? null : uuid(auth.userId);
    const shortId = await readShortId(request);
    const database = selectD1Database(env, "business");
    if (!database) throw new FanmarkDetailsApiError("fanmark_details_unavailable");
    const query = currentUserId ? database.prepare(DETAILS_SQL)
      .bind(shortId, currentUserId, currentUserId, currentUserId) : database.prepare(PUBLIC_DETAILS_SQL).bind(shortId);
    const result = await query
      .all<DetailRow>();
    if (result.success !== true || !Array.isArray(result.results) || result.results.length > 1) {
      throw new FanmarkDetailsApiError("fanmark_details_unavailable");
    }
    const row = result.results[0];
    return json({ schemaVersion: 1, result: row ? mapRow(row, clock().toISOString(), currentUserId !== null) : null }, 200, headers);
  } catch (error) {
    const failure = error instanceof FanmarkDetailsApiError ? error : new FanmarkDetailsApiError("fanmark_details_unavailable");
    return json({ error: failure.code }, failure.status, headers);
  }
}
