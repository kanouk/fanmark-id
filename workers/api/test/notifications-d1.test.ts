import { env } from "cloudflare:workers";
import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import authSchemaSql from "../migrations/0003_better_auth_core.sql?raw";
import notificationsSchemaSql from "./fixtures/d1-notifications.sql?raw";
import { runScheduledNotificationEvents } from "../src/notifications-scheduled";
import { handleRequest } from "../src";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const authDatabase = runtimeEnv.AUTH_DB;
const businessDatabase = runtimeEnv.FANMARK_DB;
const apiBase = "https://api.example.test";
const appOrigin = "https://app.example.test";
const ownerId = "8911e63f-9c85-4a7a-bff1-432e8daed7b5";
const otherId = "66c59118-5e50-4d5c-a675-3afc83e6006d";
const ownerEmail = "notifications-owner@example.invalid";
const otherEmail = "notifications-other@example.invalid";
const password = "Synthetic-Notifications-Only!2026";
const now = "2026-09-25T00:00:00.000Z";
const unreadDeliveredId = "55555555-1111-4111-8111-111111111111";
const pendingId = "55555555-2222-4222-8222-222222222222";
const expiredId = "55555555-3333-4333-8333-333333333333";
const alreadyReadId = "55555555-4444-4444-8444-444444444444";
const otherNotificationId = "55555555-5555-4555-8555-555555555555";

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
    if (character === "'" && !doubleQuoted) {
      if (singleQuoted && next === "'") index += 1;
      else singleQuoted = !singleQuoted;
      continue;
    }
    if (character === '"' && !singleQuoted) {
      if (doubleQuoted && next === '"') index += 1;
      else doubleQuoted = !doubleQuoted;
      continue;
    }
    if (character !== ";" || singleQuoted || doubleQuoted) continue;
    const candidate = sql.slice(start, index).trim();
    if (/^create\s+trigger\b/iu.test(candidate) && !/\bend\s*$/iu.test(candidate)) continue;
    if (candidate) statements.push(candidate);
    start = index + 1;
  }
  const finalStatement = sql.slice(start).trim();
  if (finalStatement) statements.push(finalStatement);
  return statements;
}

async function request(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", appOrigin);
  return handleRequest(new Request(`${apiBase}${path}`, { ...init, headers }), { ...runtimeEnv, ...overrides });
}

