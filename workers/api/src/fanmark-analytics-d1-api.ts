import { selectD1Database, type Env } from "./repository";
import type { StorageAuthResolver } from "./storage-r2";

const FANMARKS_PATH = "/api/me/analytics/fanmarks";
const ANALYTICS_PATH = "/api/me/analytics";
const SUMMARY_PATH = "/api/me/analytics/summary";
const METHODS = "GET, OPTIONS";
const MAX_FANMARKS = 5_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const ANALYTICS_PLANS = new Set(["creator", "business", "enterprise", "admin"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface OwnedFanmarkRow extends Record<string, unknown> {
  id: unknown;
  shortId: unknown;
  userInputFanmark: unknown;
  displayFanmark: unknown;
  fanmarkName: unknown;
  activeLicenseCount: unknown;
}

interface MetricsRow extends Record<string, unknown> {
  accessCount: unknown;
  uniqueVisitors: unknown;
  referrerDirect: unknown;
  referrerSearch: unknown;
  referrerSocial: unknown;
  referrerOther: unknown;
  deviceMobile: unknown;
  deviceTablet: unknown;
  deviceDesktop: unknown;
  accessTypeProfile: unknown;
  accessTypeRedirect: unknown;
  accessTypeText: unknown;
  accessTypeInactive: unknown;
}

const FANMARKS_SQL = `
WITH active_licenses AS (
  SELECT
    l.id AS licenseId,
    l.fanmark_id AS fanmarkId,
    l.display_fanmark AS displayFanmark,
    (SELECT COUNT(*) FROM fanmark_licenses AS active
      WHERE active.fanmark_id = l.fanmark_id AND active.status = 'active') AS activeLicenseCount,
    ROW_NUMBER() OVER (PARTITION BY l.fanmark_id ORDER BY l.created_at DESC, l.id DESC) AS licenseRank
  FROM fanmark_licenses AS l
  WHERE l.user_id = ? AND l.status = 'active'
)
SELECT
  f.id AS id,
  f.short_id AS shortId,
  f.user_input_fanmark AS userInputFanmark,
  active_licenses.displayFanmark AS displayFanmark,
  basic.fanmark_name AS fanmarkName,
  active_licenses.activeLicenseCount AS activeLicenseCount
FROM active_licenses
JOIN fanmarks AS f ON f.id = active_licenses.fanmarkId
LEFT JOIN fanmark_basic_configs AS basic ON basic.license_id = active_licenses.licenseId
WHERE active_licenses.licenseRank = 1
ORDER BY f.created_at DESC, f.id ASC
LIMIT ${MAX_FANMARKS + 1}
`;

const OWNED_IDS_CTE = `
WITH owned_fanmarks AS (
  SELECT DISTINCT fanmark_id
  FROM fanmark_licenses
  WHERE user_id = ? AND status = 'active'
)
`;

export class FanmarkAnalyticsApiError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "FanmarkAnalyticsApiError";
  }
}

function json(body: unknown, status: number, cors: Headers): Response {
  const headers = new Headers(cors);
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");
  let text = JSON.stringify(body);
  let resultStatus = status;
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    text = JSON.stringify({ error: "analytics_unavailable" });
    resultStatus = 503;
  }
  return new Response(text, { status: resultStatus, headers });
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

