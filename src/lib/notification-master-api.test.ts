import assert from "node:assert/strict";
import test from "node:test";
import {
  getNotificationMasterBackend,
  createManualNotificationEvent,
  loadNotificationDeliveries,
  loadNotificationEvents,
  loadNotificationRules,
  loadNotificationTemplates,
  NotificationMasterApiError,
  updateNotificationRule,
  updateNotificationTemplate,
} from "./notification-master-api.ts";

const API_BASE = "https://api.example.test";
const AUTH_BASE = "https://api.example.test";
const RULE_ID = "45111111-1111-4111-8111-111111111111";
const TEMPLATE_ID = "45222222-2222-4222-8222-222222222222";
const UPDATED_AT = "2026-09-25T12:00:00.000Z";
const EVENT_ID = "45444444-4444-4444-8444-444444444444";
const NOTIFICATION_ID = "45555555-5555-4555-8555-555555555555";

const rule = {
  id: RULE_ID,
  event_type: "license_expiring",
  channel: "in_app",
  template_id: "extension_reminder",
  priority: 3,
  delay_seconds: 60,
  enabled: true,
  updated_at: UPDATED_AT,
};

const template = {
  id: TEMPLATE_ID,
  template_id: "extension_reminder",
  language: "ja",
  channel: "in_app",
  version: 1,
  title: "延長のお知らせ",
  body: "{{name}}",
  summary: null,
  is_active: true,
  created_at: UPDATED_AT,
  updated_at: UPDATED_AT,
};

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("notification master selector defaults to Supabase and rejects unknown values", () => {
  assert.equal(getNotificationMasterBackend(undefined), "supabase");
  assert.equal(getNotificationMasterBackend(" worker "), "worker");
  assert.throws(() => getNotificationMasterBackend("d1"), NotificationMasterApiError);
});

test("loads notification rules from a same-origin Worker with cookies and no cache", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const result = await loadNotificationRules({
    baseUrl: API_BASE,
    authBaseUrl: AUTH_BASE,
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return response({ schemaVersion: 1, rules: [rule] });
    },
  });
  assert.equal(capturedUrl, "https://api.example.test/api/admin/notification-masters/rules");
  assert.equal(capturedInit?.credentials, "include");
  assert.equal(capturedInit?.cache, "no-store");
  assert.deepEqual(result, [rule]);
});

test("loads templates and patches only requested rule/template fields", async () => {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const call = {
      url: String(input),
      method: String(init?.method),
      ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) as unknown } : {}),
    };
    calls.push(call);
    if (call.method === "GET") return response({ schemaVersion: 1, templates: [template] });
    if (call.url.endsWith(`/rules/${RULE_ID}`)) return response({ schemaVersion: 1, rule: { ...rule, enabled: false } });
    return response({ schemaVersion: 1, template: { ...template, title: "更新済み", is_active: false } });
  };

  assert.deepEqual(await loadNotificationTemplates({ baseUrl: API_BASE, authBaseUrl: AUTH_BASE, fetchImpl }), [template]);
  const updatedRule = await updateNotificationRule(RULE_ID, false, UPDATED_AT, { baseUrl: API_BASE, authBaseUrl: AUTH_BASE, fetchImpl });
  assert.equal(updatedRule.enabled, false);
  const updatedTemplate = await updateNotificationTemplate(TEMPLATE_ID, {
    title: "更新済み", body: "{{name}}", summary: null, isActive: false, expectedUpdatedAt: UPDATED_AT,
  }, { baseUrl: API_BASE, authBaseUrl: AUTH_BASE, fetchImpl });
  assert.equal(updatedTemplate.is_active, false);
  assert.deepEqual(calls.map(({ url, method }) => [url, method]), [
    ["https://api.example.test/api/admin/notification-masters/templates", "GET"],
    [`https://api.example.test/api/admin/notification-masters/rules/${RULE_ID}`, "PATCH"],
    [`https://api.example.test/api/admin/notification-masters/templates/${TEMPLATE_ID}`, "PATCH"],
  ]);
  assert.deepEqual(calls[1]?.body, { enabled: false, expectedUpdatedAt: UPDATED_AT });
  assert.deepEqual(calls[2]?.body, {
    title: "更新済み", body: "{{name}}", summary: null, isActive: false, expectedUpdatedAt: UPDATED_AT,
  });
});

test("loads bounded notification logs and posts only supported manual event input", async () => {
  const event = {
    id: EVENT_ID,
    event_type: "license_expired",
    status: "processed",
    source: "edge_function",
    created_at: UPDATED_AT,
    processed_at: UPDATED_AT,
    error_reason: null,
  };
  const delivery = {
    id: NOTIFICATION_ID,
    user_id: "12345678...",
    channel: "in_app",
    status: "delivered",
    delivered_at: UPDATED_AT,
    read_at: null,
    priority: 3,
  };
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const call = {
      url: String(input),
      method: String(init?.method),
      ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) as unknown } : {}),
    };
    calls.push(call);
    if (call.url.endsWith("/events") && call.method === "GET") return response({ schemaVersion: 1, events: [event] });
    if (call.url.endsWith("/notifications")) return response({ schemaVersion: 1, notifications: [delivery] });
    return response({ schemaVersion: 1, event: { id: EVENT_ID } }, 201);
  };

  assert.deepEqual(await loadNotificationEvents({ baseUrl: API_BASE, authBaseUrl: AUTH_BASE, fetchImpl }), [event]);
  assert.deepEqual(await loadNotificationDeliveries({ baseUrl: API_BASE, authBaseUrl: AUTH_BASE, fetchImpl }), [delivery]);
  assert.deepEqual(await createManualNotificationEvent("license_expired", { user_id: "synthetic-user" }, {
    baseUrl: API_BASE, authBaseUrl: AUTH_BASE, fetchImpl,
  }), { id: EVENT_ID });
  assert.deepEqual(calls.map(({ url, method }) => [url, method]), [
    ["https://api.example.test/api/admin/notification-masters/events", "GET"],
    ["https://api.example.test/api/admin/notification-masters/notifications", "GET"],
    ["https://api.example.test/api/admin/notification-masters/events", "POST"],
  ]);
  assert.deepEqual(calls[2]?.body, { eventType: "license_expired", payload: { user_id: "synthetic-user" } });
  await assert.rejects(
    createManualNotificationEvent("unsupported_event" as "license_expired", { user_id: "synthetic-user" }, {
      baseUrl: API_BASE, authBaseUrl: AUTH_BASE, fetchImpl,
    }),
    NotificationMasterApiError,
  );
});

test("rejects cross-origin auth targets, malformed responses, and preserves HTTP errors", async () => {
  await assert.rejects(
    loadNotificationRules({ baseUrl: API_BASE, authBaseUrl: "https://auth.other.test" }),
    NotificationMasterApiError,
  );
  await assert.rejects(
    loadNotificationRules({
      baseUrl: API_BASE,
      authBaseUrl: AUTH_BASE,
      fetchImpl: async () => response({ schemaVersion: 1, rules: [{ ...rule, created_by: "leak" }] }),
    }),
    (error: unknown) => error instanceof NotificationMasterApiError && error.kind === "invalid_response",
  );
  await assert.rejects(
    loadNotificationTemplates({ baseUrl: API_BASE, authBaseUrl: AUTH_BASE, fetchImpl: async () => response({}, 403) }),
    (error: unknown) => error instanceof NotificationMasterApiError && error.kind === "http" && error.status === 403,
  );
});
