import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchMaintenanceSettingsFromWorker, MaintenanceSettingsApiError, parseMaintenanceSettingsPayload, updateMaintenanceSettingsInWorker } from "./maintenance-settings-api.ts";

const settings = {
  maintenance_mode: true,
  maintenance_message: "Scheduled maintenance",
  maintenance_end_time: "2026-09-26T00:00:00.000Z",
};

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


test("retries a transient configuration read once and still returns confirmed maintenance", async () => {
  for (const failure of ["network", "timeout", "502", "503", "504"]) {
    const signals: AbortSignal[] = [];
    const result = await fetchMaintenanceSettingsFromWorker({
      apiBaseUrl: "https://api.example.test", timeoutMs: 20,
      fetcher: async (_input, init) => {
        signals.push(init!.signal!);
        if (signals.length === 1) {
          if (failure === "network") throw new TypeError("synthetic network failure");
          if (failure === "timeout") return new Promise<Response>((_resolve, reject) => {
            init!.signal!.addEventListener("abort", () => reject(new Error("synthetic timeout")), { once: true });
          });
          return new Response("unavailable", { status: Number(failure) });
        }
        return Response.json({ schemaVersion: 1, settings });
      },
    });
    assert.deepEqual(result, settings);
    assert.equal(signals.length, 2);
    assert.notEqual(signals[0], signals[1]);
    assert.equal(signals[1].aborted, false);
  }
});

test("bounds persistent failures to two reads without inventing disabled maintenance", async () => {
  let calls = 0;
  await assert.rejects(fetchMaintenanceSettingsFromWorker({ apiBaseUrl: "https://api.example.test",
    fetcher: async () => { calls++; throw new TypeError("synthetic offline"); },
  }), (error: unknown) => error instanceof MaintenanceSettingsApiError && error.kind === "network");
  assert.equal(calls, 2);
});

test("does not retry server backoff, permanent refusal or invalid settings", async () => {
  for (const response of [new Response(null, { status: 503, headers: { "retry-after": "60" } }),
    new Response(null, { status: 401 }), Response.json({ schemaVersion: 1, settings: { maintenance_mode: false } })]) {
    let calls = 0;
    await assert.rejects(fetchMaintenanceSettingsFromWorker({ apiBaseUrl: "https://api.example.test",
      fetcher: async () => { calls++; return response; },
    }), (error: unknown) => error instanceof MaintenanceSettingsApiError);
    assert.equal(calls, 1);
  }
});

test("never retries a settings mutation after a transport failure", async () => {
  let calls = 0;
  await assert.rejects(updateMaintenanceSettingsInWorker({ maintenance_mode: false }, {
    apiBaseUrl: "https://api.example.test", fetcher: async () => { calls++; throw new TypeError("synthetic network failure"); },
  }));
  assert.equal(calls, 1);
});
