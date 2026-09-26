import { selectD1Database, type Env } from "./repository";
import type { StorageAuthResolver } from "./storage-r2";

const OWNED_FANMARKS_PATH = "/api/me/fanmarks";
const OWNED_FANMARKS_METHODS = "GET, OPTIONS";
const MAX_OWNED_FANMARKS = 500;

interface OwnedFanmarkRow extends Record<string, unknown> {
  id: unknown;
  userInputFanmark: unknown;
  emojiIds: unknown;
  shortId: unknown;
  fanmarkStatus: unknown;
  fanmarkCreatedAt: unknown;
  fanmarkUpdatedAt: unknown;
  tierLevel: unknown;
  licenseId: unknown;
  licenseStart: unknown;
  licenseEnd: unknown;
  graceExpiresAt: unknown;
  licenseStatus: unknown;
  isReturned: unknown;
  excludedAt: unknown;
  planExcluded: unknown;
  licenseCreatedAt: unknown;
  displayFanmark: unknown;
  basicConfigCount: unknown;
  accessType: unknown;
  fanmarkName: unknown;
  totalCount: unknown;
}

const OWNED_FANMARKS_SQL = `
WITH owned_licenses AS (
  SELECT *
  FROM fanmark_licenses
  WHERE user_id = ?
    AND status IN ('active', 'grace', 'expired')
),
basic_configs AS (
  SELECT
    license_id,
    COUNT(*) AS configCount,
    MAX(access_type) AS accessType,
    MAX(fanmark_name) AS fanmarkName
  FROM fanmark_basic_configs
  WHERE license_id IN (SELECT id FROM owned_licenses)
  GROUP BY license_id
),
owned AS (
  SELECT
    f.id AS id,
    f.user_input_fanmark AS userInputFanmark,
    f.emoji_ids AS emojiIds,
    f.short_id AS shortId,
    f.status AS fanmarkStatus,
    f.created_at AS fanmarkCreatedAt,
    f.updated_at AS fanmarkUpdatedAt,
    f.tier_level AS tierLevel,
    fl.id AS licenseId,
    fl.license_start AS licenseStart,
    fl.license_end AS licenseEnd,
    fl.grace_expires_at AS graceExpiresAt,
    fl.status AS licenseStatus,
    fl.is_returned AS isReturned,
    fl.excluded_at AS excludedAt,
    fl.plan_excluded AS planExcluded,
    fl.created_at AS licenseCreatedAt,
    fl.display_fanmark AS displayFanmark,
    COALESCE(b.configCount, 0) AS basicConfigCount,
    COALESCE(b.accessType, 'inactive') AS accessType,
    b.fanmarkName AS fanmarkName,
    COUNT(*) OVER () AS totalCount
  FROM owned_licenses AS fl
  JOIN fanmarks AS f ON f.id = fl.fanmark_id
  LEFT JOIN basic_configs AS b ON b.license_id = fl.id
  ORDER BY fl.created_at DESC, fl.id ASC
  LIMIT ${MAX_OWNED_FANMARKS + 1}
)
SELECT * FROM owned
`;

export class OwnedFanmarksUnavailableError extends Error {
  constructor() {
    super("owned fanmarks are unavailable");
    this.name = "OwnedFanmarksUnavailableError";
  }
}

export function isOwnedFanmarksPath(pathname: string): boolean {
  return pathname === OWNED_FANMARKS_PATH;
}

function jsonResponse(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function originHeaders(request: Request, env: Env): Headers | null {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (!origin) return headers;
  const allowedOrigins = new Set(
    (env.CORS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (!allowedOrigins.has(origin)) return null;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", OWNED_FANMARKS_METHODS);
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return headers;
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new OwnedFanmarksUnavailableError();
  return value;
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new OwnedFanmarksUnavailableError();
  return value;
}

function parseEmojiIds(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new OwnedFanmarksUnavailableError();
    }
  }
  if (!Array.isArray(parsed) || parsed.some((candidate) => typeof candidate !== "string")) {
    throw new OwnedFanmarksUnavailableError();
  }
  return parsed as string[];
}

function bool(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined) return false;
  throw new OwnedFanmarksUnavailableError();
}

