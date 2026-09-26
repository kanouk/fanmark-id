import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOwnProfileApiUrl,
  getOwnProfileBackend,
  loadOwnProfile,
  ProfileApiError,
  updateOwnProfile,
} from "./profile-api.ts";

const profile = {
  id: "profile-row",
  user_id: "c2d65530-e7b5-4b40-8fcb-01642863a61b",
  username: "owner",
  display_name: "Owner",
  avatar_url: null,
  plan_type: "creator",
  preferred_language: "ja",
  created_at: "2026-09-25T00:00:00.000Z",
  updated_at: "2026-09-25T00:00:00.000Z",
  requires_password_setup: false,
};

test("profile backend defaults to Supabase and rejects unknown values", () => {
  assert.equal(getOwnProfileBackend(undefined), "supabase");
  assert.equal(getOwnProfileBackend("worker"), "worker");
  assert.throws(() => getOwnProfileBackend("fallback"), ProfileApiError);
});

test("profile API URL and auth origin must use the same clean HTTPS origin", async () => {
  assert.equal(String(buildOwnProfileApiUrl("https://api.example.test")), "https://api.example.test/api/me/profile");
  assert.throws(() => buildOwnProfileApiUrl("https://api.example.test/path"), ProfileApiError);
  await assert.rejects(loadOwnProfile({ baseUrl: "https://api.example.test", authBaseUrl: "https://auth.example.test" }), ProfileApiError);
});

test("GET and PATCH send only same-origin credentials and never fall back", async () => {
  const calls: Array<{ url: string; method: string | undefined; credentials: RequestCredentials | undefined; cache: RequestCache | undefined }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method, credentials: init?.credentials, cache: init?.cache });
    return new Response(JSON.stringify({ schemaVersion: 1, profile }), {
      headers: { "content-type": "application/json" },
    });
  };
  assert.deepEqual(await loadOwnProfile({ baseUrl: "https://api.example.test", fetchImpl }), profile);
  assert.deepEqual(await updateOwnProfile({ display_name: "Updated" }, { baseUrl: "https://api.example.test", fetchImpl }), profile);
  assert.deepEqual(calls, [
    { url: "https://api.example.test/api/me/profile", method: "GET", credentials: "include", cache: "no-store" },
    { url: "https://api.example.test/api/me/profile", method: "PATCH", credentials: "include", cache: "no-store" },
  ]);
  let attempts = 0;
  await assert.rejects(loadOwnProfile({
    baseUrl: "https://api.example.test",
    fetchImpl: async () => { attempts += 1; return new Response("{}", { status: 503 }); },
  }), (error: unknown) => error instanceof ProfileApiError && error.kind === "http");
  assert.equal(attempts, 1);
});

test("the client rejects malformed, oversized, and privilege-shaped responses or updates", async () => {
  assert.throws(() => updateOwnProfile({ plan_type: "admin" } as never, { baseUrl: "https://api.example.test" }), ProfileApiError);
  await assert.rejects(loadOwnProfile({
    baseUrl: "https://api.example.test",
    fetchImpl: async () => new Response(JSON.stringify({ schemaVersion: 1, profile: { ...profile, requires_password_setup: 0 } }), { headers: { "content-type": "application/json" } }),
  }), ProfileApiError);
  await assert.rejects(loadOwnProfile({
    baseUrl: "https://api.example.test",
    fetchImpl: async () => new Response(JSON.stringify({ schemaVersion: 1, profile: { ...profile, stripe_customer_id: "private" } }), { headers: { "content-type": "application/json" } }),
  }), ProfileApiError);
  await assert.rejects(loadOwnProfile({
    baseUrl: "https://api.example.test",
    fetchImpl: async () => new Response("x".repeat(16 * 1024 + 1), { headers: { "content-type": "application/json" } }),
  }), ProfileApiError);
});
