import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "./fixtures/d1-notification-master-admin.sql?raw";
import {
  handleNotificationMasterRequest,
  type NotificationMasterAdminAuthorizer,
} from "../src/notification-master-d1-api";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const database = runtimeEnv.FANMARK_DB;
const apiBase = "https://api.example.test";
const appOrigin = "https://app.example.test";
const now = new Date("2026-09-26T12:34:56.000Z");
const ruleId = "45111111-1111-4111-8111-111111111111";
const templateId = "45222222-2222-4222-8222-222222222222";
const otherTemplateId = "45333333-3333-4333-8333-333333333333";
const eventId = "45444444-4444-4444-8444-444444444444";
const notificationId = "45555555-5555-4555-8555-555555555555";
const initialTime = "2026-09-25T12:00:00.000Z";

const allowAdmin: NotificationMasterAdminAuthorizer = async () => ({
  userId: "synthetic-admin",
  sessionId: "synthetic-session",
});
const denyAdmin: NotificationMasterAdminAuthorizer = async (_request, headers) =>
  new Response(JSON.stringify({ error: "mfa_required" }), { status: 403, headers });

function splitSql(sql: string): string[] {
  return sql.split(/;\s*(?:\r?\n|$)/u).map((statement) => statement.trim()).filter(Boolean);
}

async function prepareSchema(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch(splitSql(schemaSql).map((statement) => database.prepare(statement)));
}

async function request(
  path: string,
  init: RequestInit = {},
  overrides: Partial<Env> = {},
  authorize: NotificationMasterAdminAuthorizer = allowAdmin,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", appOrigin);
  const response = await handleNotificationMasterRequest(
    new Request(`${apiBase}${path}`, { ...init, headers }),
    { ...runtimeEnv, ...overrides },
    authorize,
    () => now,
  );
  if (!response) throw new Error("Notification master route did not match");
  return response;
}

async function resetRows(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch([
    database.prepare("DELETE FROM notification_rules"),
    database.prepare("DELETE FROM notification_templates"),
    database.prepare("DELETE FROM notifications"),
    database.prepare("DELETE FROM notification_events"),
  ]);
  await database.batch([
    database.prepare(`INSERT INTO notification_rules
      (id, event_type, channel, template_id, template_version, delay_seconds, priority, enabled, created_at, updated_at, created_by)
      VALUES (?, ?, 'in_app', ?, 1, 60, 3, 1, ?, ?, ?)
    `).bind(ruleId, "license_expiring", "extension_reminder", initialTime, initialTime, "source-auth-user-id"),
    database.prepare(`INSERT INTO notification_templates
      (id, template_id, version, channel, language, title, body, summary, payload_schema, is_active, created_at, updated_at)
      VALUES (?, ?, 1, 'in_app', 'ja', '初期タイトル', '初期本文', '初期要約', '{"type":"object"}', 1, ?, ?)
    `).bind(templateId, "extension_reminder", initialTime, initialTime),
    database.prepare(`INSERT INTO notification_templates
      (id, template_id, version, channel, language, title, body, summary, payload_schema, is_active, created_at, updated_at)
      VALUES (?, ?, 1, 'in_app', 'en', 'Initial title', 'Initial body', NULL, NULL, 0, ?, ?)
    `).bind(otherTemplateId, "extension_reminder", initialTime, initialTime),
    database.prepare(`INSERT INTO notification_events
      (id, event_type, event_version, source, payload, trigger_at, status, processed_at,
       error_reason, retry_count, created_at, updated_at)
      VALUES (?, 'license_expired', 1, 'edge_function', '{"private":"event-payload"}', ?,
        'processed', ?, NULL, 0, ?, ?)
    `).bind(eventId, initialTime, initialTime, initialTime, initialTime),
    database.prepare(`INSERT INTO notifications
      (id, user_id, channel, template_id, payload, status, priority, triggered_at, delivered_at,
       read_at, created_at, updated_at)
      VALUES (?, '12345678-aaaa-4aaa-8aaa-123456789abc', 'in_app', 'extension_reminder',
        '{"private":"delivery-payload"}', 'delivered', 3, ?, ?, NULL, ?, ?)
    `).bind(notificationId, initialTime, initialTime, initialTime, initialTime),
  ]);
}

beforeAll(prepareSchema);
beforeEach(resetRows);

