import assert from "node:assert/strict";
import test from "node:test";
import {
  bulkReturnFanmarksThroughWorker,
  buildFanmarkBulkReturnApiUrl,
  buildFanmarkReturnApiUrl,
  FanmarkReturnApiError,
  getFanmarkReturnBackend,
  returnFanmarkThroughWorker,
} from "./fanmark-return-api.ts";

const ID = "45111111-1111-4111-8111-111111111111";

test("return backend defaults to Supabase and rejects unknown selectors", () => {
  assert.equal(getFanmarkReturnBackend(undefined), "supabase");
  assert.equal(getFanmarkReturnBackend("worker"), "worker");
  assert.throws(() => getFanmarkReturnBackend("fallback"), FanmarkReturnApiError);
});

test("return endpoint stays on the configured API origin", () => {
  assert.equal(buildFanmarkReturnApiUrl("https://api.example.test/").href,
    "https://api.example.test/api/me/fanmarks/return");
  assert.throws(() => buildFanmarkReturnApiUrl("javascript:alert(1)"), FanmarkReturnApiError);
});

test("bulk return endpoint stays on the configured API origin", () => {
  assert.equal(buildFanmarkBulkReturnApiUrl("https://api.example.test/").href,
    "https://api.example.test/api/me/fanmarks/bulk-return");
});

test("Worker return uses a same-origin session cookie and sends the fanmark ID", async () => {
  let captured: Request | undefined;
  await returnFanmarkThroughWorker(ID.toUpperCase(), {
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetchImpl: async (input, init) => {
      captured = new Request(input, init);
      return Response.json({ success: true }, { headers: { "cache-control": "no-store" } });
    },
  });
  assert.equal(captured?.url, "https://api.example.test/api/me/fanmarks/return");
  assert.equal(captured?.method, "POST");
  assert.equal(captured?.credentials, "include");
  assert.equal(captured?.cache, "no-store");
  assert.deepEqual(JSON.parse(await captured!.text()), { fanmark_id: ID });
});

test("Worker return rejects cross-origin auth and does not hide server errors", async () => {
  await assert.rejects(returnFanmarkThroughWorker(ID, {
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://auth.example.test",
    fetchImpl: async () => Response.json({ success: true }),
  }), FanmarkReturnApiError);
  await assert.rejects(returnFanmarkThroughWorker(ID, {
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetchImpl: async () => Response.json({ error: "transfer_in_progress" }, { status: 400 }),
  }), (error: unknown) => error instanceof FanmarkReturnApiError && error.status === 400 &&
    error.message.includes("transfer_in_progress"));
});

test("Worker bulk return sends license IDs with the session cookie and accepts partial results", async () => {
  const secondId = "45222222-2222-4222-8222-222222222222";
  let captured: Request | undefined;
  const result = await bulkReturnFanmarksThroughWorker([ID.toUpperCase(), secondId], {
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetchImpl: async (input, init) => {
      captured = new Request(input, init);
      return Response.json({
        success: false,
        results: [{
          licenseId: ID,
          fanmarkId: "4d5884a0-304d-4205-8f73-251a2ba2f2d0",
          fanmark: "🌹",
          fanmarkShortId: "rose-owned",
          graceExpiresAt: "2026-09-27T00:00:00.000Z",
        }],
        failed: [{ licenseId: secondId, error: "transfer_in_progress" }],
      }, { status: 207, headers: { "cache-control": "no-store" } });
    },
  });
  assert.equal(captured?.url, "https://api.example.test/api/me/fanmarks/bulk-return");
  assert.equal(captured?.credentials, "include");
  assert.equal(captured?.cache, "no-store");
  assert.deepEqual(JSON.parse(await captured!.text()), { license_ids: [ID, secondId] });
  assert.equal(result.success, false);
  assert.equal(result.results.length, 1);
  assert.deepEqual(result.failed, [{ licenseId: secondId, error: "transfer_in_progress" }]);
});

test("Worker bulk return validates selections and response accounting", async () => {
  await assert.rejects(bulkReturnFanmarksThroughWorker([ID, ID], {
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetchImpl: async () => Response.json({ success: true, results: [] }),
  }), FanmarkReturnApiError);
  await assert.rejects(bulkReturnFanmarksThroughWorker([ID], {
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetchImpl: async () => Response.json({ success: true, results: [] }),
  }), FanmarkReturnApiError);
});
