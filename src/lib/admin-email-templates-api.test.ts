import assert from "node:assert/strict";
import test from "node:test";
import { createAdminEmailTemplatesApi, getAdminEmailTemplatesBackend } from "./admin-email-templates-api.ts";

const id = "81111111-1111-4111-8111-111111111111";
const updatedAt = "2026-09-25T12:00:00.000Z";
const template = {
  id, email_type: "signup", language: "ja", subject: "登録確認", body_text: "本文", button_text: "確認",
  is_active: true, created_at: updatedAt, updated_at: updatedAt,
};

test("email template selector defaults to Supabase and rejects unknown values", () => {
  assert.equal(getAdminEmailTemplatesBackend(undefined), "supabase");
  assert.equal(getAdminEmailTemplatesBackend(" worker "), "worker");
  assert.throws(() => getAdminEmailTemplatesBackend("other"), /configuration/u);
});

test("list uses credentialed same-origin no-store GET and validates bounded DTOs", async () => {
  let actualUrl = "";
  let actualInit;
  const api = createAdminEmailTemplatesApi({
    baseUrl: "https://staging.example.test",
    authBaseUrl: "https://staging.example.test",
    fetchImpl: async (url, init) => {
      actualUrl = String(url);
      actualInit = init;
      return new Response(JSON.stringify({ templates: [template] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.deepEqual(await api.list(), [template]);
  assert.equal(actualUrl, "https://staging.example.test/api/admin/email-templates");
  assert.equal(actualInit.method, "GET");
  assert.equal(actualInit.credentials, "include");
  assert.equal(actualInit.cache, "no-store");
  assert.equal(actualInit.redirect, "error");

  const malformed = createAdminEmailTemplatesApi({
    baseUrl: "https://staging.example.test",
    authBaseUrl: "https://staging.example.test",
    fetchImpl: async () => new Response(JSON.stringify({ templates: [{ ...template, is_active: 1 }] }), {
      status: 200, headers: { "content-type": "application/json" },
    }),
  });
  await assert.rejects(malformed.list(), /invalid_response/u);
});

test("update uses PATCH CAS contract and refuses cross-origin auth", async () => {
  let actualInit;
  const api = createAdminEmailTemplatesApi({
    baseUrl: "https://staging.example.test",
    authBaseUrl: "https://staging.example.test",
    fetchImpl: async (_url, init) => {
      actualInit = init;
      return new Response(JSON.stringify({ template: { ...template, subject: "新しい件名", updated_at: "2026-09-26T12:34:56.000Z" } }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    },
  });
  const result = await api.update({ id, expectedUpdatedAt: updatedAt, subject: "新しい件名", bodyText: "本文", buttonText: "確認" });
  assert.equal(result.subject, "新しい件名");
  assert.equal(actualInit.method, "PATCH");
  assert.deepEqual(JSON.parse(actualInit.body), {
    expectedUpdatedAt: updatedAt, subject: "新しい件名", bodyText: "本文", buttonText: "確認",
  });

  const crossOrigin = createAdminEmailTemplatesApi({ baseUrl: "https://worker.example.test", authBaseUrl: "https://app.example.test" });
  await assert.rejects(crossOrigin.list(), /configuration/u);
});