async function signIn(email: string): Promise<string> {
  const response = await request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (response.status !== 200) throw new Error(`Synthetic sign-in failed: ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Synthetic sign-in did not issue a session cookie");
  return cookie;
}

async function resetRows(): Promise<void> {
  if (!authDatabase || !businessDatabase) throw new Error("Split D1 bindings unavailable");
  await authDatabase.prepare('DELETE FROM "session" WHERE "userId" IN (?, ?)').bind(ownerId, otherId).run();
  await authDatabase.prepare('DELETE FROM "account" WHERE "userId" IN (?, ?)').bind(ownerId, otherId).run();
  await authDatabase.prepare('DELETE FROM "user" WHERE "id" IN (?, ?)').bind(ownerId, otherId).run();
  await businessDatabase.prepare("DELETE FROM notifications WHERE user_id IN (?, ?)").bind(ownerId, otherId).run();
  await businessDatabase.batch([
    businessDatabase.prepare("DELETE FROM notification_events"),
    businessDatabase.prepare("DELETE FROM notification_preferences"),
    businessDatabase.prepare("DELETE FROM notification_rules"),
    businessDatabase.prepare("DELETE FROM notification_templates"),
    businessDatabase.prepare("DELETE FROM user_settings"),
  ]);
  for (const [id, email, name] of [
    [ownerId, ownerEmail, "Synthetic Notification Owner"],
    [otherId, otherEmail, "Synthetic Notification Other"],
  ]) {
    await authDatabase.prepare(
      'INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)',
    ).bind(id, name, email, now, now).run();
    await authDatabase.prepare(
      'INSERT INTO "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(`${id}-account`, id, "credential", id, bcrypt.hashSync(password, 10), now, now).run();
  }
  const fixtures = [
    [unreadDeliveredId, ownerId, "in_app", "delivered", null, null, { title: "Hello", body: "Owner-only content" }],
    [pendingId, ownerId, "email", "pending", null, null, { title: "Pending" }],
    [expiredId, ownerId, "webpush", "delivered", "2000-01-01T00:00:00.000Z", null, { title: "Expired" }],
    [alreadyReadId, ownerId, "in_app", "delivered", null, now, { title: "Read" }],
    [otherNotificationId, otherId, "in_app", "delivered", null, null, { title: "Other user's private notification" }],
  ] as const;
  for (const [id, userId, channel, status, expiresAt, readAt, payload] of fixtures) {
    await businessDatabase.prepare(`
      INSERT INTO notifications
        (id, event_id, rule_id, user_id, channel, template_id, template_version, payload,
         status, priority, triggered_at, expires_at, delivered_at, retry_count, read_at,
         read_via, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 5, ?, ?, ?, 0, ?, ?, ?, ?)
    `).bind(
      id, `${id}-event`, `${id}-rule`, userId, channel, `${id}-template`, JSON.stringify(payload), status,
      now, expiresAt, status === "delivered" ? now : null, readAt, readAt ? "app" : null, now, now,
    ).run();
  }
}

beforeAll(async () => {
  if (!authDatabase || !businessDatabase) throw new Error("Split D1 bindings unavailable");
  await authDatabase.batch(splitSqlStatements(authSchemaSql).map((statement) => authDatabase.prepare(statement)));
  await businessDatabase.batch(splitSqlStatements(notificationsSchemaSql).map((statement) => businessDatabase.prepare(statement)));
});

beforeEach(resetRows);

describe("Better Auth notifications API", () => {
  it("lists only the session owner's notifications with a minimal DTO and a bounded limit", async () => {
    const cookie = await signIn(ownerEmail);
    const response = await request("/api/me/notifications?limit=3", { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as { schemaVersion: number; notifications: Array<Record<string, unknown>> };
    expect(body.schemaVersion).toBe(1);
    expect(body.notifications).toHaveLength(3);
    expect(body.notifications.map((item) => item.id)).toEqual([unreadDeliveredId, pendingId, expiredId]);
    expect(body.notifications[1]).toMatchObject({ id: pendingId, payload: { title: "Pending" }, read_at: null, channel: "email" });
    expect(body.notifications[1]).not.toHaveProperty("user_id");
    expect(body.notifications[1]).not.toHaveProperty("event_id");
    expect(body.notifications[1]).not.toHaveProperty("error_reason");
    expect(JSON.stringify(body)).not.toContain("Other user's private notification");
  });

  it("counts only unread, delivered, unexpired notifications for the session owner", async () => {
    const cookie = await signIn(ownerEmail);
    const response = await request("/api/me/notifications/unread-count", { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ schemaVersion: 1, count: 1 });
  });

  it("marks one owned notification read and refuses to update another user's notification", async () => {
    const cookie = await signIn(ownerEmail);
    const updated = await request(`/api/me/notifications/${unreadDeliveredId}/read`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ readVia: "menu" }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({ schemaVersion: 1, updated: true });
    const privateRead = await request(`/api/me/notifications/${otherNotificationId}/read`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ readVia: "app" }),
    });
    expect(privateRead.status).toBe(200);
    expect(await privateRead.json()).toEqual({ schemaVersion: 1, updated: false });
    const rows = await businessDatabase?.prepare("SELECT id, user_id, read_at, read_via FROM notifications ORDER BY id").all();
    const ownerRow = rows?.results?.find((row) => row.id === unreadDeliveredId);
    const otherRow = rows?.results?.find((row) => row.id === otherNotificationId);
    expect(ownerRow).toMatchObject({ user_id: ownerId, read_via: "menu" });
    expect(typeof ownerRow?.read_at).toBe("string");
    expect(Number.isFinite(Date.parse(String(ownerRow?.read_at)))).toBe(true);
    expect(otherRow).toMatchObject({ user_id: otherId, read_at: null, read_via: null });

    const pendingRead = await request(`/api/me/notifications/${pendingId}/read`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ readVia: "app" }),
    });
    expect(pendingRead.status).toBe(200);
    expect(await pendingRead.json()).toEqual({ schemaVersion: 1, updated: true });
  });

  it("caps the total notification response size even when each payload is individually valid", async () => {
    const cookie = await signIn(ownerEmail);
    const payload = JSON.stringify({ text: "x".repeat(15 * 1024) });
    for (let index = 0; index < 18; index += 1) {
      const suffix = String(index + 1).padStart(12, "0");
      const id = `77777777-7777-4777-8777-${suffix}`;
      await businessDatabase?.prepare(`
        INSERT INTO notifications
          (id, event_id, rule_id, user_id, channel, template_id, template_version, payload,
           status, priority, triggered_at, retry_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'in_app', ?, 1, ?, 'delivered', 5, ?, 0, ?, ?)
      `).bind(id, `${id}-event`, `${id}-rule`, ownerId, `${id}-template`, payload, now, now, now).run();
    }

    const response = await request("/api/me/notifications?limit=50", { headers: { Cookie: cookie } });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "notifications_unavailable" });
  });

  it("marks all eligible owned notifications and leaves pending, expired, read, and other-owner rows unchanged", async () => {
    const cookie = await signIn(ownerEmail);
    const response = await request("/api/me/notifications/read-all", { method: "POST", headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ schemaVersion: 1, updatedCount: 1 });
    const rows = await businessDatabase?.prepare("SELECT id, user_id, status, expires_at, read_at, read_via FROM notifications ORDER BY id").all();
    const values = new Map((rows?.results ?? []).map((row) => [row.id, row]));
    expect(values.get(unreadDeliveredId)).toMatchObject({ user_id: ownerId, read_via: "app" });
    expect(Number.isFinite(Date.parse(String(values.get(unreadDeliveredId)?.read_at)))).toBe(true);
    expect(values.get(pendingId)).toMatchObject({ read_at: null, read_via: null });
    expect(values.get(expiredId)).toMatchObject({ read_at: null, read_via: null });
    expect(values.get(alreadyReadId)?.read_at).toBe(now);
    expect(values.get(otherNotificationId)).toMatchObject({ user_id: otherId, read_at: null, read_via: null });
  });

  it("requires Better Auth, rejects caller-supplied identities and malformed operations, and enforces CORS", async () => {
    const cookie = await signIn(ownerEmail);
    expect((await request("/api/me/notifications")).status).toBe(401);
    expect((await request(`/api/me/notifications?limit=51`, { headers: { Cookie: cookie } })).status).toBe(400);
    expect((await request(`/api/me/notifications?userId=${otherId}`, { headers: { Cookie: cookie } })).status).toBe(400);
    expect((await request("/api/me/notifications/read-all", {
      method: "POST", headers: { Cookie: cookie, "content-type": "application/json" }, body: JSON.stringify({ userId: otherId }),
    })).status).toBe(400);
    expect((await request(`/api/me/notifications/${unreadDeliveredId}/read`, {
      method: "PATCH", headers: { Cookie: cookie, "content-type": "application/json" }, body: JSON.stringify({ readVia: "admin" }),
    })).status).toBe(400);
    expect((await request("/api/me/notifications/unread-count", { method: "POST", headers: { Cookie: cookie } })).status).toBe(405);
    expect((await request("/api/me/notifications", {}, { NOTIFICATIONS_BACKEND: undefined })).status).toBe(503);
    expect((await request("/api/me/notifications", { headers: { Origin: "https://attacker.example.test", Cookie: cookie } })).status).toBe(403);
    expect((await request("/api/me/notifications", { method: "OPTIONS", headers: { "access-control-request-method": "GET" } })).status).toBe(204);
  });
});

describe("D1 notification event processor", () => {
  async function seedEvent(delaySeconds = 0, triggerAt = now): Promise<string> {
    if (!businessDatabase) throw new Error("Split D1 bindings unavailable");
    const eventId = "aaaaaaaa-1111-4111-8111-111111111111";
    const ruleId = "bbbbbbbb-2222-4222-8222-222222222222";
    const createdAt = now;
    await businessDatabase.batch([
      businessDatabase.prepare(`INSERT INTO user_settings (id, user_id, username, preferred_language)
        VALUES (?, ?, ?, 'ja')`).bind("cccccccc-3333-4333-8333-333333333333", ownerId, "synthetic-notification-owner"),
      businessDatabase.prepare(`INSERT INTO notification_templates
        (id, template_id, version, channel, language, title, body, summary, is_active)
        VALUES (?, ?, 1, 'in_app', 'ja', ?, ?, ?, 1)`)
        .bind("dddddddd-4444-4444-8444-444444444444", "synthetic-template", "{{fanmark_name}}", "Hello {{fanmark_name}} {{created_at}}", "For {{fanmark_id}}"),
      businessDatabase.prepare(`INSERT INTO notification_rules
        (id, event_type, channel, template_id, template_version, delay_seconds, priority, enabled)
        VALUES (?, 'synthetic_event', 'in_app', 'synthetic-template', 1, ?, 8, 1)`)
        .bind(ruleId, delaySeconds),
      businessDatabase.prepare(`INSERT INTO notification_events
        (id, event_type, event_version, source, payload, trigger_at, status, retry_count, created_at, updated_at)
        VALUES (?, 'synthetic_event', 1, 'edge_function', ?, ?, 'pending', 0, ?, ?)`)
        .bind(eventId, JSON.stringify({ user_id: ownerId, fanmark_id: "fmk-1", fanmark_name: "香水ラジオ", created_at: createdAt }), triggerAt, createdAt, createdAt),
    ]);
    return eventId;
  }

  it("renders due events, creates one delivered in-app item, and is idempotent on later polls", async () => {
    if (!businessDatabase) throw new Error("Split D1 bindings unavailable");
    const eventId = await seedEvent();
    const result = await runScheduledNotificationEvents({
      env: { ...runtimeEnv, NOTIFICATION_PROCESSOR_BACKEND: "d1" },
      database: businessDatabase,
      scheduledTime: Date.parse(now),
    });
    expect(result).toEqual({ status: "completed", selected: 1, processed: 1, failed: 0 });
    const event = await businessDatabase.prepare("SELECT status, processed_at FROM notification_events WHERE id = ?")
      .bind(eventId).first();
    expect(event).toEqual({ status: "processed", processed_at: now });
    const notifications = await businessDatabase.prepare("SELECT user_id, channel, status, payload FROM notifications WHERE event_id = ?")
      .bind(eventId).all<{ user_id: string; channel: string; status: string; payload: string }>();
    expect(notifications.results).toHaveLength(1);
    expect(notifications.results[0]).toMatchObject({ user_id: ownerId, channel: "in_app", status: "delivered" });
    expect(JSON.parse(notifications.results[0].payload)).toEqual({
      title: "香水ラジオ",
      body: "Hello 香水ラジオ {{created_at}}",
      summary: "For fmk-1",
      link: null,
      fanmark_id: "fmk-1",
      fanmark_short_id: null,
      metadata: { user_id: ownerId, fanmark_id: "fmk-1", fanmark_name: "香水ラジオ", created_at: now },
    });
    const secondPoll = await runScheduledNotificationEvents({
      env: { ...runtimeEnv, NOTIFICATION_PROCESSOR_BACKEND: "d1" },
      database: businessDatabase,
      scheduledTime: Date.parse(now),
    });
    expect(secondPoll).toEqual({ status: "completed", selected: 0, processed: 0, failed: 0 });
    expect(await businessDatabase.prepare("SELECT count(*) AS count FROM notifications WHERE event_id = ?")
      .bind(eventId).first()).toEqual({ count: 1 });
  });

  it("creates delayed notifications as pending", async () => {
    if (!businessDatabase) throw new Error("Split D1 bindings unavailable");
    const eventId = await seedEvent(60);
    const result = await runScheduledNotificationEvents({
      env: { ...runtimeEnv, NOTIFICATION_PROCESSOR_BACKEND: "d1" },
      database: businessDatabase,
      scheduledTime: Date.parse(now),
    });
    expect(result).toMatchObject({ selected: 1, processed: 1, failed: 0 });
    const notification = await businessDatabase.prepare("SELECT status, triggered_at, delivered_at FROM notifications WHERE event_id = ?")
      .bind(eventId).first();
    expect(notification).toEqual({ status: "pending", triggered_at: "2026-09-25T00:01:00.000Z", delivered_at: null });
  });

  it("leaves events scheduled for the future untouched", async () => {
    if (!businessDatabase) throw new Error("Split D1 bindings unavailable");
    const eventId = await seedEvent(0, "2026-09-25T00:01:00.000Z");
    const result = await runScheduledNotificationEvents({
      env: { ...runtimeEnv, NOTIFICATION_PROCESSOR_BACKEND: "d1" },
      database: businessDatabase,
      scheduledTime: Date.parse(now),
    });
    expect(result).toEqual({ status: "completed", selected: 0, processed: 0, failed: 0 });
    expect(await businessDatabase.prepare("SELECT status FROM notification_events WHERE id = ?")
      .bind(eventId).first()).toEqual({ status: "pending" });
  });

  it("reclaims an abandoned processing lease after ten minutes", async () => {
    if (!businessDatabase) throw new Error("Split D1 bindings unavailable");
    const eventId = await seedEvent();
    await businessDatabase.prepare(`UPDATE notification_events SET status = 'processing', updated_at = ? WHERE id = ?`)
      .bind("2026-09-24T23:49:59.000Z", eventId).run();
    const result = await runScheduledNotificationEvents({
      env: { ...runtimeEnv, NOTIFICATION_PROCESSOR_BACKEND: "d1" },
      database: businessDatabase,
      scheduledTime: Date.parse(now),
    });
    expect(result).toMatchObject({ selected: 1, processed: 1, failed: 0 });
    expect(await businessDatabase.prepare("SELECT status, retry_count FROM notification_events WHERE id = ?")
      .bind(eventId).first()).toEqual({ status: "processed", retry_count: 0 });
  });

  it("honors a user's disabled channel preference", async () => {
    if (!businessDatabase) throw new Error("Split D1 bindings unavailable");
    const eventId = await seedEvent();
    await businessDatabase.prepare(`INSERT INTO notification_preferences
      (id, user_id, channel, event_type, enabled, created_at, updated_at)
      VALUES (?, ?, 'in_app', 'synthetic_event', 0, ?, ?)`)
      .bind("eeeeeeee-5555-4555-8555-555555555555", ownerId, now, now).run();
    const result = await runScheduledNotificationEvents({
      env: { ...runtimeEnv, NOTIFICATION_PROCESSOR_BACKEND: "d1" },
      database: businessDatabase,
      scheduledTime: Date.parse(now),
    });
    expect(result).toMatchObject({ processed: 1, failed: 0 });
    expect(await businessDatabase.prepare("SELECT count(*) AS count FROM notifications WHERE event_id = ?")
      .bind(eventId).first()).toEqual({ count: 0 });
  });

  it("does not touch the queue while its backend selector is disabled", async () => {
    if (!businessDatabase) throw new Error("Split D1 bindings unavailable");
    const eventId = await seedEvent();
    const result = await runScheduledNotificationEvents({
      env: runtimeEnv,
      database: businessDatabase,
      scheduledTime: Date.parse(now),
    });
    expect(result).toEqual({ status: "disabled" });
    expect(await businessDatabase.prepare("SELECT status FROM notification_events WHERE id = ?")
      .bind(eventId).first()).toEqual({ status: "pending" });
    expect(await businessDatabase.prepare("SELECT count(*) AS count FROM notifications WHERE event_id = ?")
      .bind(eventId).first()).toEqual({ count: 0 });
  });
});
