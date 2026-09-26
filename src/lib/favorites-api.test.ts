import assert from "node:assert/strict";
import test from "node:test";
import {
  addWorkerFavoriteFanmark,
  FavoritesApiError,
  getFavoritesBackend,
  loadWorkerFavoriteFanmarkRows,
  parseFavoriteFanmarksPayload,
  removeWorkerFavoriteFanmark,
} from "./favorites-api.ts";

const favorite = {
  favorite_id: "beed0001-0c4f-4ae7-9aa9-7b969f0d9d01",
  discovery_id: "beed0002-0c4f-4ae7-9aa9-7b969f0d9d02",
  favorited_at: "2026-09-25T00:00:00.000Z",
  fanmark_id: null,
  display_fanmark: "👋",
  normalized_emoji_ids: ["beed0003-0c4f-4ae7-9aa9-7b969f0d9d03"],
  emoji_ids: ["beed0004-0c4f-4ae7-9aa9-7b969f0d9d04"],
  availability_status: "unknown",
  search_count: 0,
  favorite_count: 1,
  short_id: null,
  fanmark_name: null,
  access_type: null,
  target_url: null,
  text_content: null,
  current_owner_username: null,
  current_owner_display_name: null,
  current_license_start: null,
  current_license_end: null,
  current_license_status: null,
  is_password_protected: false,
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("favorites backend defaults to Supabase and rejects unknown selectors", () => {
  assert.equal(getFavoritesBackend(undefined), "supabase");
  assert.equal(getFavoritesBackend("worker"), "worker");
  assert.throws(() => getFavoritesBackend("fallback"), FavoritesApiError);
});

test("parses the strict favorites DTO and rejects malformed response shapes", () => {
  assert.deepEqual(parseFavoriteFanmarksPayload({ schemaVersion: 1, items: [favorite] }), [favorite]);
  for (const payload of [
    { schemaVersion: 2, items: [favorite] },
    { schemaVersion: 1, items: [{ ...favorite, user_id: "another-user" }] },
    { schemaVersion: 1, items: [{ ...favorite, emoji_ids: "not-json" }] },
    { schemaVersion: 1, items: [{ ...favorite, is_password_protected: 1 }] },
  ]) assert.throws(() => parseFavoriteFanmarksPayload(payload), FavoritesApiError);
});

test("Worker list uses same-origin credentials, no-store, and a strict payload", async () => {
  let call: { url: URL; init: RequestInit } | undefined;
  const rows = await loadWorkerFavoriteFanmarkRows({
    backend: "worker",
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetchImpl: async (input, init) => {
      call = { url: new URL(String(input)), init: init ?? {} };
      return jsonResponse({ schemaVersion: 1, items: [favorite] });
    },
  });
  assert.deepEqual(rows, [favorite]);
  assert.equal(call?.url.pathname, "/api/me/favorites");
  assert.equal(call?.init.credentials, "include");
  assert.equal(call?.init.cache, "no-store");
  assert.equal(call?.init.redirect, "error");
  await assert.rejects(loadWorkerFavoriteFanmarkRows({
    backend: "worker",
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://auth.example.test",
  }), FavoritesApiError);
});

test("favorite mutations keep the RPC input shape and validate returned booleans", async () => {
  const calls: Array<{ method: string; body: string | undefined }> = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    calls.push({ method: init?.method ?? "", body: init?.body as string | undefined });
    return jsonResponse(calls.length === 1 ? { added: true } : { removed: false });
  };
  const options = { backend: "worker", baseUrl: "https://api.example.test", authBaseUrl: "https://api.example.test", fetchImpl };
  const emojiIds = ["beed0003-0c4f-4ae7-9aa9-7b969f0d9d03"];
  assert.equal(await addWorkerFavoriteFanmark(emojiIds, "👋", options), true);
  assert.equal(await removeWorkerFavoriteFanmark(emojiIds, options), false);
  assert.deepEqual(calls, [
    { method: "POST", body: JSON.stringify({ input_emoji_ids: emojiIds, input_display_fanmark: "👋" }) },
    { method: "DELETE", body: JSON.stringify({ input_emoji_ids: emojiIds }) },
  ]);
  await assert.rejects(addWorkerFavoriteFanmark(emojiIds, "👋", {
    ...options,
    fetchImpl: async () => jsonResponse({ added: "yes" }),
  }), FavoritesApiError);
});
