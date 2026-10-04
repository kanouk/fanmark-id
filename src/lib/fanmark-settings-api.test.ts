import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFanmarkSettingsApiUrl,
  FanmarkSettingsApiError,
  getFanmarkSettingsBackend,
  getOwnerFanmarkSettings,
  saveOwnerFanmarkSettings,
} from "./fanmark-settings-api.ts";

const ID = "45111111-1111-4111-8111-111111111111";
const context = {
  schemaVersion: 1,
  fanmark: {
    id: ID,
    user_input_fanmark: "🌹",
    display_fanmark: "🌹",
    emoji_ids: ["043a78d4-1e42-4502-9f57-b1d1f93482db"],
    fanmark_name: "Rose",
    access_type: "profile",
    target_url: null,
    text_content: null,
    is_password_protected: false,
    status: "active",
    short_id: "rose",
    license_id: "45222222-2222-4222-8222-222222222222",
    is_public: true,
    has_active_license: true,
  },
};

test("settings backend selector defaults to Supabase and rejects unknown values", () => {
  assert.equal(getFanmarkSettingsBackend(undefined), "supabase");
  assert.equal(getFanmarkSettingsBackend("worker"), "worker");
  assert.throws(() => getFanmarkSettingsBackend("fallback"), FanmarkSettingsApiError);
});

test("settings URL is scoped to the authenticated fanmark and API origin", () => {
  assert.equal(buildFanmarkSettingsApiUrl("https://api.example.test/", ID.toUpperCase()).href,
    `https://api.example.test/api/me/fanmarks/${ID}/settings`);
  assert.throws(() => buildFanmarkSettingsApiUrl("https://api.example.test", "not-an-id"), FanmarkSettingsApiError);
});

test("GET uses same-origin credentials and rejects responses that contain extra credential fields", async () => {
  let captured: Request | undefined;
  const result = await getOwnerFanmarkSettings(ID, {
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetchImpl: async (input, init) => {
      captured = new Request(input, init);
      return Response.json(context, { headers: { "cache-control": "no-store" } });
    },
  });
  assert.equal(result.fanmark_name, "Rose");
  assert.equal(captured?.method, "GET");
  assert.equal(captured?.credentials, "include");
  assert.equal(captured?.cache, "no-store");
  await assert.rejects(getOwnerFanmarkSettings(ID, {
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetchImpl: async () => Response.json({ ...context, fanmark: { ...context.fanmark, access_password: "secret" } }),
  }), FanmarkSettingsApiError);
});

test("PATCH carries settings and includes an access password only when supplied", async () => {
  let captured: Request | undefined;
  await saveOwnerFanmarkSettings(ID, {
    fanmarkName: "Rose",
    accessType: "profile",
    isPasswordProtected: true,
    isPublic: true,
  }, {
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetchImpl: async (input, init) => {
      captured = new Request(input, init);
      return Response.json(context);
    },
  });
  assert.equal(captured?.method, "PATCH");
  assert.equal(captured?.credentials, "include");
  assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(await captured!.text()), "accessPassword"), false);

  let passwordBody = "";
  await saveOwnerFanmarkSettings(ID, {
    fanmarkName: "Rose",
    accessType: "profile",
    isPasswordProtected: true,
    accessPassword: "2468",
    isPublic: true,
  }, {
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetchImpl: async (_input, init) => {
      passwordBody = String(init?.body ?? "");
      return Response.json(context);
    },
  });
  assert.equal(JSON.parse(passwordBody).accessPassword, "2468");
});

test("settings requests refuse cross-origin auth and surface HTTP failures without fallback", async () => {
  await assert.rejects(getOwnerFanmarkSettings(ID, {
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://auth.example.test",
    fetchImpl: async () => Response.json(context),
  }), FanmarkSettingsApiError);
  await assert.rejects(getOwnerFanmarkSettings(ID, {
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetchImpl: async () => new Response(null, { status: 503 }),
  }), (error: unknown) => error instanceof FanmarkSettingsApiError && error.kind === "http" && error.status === 503);
});
