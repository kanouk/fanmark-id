import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEmojiCatalogApiUrl,
  EmojiCatalogApiError,
  loadEmojiCatalogFromWorker,
} from "../src/lib/emoji-catalog-worker.ts";

const VERSION = "a".repeat(64);
const BASE_URL = "https://api.example.test";

const FIRST_ITEM = {
  id: "11111111-1111-4111-8111-111111111111",
  emoji: "😀",
  shortName: "grinning face",
  keywords: ["face", "smile"],
  category: "Smileys & Emotion",
  subcategory: "face-smiling",
  codepoints: ["1F600"],
  sortOrder: 1,
};

const SECOND_ITEM = {
  id: "22222222-2222-4222-8222-222222222222",
  emoji: "👩‍💻",
  shortName: "woman technologist",
  keywords: ["coder", "developer"],
  category: "People & Body",
  subcategory: "person-role",
  codepoints: ["1F469", "200D", "1F4BB"],
  sortOrder: 2,
};

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("builds an API URL only from a clean secure Worker origin", () => {
  const url = buildEmojiCatalogApiUrl(BASE_URL, { version: VERSION, offset: 500, limit: 500 });
  assert.equal(url.href, `${BASE_URL}/api/emoji/catalog?version=${VERSION}&offset=500&limit=500`);
  assert.equal(buildEmojiCatalogApiUrl("http://localhost:8787").pathname, "/api/emoji/catalog");
  assert.throws(() => buildEmojiCatalogApiUrl("http://api.example.test"), { name: "EmojiCatalogApiError" });
  assert.throws(() => buildEmojiCatalogApiUrl(`${BASE_URL}/unexpected`), { name: "EmojiCatalogApiError" });
  assert.throws(() => buildEmojiCatalogApiUrl(`${BASE_URL}?token=secret`), { name: "EmojiCatalogApiError" });
});

test("loads every page pinned to the first release version without credentials or cache", async () => {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.cache, "no-store");
    if (calls.length === 1) {
      return response({
        schemaVersion: 1,
        version: VERSION,
        total: 2,
        offset: 0,
        limit: 1,
        nextOffset: 1,
        items: [FIRST_ITEM],
      });
    }
    return response({
      schemaVersion: 1,
      version: VERSION,
      total: 2,
      offset: 1,
      limit: 1,
      nextOffset: null,
      items: [SECOND_ITEM],
    });
  };

  const release = await loadEmojiCatalogFromWorker(BASE_URL, { fetcher, pageSize: 1 });
  assert.deepEqual(release, {
    version: VERSION,
    items: [FIRST_ITEM, SECOND_ITEM],
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.has("version"), false);
  assert.equal(calls[1].url.searchParams.get("version"), VERSION);
  assert.equal(calls[1].url.searchParams.get("offset"), "1");
});

test("rejects an active-version switch during pagination", async () => {
  let callCount = 0;
  const fetcher: typeof fetch = async () => {
    callCount += 1;
    return response({
      schemaVersion: 1,
      version: callCount === 1 ? VERSION : "b".repeat(64),
      total: 2,
      offset: callCount - 1,
      limit: 1,
      nextOffset: callCount === 1 ? 1 : null,
      items: [callCount === 1 ? FIRST_ITEM : SECOND_ITEM],
    });
  };

  await assert.rejects(
    loadEmojiCatalogFromWorker(BASE_URL, { fetcher, pageSize: 1 }),
    (error: unknown) => error instanceof EmojiCatalogApiError && error.kind === "invalid_response",
  );
});

test("rejects incomplete pages and duplicate catalog identities", async () => {
  const incompletePageFetch: typeof fetch = async () => response({
    schemaVersion: 1,
    version: VERSION,
    total: 2,
    offset: 0,
    limit: 1,
    nextOffset: 1,
    items: [],
  });
  await assert.rejects(
    loadEmojiCatalogFromWorker(BASE_URL, { fetcher: incompletePageFetch, pageSize: 1 }),
    (error: unknown) => error instanceof EmojiCatalogApiError && error.kind === "invalid_response",
  );

  let callCount = 0;
  const duplicateFetch: typeof fetch = async () => {
    callCount += 1;
    return response({
      schemaVersion: 1,
      version: VERSION,
      total: 2,
      offset: callCount - 1,
      limit: 1,
      nextOffset: callCount === 1 ? 1 : null,
      items: [FIRST_ITEM],
    });
  };
  await assert.rejects(
    loadEmojiCatalogFromWorker(BASE_URL, { fetcher: duplicateFetch, pageSize: 1 }),
    (error: unknown) => error instanceof EmojiCatalogApiError && error.kind === "invalid_response",
  );
});

test("classifies HTTP failures without attempting another data source", async () => {
  const fetcher: typeof fetch = async () => response({ error: "emoji_catalog_unavailable" }, 503);
  await assert.rejects(
    loadEmojiCatalogFromWorker(BASE_URL, { fetcher }),
    (error: unknown) =>
      error instanceof EmojiCatalogApiError && error.kind === "http" && error.status === 503,
  );
});