function mapOwnedFanmark(row: OwnedFanmarkRow): Record<string, unknown> {
  const id = requiredText(row.id);
  const licenseId = requiredText(row.licenseId);
  const inputFanmark = nullableText(row.userInputFanmark) ?? "";
  const displayFanmark = nullableText(row.displayFanmark) ?? "";
  const emojiIds = parseEmojiIds(row.emojiIds);
  const status = requiredText(row.licenseStatus);
  if (!new Set(["active", "grace", "expired"]).has(status)) throw new OwnedFanmarksUnavailableError();
  const configCount = Number(row.basicConfigCount);
  if (!Number.isInteger(configCount) || configCount < 0 || configCount > 1) {
    throw new OwnedFanmarksUnavailableError();
  }
  const accessType = requiredText(row.accessType);
  const licenseStart = requiredText(row.licenseStart);
  const licenseCreatedAt = requiredText(row.licenseCreatedAt);
  const fanmarkName = nullableText(row.fanmarkName) ?? (displayFanmark || inputFanmark);
  const emojiKey = emojiIds.length > 0 ? emojiIds.join(":") : displayFanmark || inputFanmark || id;
  const planExcluded = bool(row.planExcluded);
  const tierLevel = row.tierLevel === null || row.tierLevel === undefined ? null : Number(row.tierLevel);
  if (tierLevel !== null && (!Number.isInteger(tierLevel) || tierLevel < 1)) throw new OwnedFanmarksUnavailableError();

  return {
    id,
    user_input_fanmark: inputFanmark,
    emoji_ids: emojiIds,
    fanmark: displayFanmark,
    emoji_key: emojiKey,
    fanmark_name: fanmarkName,
    short_id: requiredText(row.shortId),
    access_type: accessType,
    tier_level: tierLevel,
    current_license_id: licenseId,
    is_transferable: true,
    status: requiredText(row.fanmarkStatus),
    created_at: requiredText(row.fanmarkCreatedAt),
    updated_at: requiredText(row.fanmarkUpdatedAt),
    current_license: {
      id: licenseId,
      license_start: licenseStart,
      license_end: nullableText(row.licenseEnd),
      status,
      created_at: licenseCreatedAt,
    },
    fanmark_licenses: {
      license_start: licenseStart,
      license_end: nullableText(row.licenseEnd),
      grace_expires_at: nullableText(row.graceExpiresAt),
      status,
      is_returned: bool(row.isReturned),
      excluded_at: nullableText(row.excludedAt),
      excluded_from_plan: planExcluded ? "true" : null,
    },
  };
}

export async function handleOwnedFanmarksRequest(
  request: Request,
  env: Env,
  resolveAuth: StorageAuthResolver,
): Promise<Response> {
  const headers = originHeaders(request, env);
  if (!headers) return jsonResponse({ error: "forbidden_origin" }, 403);

  if (request.method === "OPTIONS") {
    const requestedMethod = request.headers.get("access-control-request-method")?.toUpperCase();
    if (requestedMethod && requestedMethod !== "GET") {
      headers.set("allow", OWNED_FANMARKS_METHODS);
      return jsonResponse({ error: "method_not_allowed" }, 405, headers);
    }
    headers.set("allow", OWNED_FANMARKS_METHODS);
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET") {
    headers.set("allow", OWNED_FANMARKS_METHODS);
    return jsonResponse({ error: "method_not_allowed" }, 405, headers);
  }
  if (env.OWNED_FANMARKS_BACKEND?.trim() !== "d1") {
    return jsonResponse({ error: "owned_fanmarks_unavailable" }, 503, headers);
  }
  const database = selectD1Database(env, "business");
  if (!database || env.AUTH_BACKEND?.trim() !== "better-auth") {
    return jsonResponse({ error: "server_misconfigured" }, 500, headers);
  }

  const auth = await resolveAuth(request, env);
  if (!auth.available) return jsonResponse({ error: "auth_unavailable" }, 503, headers);
  if (!auth.userId) return jsonResponse({ error: "unauthorized" }, 401, headers);

  try {
    const result = await database.prepare(OWNED_FANMARKS_SQL).bind(auth.userId).all<OwnedFanmarkRow>();
    const rows = result.results ?? [];
    if (rows.length > MAX_OWNED_FANMARKS || rows.some((row) => Number(row.totalCount) > MAX_OWNED_FANMARKS)) {
      return jsonResponse({ error: "owned_fanmarks_unavailable" }, 503, headers);
    }
    const items = rows.map(mapOwnedFanmark);
    return jsonResponse({ schemaVersion: 1, items }, 200, headers);
  } catch {
    return jsonResponse({ error: "owned_fanmarks_unavailable" }, 503, headers);
  }
}
