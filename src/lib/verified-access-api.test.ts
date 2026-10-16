import assert from "node:assert/strict";
import test from "node:test";
import {
  getVerifiedAccessBackend,
  VerifiedAccessApiError,
  verifyAndReadProtectedFanmark,
} from "./verified-access-api.ts";

const FANMARK_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LICENSE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EMOJI_IDS = ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

test("verified-access selector defaults to Supabase and accepts only explicit backends", () => {
  assert.equal(getVerifiedAccessBackend(undefined), "supabase");
  assert.equal(getVerifiedAccessBackend(" supabase "), "supabase");
  assert.equal(getVerifiedAccessBackend("worker"), "worker");
  assert.throws(
    () => getVerifiedAccessBackend("unknown"),
    (error) => error instanceof VerifiedAccessApiError && error.kind === "configuration",
  );
});

test("short-ID verification fetches protected content with the proof cookie and no cache", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input.pathname : String(input);
    calls.push({ url, init: init ?? {} });
    if (url.endsWith("/verify-password")) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    return jsonResponse({ fanmarkId: FANMARK_ID, licenseId: LICENSE_ID, accessType: "text", textContent: "秘密の本文" });
  };

  const result = await verifyAndReadProtectedFanmark(
    { kind: "short", shortId: "xYz-123" },
    "0420",
    { baseUrl: "https://fanmark-app-staging.example.workers.dev", fetchImpl },
  );

  assert.deepEqual(result, { fanmarkId: FANMARK_ID, licenseId: LICENSE_ID, accessType: "text", textContent: "秘密の本文" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/fanmarks/access/short/xYz-123/verify-password");
  assert.equal(calls[1].url, "/api/fanmarks/access/short/xYz-123/protected");
  assert.equal(calls[0].init.body, JSON.stringify({ password: "0420" }));
  for (const call of calls) {
    assert.equal(call.init.credentials, "include");
    assert.equal(call.init.cache, "no-store");
    assert.equal(call.init.headers && (call.init.headers as Record<string, string>).authorization, undefined);
  }
});

test("emoji verification sends the selector to both routes and accepts a protected profile", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input.pathname : String(input);
    calls.push({ url, init: init ?? {} });
    if (url.endsWith("/verify-password")) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    return jsonResponse({
      fanmarkId: FANMARK_ID,
      licenseId: LICENSE_ID,
      accessType: "profile",
      profile: {
        name: "Fan",
        bio: null,
        socialLinks: { website: "https://example.com/" },
        themeSettings: { theme_color: "#123456" },
      },
    });
  };

  const result = await verifyAndReadProtectedFanmark(
    { kind: "emoji", emojiIds: EMOJI_IDS },
    "9876",
    { baseUrl: "https://fanmark-app-staging.example.workers.dev", fetchImpl },
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { emojiIds: EMOJI_IDS, password: "9876" });
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), { emojiIds: EMOJI_IDS });
  assert.equal(calls.every((call) => call.init.method === "POST"), true);
  assert.deepEqual(result, {
    fanmarkId: FANMARK_ID,
    licenseId: LICENSE_ID,
    accessType: "profile",
    profile: { name: "Fan", bio: null, socialLinks: { website: "https://example.com/" }, themeSettings: { theme_color: "#123456" } },
  });
});

test("verification denial never requests protected content or falls back", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return jsonResponse({ error: "access_denied" }, 401);
  };
  await assert.rejects(
    verifyAndReadProtectedFanmark(
      { kind: "short", shortId: "short-id" },
      "1111",
      { baseUrl: "https://fanmark-app-staging.example.workers.dev", fetchImpl },
    ),
    (error) => error instanceof VerifiedAccessApiError && error.kind === "http" && error.status === 401,
  );
  assert.equal(calls, 1);
});

test("malformed protected DTOs and oversized bodies fail closed", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = input instanceof URL ? input.pathname : String(input);
    if (url.endsWith("/verify-password")) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    return jsonResponse({ fanmarkId: FANMARK_ID, licenseId: LICENSE_ID, accessType: "text", textContent: "x", extra: true });
  };
  await assert.rejects(
    verifyAndReadProtectedFanmark({ kind: "short", shortId: "short-id" }, "1234", {
      baseUrl: "https://fanmark-app-staging.example.workers.dev",
      fetchImpl,
    }),
    (error) => error instanceof VerifiedAccessApiError && error.kind === "invalid_response",
  );

  const oversizeFetch: typeof fetch = async (input) => {
    const url = input instanceof URL ? input.pathname : String(input);
    if (url.endsWith("/verify-password")) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    return new Response(" ".repeat(64 * 1024 + 1), { status: 200, headers: { "cache-control": "no-store" } });
  };
  await assert.rejects(
    verifyAndReadProtectedFanmark({ kind: "short", shortId: "short-id" }, "1234", {
      baseUrl: "https://fanmark-app-staging.example.workers.dev",
      fetchImpl: oversizeFetch,
    }),
    (error) => error instanceof VerifiedAccessApiError && error.kind === "invalid_response",
  );
});

test("uncached protected responses are required and timeouts fail without fallback", async () => {
  const cachedFetch: typeof fetch = async (input) => {
    const url = input instanceof URL ? input.pathname : String(input);
    if (url.endsWith("/verify-password")) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    const response = jsonResponse(
      { fanmarkId: FANMARK_ID, licenseId: LICENSE_ID, accessType: "text", textContent: "private" },
      200,
    );
    const headers = new Headers(response.headers);
    headers.set("cache-control", "public, max-age=300");
    return new Response(response.body, { status: response.status, headers });
  };
  await assert.rejects(
    verifyAndReadProtectedFanmark({ kind: "short", shortId: "short-id" }, "1234", {
      baseUrl: "https://fanmark-app-staging.example.workers.dev",
      fetchImpl: cachedFetch,
    }),
    (error) => error instanceof VerifiedAccessApiError && error.kind === "invalid_response",
  );

  let calls = 0;
  const hangingFetch: typeof fetch = async (_input, init) => {
    calls += 1;
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  };
  await assert.rejects(
    verifyAndReadProtectedFanmark({ kind: "short", shortId: "short-id" }, "1234", {
      baseUrl: "https://fanmark-app-staging.example.workers.dev",
      fetchImpl: hangingFetch,
      timeoutMs: 5,
    }),
    (error) => error instanceof VerifiedAccessApiError && error.kind === "timeout",
  );
  assert.equal(calls, 1);
});

test("invalid selector and worker origins are rejected before network use", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response(null, { status: 204 });
  };
  await assert.rejects(
    verifyAndReadProtectedFanmark({ kind: "emoji", emojiIds: ["not-a-uuid"] }, "1234", {
      baseUrl: "https://fanmark-app-staging.example.workers.dev",
      fetchImpl,
    }),
    (error) => error instanceof VerifiedAccessApiError && error.kind === "configuration",
  );
  await assert.rejects(
    verifyAndReadProtectedFanmark({ kind: "short", shortId: "short-id" }, "1234", {
      baseUrl: "https://user:pass@example.com",
      fetchImpl,
    }),
    (error) => error instanceof VerifiedAccessApiError && error.kind === "configuration",
  );
  assert.equal(calls, 0);
});
