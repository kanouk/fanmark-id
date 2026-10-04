import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchFanmarkDetailsFromWorker,
  getFanmarkDetailsBackend,
  parseFanmarkDetailsPayload,
  FanmarkDetailsApiError,
} from "./fanmark-details-api.ts";

const details = {
  fanmark_id: "d8416a59-3f01-4c4d-9d9d-201f4f57f00a",
  user_input_fanmark: "🌹",
  display_fanmark: "🌹",
  emoji_ids: ["043a78d4-1e42-4502-9f57-b1d1f93482db"],
  fanmark: "🌹",
  normalized_emoji: "🌹",
  short_id: "rose-owned",
  fanmark_created_at: "2025-01-01T00:00:00.000Z",
  current_owner_username: null,
  current_owner_display_name: null,
  current_license_start: null,
  current_license_end: "2026-10-01T00:00:00.000Z",
  current_license_status: "active",
  current_grace_expires_at: null,
  current_is_returned: false,
  is_currently_active: true,
  first_acquired_date: null,
  first_owner_username: null,
  first_owner_display_name: null,
  license_history: [],
  history_available: false,
  is_favorited: false,
  has_pending_lottery: false,
  is_current_owner: false,
  lottery_entry_count: 0,
  has_user_lottery_entry: false,
};

test("selects the Worker only explicitly and validates the exact DTO", () => {
  assert.equal(getFanmarkDetailsBackend(undefined), "supabase");
  assert.equal(getFanmarkDetailsBackend(" worker "), "worker");
  assert.throws(() => getFanmarkDetailsBackend("automatic"), FanmarkDetailsApiError);
  assert.deepEqual(parseFanmarkDetailsPayload({ schemaVersion: 1, result: details }), details);
  assert.equal(parseFanmarkDetailsPayload({ schemaVersion: 1, result: null }), null);
  assert.throws(() => parseFanmarkDetailsPayload({ schemaVersion: 1, result: { ...details, user_id: "private" } }),
    (error: unknown) => error instanceof FanmarkDetailsApiError && error.kind === "invalid_response");
  assert.throws(() => parseFanmarkDetailsPayload({ schemaVersion: 1, result: {
    ...details, history_available: false, current_owner_username: "should-not-be-public",
  } }), FanmarkDetailsApiError);
  assert.throws(() => parseFanmarkDetailsPayload({ schemaVersion: 2, result: details }), FanmarkDetailsApiError);
});

test("sends the same-origin Better Auth cookie and bounded short-ID request", async () => {
  let captured: { url: string; method?: string; credentials?: RequestCredentials; body?: string } | undefined;
  const result = await fetchFanmarkDetailsFromWorker("rose-owned", {
    baseUrl: "https://app.example.test",
    authBaseUrl: "https://app.example.test",
    fetchImpl: async (input, init) => {
      captured = { url: String(input), method: init?.method, credentials: init?.credentials, body: String(init?.body) };
      return Response.json({ schemaVersion: 1, result: details });
    },
  });
  assert.deepEqual(result, details);
  assert.deepEqual(captured, {
    url: "https://app.example.test/api/fanmarks/details",
    method: "POST",
    credentials: "include",
    body: JSON.stringify({ shortId: "rose-owned" }),
  });
  assert.equal(await fetchFanmarkDetailsFromWorker("legacy_id", {
    baseUrl: "https://app.example.test",
    authBaseUrl: "https://app.example.test",
    fetchImpl: async () => Response.json({ schemaVersion: 1, result: details }),
  }) !== undefined, true);
  await assert.rejects(fetchFanmarkDetailsFromWorker("bad/id", {
    baseUrl: "https://app.example.test",
    authBaseUrl: "https://app.example.test",
    fetchImpl: async () => Response.json({ schemaVersion: 1, result: details }),
  }), FanmarkDetailsApiError);
});

test("does not fall back after an authorization or Worker failure", async () => {
  await assert.rejects(fetchFanmarkDetailsFromWorker("rose-owned", {
    baseUrl: "https://app.example.test",
    authBaseUrl: "https://app.example.test",
    fetchImpl: async () => new Response(null, { status: 401 }),
  }), (error: unknown) => error instanceof FanmarkDetailsApiError && error.kind === "auth_required");
  await assert.rejects(fetchFanmarkDetailsFromWorker("rose-owned", {
    baseUrl: "https://app.example.test",
    authBaseUrl: "https://api.example.test",
    fetchImpl: async () => { throw new Error("must not run cross-origin"); },
  }), FanmarkDetailsApiError);
});

test("rejects oversized Worker responses before parsing them", async () => {
  await assert.rejects(fetchFanmarkDetailsFromWorker("rose-owned", {
    baseUrl: "https://app.example.test",
    authBaseUrl: "https://app.example.test",
    fetchImpl: async () => new Response("x".repeat(50 * 1024)),
  }), (error: unknown) => error instanceof FanmarkDetailsApiError && error.kind === "invalid_response");
});
