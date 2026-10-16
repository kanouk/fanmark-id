import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRecentFanmarksApiUrl,
  fetchRecentFanmarksFromWorker,
  getRecentFanmarksApiBaseUrl,
  loadRecentFanmarks,
  mapRecentFanmarkRpcRows,
  parseRecentFanmarksApiPayload,
  RecentFanmarksApiError,
} from "./recent-fanmarks.ts";

test("selects the Worker only when the environment value is non-empty", () => {
  assert.equal(getRecentFanmarksApiBaseUrl(undefined), undefined);
  assert.equal(getRecentFanmarksApiBaseUrl("   "), undefined);
  assert.equal(getRecentFanmarksApiBaseUrl(" https://api.example.test "), "https://api.example.test");
});

test("builds a bounded endpoint and permits localhost HTTP development URLs", () => {
  assert.equal(
    buildRecentFanmarksApiUrl("https://api.example.test/", 2).toString(),
    "https://api.example.test/api/fanmarks/recent?limit=2",
  );
  assert.equal(
    buildRecentFanmarksApiUrl("http://localhost:8787", 20).toString(),
    "http://localhost:8787/api/fanmarks/recent?limit=20",
  );

  for (const invalidUrl of [
    "",
    "not a URL",
    "http://api.example.test",
    "https://api.example.test/path",
    "https://user:password@api.example.test",
    "https://api.example.test?secret=1",
    "https://api.example.test#fragment",
  ]) {
    assert.throws(
      () => buildRecentFanmarksApiUrl(invalidUrl),
      (error: unknown) => error instanceof RecentFanmarksApiError && error.kind === "configuration",
    );
  }
});

test("maps the versioned Worker payload and rejects malformed schema", () => {
  assert.deepEqual(
    parseRecentFanmarksApiPayload({
      schemaVersion: 1,
      items: [
        {
          id: "license-1",
          emoji: "🌿",
          createdAt: "2026-09-21T00:00:00.000Z",
          shortId: "PUBLIC01",
          fanmarkId: "fanmark-1",
          privateField: "discarded",
        },
      ],
    }),
    [
      {
        id: "license-1",
        emoji: "🌿",
        created_at: "2026-09-21T00:00:00.000Z",
        short_id: "PUBLIC01",
        fanmark_id: "fanmark-1",
      },
    ],
  );

  for (const malformed of [
    null,
    { schemaVersion: 2, items: [] },
    { schemaVersion: 1, items: [{ id: "missing-emoji", createdAt: null }] },
    { schemaVersion: 1, items: [{ id: "bad-created-at", emoji: "🧪", createdAt: 1 }] },
    { schemaVersion: 1, items: [{ id: "bad-short-id", emoji: "🧪", createdAt: null, shortId: 1 }] },
    { schemaVersion: 1, items: [{ id: "bad-fanmark-id", emoji: "🧪", createdAt: null, fanmarkId: 1 }] },
  ]) {
    assert.throws(
      () => parseRecentFanmarksApiPayload(malformed),
      (error: unknown) => error instanceof RecentFanmarksApiError && error.kind === "invalid_response",
    );
  }
});

test("preserves the Supabase fallback mapping and license-id precedence", () => {
  assert.deepEqual(
    mapRecentFanmarkRpcRows([
      {
        license_id: "license-1",
        fanmark_id: "fanmark-1",
        fanmark_short_id: "PUBLIC01",
        display_emoji: "🌿",
        license_created_at: "2026-09-21T00:00:00.000Z",
        user_id: "discarded",
      },
      {
        license_id: null,
        fanmark_id: "fanmark-2",
        display_emoji: null,
        license_created_at: null,
      },
    ]),
    [
      { id: "license-1", emoji: "🌿", created_at: "2026-09-21T00:00:00.000Z", short_id: "PUBLIC01", fanmark_id: "fanmark-1" },
      { id: "fanmark-2", emoji: "❓", created_at: null, short_id: null, fanmark_id: "fanmark-2" },
    ],
  );
});

test("sends only public request metadata and validates HTTP failures", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const response = await fetchRecentFanmarksFromWorker("https://api.example.test", {
    fetcher: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return Response.json({
        schemaVersion: 1,
        items: [{ id: "fanmark-1", emoji: "🧪", createdAt: null, shortId: "SHORT01", fanmarkId: "fanmark-1" }],
      });
    },
  });

  assert.equal(requestUrl, "https://api.example.test/api/fanmarks/recent?limit=20");
  assert.equal(requestInit?.method, "GET");
  assert.equal(new Headers(requestInit?.headers).get("accept"), "application/json");
  assert.equal(new Headers(requestInit?.headers).get("authorization"), null);
  assert.equal(new Headers(requestInit?.headers).get("cookie"), null);
  assert.equal(requestInit?.credentials, "omit");
  assert.equal(requestInit?.cache, "no-store");
  assert.equal(requestInit?.redirect, "error");
  assert.deepEqual(response, [{ id: "fanmark-1", emoji: "🧪", created_at: null, short_id: "SHORT01", fanmark_id: "fanmark-1" }]);

  await assert.rejects(
    () =>
      fetchRecentFanmarksFromWorker("https://api.example.test", {
        fetcher: async () => new Response("private upstream detail", { status: 503 }),
      }),
    (error: unknown) =>
      error instanceof RecentFanmarksApiError && error.kind === "http" && error.status === 503,
  );
});

test("does not call the Supabase fallback after an explicitly selected Worker fails", async () => {
  let fallbackCalls = 0;

  await assert.rejects(
    () =>
      loadRecentFanmarks({
        apiBaseUrl: "https://api.example.test",
        fetcher: async () => new Response("private upstream detail", { status: 503 }),
        fallback: async () => {
          fallbackCalls += 1;
          return [];
        },
      }),
    (error: unknown) => error instanceof RecentFanmarksApiError && error.kind === "http",
  );

  assert.equal(fallbackCalls, 0);
});

test("rejects a malformed response before it reaches the UI", async () => {
  await assert.rejects(
    () =>
      fetchRecentFanmarksFromWorker("https://api.example.test", {
        fetcher: async () =>
          Response.json({
            schemaVersion: 1,
            items: [{ id: "missing-emoji", createdAt: null }],
          }),
      }),
    (error: unknown) => error instanceof RecentFanmarksApiError && error.kind === "invalid_response",
  );
});

test("aborts a stalled Worker request at the timeout", async () => {
  await assert.rejects(
    () =>
      fetchRecentFanmarksFromWorker("https://api.example.test", {
        timeoutMs: 5,
        fetcher: (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("timed out", "AbortError"));
            });
          }),
      }),
    (error: unknown) => error instanceof RecentFanmarksApiError && error.kind === "timeout",
  );
});

test("propagates unmount cancellation without waiting for the timeout", async () => {
  const controller = new AbortController();
  let observedSignal: AbortSignal | undefined;
  const request = fetchRecentFanmarksFromWorker("https://api.example.test", {
    signal: controller.signal,
    timeoutMs: 30_000,
    fetcher: (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        observedSignal = init?.signal;
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("unmounted", "AbortError"));
        });
      }),
  });

  controller.abort();
  await assert.rejects(
    request,
    (error: unknown) => error instanceof RecentFanmarksApiError && error.kind === "aborted",
  );
  assert.equal(observedSignal?.aborted, true);
});
