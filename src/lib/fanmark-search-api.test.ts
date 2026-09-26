import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFanmarkSearchDetailsUrl,
  fetchFanmarkSearchDetailsFromWorker,
  getFanmarkSearchBackend,
  loadFanmarkSearchDetails,
  parseFanmarkSearchDetailsPayload,
  FanmarkSearchApiError,
} from "./fanmark-search-api.ts";

const FANMARK_ID = "4d5884a0-304d-4205-8f73-251a2ba2f2d0";
const USER_ID = "e62ce4d0-8055-4ecb-9e3a-759d70d659e0";
const ENTRY_ID = "d1b04d8a-9044-4c23-a57d-30a0b66534f6";

const details = {
  id: FANMARK_ID,
  user_input_fanmark: "🌹",
  display_fanmark: "🌹",
  emoji_ids: ["043a78d4-1e42-4502-9f57-b1d1f93482db"],
  normalized_emoji: "🌹",
  short_id: "rose-owned",
  status: "active",
  current_owner_id: USER_ID,
  has_active_license: true,
  license_id: ENTRY_ID,
  current_license_status: "active",
  current_grace_expires_at: null,
  is_blocked_for_registration: true,
  next_available_at: "2999-12-31T23:59:59.000000Z",
  lottery_entry_count: 1,
  has_user_lottery_entry: true,
  user_lottery_entry_id: ENTRY_ID,
};

test("selects Worker only explicitly and builds the fixed detail endpoint", () => {
  assert.equal(getFanmarkSearchBackend(undefined), "supabase");
  assert.equal(getFanmarkSearchBackend(" worker "), "worker");
  assert.throws(() => getFanmarkSearchBackend("automatic"), FanmarkSearchApiError);
  assert.equal(buildFanmarkSearchDetailsUrl("https://api.example.test/").href,
    "https://api.example.test/api/fanmarks/search/details");
  assert.throws(() => buildFanmarkSearchDetailsUrl("https://api.example.test/path"), FanmarkSearchApiError);
});

test("parses only the bounded, allowlisted DTO and rejects protected config fields", () => {
  assert.deepEqual(parseFanmarkSearchDetailsPayload({ schemaVersion: 1, result: details }), details);
  assert.equal(parseFanmarkSearchDetailsPayload({ schemaVersion: 1, result: null }), null);
  assert.throws(() => parseFanmarkSearchDetailsPayload({ schemaVersion: 1, result: { ...details, target_url: "https://private.test" } }),
    (error: unknown) => error instanceof FanmarkSearchApiError && error.kind === "invalid_response");
  assert.throws(() => parseFanmarkSearchDetailsPayload({ schemaVersion: 2, result: details }), FanmarkSearchApiError);
  assert.throws(() => parseFanmarkSearchDetailsPayload({ schemaVersion: 1, result: { ...details, user_lottery_entry_id: null } }),
    FanmarkSearchApiError);
});

test("sends the Better Auth cookie with a same-origin request and maps the DTO", async () => {
  let captured: { url: string; method?: string; credentials?: RequestCredentials; body?: string } | undefined;
  const result = await fetchFanmarkSearchDetailsFromWorker(FANMARK_ID, {
    baseUrl: "https://app.example.test",
    authBaseUrl: "https://app.example.test",
    fetchImpl: async (input, init) => {
      captured = { url: String(input), method: init?.method, credentials: init?.credentials, body: String(init?.body) };
      return Response.json({ schemaVersion: 1, result: details });
    },
  });
  assert.deepEqual(result, details);
  assert.deepEqual(captured, {
    url: "https://app.example.test/api/fanmarks/search/details",
    method: "POST",
    credentials: "include",
    body: JSON.stringify({ fanmarkId: FANMARK_ID }),
  });
});

test("keeps Supabase as an explicit fallback only and does not fallback after Worker failure", async () => {
  let fallbackCalls = 0;
  const fallback = async () => {
    fallbackCalls += 1;
    return [{ id: FANMARK_ID }];
  };
  const sourceResult = await loadFanmarkSearchDetails(FANMARK_ID, { backend: "supabase", fallback });
  assert.deepEqual(sourceResult, [{ id: FANMARK_ID }]);
  assert.equal(fallbackCalls, 1);

  await assert.rejects(loadFanmarkSearchDetails(FANMARK_ID, {
    backend: "worker",
    baseUrl: "https://app.example.test",
    authBaseUrl: "https://app.example.test",
    fetchImpl: async () => new Response("{}", { status: 503, headers: { "content-type": "application/json" } }),
    fallback,
  }), (error: unknown) => error instanceof FanmarkSearchApiError && error.kind === "http");
  assert.equal(fallbackCalls, 1);
});

test("rejects cross-origin auth configuration and malformed Worker response", async () => {
  await assert.rejects(fetchFanmarkSearchDetailsFromWorker(FANMARK_ID, {
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://auth.example.test",
    fetchImpl: async () => Response.json({ schemaVersion: 1, result: null }),
  }), (error: unknown) => error instanceof FanmarkSearchApiError && error.kind === "configuration");
  await assert.rejects(fetchFanmarkSearchDetailsFromWorker(FANMARK_ID, {
    baseUrl: "https://app.example.test",
    authBaseUrl: "https://app.example.test",
    fetchImpl: async () => Response.json({ schemaVersion: 1, result: { ...details, short_id: "" } }),
  }), (error: unknown) => error instanceof FanmarkSearchApiError && error.kind === "invalid_response");
});
