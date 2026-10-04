import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFanmarkTransferApiUrl,
  callFanmarkTransferWorker,
  getFanmarkTransferBackend,
  FanmarkTransferApiError,
} from "./fanmark-transfer-api.ts";

test("defaults to Supabase and accepts the explicit Worker backend", () => {
  assert.equal(getFanmarkTransferBackend(undefined), "supabase");
  assert.equal(getFanmarkTransferBackend(" worker "), "worker");
  assert.throws(() => getFanmarkTransferBackend("cloudflare"), { name: "FanmarkTransferApiError" });
});

test("builds all transfer routes on the configured app origin", () => {
  assert.equal(buildFanmarkTransferApiUrl("list", "https://app.example.test").href,
    "https://app.example.test/api/me/transfers");
  assert.equal(buildFanmarkTransferApiUrl("issue", "https://app.example.test").href,
    "https://app.example.test/api/me/transfers/issue");
  assert.equal(buildFanmarkTransferApiUrl("approve", "https://app.example.test").href,
    "https://app.example.test/api/me/transfers/approve");
});

test("lists caller transfer data with a credentialed no-store GET", async () => {
  let captured: Request | undefined;
  const result = await callFanmarkTransferWorker<{
    issuedCodes: unknown[];
    pendingRequests: unknown[];
    myRequests: unknown[];
  }>("list", undefined, {
    baseUrl: "https://app.example.test",
    authBaseUrl: "https://app.example.test",
    fetchImpl: async (input, init) => {
      captured = new Request(input, init);
      return new Response(JSON.stringify({ issuedCodes: [], pendingRequests: [], myRequests: [] }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(captured?.url, "https://app.example.test/api/me/transfers");
  assert.equal(captured?.method, "GET");
  assert.equal(captured?.credentials, "include");
  assert.equal(captured?.cache, "no-store");
  assert.deepEqual(result, { issuedCodes: [], pendingRequests: [], myRequests: [] });
});

test("posts operations and preserves Worker error codes without fallback", async () => {
  let captured: Request | undefined;
  let calls = 0;
  try {
    await callFanmarkTransferWorker("apply", { transfer_code: "ABCD-EFGH-JKLM" }, {
      baseUrl: "https://app.example.test",
      authBaseUrl: "https://app.example.test",
      fetchImpl: async (input, init) => {
        calls += 1;
        captured = new Request(input, init);
        return new Response(JSON.stringify({ error: "fanmark_limit_exceeded", current: 3, limit: 3 }), {
          status: 400, headers: { "content-type": "application/json" },
        });
      },
    });
    assert.fail("expected a Worker error");
  } catch (error) {
    assert.ok(error instanceof FanmarkTransferApiError);
    assert.equal(error.message, "fanmark_limit_exceeded (400)");
    assert.deepEqual(error.context, { error: "fanmark_limit_exceeded", current: 3, limit: 3 });
  }
  assert.equal(calls, 1);
  assert.equal(captured?.url, "https://app.example.test/api/me/transfers/apply");
  assert.equal(captured?.method, "POST");
  assert.deepEqual(await captured?.json(), { transfer_code: "ABCD-EFGH-JKLM" });
});

test("rejects cross-origin auth and malformed responses before accepting a result", async () => {
  let calls = 0;
  await assert.rejects(
    callFanmarkTransferWorker("issue", {}, {
      baseUrl: "https://api.example.test",
      authBaseUrl: "https://login.example.test",
      fetchImpl: async () => { calls += 1; return new Response(); },
    }),
    { name: "FanmarkTransferApiError", kind: "configuration" },
  );
  assert.equal(calls, 0);
  await assert.rejects(
    callFanmarkTransferWorker("approve", {}, {
      baseUrl: "https://app.example.test",
      authBaseUrl: "https://app.example.test",
      fetchImpl: async () => new Response("<html>not json</html>", {
        status: 200, headers: { "content-type": "text/html" },
      }),
    }),
    { name: "FanmarkTransferApiError", kind: "invalid_response" },
  );
});

test("rejects unknown selectors and non-success operation responses", async () => {
  assert.throws(() => getFanmarkTransferBackend("supabase-d1"), { name: "FanmarkTransferApiError" });
  await assert.rejects(
    callFanmarkTransferWorker("cancel", {}, {
      baseUrl: "https://app.example.test",
      authBaseUrl: "https://app.example.test",
      fetchImpl: async () => new Response(JSON.stringify({ error: "invalid_request" }), {
        status: 200, headers: { "content-type": "application/json" },
      }),
    }),
    { name: "FanmarkTransferApiError", kind: "invalid_response" },
  );
});
