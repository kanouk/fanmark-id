import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFanmarkAccessAnalyticsApiUrl,
  FanmarkAccessAnalyticsApiError,
  getFanmarkAccessAnalyticsBackend,
  recordFanmarkAccessWithWorker,
} from "./fanmark-access-analytics-api.ts";

test("analytics backend is opt-in and rejects an unknown selector", () => {
  assert.equal(getFanmarkAccessAnalyticsBackend(undefined), "supabase");
  assert.equal(getFanmarkAccessAnalyticsBackend("worker"), "worker");
  assert.throws(() => getFanmarkAccessAnalyticsBackend("typo"), FanmarkAccessAnalyticsApiError);
});

test("analytics URL uses the bounded Worker origin", () => {
  assert.equal(buildFanmarkAccessAnalyticsApiUrl("https://api.example.test/").toString(), "https://api.example.test/api/fanmarks/access");
  assert.throws(() => buildFanmarkAccessAnalyticsApiUrl("https://api.example.test/path"), FanmarkAccessAnalyticsApiError);
});

test("worker request omits credentials and validates the acknowledgement", async () => {
  let seen: Request | undefined;
  const recorded = await recordFanmarkAccessWithWorker({
    fanmark_id: "d8416a59-3f01-4c4d-9d9d-201f4f57f00a",
    short_id: "rose-owned",
    referrer: null,
    user_agent: "synthetic",
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    access_type: "profile",
  }, {
    baseUrl: "https://api.example.test",
    fetchImpl: async (input, init) => {
      seen = new Request(input, init);
      return Response.json({ success: true, recorded: false });
    },
  });
  assert.equal(recorded, false);
  assert.equal(seen?.url, "https://api.example.test/api/fanmarks/access");
  assert.equal(seen?.credentials, "omit");

  await assert.rejects(() => recordFanmarkAccessWithWorker({
    fanmark_id: "d8416a59-3f01-4c4d-9d9d-201f4f57f00a",
    short_id: "rose-owned",
    referrer: null,
    user_agent: "synthetic",
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    access_type: "profile",
  }, { baseUrl: "https://api.example.test", fetchImpl: async () => new Response("bad", { status: 500 }) }),
  (error: unknown) => error instanceof FanmarkAccessAnalyticsApiError && error.kind === "invalid_response");
});
