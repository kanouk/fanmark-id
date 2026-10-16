import assert from "node:assert/strict";
import test from "node:test";
import {
  getNotificationsBackend,
  loadOwnNotifications,
  loadOwnUnreadNotificationCount,
  markAllOwnNotificationsRead,
  markOwnNotificationRead,
  NotificationsApiError,
} from "./notifications-api.ts";

const id = "55555555-1111-4111-8111-111111111111";
const notification = {
  id,
  payload: { title: "A notification", body: "Hello" },
  read_at: null,
  triggered_at: "2026-09-24T12:00:00.000Z",
  priority: 5,
  channel: "in_app",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("notification backend defaults to Supabase and rejects unknown selectors", () => {
  assert.equal(getNotificationsBackend(undefined), "supabase");
  assert.equal(getNotificationsBackend("worker"), "worker");
  assert.throws(() => getNotificationsBackend("fallback"), NotificationsApiError);
});

test("list uses same-origin credentials, no-store, a strict DTO and the requested bound", async () => {
  let call: { url: URL; init: RequestInit } | undefined;
  const notifications = await loadOwnNotifications(5, {
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetchImpl: async (input, init) => {
      call = { url: new URL(String(input)), init: init ?? {} };
      return jsonResponse({ schemaVersion: 1, notifications: [notification] });
    },
  });
  assert.deepEqual(notifications, [notification]);
  assert.equal(call?.url.pathname, "/api/me/notifications");
  assert.equal(call?.url.searchParams.get("limit"), "5");
  assert.equal(call?.init.credentials, "include");
  assert.equal(call?.init.cache, "no-store");
  assert.equal(call?.init.redirect, "error");
  await assert.rejects(loadOwnNotifications(51, { baseUrl: "https://api.example.test" }), NotificationsApiError);
});

test("rejects cross-origin auth and malformed, oversized, or privilege-shaped responses", async () => {
  await assert.rejects(
    loadOwnNotifications(10, { baseUrl: "https://api.example.test", authBaseUrl: "https://auth.example.test" }),
    NotificationsApiError,
  );
  for (const notifications of [
    [{ ...notification, user_id: "somebody-else" }],
    [{ ...notification, channel: "secret" }],
    [{ ...notification, read_at: "not-a-date" }],
  ]) {
    await assert.rejects(loadOwnNotifications(10, {
      baseUrl: "https://api.example.test",
      authBaseUrl: "https://api.example.test",
      fetchImpl: async () => jsonResponse({ schemaVersion: 1, notifications }),
    }), NotificationsApiError);
  }
  await assert.rejects(loadOwnNotifications(10, {
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    fetchImpl: async () => jsonResponse({ schemaVersion: 1, notifications: Array(11).fill(notification) }),
  }), NotificationsApiError);
});

test("reads counts and sends only narrowly allowed read mutations without fallback", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const requestInit = init ?? {};
    calls.push({ url, init: requestInit });
    if (url.pathname.endsWith("unread-count")) return jsonResponse({ schemaVersion: 1, count: 3 });
    if (url.pathname.endsWith("read-all")) return jsonResponse({ schemaVersion: 1, updatedCount: 2 });
    if (requestInit.method === "PATCH") return jsonResponse({ schemaVersion: 1, updated: true });
    return jsonResponse({ error: "unavailable" }, 503);
  };
  const options = { baseUrl: "https://api.example.test", authBaseUrl: "https://api.example.test", fetchImpl };
  assert.equal(await loadOwnUnreadNotificationCount(options), 3);
  assert.equal(await markOwnNotificationRead(id, "menu", options), true);
  assert.equal(await markAllOwnNotificationsRead(options), 2);
  assert.equal(calls[1].init.method, "PATCH");
  assert.equal(calls[1].init.credentials, "include");
  assert.equal(calls[1].init.body, JSON.stringify({ readVia: "menu" }));
  assert.equal(calls[2].init.method, "POST");
  await assert.rejects(loadOwnNotifications(5, options), (error: unknown) =>
    error instanceof NotificationsApiError && error.kind === "http" && error.status === 503,
  );
});
