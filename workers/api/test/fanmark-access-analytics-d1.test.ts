import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "./fixtures/d1-fanmark-access-analytics.sql?raw";
import { handleFanmarkAccessAnalyticsRequest } from "../src/fanmark-access-analytics-d1-api";
import { handleFanmarkAnalyticsRequest } from "../src/fanmark-analytics-d1-api";
import type { Env } from "../src/repository";
import type { StorageAuthResolver } from "../src/storage-r2";

const runtimeEnv = env as unknown as Env;
const database = runtimeEnv.FANMARK_DB;
const API_BASE = "https://api.example.test";
const APP_ORIGIN = "https://app.example.test";
const FANMARK_ID = "d8416a59-3f01-4c4d-9d9d-201f4f57f00a";
const OTHER_FANMARK_ID = "e8416a59-3f01-4c4d-9d9d-201f4f57f00a";
const LICENSE_ID = "45111111-1111-4111-8111-111111111111";
const OTHER_LICENSE_ID = "45222222-2222-4222-8222-222222222222";
const USER_ID = "e62ce4d0-8055-4ecb-9e3a-759d70d659e0";
const OTHER_USER_ID = "2a1b9c5f-3c8a-4890-9e04-3768885b6dd8";
const START = new Date("2026-09-26T10:00:00.000Z");
const ownerAuth: StorageAuthResolver = async () => ({ available: true, userId: USER_ID });
const otherAuth: StorageAuthResolver = async () => ({ available: true, userId: OTHER_USER_ID });
const anonymousAuth: StorageAuthResolver = async () => ({ available: true, userId: null });

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${API_BASE}/api/fanmarks/access`, {
    method: "POST",
    headers: { Origin: APP_ORIGIN, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function makeReadRequest(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${API_BASE}${path}`, { method: "GET", headers: { Origin: APP_ORIGIN, ...headers } });
}

const input = (overrides: Record<string, unknown> = {}) => ({
  fanmark_id: FANMARK_ID,
  short_id: "rose-owned",
  referrer: "https://www.google.co.jp/search?q=rose",
  user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  utm_source: "campaign",
  utm_medium: "social",
  utm_campaign: "autumn",
  access_type: "profile",
  ...overrides,
});

async function call(body: unknown, clock = () => new Date(START), headers: Record<string, string> = {}) {
  return handleFanmarkAccessAnalyticsRequest(makeRequest(body, headers), runtimeEnv, clock);
}

beforeAll(async () => {
  if (!database) throw new Error("Business D1 binding unavailable");
  const statements = schemaSql.split(";").map((statement) => statement.trim()).filter(Boolean);
  await database.batch(statements.map((statement) => database.prepare(statement)));
});

beforeEach(async () => {
  if (!database) throw new Error("Business D1 binding unavailable");
  for (const table of ["fanmark_access_daily_stats", "fanmark_access_logs", "fanmark_basic_configs", "fanmark_licenses", "user_settings", "fanmarks"]) {
    await database.prepare(`DELETE FROM ${table}`).run();
  }
  await database.prepare("INSERT INTO user_settings (user_id, plan_type) VALUES (?, ?), (?, ?)")
    .bind(USER_ID, "business", OTHER_USER_ID, "free").run();
  await database.prepare("INSERT INTO fanmarks (id, short_id, status, user_input_fanmark, created_at) VALUES (?, ?, 'active', ?, ?), (?, ?, 'active', ?, ?)")
    .bind(FANMARK_ID, "rose-owned", "🌹", "2025-01-01T00:00:00.000Z", OTHER_FANMARK_ID, "violet-owned", "💜", "2025-02-01T00:00:00.000Z").run();
  await database.prepare("INSERT INTO fanmark_licenses (id, fanmark_id, user_id, status, created_at, license_end, display_fanmark) VALUES (?, ?, ?, 'active', ?, ?, ?), (?, ?, ?, 'active', ?, ?, ?)")
    .bind(LICENSE_ID, FANMARK_ID, USER_ID, "2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z", "🌹",
      OTHER_LICENSE_ID, OTHER_FANMARK_ID, OTHER_USER_ID, "2026-09-02T00:00:00.000Z", "2026-10-01T00:00:00.000Z", "💜").run();
  await database.prepare("INSERT INTO fanmark_basic_configs (id, license_id, fanmark_name) VALUES (?, ?, ?), (?, ?, ?)")
    .bind("b1", LICENSE_ID, "Rose", "b2", OTHER_LICENSE_ID, "Violet").run();
});

