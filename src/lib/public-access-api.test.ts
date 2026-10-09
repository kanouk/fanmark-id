import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPublicAccessApiUrl,
  fetchPublicEmojiProfile,
  fetchPublicFanmarkByEmojiIds,
  fetchPublicFanmarkByShortId,
  getPublicAccessReadBackend,
  PublicAccessApiError,
} from "./public-access-api.ts";

const API_BASE = "https://api.example.test";
const FANMARK_ID = "11111111-1111-4111-8111-111111111111";
const LICENSE_ID = "22222222-2222-4222-8222-222222222222";
const EMOJI_ID = "33333333-3333-4333-8333-333333333333";

function accessPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: FANMARK_ID,
    shortId: "rose-1",
    userInputFanmark: "🌹",
    displayFanmark: "🌹 display",
    emojiIds: [EMOJI_ID],
    accessState: "open",
    fanmarkName: "Rose",
    accessType: "text",
    targetUrl: null,
    textContent: "hello",
    status: "active",
    isPasswordProtected: false,
    licenseId: LICENSE_ID,
    licenseStatus: "active",
    licenseEnd: "2026-10-01T00:00:00.000000Z",
    graceExpiresAt: null,
    isReturned: false,
    ...overrides,
  };
}

function profilePayload() {
  return {
    schemaVersion: 1,
    licenseId: LICENSE_ID,
    displayName: "Rose",
    bio: "A public profile",
    socialLinks: { website: "https://example.test" },
    themeSettings: { theme_color: "#123456" },
    createdAt: "2026-09-01T00:00:00.000000Z",
    updatedAt: "2026-09-02T00:00:00.000000Z",
  };
}

test("public-read selector defaults to Supabase and accepts only explicit backends", () => {
  assert.equal(getPublicAccessReadBackend(undefined), "supabase");
  assert.equal(getPublicAccessReadBackend(" supabase "), "supabase");
  assert.equal(getPublicAccessReadBackend("worker"), "worker");
  assert.throws(
    () => getPublicAccessReadBackend("d1"),
    (error) => error instanceof PublicAccessApiError && error.kind === "configuration",
  );
});

test("Worker URL accepts HTTPS and loopback, but rejects unsafe origins and paths", () => {
  assert.equal(
    buildPublicAccessApiUrl(API_BASE, "/api/fanmarks/access/short/rose-1").href,
    `${API_BASE}/api/fanmarks/access/short/rose-1`,
  );
  assert.equal(
    buildPublicAccessApiUrl("http://localhost:8787", "/api/fanmarks/access/emoji").href,
    "http://localhost:8787/api/fanmarks/access/emoji",
  );

  for (const base of [
    "http://api.example.test",
    "https://user:secret@api.example.test",
    "https://api.example.test/path",
    "https://api.example.test/?key=value",
    "https://api.example.test/#fragment",
    "not a URL",
  ]) {
    assert.throws(() => buildPublicAccessApiUrl(base, "/api/fanmarks/access/emoji"));
  }
  assert.throws(() => buildPublicAccessApiUrl(API_BASE, "/other/path"));
});

test("short-id reads map the Worker contract and omit browser credentials", async () => {
  let calledUrl = "";
  const record = await fetchPublicFanmarkByShortId("rose-1", {
    baseUrl: API_BASE,
    fetchImpl: async (input, init) => {
      calledUrl = String(input);
      assert.equal(init?.method, "GET");
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.cache, "no-store");
      assert.deepEqual(Object.fromEntries(new Headers(init?.headers)), { accept: "application/json" });
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      assert.equal(new Headers(init?.headers).has("cookie"), false);
      return new Response(JSON.stringify(accessPayload()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(calledUrl, `${API_BASE}/api/fanmarks/access/short/rose-1`);
  assert.deepEqual(record, {
    id: FANMARK_ID,
    user_input_fanmark: "🌹",
    display_fanmark: "🌹 display",
    emoji_ids: [EMOJI_ID],
    fanmark: "🌹 display",
    short_id: "rose-1",
    fanmark_name: "Rose",
    access_type: "text",
    target_url: null,
    text_content: "hello",
    is_password_protected: false,
    status: "active",
    license_id: LICENSE_ID,
    license_status: "active",
    license_end: "2026-10-01T00:00:00.000000Z",
    grace_expires_at: null,
    is_returned: false,
  });
});

test("emoji reads POST only normalized IDs and protected records are redacted", async () => {
  const record = await fetchPublicFanmarkByEmojiIds([EMOJI_ID], {
    baseUrl: API_BASE,
    fetchImpl: async (input, init) => {
      assert.equal(String(input), `${API_BASE}/api/fanmarks/access/emoji`);
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "omit");
      assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
      assert.deepEqual(JSON.parse(String(init?.body)), { emojiIds: [EMOJI_ID] });
      return new Response(JSON.stringify(accessPayload({
        accessState: "locked",
        accessType: "text",
        fanmarkName: null,
        textContent: null,
        isPasswordProtected: true,
      })), { status: 200 });
    },
  });
  assert.equal(record?.is_password_protected, true);
  assert.equal(record?.fanmark_name, "🌹 display");
  assert.equal(record?.text_content, null);
});

test("public profile reads preserve the explicit public projection", async () => {
  const profile = await fetchPublicEmojiProfile(LICENSE_ID, {
    baseUrl: API_BASE,
    fetchImpl: async (input, init) => {
      assert.equal(String(input), `${API_BASE}/api/fanmarks/public-profile/${LICENSE_ID}`);
      assert.equal(init?.method, "GET");
      assert.equal(init?.credentials, "omit");
      return new Response(JSON.stringify(profilePayload()), { status: 200 });
    },
  });
  assert.deepEqual(profile, {
    license_id: LICENSE_ID,
    display_name: "Rose",
    bio: "A public profile",
    social_links: { website: "https://example.test" },
    theme_settings: { theme_color: "#123456" },
    created_at: "2026-09-01T00:00:00.000000Z",
    updated_at: "2026-09-02T00:00:00.000000Z",
  });
});

test("missing rows are null; upstream errors and malformed projection fail closed", async () => {
  const missing = await fetchPublicFanmarkByShortId("missing", {
    baseUrl: API_BASE,
    fetchImpl: async () => new Response(null, { status: 404 }),
  });
  assert.equal(missing, null);

  await assert.rejects(
    fetchPublicFanmarkByShortId("rose-1", { baseUrl: API_BASE, fetchImpl: async () => new Response("private body", { status: 503 }) }),
    (error) => error instanceof PublicAccessApiError && error.kind === "http" && error.status === 503,
  );
  await assert.rejects(
    fetchPublicFanmarkByShortId("rose-1", {
      baseUrl: API_BASE,
      fetchImpl: async () => new Response(JSON.stringify(accessPayload({ accessState: "locked" })), { status: 200 }),
    }),
    (error) => error instanceof PublicAccessApiError && error.kind === "invalid_response",
  );
  await assert.rejects(
    fetchPublicFanmarkByShortId("rose-1", {
      baseUrl: API_BASE,
      fetchImpl: async () => new Response("x".repeat(64 * 1024 + 1), { status: 200 }),
    }),
    (error) => error instanceof PublicAccessApiError && error.kind === "invalid_response",
  );
});

test("worker client preserves bounded timeout failures", async () => {
  assert.equal(getPublicAccessReadBackend("worker"), "worker");
  await assert.rejects(
    fetchPublicFanmarkByShortId("rose-1", {
      baseUrl: API_BASE,
      timeoutMs: 5,
      fetchImpl: (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    }),
    (error) => error instanceof PublicAccessApiError && error.kind === "timeout",
  );
});
