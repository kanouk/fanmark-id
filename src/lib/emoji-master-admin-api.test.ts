import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmojiMasterAdminApi, EmojiMasterAdminApiError, type EmojiMasterAdminItem } from "./emoji-master-admin-api.ts";

const sampleItem: EmojiMasterAdminItem = {
  id: "11111111-1111-4111-8111-111111111111",
  emoji: "🎵",
  shortName: "musical_note",
  keywords: ["music"],
  category: "Objects",
  subcategory: "music",
  codepoints: ["1F3B5"],
  sortOrder: 2,
  updatedAt: "2026-09-24T01:02:03.000Z",
  releaseProtected: false,
};

test("emoji master admin API uses credentialed no-store requests and decodes pages", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const api = createEmojiMasterAdminApi({
    baseUrl: "https://app.example.test",
    fetcher: async (input, init = {}) => {
      calls.push({ url: new URL(String(input)), init });
      return new Response(JSON.stringify({
        schemaVersion: 1,
        activeReleaseVersion: "a".repeat(64),
        page: 1,
        pageSize: 25,
        total: 1,
        items: [sampleItem],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const page = await api.list({ page: 1, pageSize: 25, search: "music & note" });
  assert.equal(page.activeReleaseVersion, "a".repeat(64));
  assert.deepEqual(page.items, [sampleItem]);
  assert.equal(calls[0].url.pathname, "/api/admin/emoji-master");
  assert.equal(calls[0].url.searchParams.get("search"), "music & note");
  assert.equal(calls[0].init.credentials, "include");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.redirect, "error");
});

test("emoji master admin import chunks batches to the Worker limit", async () => {
  const batchSizes: number[] = [];
  const api = createEmojiMasterAdminApi({
    baseUrl: "https://app.example.test",
    fetcher: async (_input, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { records: unknown[] };
      batchSizes.push(body.records.length);
      return new Response(JSON.stringify({ importedCount: body.records.length }), { status: 200 });
    },
  });

  const records = Array.from({ length: 205 }, (_unused, index) => ({
    emoji: `emoji-${index}`,
    shortName: `record-${index}`,
    keywords: [],
    category: null,
    subcategory: null,
    codepoints: ["1F3B5"],
    sortOrder: index,
  }));
  assert.equal(await api.import(records), 205);
  assert.deepEqual(batchSizes, [100, 100, 5]);
});

test("emoji master admin API reports backend authorization errors without falling back", async () => {
  const api = createEmojiMasterAdminApi({
    baseUrl: "https://app.example.test",
    fetcher: async () => new Response(JSON.stringify({ error: "mfa_required" }), { status: 403 }),
  });

  await assert.rejects(
    api.list({ page: 1, pageSize: 25, search: "" }),
    (error: unknown) => error instanceof EmojiMasterAdminApiError && error.code === "mfa_required",
  );
});

test("emoji master admin import reports earlier saved unpublished batches after a later failure", async () => {
  let calls = 0;
  const api = createEmojiMasterAdminApi({
    baseUrl: "https://app.example.test",
    fetcher: async (_input, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        const body = JSON.parse(String(init?.body)) as { records: unknown[] };
        return new Response(JSON.stringify({ importedCount: body.records.length }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "emoji_master_unavailable" }), { status: 503 });
    },
  });

  const records = Array.from({ length: 101 }, (_unused, index) => ({
    emoji: `emoji-${index}`,
    shortName: `record-${index}`,
    keywords: [],
    category: null,
    subcategory: null,
    codepoints: ["1F3B5"],
    sortOrder: index,
  }));
  await assert.rejects(
    api.import(records),
    (error: unknown) => error instanceof EmojiMasterAdminApiError &&
      error.code === "partial_import_failed" && error.importedCount === 100 &&
      error.message.includes("公開版は変わっていません"),
  );
});
