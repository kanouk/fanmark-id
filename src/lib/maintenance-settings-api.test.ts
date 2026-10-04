import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchMaintenanceSettingsFromWorker,
  getMaintenanceSettingsBackend,
  MaintenanceSettingsApiError,
  parseMaintenanceSettingsPayload,
  updateMaintenanceSettingsInWorker,
} from "./maintenance-settings-api.ts";

const settings = {
  maintenance_mode: true,
  maintenance_message: "Scheduled maintenance",
  maintenance_end_time: "2026-09-26T00:00:00.000Z",
};

test("selects only the configured maintenance backend", () => {
  assert.equal(getMaintenanceSettingsBackend(undefined), "supabase");
  assert.equal(getMaintenanceSettingsBackend(" "), "supabase");
  assert.equal(getMaintenanceSettingsBackend("worker"), "worker");
  assert.throws(() => getMaintenanceSettingsBackend("unknown"), MaintenanceSettingsApiError);
});

test("accepts the versioned settings response and rejects malformed or over-broad payloads", () => {
  assert.deepEqual(parseMaintenanceSettingsPayload({ schemaVersion: 1, settings }), settings);
  for (const malformed of [
    null,
    { schemaVersion: 2, settings },
    { schemaVersion: 1, settings: { ...settings, creator_stripe_price_id: "private" } },
    { schemaVersion: 1, settings: { ...settings, maintenance_mode: "true" } },
    { schemaVersion: 1, settings: { ...settings, maintenance_end_time: "tomorrow" } },
    { schemaVersion: 1, settings: { ...settings, maintenance_message: "x".repeat(2_001) } },
  ]) {
    assert.throws(() => parseMaintenanceSettingsPayload(malformed), (error: unknown) =>
      error instanceof MaintenanceSettingsApiError && error.kind === "invalid_response");
  }
});

test("GET and PATCH use the Worker route with same-origin credentials and no-store caching", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json({ schemaVersion: 1, settings });
  };

  assert.deepEqual(await fetchMaintenanceSettingsFromWorker({
    apiBaseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetcher,
  }), settings);
  assert.deepEqual(await updateMaintenanceSettingsInWorker({ maintenance_mode: true }, {
    apiBaseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetcher,
  }), settings);

  assert.equal(requests[0].url, "https://api.example.test/api/system/maintenance");
  assert.equal(requests[0].init?.method, "GET");
  assert.equal(requests[0].init?.credentials, "include");
  assert.equal(requests[0].init?.cache, "no-store");
  assert.equal(requests[1].url, "https://api.example.test/api/admin/system-settings/maintenance");
  assert.equal(requests[1].init?.method, "PATCH");
  assert.equal(requests[1].init?.body, JSON.stringify({ maintenance_mode: true }));
});

test("rejects cross-origin and HTTP failures without a Supabase fallback", async () => {
  let calls = 0;
  await assert.rejects(fetchMaintenanceSettingsFromWorker({
    apiBaseUrl: "https://api.example.test",
    authBaseUrl: "https://auth.example.test",
    fetcher: async () => {
      calls += 1;
      return Response.json({ schemaVersion: 1, settings });
    },
  }), (error: unknown) => error instanceof MaintenanceSettingsApiError && error.kind === "configuration");
  assert.equal(calls, 0);

  await assert.rejects(fetchMaintenanceSettingsFromWorker({
    apiBaseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetcher: async () => new Response("unavailable", { status: 503 }),
  }), (error: unknown) => error instanceof MaintenanceSettingsApiError && error.kind === "http" && error.status === 503);

  await assert.rejects(fetchMaintenanceSettingsFromWorker({
    apiBaseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetcher: async () => new Response(
      JSON.stringify({ schemaVersion: 1, settings }) + " ".repeat(9 * 1024),
      { headers: { "content-type": "application/json" } },
    ),
  }), (error: unknown) => error instanceof MaintenanceSettingsApiError && error.kind === "invalid_response");
});
