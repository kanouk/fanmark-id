import { selectD1Database, type Env } from "./repository";

const ACCESS_PATH = "/api/fanmarks/access";
const ALLOWED_METHODS = "POST, OPTIONS";
const MAX_BODY_BYTES = 8 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ACCESS_TYPES = new Set(["profile", "redirect", "text", "inactive"]);
const SEARCH_ENGINES = ["google.com", "google.co.jp", "bing.com", "yahoo.com", "yahoo.co.jp", "duckduckgo.com", "baidu.com", "yandex.ru"];
const SOCIAL_PLATFORMS = ["twitter.com", "x.com", "t.co", "instagram.com", "facebook.com", "fb.com", "tiktok.com", "line.me", "linkedin.com", "pinterest.com", "reddit.com", "youtube.com"];

type AccessType = "profile" | "redirect" | "text" | "inactive" | null;
type DeviceType = "desktop" | "tablet" | "mobile" | "unknown";
type ReferrerCategory = "direct" | "search" | "social" | "other";

interface AccessInput {
  fanmarkId: string;
  shortId: string;
  referrer: string | null;
  userAgent: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  accessType: AccessType;
}

function response(body: unknown, status: number, cors = new Headers()): Response {
  const headers = new Headers(cors);
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function originHeaders(request: Request, env: Env): Headers | null {
  const origin = request.headers.get("Origin");
  if (!origin) return new Headers();
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  if (!allowed.has(origin)) return null;
  return new Headers({
    "access-control-allow-origin": origin,
    "access-control-allow-methods": ALLOWED_METHODS,
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  });
}

function boundedText(value: unknown, maximum: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  return value.slice(0, maximum);
}

function parseInput(value: unknown): AccessInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "fanmark_id", "short_id", "referrer", "user_agent", "utm_source", "utm_medium", "utm_campaign", "access_type",
  ]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) return null;
  if (typeof body.fanmark_id !== "string" || !UUID_PATTERN.test(body.fanmark_id)) return null;
  if (typeof body.short_id !== "string" || body.short_id.length < 1 || body.short_id.length > 128 || /\s/u.test(body.short_id)) return null;
  if (["referrer", "user_agent", "utm_source", "utm_medium", "utm_campaign"].some((key) => {
    const field = body[key];
    return field !== undefined && field !== null && typeof field !== "string";
  })) return null;
  if (body.access_type !== undefined && body.access_type !== null && typeof body.access_type !== "string") return null;

  const accessTypeValue = boundedText(body.access_type, 32);
  return {
    fanmarkId: body.fanmark_id,
    shortId: body.short_id,
    referrer: boundedText(body.referrer, 2048),
    userAgent: boundedText(body.user_agent, 512),
    utmSource: boundedText(body.utm_source, 200),
    utmMedium: boundedText(body.utm_medium, 200),
    utmCampaign: boundedText(body.utm_campaign, 200),
    accessType: accessTypeValue && ACCESS_TYPES.has(accessTypeValue) ? accessTypeValue as AccessType : null,
  };
}

function parseUserAgent(userAgent: string | null): { deviceType: DeviceType; browser: string; os: string } {
  if (!userAgent) return { deviceType: "unknown", browser: "unknown", os: "unknown" };
  let deviceType: DeviceType = "desktop";
  if (/tablet|ipad|playbook|silk/i.test(userAgent)) deviceType = "tablet";
  else if (/mobile|iphone|ipod|android.*mobile|windows.*phone|blackberry/i.test(userAgent)) deviceType = "mobile";

  let browser = "other";
  if (/edg/i.test(userAgent)) browser = "edge";
  else if (/opera|opr/i.test(userAgent)) browser = "opera";
  else if (/chrome/i.test(userAgent)) browser = "chrome";
  else if (/safari/i.test(userAgent)) browser = "safari";
  else if (/firefox/i.test(userAgent)) browser = "firefox";

  let os = "other";
  if (/windows/i.test(userAgent)) os = "windows";
  else if (/macintosh|mac os/i.test(userAgent)) os = "macos";
  else if (/android/i.test(userAgent)) os = "android";
  else if (/iphone|ipad|ipod/i.test(userAgent)) os = "ios";
  else if (/linux/i.test(userAgent)) os = "linux";
  return { deviceType, browser, os };
}

function referrerDetails(referrer: string | null): { domain: string | null; category: ReferrerCategory } {
  if (!referrer) return { domain: null, category: "direct" };
  try {
    const url = new URL(referrer);
    if (url.protocol !== "http:" && url.protocol !== "https:") return { domain: null, category: "direct" };
    const domain = url.hostname.replace(/^www\./iu, "").toLowerCase();
    const matches = (candidate: string) => domain === candidate || domain.endsWith(`.${candidate}`);
    const category: ReferrerCategory = SEARCH_ENGINES.some(matches)
      ? "search"
      : SOCIAL_PLATFORMS.some(matches)
        ? "social"
        : "other";
    return { domain, category };
  } catch {
    return { domain: null, category: "direct" };
  }
}

