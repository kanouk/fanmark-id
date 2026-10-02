import { env } from "cloudflare:workers";
import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import authSchemaSql from "../migrations/0003_better_auth_core.sql?raw";
import { checkedInSqlStatements as splitSqlStatements } from "./schema-statements";
import { runScheduledNotificationArchive, runScheduledNotificationEvents } from "../src/notifications-scheduled";
import renderSourceJson from "./fixtures/notification-render-source.json?raw";
import signupSchema from "../migrations/0007_auth_signup_command.sql?raw";
import suspensionSchema from "../migrations/0008_auth_user_suspension.sql?raw";
import { handleRequest } from "../src";
import type { Env } from "../src/repository";

declare module "vitest" {
  export interface ProvidedContext {
    businessNotificationMigrations: Array<{ name: string; sql: string }>;
  }
}

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
const now = "2026-09-25T00:00:00.000000Z";
const unreadDeliveredId = "55555555-1111-4111-8111-111111111111";
const pendingId = "55555555-2222-4222-8222-222222222222";
const expiredId = "55555555-3333-4333-8333-333333333333";
const alreadyReadId = "55555555-4444-4444-8444-444444444444";
const otherNotificationId = "55555555-5555-4555-8555-555555555555";

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

async function seedNotificationReferences(id: string, createdAt: string): Promise<void> {
  if (!businessDatabase) throw new Error("Split D1 bindings unavailable");
  await businessDatabase.batch([
    businessDatabase.prepare(`INSERT INTO notification_events
      (id,event_type,source,trigger_at,status,created_at,updated_at)
      VALUES (?, 'synthetic_reference', 'system', ?, 'processed', ?, ?)`)
      .bind(id, createdAt, createdAt, createdAt),
    businessDatabase.prepare(`INSERT INTO notification_rules
      (id,event_type,channel,template_id,enabled,created_at,updated_at)
      VALUES (?, 'synthetic_reference', 'in_app', 'synthetic-reference-template', 0, ?, ?)`)
      .bind(id, createdAt, createdAt),
  ]);
}

