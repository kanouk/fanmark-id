import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchLifecycleSettingsFromWorker,
  getLifecycleSettingsBackend,
  LifecycleSettingsApiError,
  parseLifecycleSettingsPayload,
  updateGracePeriodInWorker,
} from "./lifecycle-settings-api.ts";

test("selects Supabase by default and rejects unknown lifecycle backends", () => {
  assert.equal(getLifecycleSettingsBackend(undefined), "supabase");
  assert.equal(getLifecycleSettingsBackend(" "), "supabase");
  assert.equal(getLifecycleSettingsBackend("worker"), "worker");
  assert.throws(() => getLifecycleSettingsBackend("d1"), LifecycleSettingsApiError);
});

test("accepts the versioned lifecycle settings response and validates its exact shape", () => {
  assert.deepEqual(
    parseLifecycleSettingsPayload({ schemaVersion: 1, settings: { grace_period_days: 14 } }),
    { grace_period_days: 14 },
  );
  for (const malformed of [
    null,
    { schemaVersion: 2, settings: { grace_period_days: 14 } },
    { schemaVersion: 1, settings: { grace_period_days: "14" } },
    { schemaVersion: 1, settings: { grace_period_days: 0 } },
    { schemaVersion: 1, settings: { grace_period_days: 366 } },
    { schemaVersion: 1, settings: { grace_period_days: 14, stripe_price_id: "price_secret" } },
  ]) {
    assert.throws(() => parseLifecycleSettingsPayload(malformed), (error: unknown) =>
      error instanceof LifecycleSettingsApiError && error.kind === "invalid_response");
  }
});

test("uses the protected Worker route for reads and updates", async () => {
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    seen.push({ url: String(input), init });
    return Response.json({ schemaVersion: 1, settings: { grace_period_days: 30 } });
  };
  const options = {
    apiBaseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetcher,
  };
  assert.deepEqual(await fetchLifecycleSettingsFromWorker(options), { grace_period_days: 30 });
  assert.deepEqual(await updateGracePeriodInWorker(30, options), { grace_period_days: 30 });
  assert.equal(seen[0].url, "https://api.example.test/api/system/lifecycle");
  assert.equal(seen[0].init?.method, "GET");
  assert.equal(seen[0].init?.credentials, "include");
  assert.equal(seen[0].init?.cache, "no-store");
  assert.equal(seen[1].init?.method, "PATCH");
  assert.equal(seen[1].url, "https://api.example.test/api/admin/system-settings/lifecycle");
  assert.equal(seen[1].init?.body, JSON.stringify({ grace_period_days: 30 }));
});

test("blocks cross-origin requests and rejects failed Worker requests without fallback", async () => {
  let calls = 0;
  await assert.rejects(fetchLifecycleSettingsFromWorker({
    apiBaseUrl: "https://api.example.test",
    authBaseUrl: "https://auth.example.test",
    fetcher: async () => {
      calls += 1;
      return Response.json({ schemaVersion: 1, settings: { grace_period_days: 1 } });
    },
  }), (error: unknown) => error instanceof LifecycleSettingsApiError && error.kind === "configuration");
  assert.equal(calls, 0);

  await assert.rejects(updateGracePeriodInWorker(366, {
    apiBaseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetcher: async () => {
      calls += 1;
      return Response.json({ schemaVersion: 1, settings: { grace_period_days: 1 } });
    },
  }), (error: unknown) => error instanceof LifecycleSettingsApiError && error.kind === "configuration");
  assert.equal(calls, 0);

  await assert.rejects(fetchLifecycleSettingsFromWorker({
    apiBaseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetcher: async () => new Response("unavailable", { status: 503 }),
  }), (error: unknown) => error instanceof LifecycleSettingsApiError && error.kind === "http" && error.status === 503);
});