describe("public fanmark access analytics D1 API", () => {
  it("records a bounded log and atomically updates daily aggregate fields", async () => {
    const response = await call(input());
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ success: true, recorded: true });
    const log = await database!.prepare("SELECT * FROM fanmark_access_logs").first<Record<string, unknown>>();
    expect(log).toMatchObject({
      fanmark_id: FANMARK_ID,
      license_id: LICENSE_ID,
      referrer_domain: "google.co.jp",
      referrer_category: "search",
      device_type: "mobile",
      browser: "safari",
      os: "macos",
      access_type: "profile",
    });
    expect(log?.visitor_hash).toMatch(/^[0-9a-f]{32}$/u);
    const stats = await database!.prepare("SELECT * FROM fanmark_access_daily_stats").first<Record<string, number>>();
    expect(stats).toMatchObject({
      access_count: 1,
      unique_visitors: 1,
      referrer_search: 1,
      device_mobile: 1,
      access_type_profile: 1,
    });
  });

  it("deduplicates simultaneous requests and does not inflate daily stats", async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, () => call(input())));
    const payloads = await Promise.all(responses.map((response) => response?.json() as Promise<{ recorded: boolean }>));
    expect(payloads.filter((payload) => payload.recorded)).toHaveLength(1);
    const logs = await database!.prepare("SELECT COUNT(*) AS count FROM fanmark_access_logs").first<{ count: number }>();
    const stats = await database!.prepare("SELECT access_count, unique_visitors FROM fanmark_access_daily_stats").first<{ access_count: number; unique_visitors: number }>();
    expect(logs?.count).toBe(1);
    expect(stats).toEqual({ access_count: 1, unique_visitors: 1 });
  });

  it("allows the same visitor after five minutes but counts one unique visitor for the day", async () => {
    await call(input());
    const later = new Date(START.getTime() + 5 * 60 * 1000 + 1);
    const response = await call(input({ referrer: null, access_type: "redirect" }), () => later);
    expect(await response?.json()).toEqual({ success: true, recorded: true });
    const stats = await database!.prepare("SELECT access_count, unique_visitors, referrer_direct, access_type_redirect FROM fanmark_access_daily_stats")
      .first<Record<string, number>>();
    expect(stats).toEqual({ access_count: 2, unique_visitors: 1, referrer_direct: 1, access_type_redirect: 1 });
  });

  it("rejects malformed and oversized requests, disallowed origins, and mismatched IDs", async () => {
    expect((await call("{"))?.status).toBe(400);
    expect((await call(input({ unexpected: true })))?.status).toBe(400);
    expect((await call(input(), () => new Date(START), { Origin: "https://attacker.example.test" }))?.status).toBe(403);
    expect((await call("x".repeat(9000)))?.status).toBe(400);
    expect(await (await call(input({ fanmark_id: "a8416a59-3f01-4c4d-9d9d-201f4f57f00a" })))?.json())
      .toEqual({ success: true, recorded: false });
    const logs = await database!.prepare("SELECT COUNT(*) AS count FROM fanmark_access_logs").first<{ count: number }>();
    expect(logs?.count).toBe(0);
  });

  it("fails closed when the backend is not explicitly selected", async () => {
    const response = await handleFanmarkAccessAnalyticsRequest(makeRequest(input()), { ...runtimeEnv, FANMARK_ACCESS_ANALYTICS_BACKEND: undefined });
    expect(response?.status).toBe(503);
  });

  it("returns only the authenticated owner's fanmarks and aggregate analytics", async () => {
    await database!.prepare(`INSERT INTO fanmark_access_daily_stats (
      fanmark_id, license_id, stat_date, access_count, unique_visitors, referrer_search, device_mobile, access_type_profile
    ) VALUES (?, ?, '2026-09-25', 4, 3, 2, 1, 4), (?, ?, '2026-09-25', 90, 80, 50, 30, 50)`)
      .bind(FANMARK_ID, LICENSE_ID, OTHER_FANMARK_ID, OTHER_LICENSE_ID).run();
    const response = await handleFanmarkAnalyticsRequest(
      makeReadRequest("/api/me/analytics?start_date=2026-09-20&end_date=2026-09-26"),
      { ...runtimeEnv, FANMARK_ANALYTICS_BACKEND: "d1", AUTH_BACKEND: "better-auth" }, ownerAuth, () => new Date(START),
    );
    expect(response?.status).toBe(200);
    const result = (await response?.json() as { result: Record<string, unknown> }).result;
    expect(result.fanmarks).toEqual([{
      id: FANMARK_ID, shortId: "rose-owned", userInputFanmark: "🌹", displayFanmark: "🌹", fanmarkName: "Rose",
    }]);
    expect(result.summary).toMatchObject({ accessCount: 4, uniqueVisitors: 3, referrerSearch: 2, deviceMobile: 1, accessTypeProfile: 4 });
    expect(result.dailyStats).toEqual([{ statDate: "2026-09-25", accessCount: 4, uniqueVisitors: 3 }]);
    expect(result.fanmarkTotals).toEqual([{ fanmarkId: FANMARK_ID, accessCount: 4 }]);
    expect(JSON.stringify(result)).not.toContain(OTHER_FANMARK_ID);
    expect(JSON.stringify(result)).not.toContain(USER_ID);
  });

  it("requires the current session and the analytics plan, and rejects invalid or unowned filters", async () => {
    const envWithBackend = { ...runtimeEnv, FANMARK_ANALYTICS_BACKEND: "d1", AUTH_BACKEND: "better-auth" };
    const path = "/api/me/analytics?start_date=2026-09-20&end_date=2026-09-26";
    expect((await handleFanmarkAnalyticsRequest(makeReadRequest(path), envWithBackend, anonymousAuth))?.status).toBe(401);
    expect((await handleFanmarkAnalyticsRequest(makeReadRequest(path), envWithBackend, otherAuth))?.status).toBe(403);
    expect((await handleFanmarkAnalyticsRequest(makeReadRequest("/api/me/analytics?start_date=not-a-date&end_date=2026-09-26"), envWithBackend, ownerAuth))?.status).toBe(400);
    const unowned = await handleFanmarkAnalyticsRequest(
      makeReadRequest(`/api/me/analytics?start_date=2026-09-20&end_date=2026-09-26&fanmark_id=${OTHER_FANMARK_ID}`),
      envWithBackend, ownerAuth,
    );
    expect(unowned?.status).toBe(404);
  });

  it("limits dashboard summary to the current user's derived-active licenses", async () => {
    const today = START.toISOString().slice(0, 10);
    const graceFanmarkId = "f8416a59-3f01-4c4d-9d9d-201f4f57f00a";
    const graceLicenseId = "45333333-3333-4333-8333-333333333333";
    await database!.prepare("INSERT INTO fanmarks (id, short_id, status, user_input_fanmark, created_at) VALUES (?, ?, 'active', ?, ?)")
      .bind(graceFanmarkId, "grace-owned", "🌱", "2026-09-03T00:00:00.000Z").run();
    await database!.prepare(`INSERT INTO fanmark_licenses (
      id, fanmark_id, user_id, status, created_at, license_end, grace_expires_at, is_returned, display_fanmark
    ) VALUES (?, ?, ?, 'grace', ?, ?, ?, 0, ?)`)
      .bind(graceLicenseId, graceFanmarkId, USER_ID, "2026-09-03T00:00:00.000Z", "2026-09-24T00:00:00.000Z", "2026-10-01T00:00:00.000Z", "🌱").run();
    await database!.prepare("INSERT INTO fanmark_access_daily_stats (fanmark_id, license_id, stat_date, access_count) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)")
      .bind(FANMARK_ID, LICENSE_ID, today, 7, OTHER_FANMARK_ID, OTHER_LICENSE_ID, today, 500, graceFanmarkId, graceLicenseId, today, 200).run();
    const response = await handleFanmarkAnalyticsRequest(
      makeReadRequest("/api/me/analytics/summary?days=30"),
      { ...runtimeEnv, FANMARK_ANALYTICS_BACKEND: "d1", AUTH_BACKEND: "better-auth" }, ownerAuth, () => new Date(START),
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ schemaVersion: 1, result: { totalAccess: 7 } });
  });
});
