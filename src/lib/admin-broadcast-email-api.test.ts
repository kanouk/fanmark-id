import assert from "node:assert/strict";
import test from "node:test";
import { createAdminBroadcastEmailApi, getAdminBroadcastEmailBackend } from "./admin-broadcast-email-api.ts";

const id = "81111111-1111-4111-8111-111111111111";
const timestamp = "2026-09-25T12:00:00.000Z";
const draft = {
  id,
  subject: "お知らせ",
  body_text: "本文",
  email_type: "broadcast_announcement",
  total_recipients: 0,
  sent_count: 0,
  failed_count: 0,
  status: "draft",
  recipient_filter: { languages: ["ja"] },
  created_at: timestamp,
  started_at: null,
  completed_at: null,
};
const template = {
  id,
  email_type: "broadcast_announcement",
  language: "ja",
  subject: "お知らせ",
  body_text: "本文",
  button_text: "開く",
};

test("broadcast email selector defaults to Supabase and rejects unknown values", () => {
  assert.equal(getAdminBroadcastEmailBackend(undefined), "supabase");
  assert.equal(getAdminBroadcastEmailBackend(" worker "), "worker");
  assert.throws(() => getAdminBroadcastEmailBackend("other"), /configuration/u);
});

test("list uses a credentialed same-origin no-store request and validates the snapshot", async () => {
  let actualUrl = "";
  let actualInit: RequestInit | undefined;
  const api = createAdminBroadcastEmailApi({
    baseUrl: "https://staging.example.test",
    authBaseUrl: "https://staging.example.test",
    fetchImpl: async (url, init) => {
      actualUrl = String(url);
      actualInit = init;
      return new Response(JSON.stringify({ broadcasts: [draft], templates: [template] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.deepEqual(await api.list(), { broadcasts: [draft], templates: [template] });
  assert.equal(actualUrl, "https://staging.example.test/api/admin/broadcast-emails");
  assert.equal(actualInit?.method, "GET");
  assert.equal(actualInit?.credentials, "include");
  assert.equal(actualInit?.cache, "no-store");
  assert.equal(actualInit?.redirect, "error");

  const malformed = createAdminBroadcastEmailApi({
    baseUrl: "https://staging.example.test",
    authBaseUrl: "https://staging.example.test",
    fetchImpl: async () => new Response(JSON.stringify({ broadcasts: [{ ...draft, error_details: "leak" }], templates: [template] }), {
      status: 200, headers: { "content-type": "application/json" },
    }),
  });
  await assert.rejects(malformed.list(), /invalid_response/u);
});

test("recipient estimates and draft creation use bounded POST contracts", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const api = createAdminBroadcastEmailApi({
    baseUrl: "https://staging.example.test",
    authBaseUrl: "https://staging.example.test",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init! });
      if (String(url).endsWith("/estimate")) {
        return new Response(JSON.stringify({ count: 3 }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ broadcast: { ...draft, recipient_filter: { languages: ["ja"] } } }), {
        status: 201, headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(await api.estimateRecipients({ languages: ["ja"] }), 3);
  const created = await api.createDraft({
    emailType: "broadcast_announcement",
    subject: " お知らせ ",
    bodyText: "本文",
    recipientFilter: { languages: ["ja"] },
  });
  assert.equal(created.status, "draft");
  assert.equal(calls[0].url, "https://staging.example.test/api/admin/broadcast-emails/estimate");
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { recipientFilter: { languages: ["ja"] } });
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].init.body as string), {
    emailType: "broadcast_announcement", subject: " お知らせ ", bodyText: "本文", recipientFilter: { languages: ["ja"] },
  });
});

test("refuses cross-origin authentication and invalid status DTOs", async () => {
  const crossOrigin = createAdminBroadcastEmailApi({ baseUrl: "https://worker.example.test", authBaseUrl: "https://app.example.test" });
  await assert.rejects(crossOrigin.list(), /configuration/u);

  const malformed = createAdminBroadcastEmailApi({
    baseUrl: "https://staging.example.test",
    authBaseUrl: "https://staging.example.test",
    fetchImpl: async () => new Response(JSON.stringify({ broadcasts: [{ ...draft, status: "sending", error_details: "unexpected" }], templates: [] }), {
      status: 200, headers: { "content-type": "application/json" },
    }),
  });
  await assert.rejects(malformed.list(), /invalid_response/u);
});
