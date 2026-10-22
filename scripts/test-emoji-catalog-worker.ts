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

test("loads pinned pages three at a time and preserves order when responses arrive backwards", async () => {
  const pending = new Map<number, () => void>();
  const offsets: number[] = [];
  let active = 0;
  let peak = 0;
  const item = (offset: number) => ({ ...FIRST_ITEM,
    id: `00000000-0000-4000-8000-${String(offset + 1).padStart(12, '0')}`,
    emoji: String.fromCodePoint(0x1f600 + offset), codepoints: [(0x1f600 + offset).toString(16).toUpperCase()],
  });
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    const offset = Number(url.searchParams.get('offset') ?? 0);
    offsets.push(offset);
    if (offset > 0) {
      assert.equal(url.searchParams.get('version'), VERSION);
      active++; peak = Math.max(peak, active);
      await new Promise<void>(resolve => pending.set(offset, resolve));
      active--;
    }
    return response({ schemaVersion: 1, version: VERSION, total: 8, offset, limit: 1,
      nextOffset: offset < 7 ? offset + 1 : null, items: [item(offset)] });
  };
  const waitFor = async (count: number) => {
    for (let attempt = 0; attempt < 100 && offsets.length < count; attempt++) await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(offsets.length, count);
  };
  const loading = loadEmojiCatalogFromWorker(BASE_URL, { fetcher, pageSize: 1 });
  await waitFor(4);
  assert.deepEqual(offsets, [0, 1, 2, 3]);
  for (const offset of [3, 2, 1]) pending.get(offset)!();
  await waitFor(7);
  for (const offset of [6, 5, 4]) pending.get(offset)!();
  await waitFor(8);
  pending.get(7)!();
  assert.equal(peak, 3);
  const release = await loading;
  assert.deepEqual(release.items.map(entry => entry.id), Array.from({ length: 8 }, (_, offset) => item(offset).id));
});

test("a duplicate in separately fetched pages rejects the entire catalog", async () => {
  const fetcher: typeof fetch = async input => {
    const offset = Number(new URL(String(input)).searchParams.get('offset') ?? 0);
    return response({ schemaVersion: 1, version: VERSION, total: 3, offset, limit: 1,
      nextOffset: offset < 2 ? offset + 1 : null, items: [offset === 0 ? FIRST_ITEM : SECOND_ITEM] });
  };
  await assert.rejects(loadEmojiCatalogFromWorker(BASE_URL, { fetcher, pageSize: 1 }),
    (error: unknown) => error instanceof EmojiCatalogApiError && error.kind === 'invalid_response');
});

test("loads every page pinned to the first release version with same-origin cookies and without cache", async () => {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    assert.equal(init?.credentials, "same-origin");
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

test("can pin the first page to an explicitly selected immutable release", async () => {
  let requestedUrl: URL | undefined;
  const fetcher: typeof fetch = async (input) => {
    requestedUrl = new URL(String(input));
    return response({
      schemaVersion: 1,
      version: VERSION,
      total: 1,
      offset: 0,
      limit: 1,
      nextOffset: null,
      items: [FIRST_ITEM],
    });
  };

  const release = await loadEmojiCatalogFromWorker(BASE_URL, {
    fetcher,
    pageSize: 1,
    version: VERSION,
  });
  assert.equal(release.version, VERSION);
  assert.equal(requestedUrl?.searchParams.get("version"), VERSION);
});

test("rejects an invalid configured release before fetching", async () => {
  let fetchCount = 0;
  const fetcher: typeof fetch = async () => {
    fetchCount += 1;
    return response({});
  };

  await assert.rejects(
    loadEmojiCatalogFromWorker(BASE_URL, { fetcher, version: "not-a-release" }),
    (error: unknown) => error instanceof EmojiCatalogApiError && error.kind === "configuration",
  );
  assert.equal(fetchCount, 0);
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