function validateDate(value: string | null): value is string {
  if (!value || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateRange(url: URL): { startDate: string; endDate: string; fanmarkId: string | null } {
  const allowed = new Set(["start_date", "end_date", "fanmark_id"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new FanmarkAnalyticsApiError("invalid_request", 400);
    }
  }
  const startDate = url.searchParams.get("start_date");
  const endDate = url.searchParams.get("end_date");
  const fanmarkId = url.searchParams.get("fanmark_id");
  if (!validateDate(startDate) || !validateDate(endDate)) {
    throw new FanmarkAnalyticsApiError("invalid_request", 400);
  }
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (end < start || end - start > 90 * 24 * 60 * 60 * 1000 ||
      (fanmarkId !== null && !UUID_RE.test(fanmarkId))) {
    throw new FanmarkAnalyticsApiError("invalid_request", 400);
  }
  return { startDate, endDate, fanmarkId };
}

function ownedFanmarks(rows: OwnedFanmarkRow[]): Array<Record<string, unknown>> {
  if (rows.length > MAX_FANMARKS) throw new FanmarkAnalyticsApiError("analytics_unavailable");
  const seen = new Set<string>();
  return rows.map((row) => {
    if (typeof row.id !== "string" || typeof row.shortId !== "string" ||
        typeof row.userInputFanmark !== "string" || typeof row.activeLicenseCount !== "number" ||
        row.activeLicenseCount !== 1 || seen.has(row.id) ||
        (row.displayFanmark !== null && typeof row.displayFanmark !== "string") ||
        (row.fanmarkName !== null && typeof row.fanmarkName !== "string")) {
      throw new FanmarkAnalyticsApiError("analytics_unavailable");
    }
    seen.add(row.id);
    return {
      id: row.id,
      shortId: row.shortId,
      userInputFanmark: row.userInputFanmark,
      displayFanmark: row.displayFanmark ?? "",
      fanmarkName: row.fanmarkName,
    };
  });
}

function metricValue(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new FanmarkAnalyticsApiError("analytics_unavailable");
  }
  return value;
}

function mapMetrics(row: MetricsRow | undefined): Record<string, number> {
  const data = row ?? {} as MetricsRow;
  return {
    accessCount: metricValue(data.accessCount),
    uniqueVisitors: metricValue(data.uniqueVisitors),
    referrerDirect: metricValue(data.referrerDirect),
    referrerSearch: metricValue(data.referrerSearch),
    referrerSocial: metricValue(data.referrerSocial),
    referrerOther: metricValue(data.referrerOther),
    deviceMobile: metricValue(data.deviceMobile),
    deviceTablet: metricValue(data.deviceTablet),
    deviceDesktop: metricValue(data.deviceDesktop),
    accessTypeProfile: metricValue(data.accessTypeProfile),
    accessTypeRedirect: metricValue(data.accessTypeRedirect),
    accessTypeText: metricValue(data.accessTypeText),
    accessTypeInactive: metricValue(data.accessTypeInactive),
  };
}

function analyticsMetricsSql(extraWhere = ""): string {
  return `${OWNED_IDS_CTE}
    SELECT
      COALESCE(SUM(COALESCE(s.access_count, 0)), 0) AS accessCount,
      COALESCE(SUM(COALESCE(s.unique_visitors, 0)), 0) AS uniqueVisitors,
      COALESCE(SUM(COALESCE(s.referrer_direct, 0)), 0) AS referrerDirect,
      COALESCE(SUM(COALESCE(s.referrer_search, 0)), 0) AS referrerSearch,
      COALESCE(SUM(COALESCE(s.referrer_social, 0)), 0) AS referrerSocial,
      COALESCE(SUM(COALESCE(s.referrer_other, 0)), 0) AS referrerOther,
      COALESCE(SUM(COALESCE(s.device_mobile, 0)), 0) AS deviceMobile,
      COALESCE(SUM(COALESCE(s.device_tablet, 0)), 0) AS deviceTablet,
      COALESCE(SUM(COALESCE(s.device_desktop, 0)), 0) AS deviceDesktop,
      COALESCE(SUM(COALESCE(s.access_type_profile, 0)), 0) AS accessTypeProfile,
      COALESCE(SUM(COALESCE(s.access_type_redirect, 0)), 0) AS accessTypeRedirect,
      COALESCE(SUM(COALESCE(s.access_type_text, 0)), 0) AS accessTypeText,
      COALESCE(SUM(COALESCE(s.access_type_inactive, 0)), 0) AS accessTypeInactive
    FROM fanmark_access_daily_stats AS s
    JOIN owned_fanmarks AS owned ON owned.fanmark_id = s.fanmark_id
    WHERE s.stat_date >= ? AND s.stat_date <= ? ${extraWhere}`;
}

async function checkAnalyticsPlan(db: D1Database, userId: string): Promise<void> {
  const result = await db.prepare("SELECT plan_type AS planType FROM user_settings WHERE user_id = ? LIMIT 2")
    .bind(userId).all<{ planType: unknown }>();
  if (result.success !== true || !Array.isArray(result.results) || result.results.length > 1) {
    throw new FanmarkAnalyticsApiError("analytics_unavailable");
  }
  const plan = result.results[0]?.planType;
  if (typeof plan !== "string" || !ANALYTICS_PLANS.has(plan)) {
    throw new FanmarkAnalyticsApiError("analytics_forbidden", 403);
  }
}

function daysQuery(url: URL): number {
  if ([...url.searchParams.keys()].some((key) => key !== "days") || url.searchParams.getAll("days").length > 1) {
    throw new FanmarkAnalyticsApiError("invalid_request", 400);
  }
  const raw = url.searchParams.get("days") ?? "30";
  if (!/^(?:[1-9]|[1-8][0-9]|90)$/u.test(raw)) throw new FanmarkAnalyticsApiError("invalid_request", 400);
  return Number(raw);
}

async function handleAnalyticsRead(
  request: Request,
  url: URL,
  env: Env,
  userId: string,
  db: D1Database,
  clock: () => Date,
): Promise<Response> {
  if (url.pathname === FANMARKS_PATH) {
    if (url.search) throw new FanmarkAnalyticsApiError("invalid_request", 400);
    const rows = await db.prepare(FANMARKS_SQL).bind(userId).all<OwnedFanmarkRow>();
    if (rows.success !== true || !Array.isArray(rows.results)) throw new FanmarkAnalyticsApiError("analytics_unavailable");
    return json({ schemaVersion: 1, result: ownedFanmarks(rows.results) }, 200, corsHeaders(request, env) ?? new Headers());
  }

  if (url.pathname === SUMMARY_PATH) {
    const days = daysQuery(url);
    const now = clock();
    const endDate = now.toISOString().slice(0, 10);
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days * 24 * 60 * 60 * 1000))
      .toISOString().slice(0, 10);
    const result = await db.prepare(`
      SELECT COALESCE(SUM(COALESCE(stats.access_count, 0)), 0) AS accessCount
      FROM fanmark_access_daily_stats AS stats
      WHERE stats.stat_date >= ? AND stats.stat_date <= ?
        AND EXISTS (
          SELECT 1 FROM fanmark_licenses AS license
          WHERE license.user_id = ? AND license.fanmark_id = stats.fanmark_id
            AND (
              (LOWER(COALESCE(license.status, '')) = 'active'
                AND (license.license_end IS NULL OR julianday(license.license_end) > julianday(?)))
              OR (LOWER(COALESCE(license.status, '')) NOT IN ('active', 'grace', 'expired')
                AND license.license_end IS NOT NULL
                AND julianday(license.license_end) > julianday(?))
            )
        )
    `).bind(startDate, endDate, userId, now.toISOString(), now.toISOString()).first<{ accessCount: unknown }>();
    return json({ schemaVersion: 1, result: { totalAccess: metricValue(result?.accessCount) } }, 200, corsHeaders(request, env) ?? new Headers());
  }

  const range = dateRange(url);
  await checkAnalyticsPlan(db, userId);
  const fanmarksStatement = db.prepare(FANMARKS_SQL).bind(userId);
  const filterSql = range.fanmarkId ? " AND s.fanmark_id = ?" : "";
  const statsArgs = range.fanmarkId
    ? [userId, range.startDate, range.endDate, range.fanmarkId]
    : [userId, range.startDate, range.endDate];
  const selectedSql = analyticsMetricsSql(filterSql);
  const dailySql = `${OWNED_IDS_CTE}
    SELECT s.stat_date AS statDate,
      COALESCE(SUM(COALESCE(s.access_count, 0)), 0) AS accessCount,
      COALESCE(SUM(COALESCE(s.unique_visitors, 0)), 0) AS uniqueVisitors
    FROM fanmark_access_daily_stats AS s
    JOIN owned_fanmarks AS owned ON owned.fanmark_id = s.fanmark_id
    WHERE s.stat_date >= ? AND s.stat_date <= ? ${filterSql}
    GROUP BY s.stat_date ORDER BY s.stat_date ASC LIMIT 91`;
  const fanmarkTotalsSql = `${OWNED_IDS_CTE}
    SELECT s.fanmark_id AS fanmarkId,
      COALESCE(SUM(COALESCE(s.access_count, 0)), 0) AS accessCount
    FROM fanmark_access_daily_stats AS s
    JOIN owned_fanmarks AS owned ON owned.fanmark_id = s.fanmark_id
    WHERE s.stat_date >= ? AND s.stat_date <= ? ${filterSql}
    GROUP BY s.fanmark_id ORDER BY s.fanmark_id ASC LIMIT ${MAX_FANMARKS + 1}`;
  const [fanmarksResult, totalsResult, dailyResult, fanmarkTotalsResult] = await db.batch([
    fanmarksStatement,
    db.prepare(selectedSql).bind(...statsArgs),
    db.prepare(dailySql).bind(...statsArgs),
    db.prepare(fanmarkTotalsSql).bind(...statsArgs),
  ]);
  if (fanmarksResult?.success !== true || !Array.isArray(fanmarksResult.results) ||
      totalsResult?.success !== true || !Array.isArray(totalsResult.results) ||
      dailyResult?.success !== true || !Array.isArray(dailyResult.results) ||
      fanmarkTotalsResult?.success !== true || !Array.isArray(fanmarkTotalsResult.results)) {
    throw new FanmarkAnalyticsApiError("analytics_unavailable");
  }
  const fanmarks = ownedFanmarks(fanmarksResult.results as OwnedFanmarkRow[]);
  if (range.fanmarkId && !fanmarks.some((fanmark) => fanmark.id === range.fanmarkId)) {
    throw new FanmarkAnalyticsApiError("analytics_not_found", 404);
  }
  const dailyStats = (dailyResult.results as Array<Record<string, unknown>>).map((row) => {
    if (typeof row.statDate !== "string" || !validateDate(row.statDate)) throw new FanmarkAnalyticsApiError("analytics_unavailable");
    return { statDate: row.statDate, accessCount: metricValue(row.accessCount), uniqueVisitors: metricValue(row.uniqueVisitors) };
  });
  const fanmarkTotals = (fanmarkTotalsResult.results as Array<Record<string, unknown>>).map((row) => {
    if (typeof row.fanmarkId !== "string" || !UUID_RE.test(row.fanmarkId)) throw new FanmarkAnalyticsApiError("analytics_unavailable");
    return { fanmarkId: row.fanmarkId, accessCount: metricValue(row.accessCount) };
  });
  if (fanmarkTotals.length > MAX_FANMARKS) throw new FanmarkAnalyticsApiError("analytics_unavailable");
  const summary = mapMetrics((totalsResult.results as MetricsRow[])[0]);
  return json({ schemaVersion: 1, result: { fanmarks, summary, dailyStats, fanmarkTotals } }, 200, corsHeaders(request, env) ?? new Headers());
}