async function resetRows(): Promise<void> {
  if (!authDatabase || !businessDatabase) throw new Error("Split D1 bindings unavailable");
  await authDatabase.prepare('DELETE FROM "session" WHERE "userId" IN (?, ?)').bind(ownerId, otherId).run();
  await authDatabase.prepare('DELETE FROM "account" WHERE "userId" IN (?, ?)').bind(ownerId, otherId).run();
  await authDatabase.prepare('DELETE FROM "user" WHERE "id" IN (?, ?)').bind(ownerId, otherId).run();
  await businessDatabase.prepare("DELETE FROM notifications WHERE user_id IN (?, ?)").bind(ownerId, otherId).run();
  await businessDatabase.batch([
    businessDatabase.prepare("DELETE FROM notifications_history"),
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
    await seedNotificationReferences(id, now);
    await businessDatabase.prepare(`
      INSERT INTO notifications
        (id, event_id, rule_id, user_id, channel, template_id, template_version, payload,
         status, priority, triggered_at, expires_at, delivered_at, retry_count, read_at,
         read_via, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 5, ?, ?, ?, 0, ?, ?, ?, ?)
    `).bind(
      id, id, id, userId, channel, `${id}-template`, JSON.stringify(payload), status,
      now, expiresAt, status === "delivered" ? now : null, readAt, readAt ? "app" : null, now, now,
    ).run();
  }
}

beforeAll(async () => {
  if (!authDatabase || !businessDatabase) throw new Error("Split D1 bindings unavailable");
  await authDatabase.batch([authSchemaSql, signupSchema, suspensionSchema].flatMap(splitSqlStatements).map((statement) => authDatabase.prepare(statement)));
  const migrations = inject("businessNotificationMigrations");
  expect(migrations.length).toBeGreaterThanOrEqual(25);
  expect(migrations[0].name).toBe("0000_business_schema_v4_staging.sql");
  for (const migration of migrations) {
    const sql = splitSqlStatements(migration.sql);
    for (let offset = 0; offset < sql.length; offset += 50) {
      await businessDatabase.batch(sql.slice(offset, offset + 50).map(statement => businessDatabase.prepare(statement)));
    }
  }
});

beforeEach(resetRows);

describe("Better Auth notifications API", () => {
  it("refuses a revoked session for inbox reads/writes and rejects a new sign-in while suspended", async () => {
    if (!authDatabase || !businessDatabase) throw new Error("Split D1 bindings unavailable");
    const cookie = await signIn(ownerEmail);
    const otherCookie = await signIn(otherEmail);
    expect((await request("/api/me/notifications", { headers: { Cookie: cookie } })).status).toBe(200);
    const before = (await businessDatabase.prepare("SELECT * FROM notifications ORDER BY id").all()).results;
    // The admin suspension transaction sets this flag and revokes the user's
    // sessions. Its separate MFA/audit suite covers authorization and atomicity.
    await authDatabase.batch([
      authDatabase.prepare('UPDATE "user" SET banned = 1, banReason = ?, banExpires = NULL WHERE id = ?')
        .bind("synthetic notification suspension", ownerId),
      authDatabase.prepare('DELETE FROM session WHERE userId = ?').bind(ownerId),
    ]);
    for (const path of ["/api/me/notifications", "/api/me/notifications/unread-count"]) {
      const response = await request(path, { headers: { Cookie: cookie } });
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(JSON.stringify(await response.json())).not.toContain("Owner-only content");
    }
    expect((await request(`/api/me/notifications/${unreadDeliveredId}/read`, {
      method: "PATCH", headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ readVia: "app" }),
    })).status).toBe(401);
    expect((await request("/api/me/notifications/read-all", {
      method: "POST", headers: { Cookie: cookie },
    })).status).toBe(401);
    expect((await businessDatabase.prepare("SELECT * FROM notifications ORDER BY id").all()).results).toEqual(before);
    const other = await request("/api/me/notifications/unread-count", { headers: { Cookie: otherCookie } });
    expect(other.status).toBe(200);
    expect(await other.json()).toEqual({ schemaVersion: 1, count: 1 });
    const signin = await request("/api/auth/sign-in/email", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: ownerEmail, password }),
    });
    expect(signin.status).toBe(403);
    expect(await signin.json()).toMatchObject({ code: "BANNED_USER" });
    expect(await authDatabase.prepare('SELECT count(*) AS count FROM session WHERE userId = ?')
      .bind(ownerId).first()).toEqual({ count: 0 });
  });

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

  it("never accepts a caller-selected unread-count owner from the legacy RPC arguments", async () => {
    await businessDatabase?.prepare(`INSERT INTO notifications
      (id, event_id, rule_id, user_id, channel, template_id, template_version, payload,
       status, priority, triggered_at, retry_count, created_at, updated_at)
      SELECT '55555555-6666-4666-8666-666666666666', event_id, rule_id, user_id,
        channel, template_id, template_version, payload, status, priority, triggered_at,
        retry_count, created_at, updated_at FROM notifications WHERE id = ?`)
      .bind(otherNotificationId).run();
    const ownerCookie = await signIn(ownerEmail);
    const otherCookie = await signIn(otherEmail);
    for (const [cookie, count] of [[ownerCookie, 1], [otherCookie, 2]] as const) {
      const response = await request("/api/me/notifications/unread-count", { headers: { Cookie: cookie } });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ schemaVersion: 1, count });
    }
    for (const key of ["userId", "user_id", "user_id_param"]) {
      const response = await request(`/api/me/notifications/unread-count?${key}=${otherId}`, {
        headers: { Cookie: ownerCookie },
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
    expect((await request("/api/me/notifications/unread-count")).status).toBe(401);
    const rows = await businessDatabase?.prepare("SELECT user_id, read_at FROM notifications WHERE user_id = ?")
      .bind(otherId).all();
    expect(rows?.results).toEqual([{ user_id: otherId, read_at: null }, { user_id: otherId, read_at: null }]);
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
    const rows = await businessDatabase?.prepare("SELECT id, user_id, read_at, read_via, created_at, updated_at FROM notifications ORDER BY id").all();
    const ownerRow = rows?.results?.find((row) => row.id === unreadDeliveredId);
    const otherRow = rows?.results?.find((row) => row.id === otherNotificationId);
    expect(ownerRow).toMatchObject({ user_id: ownerId, read_via: "menu" });
    expect(typeof ownerRow?.read_at).toBe("string");
    expect(Number.isFinite(Date.parse(String(ownerRow?.read_at)))).toBe(true);
    expect(ownerRow?.created_at).toBe(now);
    expect(ownerRow?.updated_at).toBe(ownerRow?.read_at);
    expect(otherRow).toMatchObject({ user_id: otherId, read_at: null, read_via: null, created_at: now, updated_at: now });

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
      await seedNotificationReferences(id, now);
      await businessDatabase?.prepare(`
        INSERT INTO notifications
          (id, event_id, rule_id, user_id, channel, template_id, template_version, payload,
           status, priority, triggered_at, retry_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'in_app', ?, 1, ?, 'delivered', 5, ?, 0, ?, ?)
      `).bind(id, id, id, ownerId, `${id}-template`, payload, now, now, now).run();
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
    const rows = await businessDatabase?.prepare(`SELECT id, user_id, status, expires_at, read_at, read_via, created_at, updated_at
      FROM notifications ORDER BY id`).all();
    const values = new Map((rows?.results ?? []).map((row) => [row.id, row]));
    expect(values.get(unreadDeliveredId)).toMatchObject({ user_id: ownerId, read_via: "app" });
    expect(Number.isFinite(Date.parse(String(values.get(unreadDeliveredId)?.read_at)))).toBe(true);
    expect(values.get(unreadDeliveredId)?.created_at).toBe(now);
    expect(values.get(unreadDeliveredId)?.updated_at).toBe(values.get(unreadDeliveredId)?.read_at);
    expect(values.get(pendingId)).toMatchObject({ read_at: null, read_via: null, created_at: now, updated_at: now });
    expect(values.get(expiredId)).toMatchObject({ read_at: null, read_via: null, created_at: now, updated_at: now });
    expect(values.get(alreadyReadId)?.read_at).toBe(now);
    expect(values.get(otherNotificationId)).toMatchObject({ user_id: otherId, read_at: null, read_via: null, created_at: now, updated_at: now });
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

describe("scheduled notification archive", () => {
  const archiveNow = new Date("2026-09-25T00:00:00.000Z");
  const archiveCutoff = new Date(archiveNow.getTime() - 90 * 24 * 60 * 60 * 1000);
  const oldCreatedAt = new Date(archiveCutoff.getTime() - 1).toISOString().replace(".999Z", ".999999Z");
  const cutoffCreatedAt = archiveCutoff.toISOString().replace(".000Z", ".000000Z");
  const deliveredArchiveId = "66666666-1111-4111-8111-111111111111";
  const failedArchiveId = "66666666-2222-4222-8222-222222222222";
  const boundaryArchiveId = "66666666-3333-4333-8333-333333333333";
  const pendingArchiveId = "66666666-4444-4444-8444-444444444444";
  const conflictingArchiveId = "66666666-5555-4555-8555-555555555555";

  async function insertArchiveCandidate(id: string, status: string, createdAt: string): Promise<void> {
    await seedNotificationReferences(id, createdAt);
    await businessDatabase?.prepare(`
      INSERT INTO notifications (
        id, event_id, rule_id, user_id, channel, template_id, template_version,
        payload, status, priority, triggered_at, delivered_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'in_app', 'archive-test', 1, ?, ?, 5, ?, ?, ?, ?)
    `).bind(
      id, id, id, ownerId, JSON.stringify({ note: `synthetic-${id}`, keep: [1, null] }),
      status, createdAt, status === "delivered" ? createdAt : null, createdAt, createdAt,
    ).run();
  }

  it("moves only old delivered/failed rows and preserves source fields in history", async () => {
    await insertArchiveCandidate(deliveredArchiveId, "delivered", oldCreatedAt);
    await insertArchiveCandidate(failedArchiveId, "failed", oldCreatedAt);
    await insertArchiveCandidate(boundaryArchiveId, "delivered", cutoffCreatedAt);
    await insertArchiveCandidate(pendingArchiveId, "pending", oldCreatedAt);

    const summary = await runScheduledNotificationArchive({
      env: { ...runtimeEnv, NOTIFICATION_ARCHIVE_BACKEND: "d1" },
      now: archiveNow,
    });
    expect(summary).toEqual({ status: "completed", archived: 2, remaining: 0, conflicts: 0, batches: 1 });

    const archivedRows = await businessDatabase?.prepare(`
      SELECT id, original_data, archived_at FROM notifications_history ORDER BY id
    `).all<{ id: string; original_data: string; archived_at: string }>();
    expect(archivedRows?.results?.map((row) => row.id)).toEqual([deliveredArchiveId, failedArchiveId]);
    const archivedDelivered = archivedRows?.results?.find((row) => row.id === deliveredArchiveId);
    const sourceData = JSON.parse(String(archivedDelivered?.original_data)) as Record<string, unknown>;
    expect(sourceData).toEqual({
      id: deliveredArchiveId,
      event_id: deliveredArchiveId,
      rule_id: deliveredArchiveId,
      user_id: ownerId,
      channel: "in_app",
      template_id: "archive-test",
      template_version: 1,
      status: "delivered",
      payload: { note: `synthetic-${deliveredArchiveId}`, keep: [1, null] },
      priority: 5,
      triggered_at: oldCreatedAt,
      delivered_at: oldCreatedAt,
      read_at: null,
      read_via: null,
      expires_at: null,
      retry_count: 0,
      error_reason: null,
      created_at: oldCreatedAt,
      updated_at: oldCreatedAt,
    });
    expect(archivedDelivered?.archived_at).toBe("2026-09-25T00:00:00.000000Z");
    const remainingRows = await businessDatabase?.prepare(`
      SELECT id FROM notifications WHERE id IN (?, ?, ?, ?) ORDER BY id
    `).bind(deliveredArchiveId, failedArchiveId, boundaryArchiveId, pendingArchiveId).all<{ id: string }>();
    expect(remainingRows?.results?.map((row) => row.id)).toEqual([boundaryArchiveId, pendingArchiveId]);
  });

  it("does not touch source rows while the archive backend selector is disabled", async () => {
    await insertArchiveCandidate(deliveredArchiveId, "delivered", oldCreatedAt);
    await expect(runScheduledNotificationArchive({ env: runtimeEnv, now: archiveNow })).resolves.toEqual({ status: "disabled" });
    const source = await businessDatabase?.prepare("SELECT id FROM notifications WHERE id = ?").bind(deliveredArchiveId).first();
    const history = await businessDatabase?.prepare("SELECT id FROM notifications_history WHERE id = ?").bind(deliveredArchiveId).first();
    expect(source).toMatchObject({ id: deliveredArchiveId });
    expect(history).toBeNull();
  });

  it("retains a source row and reports a conflicting preexisting history record", async () => {
    await insertArchiveCandidate(conflictingArchiveId, "failed", oldCreatedAt);
    await businessDatabase?.prepare(`
      INSERT INTO notifications_history (id, original_data, archived_at) VALUES (?, ?, ?)
    `).bind(conflictingArchiveId, JSON.stringify({ id: conflictingArchiveId, unrelated: true }), "2026-01-01T00:00:00.000000Z").run();

    const summary = await runScheduledNotificationArchive({
      env: { ...runtimeEnv, NOTIFICATION_ARCHIVE_BACKEND: "d1" },
      now: archiveNow,
    });
    expect(summary).toEqual({ status: "partial", archived: 0, remaining: 1, conflicts: 1, batches: 1 });
    const source = await businessDatabase?.prepare("SELECT id FROM notifications WHERE id = ?").bind(conflictingArchiveId).first();
    expect(source).toMatchObject({ id: conflictingArchiveId });
  });

  it("rolls back history insertion when deleting the original notification fails", async () => {
    if (!businessDatabase) throw new Error("Split D1 bindings unavailable");
    await insertArchiveCandidate(deliveredArchiveId, "delivered", oldCreatedAt);
    await businessDatabase.prepare(`CREATE TRIGGER reject_archive_delete BEFORE DELETE ON notifications
      WHEN OLD.id = '${deliveredArchiveId}' BEGIN SELECT RAISE(ABORT, 'synthetic_archive_delete_failure'); END`).run();
    try {
      await expect(runScheduledNotificationArchive({
        env: { ...runtimeEnv, NOTIFICATION_ARCHIVE_BACKEND: "d1" }, now: archiveNow,
      })).rejects.toThrow(/synthetic_archive_delete_failure/u);
      expect(await businessDatabase.prepare("SELECT id FROM notifications WHERE id = ?")
        .bind(deliveredArchiveId).first()).toEqual({ id: deliveredArchiveId });
      expect(await businessDatabase.prepare("SELECT id FROM notifications_history WHERE id = ?")
        .bind(deliveredArchiveId).first()).toBeNull();
      expect((await businessDatabase.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    } finally {
      await businessDatabase.prepare("DROP TRIGGER reject_archive_delete").run();
    }
    await expect(runScheduledNotificationArchive({
      env: { ...runtimeEnv, NOTIFICATION_ARCHIVE_BACKEND: "d1" }, now: archiveNow,
    })).resolves.toMatchObject({ status: "completed", archived: 1, remaining: 0 });
  });

  it("resumes an identical previously archived row without rewriting the history timestamp", async () => {
    if (!businessDatabase) throw new Error("Split D1 bindings unavailable");
    await insertArchiveCandidate(deliveredArchiveId, "delivered", oldCreatedAt);
    const source = await businessDatabase.prepare("SELECT * FROM notifications WHERE id = ?")
      .bind(deliveredArchiveId).first<Record<string, unknown>>();
    if (!source) throw new Error("Synthetic notification missing");
    const keys = ["id", "user_id", "event_id", "rule_id", "template_id", "template_version", "channel",
      "status", "payload", "priority", "triggered_at", "delivered_at", "read_at", "read_via", "expires_at",
      "retry_count", "error_reason", "created_at", "updated_at"];
    const original = Object.fromEntries(keys.map(key => [key, key === "payload" ? JSON.parse(String(source[key])) : source[key]]));
    const earlierArchiveTime = "2026-09-24T00:00:00.000000Z";
    await businessDatabase.prepare("INSERT INTO notifications_history (id,original_data,archived_at) VALUES (?, ?, ?)")
      .bind(deliveredArchiveId, JSON.stringify(original), earlierArchiveTime).run();
    await expect(runScheduledNotificationArchive({
      env: { ...runtimeEnv, NOTIFICATION_ARCHIVE_BACKEND: "d1" }, now: archiveNow,
    })).resolves.toEqual({ status: "completed", archived: 1, remaining: 0, conflicts: 0, batches: 1 });
    expect(await businessDatabase.prepare("SELECT original_data,archived_at FROM notifications_history WHERE id = ?")
      .bind(deliveredArchiveId).first()).toEqual({ original_data: JSON.stringify(original), archived_at: earlierArchiveTime });
    expect(await businessDatabase.prepare("SELECT id FROM notifications WHERE id = ?")
      .bind(deliveredArchiveId).first()).toBeNull();
  });

  it("stops after 2500 rows and resumes the remaining archive backlog", async () => {
    if (!businessDatabase) throw new Error("Split D1 bindings unavailable");
    const inserts = Array.from({ length: 2501 }, (_, index) => businessDatabase.prepare(`INSERT INTO notifications
      (id,user_id,channel,template_id,payload,status,triggered_at,created_at,updated_at)
      VALUES (?, ?, 'in_app', 'synthetic-backlog', '{}', 'delivered', ?, ?, ?)`)
      .bind(`88888888-8888-4888-8888-${String(index + 1).padStart(12, "0")}`, ownerId,
        oldCreatedAt, oldCreatedAt, oldCreatedAt));
    for (let offset = 0; offset < inserts.length; offset += 100) {
      await businessDatabase.batch(inserts.slice(offset, offset + 100));
    }
    const args = { env: { ...runtimeEnv, NOTIFICATION_ARCHIVE_BACKEND: "d1" }, now: archiveNow };
    await expect(runScheduledNotificationArchive(args))
      .resolves.toEqual({ status: "partial", archived: 2500, remaining: 1, conflicts: 0, batches: 10 });
    expect(await businessDatabase.prepare("SELECT count(*) AS count FROM notifications_history").first())
      .toEqual({ count: 2500 });
    await expect(runScheduledNotificationArchive(args))
      .resolves.toEqual({ status: "completed", archived: 1, remaining: 0, conflicts: 0, batches: 1 });
    expect(await businessDatabase.prepare("SELECT count(*) AS count FROM notifications_history").first())
      .toEqual({ count: 2501 });
    expect((await businessDatabase.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  }, 20_000);
});

describe("D1 notification event processor", () => {
  async function seedEvent(delaySeconds = 0, triggerAt = now): Promise<string> {
    if (!businessDatabase) throw new Error("Split D1 bindings unavailable");
    const eventId = "aaaaaaaa-1111-4111-8111-111111111111";
    const ruleId = "bbbbbbbb-2222-4222-8222-222222222222";
    const createdAt = now;
    await businessDatabase.batch([
      businessDatabase.prepare(`INSERT INTO user_settings (id, user_id, username, preferred_language, created_at, updated_at)
        VALUES (?, ?, ?, 'ja', ?, ?)`).bind("cccccccc-3333-4333-8333-333333333333", ownerId, "synthetic-notification-owner", createdAt, createdAt),
      businessDatabase.prepare(`INSERT INTO notification_templates
        (id, template_id, version, channel, language, title, body, summary, is_active, created_at, updated_at)
        VALUES (?, ?, 1, 'in_app', 'ja', ?, ?, ?, 1, ?, ?)`)
        .bind("dddddddd-4444-4444-8444-444444444444", "synthetic-template", "{{fanmark_name}}", "Hello {{fanmark_name}} {{created_at}}", "For {{fanmark_id}}", createdAt, createdAt),
      businessDatabase.prepare(`INSERT INTO notification_rules
        (id, event_type, channel, template_id, template_version, delay_seconds, priority, enabled, created_at, updated_at)
        VALUES (?, 'synthetic_event', 'in_app', 'synthetic-template', 1, ?, 8, 1, ?, ?)`)
        .bind(ruleId, delaySeconds, createdAt, createdAt),
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
    const event = await businessDatabase.prepare("SELECT status, processed_at, updated_at FROM notification_events WHERE id = ?")
      .bind(eventId).first();
    expect(event).toEqual({ status: "processed", processed_at: now, updated_at: now });
    const notifications = await businessDatabase.prepare(`SELECT user_id, channel, status, payload,
        triggered_at, created_at, updated_at FROM notifications WHERE event_id = ?`)
      .bind(eventId).all<{ user_id: string; channel: string; status: string; payload: string; triggered_at: string; created_at: string; updated_at: string }>();
    expect(notifications.results).toHaveLength(1);
    expect(notifications.results[0]).toMatchObject({
      user_id: ownerId, channel: "in_app", status: "delivered",
      triggered_at: now, created_at: now, updated_at: now,
    });
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
    const notification = await businessDatabase.prepare(`SELECT status, triggered_at, delivered_at, created_at, updated_at
      FROM notifications WHERE event_id = ?`)
      .bind(eventId).first();
    expect(notification).toEqual({
      status: "pending", triggered_at: "2026-09-25T00:01:00.000000Z", delivered_at: null,
      created_at: now, updated_at: now,
    });
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

  it.each([
    [0, false, 1],
    [1, true, 1],
    [0, true, 0],
    [1, false, 0],
    [0, 0, 0],
    [1, 1, 0],
  ])("compares the source boolean segment strictly after D1 decoding (%s, %s)", async (stored, expected, delivered) => {
    if (!businessDatabase) throw new Error("Split D1 bindings unavailable");
    const eventId = await seedEvent();
    await businessDatabase.batch([
      businessDatabase.prepare("UPDATE user_settings SET requires_password_setup = ? WHERE user_id = ?")
        .bind(stored, ownerId),
      businessDatabase.prepare("UPDATE notification_rules SET segment_filter = ? WHERE event_type = 'synthetic_event'")
        .bind(JSON.stringify({ requires_password_setup: expected })),
    ]);
    await expect(runScheduledNotificationEvents({
      env: { ...runtimeEnv, NOTIFICATION_PROCESSOR_BACKEND: "d1" },
      database: businessDatabase, scheduledTime: Date.parse(now),
    })).resolves.toEqual({ status: "completed", selected: 1, processed: 1, failed: 0 });
    expect(await businessDatabase.prepare("SELECT count(*) AS count FROM notifications WHERE event_id = ?")
      .bind(eventId).first()).toEqual({ count: delivered });
    expect(await businessDatabase.prepare("SELECT requires_password_setup FROM user_settings WHERE user_id = ?")
      .bind(ownerId).first()).toEqual({ requires_password_setup: stored });
  });

  it.each(["", null])("uses the default language when payload language is empty (%s)", async (language) => {
    if (!businessDatabase) throw new Error("Split D1 bindings unavailable");
    const eventId = await seedEvent();
    await businessDatabase.prepare("UPDATE notification_events SET payload = json_set(payload, '$.language', ?) WHERE id = ?")
      .bind(language, eventId).run();
    await expect(runScheduledNotificationEvents({
      env: { ...runtimeEnv, NOTIFICATION_PROCESSOR_BACKEND: "d1" },
      database: businessDatabase, scheduledTime: Date.parse(now),
    })).resolves.toMatchObject({ processed: 1, failed: 0 });
    const row = await businessDatabase.prepare("SELECT payload FROM notifications WHERE event_id = ?")
      .bind(eventId).first<{ payload: string }>();
    expect(JSON.parse(row?.payload ?? "null")).toMatchObject({
      title: "香水ラジオ", body: "Hello 香水ラジオ {{created_at}}", summary: "For fmk-1",
    });
  });

  it.each([
    ["cooldown_window_seconds", "fmk-1", 0],
    ["cooldown_window_seconds", "different-fanmark", 1],
    ["cooldown_window_seconds", "", 0],
    ["cooldown_window_seconds", null, 0],
    ["max_per_user", "fmk-1", 0],
    ["max_per_user", "different-fanmark", 1],
    ["max_per_user", "", 0],
    ["max_per_user", null, 0],
  ])("preserves source notification limit scope (%s, %s)", async (limitColumn, fanmarkId, delivered) => {
    if (!businessDatabase) throw new Error("Split D1 bindings unavailable");
    const eventId = await seedEvent();
    const ruleId = "bbbbbbbb-2222-4222-8222-222222222222";
    const priorEventId = "aaaaaaaa-2222-4222-8222-222222222222";
    const priorNotificationId = "ffffffff-2222-4222-8222-222222222222";
    await businessDatabase.batch([
      businessDatabase.prepare(`UPDATE notification_rules SET ${limitColumn} = ? WHERE id = ?`)
        .bind(limitColumn === "max_per_user" ? 1 : 60, ruleId),
      businessDatabase.prepare("UPDATE notification_events SET payload = json_set(payload, '$.fanmark_id', ?) WHERE id = ?")
        .bind(fanmarkId, eventId),
      businessDatabase.prepare(`INSERT INTO notification_events
        (id,event_type,source,trigger_at,status,created_at,updated_at)
        VALUES (?, 'synthetic_event', 'system', ?, 'processed', ?, ?)`)
        .bind(priorEventId, now, now, now),
      businessDatabase.prepare(`INSERT INTO notifications
        (id,event_id,rule_id,user_id,channel,template_id,payload,status,triggered_at,created_at,updated_at)
        VALUES (?, ?, ?, ?, 'in_app', 'synthetic-template', ?, 'delivered', ?, ?, ?)`)
        .bind(priorNotificationId, priorEventId, ruleId, ownerId,
          JSON.stringify({ fanmark_id: "fmk-1", title: "Prior synthetic notification" }), now, now, now),
    ]);
    await expect(runScheduledNotificationEvents({
      env: { ...runtimeEnv, NOTIFICATION_PROCESSOR_BACKEND: "d1" },
      database: businessDatabase, scheduledTime: Date.parse(now),
    })).resolves.toEqual({ status: "completed", selected: 1, processed: 1, failed: 0 });
    expect(await businessDatabase.prepare("SELECT count(*) AS count FROM notifications WHERE event_id = ?")
      .bind(eventId).first()).toEqual({ count: delivered });
    expect(await businessDatabase.prepare("SELECT payload FROM notifications WHERE id = ?")
      .bind(priorNotificationId).first()).toEqual({ payload: JSON.stringify({ fanmark_id: "fmk-1", title: "Prior synthetic notification" }) });
  });

  const renderSource = JSON.parse(renderSourceJson) as { cases: Array<{
    label: string; inputPayloadJson: string; template: string; expected: string;
  }> };

  it.each(renderSource.cases)("matches source PostgreSQL rendering for $label", async (fixture) => {
    if (!businessDatabase) throw new Error("Split D1 bindings unavailable");
    const eventId = await seedEvent();
    const payload = { user_id: ownerId, ...JSON.parse(fixture.inputPayloadJson) };
    await businessDatabase.batch([
      businessDatabase.prepare("UPDATE notification_events SET payload = ? WHERE id = ?")
        .bind(JSON.stringify(payload), eventId),
      businessDatabase.prepare("UPDATE notification_templates SET title = ?, body = ?, summary = ? WHERE template_id = 'synthetic-template'")
        .bind(fixture.template, fixture.template, fixture.template),
    ]);
    await expect(runScheduledNotificationEvents({
      env: { ...runtimeEnv, NOTIFICATION_PROCESSOR_BACKEND: "d1" },
      database: businessDatabase, scheduledTime: Date.parse(now),
    })).resolves.toEqual({ status: "completed", selected: 1, processed: 1, failed: 0 });
    const row = await businessDatabase.prepare("SELECT payload FROM notifications WHERE event_id = ?")
      .bind(eventId).first<{ payload: string }>();
    expect(JSON.parse(row?.payload ?? "null")).toMatchObject({
      title: fixture.expected, body: fixture.expected, summary: fixture.expected, metadata: payload,
    });
  });

  it.each(["in_app", "email", "webpush"])("uses the source template lookup for %s without changing delivery status", async (channel) => {
    if (!businessDatabase) throw new Error("Split D1 bindings unavailable");
    const eventId = await seedEvent();
    await businessDatabase.prepare("UPDATE notification_rules SET channel = ? WHERE event_type = 'synthetic_event'")
      .bind(channel).run();
    await runScheduledNotificationEvents({
      env: { ...runtimeEnv, NOTIFICATION_PROCESSOR_BACKEND: "d1" },
      database: businessDatabase, scheduledTime: Date.parse(now),
    });
    const row = await businessDatabase.prepare("SELECT payload, channel, status, delivered_at FROM notifications WHERE event_id = ?")
      .bind(eventId).first<{ payload: string; channel: string; status: string; delivered_at: string | null }>();
    expect(row).toMatchObject({ channel, status: channel === "in_app" ? "delivered" : "pending",
      delivered_at: channel === "in_app" ? now : null });
    expect(JSON.parse(row?.payload ?? "null")).toMatchObject({ title: "香水ラジオ", body: "Hello 香水ラジオ {{created_at}}" });
  });

  it.each(["ja", "en", "ko", "id"])("renders %s settings language and prioritizes its explicit payload override", async (language) => {
    if (!businessDatabase) throw new Error("Split D1 bindings unavailable");
    const eventId = await seedEvent();
    const localized = `${language}: {{fanmark_name}}`;
    await businessDatabase.batch([
      businessDatabase.prepare("UPDATE user_settings SET preferred_language = ? WHERE user_id = ?").bind(language, ownerId),
      businessDatabase.prepare("UPDATE notification_templates SET language = ?, body = ? WHERE template_id = 'synthetic-template'")
        .bind(language, localized),
    ]);
    const args = { env: { ...runtimeEnv, NOTIFICATION_PROCESSOR_BACKEND: "d1" }, database: businessDatabase, scheduledTime: Date.parse(now) };
    await runScheduledNotificationEvents(args);
    const first = await businessDatabase.prepare("SELECT payload FROM notifications WHERE event_id = ?")
      .bind(eventId).first<{ payload: string }>();
    expect(JSON.parse(first?.payload ?? "null").body).toBe(`${language}: 香水ラジオ`);
    const overrideEventId = crypto.randomUUID();
    await businessDatabase.batch([
      businessDatabase.prepare("UPDATE user_settings SET preferred_language = ? WHERE user_id = ?")
        .bind(language === "ja" ? "en" : "ja", ownerId),
      businessDatabase.prepare(`INSERT INTO notification_events
        (id,event_type,source,payload,trigger_at,status,created_at,updated_at)
        VALUES (?, 'synthetic_event', 'system', ?, ?, 'pending', ?, ?)`)
        .bind(overrideEventId, JSON.stringify({ user_id: ownerId, fanmark_name: "香水ラジオ", language }), now, now, now),
    ]);
    await runScheduledNotificationEvents(args);
    const second = await businessDatabase.prepare("SELECT payload FROM notifications WHERE event_id = ?")
      .bind(overrideEventId).first<{ payload: string }>();
    expect(JSON.parse(second?.payload ?? "null").body).toBe(`${language}: 香水ラジオ`);
  });

  it.each(["inactive", "version", "language"])("keeps the source fallback when the requested template differs by %s", async (mismatch) => {
    if (!businessDatabase) throw new Error("Split D1 bindings unavailable");
    const eventId = await seedEvent();
    if (mismatch === "inactive") {
      await businessDatabase.prepare("UPDATE notification_templates SET is_active = 0").run();
    } else if (mismatch === "version") {
      await businessDatabase.prepare("UPDATE notification_rules SET template_version = 2").run();
    } else {
      await businessDatabase.prepare("UPDATE user_settings SET preferred_language = 'en' WHERE user_id = ?").bind(ownerId).run();
    }
    const original = await businessDatabase.prepare("SELECT payload FROM notification_events WHERE id = ?")
      .bind(eventId).first<{ payload: string }>();
    await runScheduledNotificationEvents({
      env: { ...runtimeEnv, NOTIFICATION_PROCESSOR_BACKEND: "d1" },
      database: businessDatabase, scheduledTime: Date.parse(now),
    });
    const row = await businessDatabase.prepare("SELECT payload FROM notifications WHERE event_id = ?")
      .bind(eventId).first<{ payload: string }>();
    expect(JSON.parse(row?.payload ?? "null")).toMatchObject({
      title: "synthetic_event", body: JSON.stringify(JSON.parse(original?.payload ?? "null")), summary: null,
    });
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
