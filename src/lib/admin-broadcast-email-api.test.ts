import assert from "node:assert/strict";
import test from "node:test";
import {
  createAdminBroadcastEmailApi,
  getAdminBroadcastEmailBackend,
  getAdminBroadcastSendBackend,
  getAdminBroadcastTestSendBackend,
} from "./admin-broadcast-email-api.ts";

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
  delivery_status: null,
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
  assert.equal(getAdminBroadcastTestSendBackend(undefined), "disabled");
  assert.equal(getAdminBroadcastTestSendBackend(" worker "), "worker");
  assert.throws(() => getAdminBroadcastTestSendBackend("supabase"), /configuration/u);
  assert.equal(getAdminBroadcastSendBackend(undefined), "disabled");
  assert.equal(getAdminBroadcastSendBackend(" worker ", "cloudflare-staging"), "worker");
  assert.equal(getAdminBroadcastSendBackend("worker", "production"), "disabled");
  assert.throws(() => getAdminBroadcastSendBackend("resend"), /configuration/u);
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

  const paused = createAdminBroadcastEmailApi({
    baseUrl: "https://staging.example.test",
    authBaseUrl: "https://staging.example.test",
    fetchImpl: async () => new Response(JSON.stringify({
      broadcasts: [{ ...draft, status: "sending", delivery_status: "needs_review" }],
      templates: [template],
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.equal((await paused.list()).broadcasts[0]?.delivery_status, "needs_review");

  const malformed = createAdminBroadcastEmailApi({
    baseUrl: "https://staging.example.test",
    authBaseUrl: "https://staging.example.test",
    fetchImpl: async () => new Response(JSON.stringify({ broadcasts: [{ ...draft, error_details: "leak" }], templates: [template] }), {
      status: 200, headers: { "content-type": "application/json" },
    }),
  });
  await assert.rejects(malformed.list(), /invalid_response/u);

  const unknownDeliveryState = createAdminBroadcastEmailApi({
    baseUrl: "https://staging.example.test",
    authBaseUrl: "https://staging.example.test",
    fetchImpl: async () => new Response(JSON.stringify({
      broadcasts: [{ ...draft, delivery_status: "retry_now" }], templates: [template],
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(unknownDeliveryState.list(), /invalid_response/u);
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

test("test send uses a credentialed Worker route without sending a recipient address", async () => {
  const requestId = "91111111-1111-4111-8111-111111111111";
  let actualUrl = "";
  let actualInit: RequestInit | undefined;
  const api = createAdminBroadcastEmailApi({
    baseUrl: "https://staging.example.test",
    authBaseUrl: "https://staging.example.test",
    fetchImpl: async (url, init) => {
      actualUrl = String(url);
      actualInit = init;
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.deepEqual(await api.sendTest({ broadcastId: id, language: "ja", requestId }), {
    success: true,
    message: "テストメールを送信しました",
  });
  assert.equal(actualUrl, "https://staging.example.test/api/admin/broadcast-emails/test-send");
  assert.equal(actualInit?.method, "POST");
  assert.equal(actualInit?.credentials, "include");
  assert.equal(actualInit?.cache, "no-store");
  assert.equal(actualInit?.redirect, "error");
  assert.deepEqual(JSON.parse(actualInit?.body as string), { broadcastId: id, language: "ja", requestId });
  assert.equal((actualInit?.body as string).includes("@example"), false);

  const malformed = createAdminBroadcastEmailApi({
    baseUrl: "https://staging.example.test",
    authBaseUrl: "https://staging.example.test",
    fetchImpl: async () => new Response(JSON.stringify({ success: true, recipient: "leak@example.test" }), {
      status: 200, headers: { "content-type": "application/json" },
    }),
  });
  await assert.rejects(malformed.sendTest({ broadcastId: id, language: "ja", requestId }), /invalid_response/u);
  await assert.rejects(api.sendTest({ broadcastId: "not-a-uuid", language: "ja", requestId }), /configuration/u);
  await assert.rejects(api.sendTest({ broadcastId: id, language: "ja", requestId: "bad" }), /configuration/u);
});

test("bulk send start uses a stable idempotency identity and validates aggregate-only response", async () => {
  const requestId = "82222222-2222-4222-8222-222222222222";
  const runId = "83333333-3333-4333-8333-333333333333";
  let actualUrl = "";
  let actualInit: RequestInit | undefined;
  const api = createAdminBroadcastEmailApi({
    baseUrl: "https://staging.example.test",
    authBaseUrl: "https://staging.example.test",
    fetchImpl: async (url, init) => {
      actualUrl = String(url);
      actualInit = init;
      return new Response(JSON.stringify({ accepted: true, runId, status: "snapshotting", recipientCount: 0, sentCount: 0, failedCount: 0 }), {
        status: 202, headers: { "content-type": "application/json" },
      });
    },
  });
  assert.deepEqual(await api.startSend({ broadcastId: id, requestId }), {
    accepted: true, runId, status: "snapshotting", recipientCount: 0, sentCount: 0, failedCount: 0,
  });
  assert.equal(actualUrl, "https://staging.example.test/api/admin/broadcast-emails/send");
  assert.equal(actualInit?.method, "POST");
  assert.deepEqual(JSON.parse(String(actualInit?.body)), { broadcastId: id, requestId });
  assert.equal(actualInit?.credentials, "include");
  assert.equal(actualInit?.cache, "no-store");

  await assert.rejects(api.startSend({ broadcastId: "bad", requestId }), /configuration/u);
  const malformed = createAdminBroadcastEmailApi({
    baseUrl: "https://staging.example.test",
    authBaseUrl: "https://staging.example.test",
    fetchImpl: async () => new Response(JSON.stringify({ accepted: true, runId, status: "sending", recipientCount: 1,
      sentCount: 0, failedCount: 0, recipients: ["leak"] }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(malformed.startSend({ broadcastId: id, requestId }), /invalid_response/u);
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
