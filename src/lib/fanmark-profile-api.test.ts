import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFanmarkProfileApiUrl,
  FanmarkProfileApiError,
  getFanmarkProfileBackend,
  getOwnerFanmarkProfileContext,
  updateOwnerFanmarkProfile,
} from "./fanmark-profile-api.ts";

const fanmarkId = "4d5884a0-304d-4205-8f73-251a2ba2f2d0";
const licenseId = "45111111-1111-4111-8111-111111111111";
const context = {
  schemaVersion: 1,
  licenseId,
  fanmark: {
    id: fanmarkId,
    user_input_fanmark: "🌹",
    fanmark: "🌹",
    emoji_ids: ["043a78d4-1e42-4502-9f57-b1d1f93482db"],
    short_id: "rose-owned",
    fanmark_name: "Rose",
  },
  profile: {
    id: "45444444-4444-4444-8444-444444444444",
    license_id: licenseId,
    display_name: "Rose Profile",
    bio: "A synthetic profile",
    social_links: { website: "https://example.test/rose" },
    theme_settings: { theme_color: "#123456" },
    is_public: true,
    created_at: "2026-09-25T00:00:00.000000Z",
    updated_at: "2026-09-25T00:00:00.000000Z",
  },
};

test("fanmark-profile backend defaults to Supabase and rejects unknown values", () => {
  assert.equal(getFanmarkProfileBackend(undefined), "supabase");
  assert.equal(getFanmarkProfileBackend("worker"), "worker");
  assert.throws(() => getFanmarkProfileBackend("fallback"), FanmarkProfileApiError);
});

test("profile URL uses a validated fanmark id and clean Worker origin", () => {
  assert.equal(
    String(buildFanmarkProfileApiUrl("https://api.example.test", fanmarkId)),
    `https://api.example.test/api/me/fanmarks/${fanmarkId}/profile`,
  );
  assert.throws(() => buildFanmarkProfileApiUrl("https://api.example.test/path", fanmarkId), FanmarkProfileApiError);
  assert.throws(() => buildFanmarkProfileApiUrl("https://api.example.test", "not-a-uuid"), FanmarkProfileApiError);
});

test("owner GET and PATCH send same-origin credentials and validate the profile context", async () => {
  const calls: Array<{ url: string; method?: string; credentials?: RequestCredentials; cache?: RequestCache; body?: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method,
      credentials: init?.credentials,
      cache: init?.cache,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response(JSON.stringify(context), { headers: { "content-type": "application/json" } });
  };
  assert.deepEqual(await getOwnerFanmarkProfileContext(fanmarkId, {
    baseUrl: "https://api.example.test", authBaseUrl: "https://api.example.test", fetchImpl,
  }), {
    licenseId,
    fanmark: context.fanmark,
    profile: context.profile,
  });
  await updateOwnerFanmarkProfile(fanmarkId, { is_public: false }, {
    baseUrl: "https://api.example.test", authBaseUrl: "https://api.example.test", fetchImpl,
  });
  assert.deepEqual(calls.map(({ url, method, credentials, cache }) => ({ url, method, credentials, cache })), [
    { url: `https://api.example.test/api/me/fanmarks/${fanmarkId}/profile`, method: "GET", credentials: "include", cache: "no-store" },
    { url: `https://api.example.test/api/me/fanmarks/${fanmarkId}/profile`, method: "PATCH", credentials: "include", cache: "no-store" },
  ]);
  assert.equal(calls[1]?.body, JSON.stringify({ is_public: false }));
});

test("owner profile client rejects cross-origin auth and malformed responses without fallback", async () => {
  let attempts = 0;
  await assert.rejects(getOwnerFanmarkProfileContext(fanmarkId, {
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://auth.example.test",
    fetchImpl: async () => { attempts += 1; return new Response(); },
  }), FanmarkProfileApiError);
  assert.equal(attempts, 0);

  await assert.rejects(getOwnerFanmarkProfileContext(fanmarkId, {
    baseUrl: "https://api.example.test",
    fetchImpl: async () => { attempts += 1; return new Response(JSON.stringify({ ...context, profile: { ...context.profile, license_id: fanmarkId } }), { headers: { "content-type": "application/json" } }); },
  }), FanmarkProfileApiError);
  assert.equal(attempts, 1);
});

test("worker failures remain visible and do not try a Supabase fallback", async () => {
  let attempts = 0;
  await assert.rejects(getOwnerFanmarkProfileContext(fanmarkId, {
    baseUrl: "https://api.example.test",
    fetchImpl: async () => { attempts += 1; return new Response("{}", { status: 503, headers: { "content-type": "application/json" } }); },
  }), (error: unknown) => error instanceof FanmarkProfileApiError && error.kind === "http" && error.status === 503);
  assert.equal(attempts, 1);
});
