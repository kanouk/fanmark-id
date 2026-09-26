import assert from "node:assert/strict";
import test from "node:test";
import {
  FanmarkAnalyticsApiError,
  fetchFanmarkAnalyticsFanmarksWorker,
  fetchFanmarkAnalyticsSummaryWorker,
  fetchFanmarkAnalyticsWorker,
  getFanmarkAnalyticsBackend,
} from "./fanmark-analytics-api.ts";

const FANMARK_ID = "d8416a59-3f01-4c4d-9d9d-201f4f57f00a";
const FANMARK = {
  id: FANMARK_ID,
  shortId: "rose-owned",
  userInputFanmark: "🌹",
  displayFanmark: "🌹",
  fanmarkName: "Rose",
};
const METRICS = {
  accessCount: 4, uniqueVisitors: 3, referrerDirect: 0, referrerSearch: 2, referrerSocial: 0, referrerOther: 0,
  deviceMobile: 1, deviceTablet: 0, deviceDesktop: 0,
  accessTypeProfile: 4, accessTypeRedirect: 0, accessTypeText: 0, accessTypeInactive: 0,
};

test("analytics selector defaults to Supabase and rejects unknown backends", () => {
  assert.equal(getFanmarkAnalyticsBackend(undefined), "supabase");
  assert.equal(getFanmarkAnalyticsBackend("worker"), "worker");
  assert.throws(() => getFanmarkAnalyticsBackend("unknown"), FanmarkAnalyticsApiError);
});

test("worker analytics calls include cookies only for the same trusted auth origin", async () => {
  let seen: Request | undefined;
  const result = await fetchFanmarkAnalyticsWorker({
    startDate: "2026-09-20", endDate: "2026-09-26", fanmarkId: FANMARK_ID,
  }, {
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetchImpl: async (input, init) => {
      seen = new Request(input, init);
      return Response.json({ schemaVersion: 1, result: {
        fanmarks: [FANMARK],
        summary: METRICS,
        dailyStats: [{ statDate: "2026-09-25", accessCount: 4, uniqueVisitors: 3 }],
        fanmarkTotals: [{ fanmarkId: FANMARK_ID, accessCount: 4 }],
      } });
    },
  });
  assert.equal(seen?.url, `https://api.example.test/api/me/analytics?start_date=2026-09-20&end_date=2026-09-26&fanmark_id=${FANMARK_ID}`);
  assert.equal(seen?.credentials, "include");
  assert.equal(result.fanmarks[0].fanmark_name, "Rose");
  assert.equal(result.summary.accessCount, 4);
  assert.deepEqual(result.dailyStats, [{ stat_date: "2026-09-25", access_count: 4, unique_visitors: 3 }]);

  await assert.rejects(() => fetchFanmarkAnalyticsFanmarksWorker({
    baseUrl: "https://api.example.test", authBaseUrl: "https://other.example.test",
    fetchImpl: async () => { throw new Error("must not fetch"); },
  }), (error: unknown) => error instanceof FanmarkAnalyticsApiError && error.kind === "configuration");
});

test("fanmark list and all-plan dashboard summary parse the narrow DTO", async () => {
  const responses = [
    Response.json({ schemaVersion: 1, result: [FANMARK] }),
    Response.json({ schemaVersion: 1, result: { totalAccess: 12 } }),
  ];
  const fetchImpl: typeof fetch = async () => responses.shift()!;
  const options = { baseUrl: "https://api.example.test", authBaseUrl: "https://api.example.test", fetchImpl };
  assert.deepEqual(await fetchFanmarkAnalyticsFanmarksWorker(options), [{
    id: FANMARK_ID, short_id: "rose-owned", user_input_fanmark: "🌹", display_fanmark: "🌹", fanmark_name: "Rose",
  }]);
  assert.equal(await fetchFanmarkAnalyticsSummaryWorker({ ...options, days: 30 }), 12);
});
