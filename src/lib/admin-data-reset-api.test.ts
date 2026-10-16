import assert from "node:assert/strict";
import test from "node:test";
import { resetDataThroughWorker, AdminDataResetApiError } from "./admin-data-reset-api.ts";

const ID = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const options = { backend: "worker", baseUrl: "https://app.example.test", authBaseUrl: "https://app.example.test" };
const result = { success: true, deletedCounts: {
  fanmark_basic_configs: 1, fanmark_redirect_configs: 2, fanmark_messageboard_configs: 3,
  fanmark_password_configs: 4, fanmark_profiles: 5, fanmark_favorites: 6, fanmark_licenses: 7, fanmarks: 8,
}, totalDeleted: 36 };
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

test("reset sends only confirmation and a stable request ID with cookie credentials; repeat attempts retain the ID", async () => {
  const calls: RequestInit[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://app.example.test/api/admin/data-reset");
    calls.push(init!); return response(result);
  };
  assert.deepEqual(await resetDataThroughWorker(ID, "DELETE", { ...options, fetchImpl }), result);
  assert.deepEqual(await resetDataThroughWorker(ID, "DELETE", { ...options, fetchImpl }), result);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.method, "POST"); assert.equal(call.credentials, "include"); assert.equal(call.cache, "no-store");
    assert.deepEqual(JSON.parse(String(call.body)), { requestId: ID.toLowerCase(), confirmation: "DELETE" });
  }
});

test("reset rejects unavailable selectors, malformed confirmation/ID and cross-origin Auth before sending", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls++; return response(result); };
  for (const override of [{ backend: "disabled" }, { backend: "supabase" }, { authBaseUrl: "https://other.example.test" }]) {
    await assert.rejects(resetDataThroughWorker(ID, "DELETE", { ...options, ...override, fetchImpl }), AdminDataResetApiError);
  }
  await assert.rejects(resetDataThroughWorker("invalid", "DELETE", { ...options, fetchImpl }), AdminDataResetApiError);
  await assert.rejects(resetDataThroughWorker(ID, "delete", { ...options, fetchImpl }), AdminDataResetApiError);
  assert.equal(calls, 0);
});

test("an HTTP reset failure is returned without a second request or Supabase fallback", async () => {
  let calls = 0;
  await assert.rejects(resetDataThroughWorker(ID, "DELETE", { ...options, fetchImpl: async () => {
    calls++; return new Response(JSON.stringify({ error: "data_reset_blocked_by_history" }), { status: 409 });
  } }), (error: unknown) => error instanceof AdminDataResetApiError && error.status === 409);
  assert.equal(calls, 1);
});

test("reset rejects false success, corrupt counts, extra fields and an inconsistent total", async () => {
  const bad = [null, { ...result, success: false }, { ...result, totalDeleted: 37 }, { ...result, leakedEmail: "private@example.test" },
    { ...result, deletedCounts: { ...result.deletedCounts, fanmarks: -1 } },
    { ...result, deletedCounts: { ...result.deletedCounts, fanmarks: "8" } }];
  for (const body of bad) {
    await assert.rejects(resetDataThroughWorker(ID, "DELETE", { ...options, fetchImpl: async () => response(body) }),
      (error: unknown) => error instanceof AdminDataResetApiError && error.kind === "invalid_response");
  }
});

test("an interrupted request preserves the caller's retry ID and reports an uncertain result", async () => {
  await assert.rejects(resetDataThroughWorker(ID, "DELETE", { ...options, timeoutMs: 10,
    fetchImpl: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  }), (error: unknown) => error instanceof AdminDataResetApiError && error.kind === "timeout");
});
