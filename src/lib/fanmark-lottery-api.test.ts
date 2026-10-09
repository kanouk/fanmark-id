import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFanmarkLotteryApiUrl,
  getFanmarkLotteryBackend,
  invokeFanmarkLotteryAction,
} from "./fanmark-lottery-api.ts";

test("defaults to Supabase and accepts explicit Worker selection", () => {
  assert.equal(getFanmarkLotteryBackend(undefined), "supabase");
  assert.equal(getFanmarkLotteryBackend(" worker "), "worker");
  assert.throws(() => getFanmarkLotteryBackend("cloudflare"), { name: "FanmarkLotteryApiError" });
});

test("builds operation-specific same-origin Worker routes", () => {
  assert.equal(buildFanmarkLotteryApiUrl("apply", "https://app.example.test").href,
    "https://app.example.test/api/fanmarks/lottery/apply");
  assert.equal(buildFanmarkLotteryApiUrl("cancel", "https://app.example.test").href,
    "https://app.example.test/api/fanmarks/lottery/cancel");
});

test("sends authenticated no-store requests to the Worker and returns the response", async () => {
  let captured: Request | undefined;
  const result = await invokeFanmarkLotteryAction<{ success: true; entry_id: string }>(
    "apply", { fanmark_id: "10000000-0000-4000-8000-000000000001" },
    async () => { throw new Error("Supabase must not be called"); },
    {
      backend: "worker",
      baseUrl: "https://app.example.test",
      authBaseUrl: "https://app.example.test",
      fetchImpl: async (input, init) => {
        captured = new Request(input, init);
        return new Response(JSON.stringify({ success: true, entry_id: "entry" }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      },
    },
  );
  assert.equal(captured?.url, "https://app.example.test/api/fanmarks/lottery/apply");
  assert.equal(captured?.method, "POST");
  assert.equal(captured?.credentials, "include");
  assert.equal(captured?.cache, "no-store");
  assert.deepEqual(result.data, { success: true, entry_id: "entry" });
  assert.equal(result.error, null);
});

test("returns Worker error codes without falling back to Supabase", async () => {
  let supabaseCalls = 0;
  const result = await invokeFanmarkLotteryAction(
    "apply", { fanmark_id: "10000000-0000-4000-8000-000000000001" },
    async () => { supabaseCalls += 1; return { data: null, error: null }; },
    {
      backend: "worker", baseUrl: "https://app.example.test", authBaseUrl: "https://app.example.test",
      fetchImpl: async () => new Response(JSON.stringify({ error: "fanmark_limit_reached" }), {
        status: 400, headers: { "content-type": "application/json" },
      }),
    },
  );
  assert.equal(supabaseCalls, 0);
  assert.equal(result.error?.message, "fanmark_limit_reached");
});

test("rejects cross-origin authentication before sending the request", async () => {
  let calls = 0;
  const result = await invokeFanmarkLotteryAction(
    "cancel", { entry_id: "30000000-0000-4000-8000-000000000001" },
    async () => ({ data: null, error: null }),
    {
      backend: "worker", baseUrl: "https://api.example.test", authBaseUrl: "https://login.example.test",
      fetchImpl: async () => { calls += 1; return new Response(); },
    },
  );
  assert.equal(calls, 0);
  assert.equal(result.error?.message, "fanmark lottery request configuration");
});

test("keeps Supabase as the selected backend by default", async () => {
  let supabaseCalls = 0;
  const result = await invokeFanmarkLotteryAction("cancel", {}, async () => {
    supabaseCalls += 1;
    return { data: { success: true }, error: null };
  }, { backend: "supabase" });
  assert.equal(supabaseCalls, 1);
  assert.deepEqual(result.data, { success: true });
});