async function visitorHash(userAgent: string | null, fanmarkId: string, date: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${userAgent || "unknown"}-${fanmarkId}-${date}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function readBoundedJson(request: Request): Promise<unknown | null> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function isFanmarkAccessAnalyticsPath(pathname: string): boolean {
  return pathname === ACCESS_PATH;
}

export async function handleFanmarkAccessAnalyticsRequest(
  request: Request,
  env: Env,
  clock: () => Date = () => new Date(),
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isFanmarkAccessAnalyticsPath(url.pathname)) return null;
  const cors = originHeaders(request, env);
  if (!cors) return response({ error: "forbidden_origin" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") {
    cors.set("allow", ALLOWED_METHODS);
    return response({ error: "method_not_allowed" }, 405, cors);
  }
  if (env.FANMARK_ACCESS_ANALYTICS_BACKEND?.trim() !== "d1") {
    return response({ error: "analytics_unavailable" }, 503, cors);
  }
  const database = selectD1Database(env, "business");
  if (!database) return response({ error: "analytics_unavailable" }, 503, cors);

  const input = parseInput(await readBoundedJson(request));
  if (!input) return response({ error: "invalid_request" }, 400, cors);

  try {
    const fanmark = await database.prepare(
      "SELECT id FROM fanmarks WHERE id = ? AND short_id = ? AND status = 'active' LIMIT 1",
    ).bind(input.fanmarkId, input.shortId).first<{ id: string }>();
    if (!fanmark) return response({ success: true, recorded: false }, 200, cors);

    const license = await database.prepare(
      "SELECT id FROM fanmark_licenses WHERE fanmark_id = ? AND status IN ('active', 'grace') ORDER BY created_at DESC, id DESC LIMIT 1",
    ).bind(fanmark.id).first<{ id: string }>();

    const now = clock();
    const accessedAt = now.toISOString();
    const statDate = accessedAt.slice(0, 10);
    const dayStart = `${statDate}T00:00:00.000Z`;
    const cutoff = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const hash = await visitorHash(input.userAgent, fanmark.id, statDate);
    const device = parseUserAgent(input.userAgent);
    const referrer = referrerDetails(input.referrer);

    const statements = await database.batch([
      database.prepare(`
        INSERT INTO fanmark_access_logs (
          fanmark_id, license_id, accessed_at, referrer, referrer_domain, referrer_category,
          user_agent, device_type, browser, os, utm_source, utm_medium, utm_campaign,
          visitor_hash, access_type
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM fanmark_access_logs
          WHERE fanmark_id = ? AND visitor_hash = ? AND accessed_at >= ?
        )
      `).bind(
        fanmark.id, license?.id ?? null, accessedAt, input.referrer, referrer.domain, referrer.category,
        input.userAgent, device.deviceType, device.browser, device.os, input.utmSource, input.utmMedium,
        input.utmCampaign, hash, input.accessType,
        fanmark.id, hash, cutoff,
      ),
      database.prepare(`
        INSERT INTO fanmark_access_daily_stats (
          fanmark_id, license_id, stat_date, access_count, unique_visitors,
          referrer_direct, referrer_search, referrer_social, referrer_other,
          device_mobile, device_tablet, device_desktop, created_at, updated_at,
          access_type_profile, access_type_redirect, access_type_text, access_type_inactive
        )
        SELECT ?, ?, ?, 1,
          (SELECT CASE WHEN COUNT(*) = 1 THEN 1 ELSE 0 END FROM fanmark_access_logs
            WHERE fanmark_id = ? AND visitor_hash = ? AND accessed_at >= ?),
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE changes() = 1
        ON CONFLICT (fanmark_id, stat_date) DO UPDATE SET
          access_count = COALESCE(fanmark_access_daily_stats.access_count, 0) + 1,
          unique_visitors = COALESCE(fanmark_access_daily_stats.unique_visitors, 0) + excluded.unique_visitors,
          referrer_direct = COALESCE(fanmark_access_daily_stats.referrer_direct, 0) + excluded.referrer_direct,
          referrer_search = COALESCE(fanmark_access_daily_stats.referrer_search, 0) + excluded.referrer_search,
          referrer_social = COALESCE(fanmark_access_daily_stats.referrer_social, 0) + excluded.referrer_social,
          referrer_other = COALESCE(fanmark_access_daily_stats.referrer_other, 0) + excluded.referrer_other,
          device_mobile = COALESCE(fanmark_access_daily_stats.device_mobile, 0) + excluded.device_mobile,
          device_tablet = COALESCE(fanmark_access_daily_stats.device_tablet, 0) + excluded.device_tablet,
          device_desktop = COALESCE(fanmark_access_daily_stats.device_desktop, 0) + excluded.device_desktop,
          access_type_profile = COALESCE(fanmark_access_daily_stats.access_type_profile, 0) + excluded.access_type_profile,
          access_type_redirect = COALESCE(fanmark_access_daily_stats.access_type_redirect, 0) + excluded.access_type_redirect,
          access_type_text = COALESCE(fanmark_access_daily_stats.access_type_text, 0) + excluded.access_type_text,
          access_type_inactive = COALESCE(fanmark_access_daily_stats.access_type_inactive, 0) + excluded.access_type_inactive,
          updated_at = excluded.updated_at
      `).bind(
        fanmark.id, license?.id ?? null, statDate, fanmark.id, hash, dayStart,
        Number(referrer.category === "direct"), Number(referrer.category === "search"),
        Number(referrer.category === "social"), Number(referrer.category === "other"),
        Number(device.deviceType === "mobile"), Number(device.deviceType === "tablet"),
        Number(device.deviceType === "desktop"), accessedAt, accessedAt,
        Number(input.accessType === "profile"), Number(input.accessType === "redirect"),
        Number(input.accessType === "text"), Number(input.accessType === "inactive"),
      ),
    ]);
    const recorded = statements[0]?.meta.changes === 1;
    return response({ success: true, recorded }, 200, cors);
  } catch {
    return response({ error: "analytics_write_failed" }, 500, cors);
  }
}