describe("D1 notification master admin API", () => {
  it("lists only explicit rule and template fields and requires the admin gate", async () => {
    const denied = await request("/api/admin/notification-masters/rules", {}, {}, denyAdmin);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "mfa_required" });

    const rules = await request("/api/admin/notification-masters/rules");
    expect(rules.status).toBe(200);
    expect(rules.headers.get("cache-control")).toBe("no-store");
    expect(rules.headers.get("access-control-allow-credentials")).toBe("true");
    expect(await rules.json()).toEqual({
      schemaVersion: 1,
      rules: [{
        id: ruleId,
        event_type: "license_expiring",
        channel: "in_app",
        template_id: "extension_reminder",
        priority: 3,
        delay_seconds: 60,
        enabled: true,
        updated_at: initialTime,
      }],
    });

    const templates = await request("/api/admin/notification-masters/templates");
    expect(templates.status).toBe(200);
    expect(await templates.json()).toEqual({
      schemaVersion: 1,
      templates: [
        {
          id: otherTemplateId, template_id: "extension_reminder", language: "en", channel: "in_app",
          version: 1, title: "Initial title", body: "Initial body", summary: null,
          is_active: false, created_at: initialTime, updated_at: initialTime,
        },
        {
          id: templateId, template_id: "extension_reminder", language: "ja", channel: "in_app",
          version: 1, title: "初期タイトル", body: "初期本文", summary: "初期要約",
          is_active: true, created_at: initialTime, updated_at: initialTime,
        },
      ],
    });
  });

  it("updates a rule through an optimistic timestamp fence", async () => {
    const updated = await request(`/api/admin/notification-masters/rules/${ruleId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false, expectedUpdatedAt: initialTime }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({
      schemaVersion: 1,
      rule: {
        id: ruleId, event_type: "license_expiring", channel: "in_app", template_id: "extension_reminder",
        priority: 3, delay_seconds: 60, enabled: false, updated_at: now.toISOString().replace(".000Z", ".000000Z"),
      },
    });
    const privateSourceIdentity = await database!.prepare("SELECT created_by FROM notification_rules WHERE id = ?")
      .bind(ruleId).first<{ created_by: string }>();
    expect(privateSourceIdentity?.created_by).toBe("source-auth-user-id");
  });

  it("updates only editable template copy and activation fields", async () => {
    const updated = await request(`/api/admin/notification-masters/templates/${templateId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedUpdatedAt: initialTime,
        title: "変更後タイトル",
        body: "変更後本文 {{name}}",
        summary: null,
        isActive: false,
      }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({
      schemaVersion: 1,
      template: {
        id: templateId, template_id: "extension_reminder", language: "ja", channel: "in_app",
        version: 1, title: "変更後タイトル", body: "変更後本文 {{name}}", summary: null,
        is_active: false, created_at: initialTime, updated_at: now.toISOString().replace(".000Z", ".000000Z"),
      },
    });
    const immutable = await database!.prepare("SELECT payload_schema, version FROM notification_templates WHERE id = ?")
      .bind(templateId).first<{ payload_schema: string; version: number }>();
    expect(immutable).toEqual({ payload_schema: '{"type":"object"}', version: 1 });
  });

  it("creates only supported manual events behind MFA and returns payload-free bounded log DTOs", async () => {
    const denied = await request("/api/admin/notification-masters/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventType: "license_expired", payload: { user_id: "synthetic-user" } }),
    }, {}, denyAdmin);
    expect(denied.status).toBe(403);
    expect(await database!.prepare("SELECT count(*) AS count FROM notification_events")
      .first<{ count: number }>()).toEqual({ count: 1 });

    const created = await request("/api/admin/notification-masters/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "favorite_fanmark_available",
        payload: { user_id: "synthetic-user", fanmark_name: "合成マーク" },
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { schemaVersion: number; event: { id: string } };
    expect(createdBody.schemaVersion).toBe(1);
    expect(createdBody.event.id).toMatch(/^[0-9a-f-]{36}$/iu);
    const inserted = await database!.prepare(`SELECT event_type, source, status, payload, trigger_at, created_at
      FROM notification_events WHERE id = ?`).bind(createdBody.event.id).first();
    expect(inserted).toEqual({
      event_type: "favorite_fanmark_available",
      source: "admin_manual",
      status: "pending",
      payload: '{"user_id":"synthetic-user","fanmark_name":"合成マーク"}',
      trigger_at: now.toISOString().replace(".000Z", ".000000Z"),
      created_at: now.toISOString().replace(".000Z", ".000000Z"),
    });

    const invalid = await request("/api/admin/notification-masters/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventType: "unsupported_event", payload: { user_id: "synthetic-user" } }),
    });
    expect(invalid.status).toBe(400);

    const eventLog = await request("/api/admin/notification-masters/events");
    expect(await eventLog.json()).toEqual({
      schemaVersion: 1,
      events: [
        {
          id: createdBody.event.id, event_type: "favorite_fanmark_available", status: "pending",
          source: "admin_manual", created_at: now.toISOString().replace(".000Z", ".000000Z"),
          processed_at: null, error_reason: null,
        },
        {
          id: eventId, event_type: "license_expired", status: "processed", source: "edge_function",
          created_at: initialTime, processed_at: initialTime, error_reason: null,
        },
      ],
    });

    const deliveryLog = await request("/api/admin/notification-masters/notifications");
    const deliveryBody = await deliveryLog.json();
    expect(deliveryBody).toEqual({
      schemaVersion: 1,
      notifications: [{
        id: notificationId, user_id: "12345678...", channel: "in_app", status: "delivered",
        delivered_at: initialTime, read_at: null, priority: 3,
      }],
    });
    expect(JSON.stringify(deliveryBody)).not.toContain("delivery-payload");
  });

  it("rejects stale revisions, malformed fields, and unauthorised origins without writes", async () => {
    const stale = await request(`/api/admin/notification-masters/rules/${ruleId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false, expectedUpdatedAt: "2026-09-01T00:00:00.000Z" }),
    });
    expect(stale.status).toBe(409);

    const unknown = await request(`/api/admin/notification-masters/rules/${ruleId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false, expectedUpdatedAt: initialTime, createdBy: "forged" }),
    });
    expect(unknown.status).toBe(400);

    const originDenied = await request("/api/admin/notification-masters/templates", {
      headers: { Origin: "https://attacker.example" },
    });
    expect(originDenied.status).toBe(403);
    const current = await database!.prepare("SELECT enabled, updated_at FROM notification_rules WHERE id = ?")
      .bind(ruleId).first();
    expect(current).toEqual({ enabled: 1, updated_at: initialTime });
  });

  it("remains unavailable unless its D1 selector is explicit", async () => {
    const disabled = await request("/api/admin/notification-masters/rules", {}, { NOTIFICATION_MASTER_BACKEND: undefined });
    expect(disabled.status).toBe(503);
    expect(await disabled.json()).toEqual({ error: "notification_master_unavailable" });
  });
});