export function isFanmarkAnalyticsPath(pathname: string): boolean {
  return pathname === FANMARKS_PATH || pathname === ANALYTICS_PATH || pathname === SUMMARY_PATH;
}

export async function handleFanmarkAnalyticsRequest(
  request: Request,
  env: Env,
  resolveAuth: StorageAuthResolver,
  clock: () => Date = () => new Date(),
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isFanmarkAnalyticsPath(url.pathname)) return null;
  const cors = corsHeaders(request, env);
  if (!cors) return json({ error: "forbidden_origin" }, 403, new Headers());
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET") {
    cors.set("allow", METHODS);
    return json({ error: "method_not_allowed" }, 405, cors);
  }
  if (env.FANMARK_ANALYTICS_BACKEND?.trim() !== "d1" || env.AUTH_BACKEND?.trim() !== "better-auth") {
    return json({ error: "analytics_unavailable" }, 503, cors);
  }
  const database = selectD1Database(env, "business");
  if (!database) return json({ error: "analytics_unavailable" }, 503, cors);

  try {
    const auth = await resolveAuth(request, env);
    if (!auth.available) throw new FanmarkAnalyticsApiError("analytics_unavailable");
    if (!auth.userId) throw new FanmarkAnalyticsApiError("unauthorized", 401);
    const result = await handleAnalyticsRead(request, url, env, auth.userId, database, clock);
    return result;
  } catch (error) {
    if (error instanceof FanmarkAnalyticsApiError) return json({ error: error.code }, error.status, cors);
    return json({ error: "analytics_unavailable" }, 503, cors);
  }
}
