import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchSystemSettingsFromWorker,
  getSystemSettingsBackend,
  SYSTEM_SETTINGS_ADMIN_KEYS,
  SYSTEM_SETTINGS_PUBLIC_KEYS,
  SystemSettingsApiError,
  updateSystemSettingInWorker,
} from "./system-settings-api.ts";

function settings(keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.map((key) => [key, key.endsWith("_limit") || key.endsWith("_pricing") || key === "max_emoji_characters"
    ? "5"
    : key === "invitation_mode" || key === "social_login_enabled" ? "false"
      : key === "stripe_mode" ? "test" : "price_synthetic"]));
}

test("selects only a known system settings backend", () => {
  assert.equal(getSystemSettingsBackend(undefined), "supabase");
  assert.equal(getSystemSettingsBackend(" "), "supabase");
  assert.equal(getSystemSettingsBackend("worker"), "worker");
  assert.throws(() => getSystemSettingsBackend("unknown"), SystemSettingsApiError);
});

test("accepts the exact public and admin setting projections", async () => {
  const publicSettings = settings(SYSTEM_SETTINGS_PUBLIC_KEYS);
  const adminSettings = settings(SYSTEM_SETTINGS_ADMIN_KEYS);
  assert.deepEqual(await fetchSystemSettingsFromWorker({
    apiBaseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetcher: async () => Response.json({ schemaVersion: 1, settings: publicSettings }),
  }), publicSettings);
  assert.deepEqual(await fetchSystemSettingsFromWorker({
    includePrivate: true,
    apiBaseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetcher: async () => Response.json({ schemaVersion: 1, settings: adminSettings }),
  }), adminSettings);

  for (const malformed of [
    null,
    { schemaVersion: 2, settings: publicSettings },
    { schemaVersion: 1, settings: { ...publicSettings, enterprise_pricing: "hidden" } },
    { schemaVersion: 1, settings: { ...publicSettings, free_fanmarks_limit: 5 } },
  ]) {
    await assert.rejects(fetchSystemSettingsFromWorker({
      apiBaseUrl: "https://api.example.test",
      authBaseUrl: "https://api.example.test",
      fetcher: async () => Response.json(malformed),
    }), (error: unknown) => error instanceof SystemSettingsApiError && error.kind === "invalid_response");
  }
});

test("uses no-store same-origin Worker requests for reads and audited admin updates", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const publicSettings = settings(SYSTEM_SETTINGS_PUBLIC_KEYS);
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return init?.method === "PATCH"
      ? Response.json({ schemaVersion: 1, updatedSetting: "invitation_mode" })
      : Response.json({ schemaVersion: 1, settings: publicSettings });
  };

  await fetchSystemSettingsFromWorker({
    apiBaseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetcher,
  });
  await updateSystemSettingInWorker({ key: "invitation_mode", value: "true", expectedValue: "false" }, {
    apiBaseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetcher,
  });

  assert.equal(calls[0]?.url, "https://api.example.test/api/system/settings");
  assert.equal(calls[0]?.init?.method, "GET");
  assert.equal(calls[0]?.init?.credentials, "include");
  assert.equal(calls[0]?.init?.cache, "no-store");
  assert.equal(calls[1]?.url, "https://api.example.test/api/admin/system-settings");
  assert.equal(calls[1]?.init?.method, "PATCH");
  assert.equal(calls[1]?.init?.body, JSON.stringify({ key: "invitation_mode", value: "true", expectedValue: "false" }));
});

test("does not fall back when the Worker is unavailable or cross-origin", async () => {
  let calls = 0;
  await assert.rejects(fetchSystemSettingsFromWorker({
    apiBaseUrl: "https://api.example.test",
    authBaseUrl: "https://auth.example.test",
    fetcher: async () => {
      calls += 1;
      return Response.json({ schemaVersion: 1, settings: settings(SYSTEM_SETTINGS_PUBLIC_KEYS) });
    },
  }), (error: unknown) => error instanceof SystemSettingsApiError && error.kind === "configuration");
  assert.equal(calls, 0);

  await assert.rejects(fetchSystemSettingsFromWorker({
    apiBaseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetcher: async () => new Response("unavailable", { status: 503 }),
  }), (error: unknown) => error instanceof SystemSettingsApiError && error.kind === "http" && error.status === 503);
});
