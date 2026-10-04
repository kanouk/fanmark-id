import { env } from "cloudflare:workers";
import { runInDurableObject, runDurableObjectAlarm, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import worker, { NotificationWakeCoordinator } from "../src";
import { flushNotificationWake, handleNotificationWakeRepairRequest } from "../src/notification-wake";
import { handleNotificationMasterRequest } from "../src/notification-master-d1-api";
import type { Env } from "../src/repository";

const runtime = env as unknown as Env;
const db = runtime.FANMARK_DB!;
const stub = runtime.NOTIFICATION_WAKE!.get(runtime.NOTIFICATION_WAKE!.idFromName("business-notification-events-v1"));
const migrations = import.meta.glob<string>("../migrations-business/*.sql", { query: "?raw", import: "default", eager: true });
const OWNER = "aaaaaaaa-1111-4111-8111-111111111111";
function splitSql(sql: string): string[] {
  const source = sql.replace(/^--.*(?:\r?\n|$)/gmu, "");
  const statements: string[] = []; let start = 0; let single = false; let double = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "'" && !double) { if (single && source[i + 1] === "'") i++; else single = !single; continue; }
    if (c === '"' && !single) { if (double && source[i + 1] === '"') i++; else double = !double; continue; }
    if (c !== ";" || single || double) continue;
    const candidate = source.slice(start, i).trim();
    if (/^create\s+trigger\b/iu.test(candidate) &&
        (candidate.match(/\bEND\b/giu)?.length ?? 0) < (candidate.match(/\bCASE\b/giu)?.length ?? 0) + 1) continue;
    if (candidate) statements.push(candidate); start = i + 1;
  }
  if (source.slice(start).trim()) statements.push(source.slice(start).trim());
  return statements;
}
async function run(sql: string, ...values: unknown[]) { return db.prepare(sql).bind(...values).run(); }
async function alarm() { return runInDurableObject(stub, (_instance, state) => state.storage.getAlarm()); }
async function wakeState() { return db.prepare("SELECT requested_generation, acknowledged_generation FROM notification_worker_wake_state").first(); }
async function manualEvent(database = db) {
  return handleNotificationMasterRequest(new Request("https://app.example.test/api/admin/notification-masters/events", {
    method: "POST", headers: { origin: "https://app.example.test", "content-type": "application/json" },
    body: JSON.stringify({ eventType: "license_expired", payload: { user_id: OWNER, name: "Synthetic" } }),
  }), { ...runtime, FANMARK_DB: database, NOTIFICATION_MASTER_BACKEND: "d1" },
  async () => ({ userId: OWNER, sessionId: "verified-current-session" }));
}
async function event(status = "pending", triggerAt = new Date(Date.now() - 1000).toISOString()) {
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  await run(`INSERT INTO notification_events (id, event_type, source, payload, trigger_at, status, created_at, updated_at)
    VALUES (?, 'synthetic-wake', 'edge_function', ?, ?, ?, ?, ?)`, id, JSON.stringify({ user_id: OWNER, name: "Synthetic" }), triggerAt, status, now, now);
  return id;
}

beforeAll(async () => {
  for (const [, sql] of Object.entries(migrations).sort(([left], [right]) => left.localeCompare(right))) {
    await db.batch(splitSql(sql).map(statement => db.prepare(statement)));
  }
});
beforeEach(async () => {
  await runInDurableObject(stub, async (instance: NotificationWakeCoordinator, state) => {
    await state.storage.deleteAlarm();
    delete (instance as unknown as { env: Env }).env.CUTOVER_WRITE_FREEZE;
  });
  for (const table of ["notifications", "notification_events", "notification_rules", "notification_templates", "user_settings"]) await run(`DELETE FROM ${table}`);
  const now = new Date().toISOString();
  await run(`INSERT INTO user_settings (user_id, username, created_at, updated_at) VALUES (?, 'wake-owner', ?, ?)`, OWNER, now, now);
  const template = crypto.randomUUID();
  await run(`INSERT INTO notification_templates (template_id, version, channel, language, title, body, is_active, created_at, updated_at)
    VALUES (?, 1, 'in_app', 'ja', 'Hello {{name}}', 'Synthetic message', 1, ?, ?)`, template, now, now);
  await run(`INSERT INTO notification_rules (event_type, channel, template_id, template_version, enabled, created_at, updated_at)
    VALUES ('synthetic-wake', 'in_app', ?, 1, 1, ?, ?)`, template, now, now);
});

describe("native D1 outbox and real SQLite Durable Object alarms", () => {
  it("returns a committed manual event and delivers it when remote metadata includes the wake trigger", async () => {
    // Live D1 counts both the event insert and the trigger's marker update.
    function wrapStatement(statement: D1PreparedStatement): D1PreparedStatement {
      return new Proxy(statement, { get(target, property) {
        if (property === "bind") return (...values: unknown[]) => wrapStatement(target.bind(...values));
        if (property === "run" || property === "all") return async () => {
          const result = await target[property]();
          return { ...result, meta: { ...result.meta, changes: 2 } };
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    }
    const remoteMetadata = new Proxy(db, { get(target, property) {
      if (property === "prepare") return (sql: string) => wrapStatement(target.prepare(sql));
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    await run("UPDATE notification_rules SET event_type = 'license_expired'");
    const before = await wakeState();
    const response = await manualEvent(remoteMetadata);
    expect(response?.status).toBe(201);
    const body = await response!.json() as { schemaVersion: number; event: { id: string } };
    expect(body).toEqual({ schemaVersion: 1, event: { id: expect.any(String) } });
    expect((await db.prepare("SELECT id, status FROM notification_events WHERE id = ?").bind(body.event.id).first()))
      .toEqual({ id: body.event.id, status: "pending" });
    expect((await wakeState())?.requested_generation).toBe(Number(before?.requested_generation) + 1);
    await flushNotificationWake(runtime); await runDurableObjectAlarm(stub);
    expect((await db.prepare("SELECT count(*) AS count FROM notifications WHERE event_id = ?").bind(body.event.id).first())?.count).toBe(1);
    expect(await alarm()).toBeNull();
  });
  it("does not report creation when the native event insert is suppressed", async () => {
    const before = await wakeState();
    await run("CREATE TRIGGER suppress_manual_event BEFORE INSERT ON notification_events WHEN NEW.source = 'admin_manual' BEGIN SELECT RAISE(IGNORE); END");
    try {
      expect((await manualEvent())?.status).toBe(503);
      expect((await db.prepare("SELECT count(*) AS count FROM notification_events").first())?.count).toBe(0);
      expect(await wakeState()).toEqual(before);
    } finally { await run("DROP TRIGGER suppress_manual_event"); }
  });
  it("rolls back manual creation when its durable wake marker is missing", async () => {
    const before = await wakeState();
    await run("DELETE FROM notification_worker_wake_state WHERE singleton_id = 1");
    try {
      expect((await manualEvent())?.status).toBe(503);
      expect((await db.prepare("SELECT count(*) AS count FROM notification_events").first())?.count).toBe(0);
    } finally {
      await run("INSERT INTO notification_worker_wake_state (singleton_id, requested_generation, acknowledged_generation) VALUES (1, ?, ?)",
        before?.requested_generation, before?.acknowledged_generation);
    }
  });
  it("empty queues do not arm an alarm and acknowledge the outstanding generation", async () => {
    const id = await event(); await run("DELETE FROM notification_events WHERE id = ?", id);
    await flushNotificationWake(runtime);
    expect(await alarm()).toBeNull();
    const row = await wakeState(); expect(row?.requested_generation).toEqual(row?.acknowledged_generation);
    expect(await runDurableObjectAlarm(stub)).toBe(false);
  });
  it("the actual alarm delivers one pending in-app event and stops when empty", async () => {
    const id = await event(); await flushNotificationWake(runtime);
    expect(await alarm()).not.toBeNull();
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await db.prepare("SELECT status FROM notification_events WHERE id = ?").bind(id).first()).toEqual({ status: "processed" });
    expect(await db.prepare("SELECT status, payload FROM notifications").first()).toMatchObject({ status: "delivered", payload: expect.stringContaining("Hello Synthetic") });
    expect(await alarm()).toBeNull(); expect(await runDurableObjectAlarm(stub)).toBe(false);
  });
  it("coalesces repeated wake calls without postponing delivery", async () => {
    await event(); await flushNotificationWake(runtime); const first = await alarm();
    await event(); await flushNotificationWake(runtime); await flushNotificationWake(runtime, true);
    expect(await alarm()).toEqual(first);
    await runDurableObjectAlarm(stub);
    expect((await db.prepare("SELECT count(*) AS count FROM notifications").first())?.count).toBe(2);
  });
  it("future pending events keep an alarm without processing before the due time", async () => {
    const id = await event("pending", new Date(Date.now() + 86_400_000).toISOString());
    await flushNotificationWake(runtime); await runDurableObjectAlarm(stub);
    expect((await db.prepare("SELECT status FROM notification_events WHERE id = ?").bind(id).first())?.status).toBe("pending");
    expect(await alarm()).not.toBeNull();
    await run("UPDATE notification_events SET trigger_at = ? WHERE id = ?", new Date(Date.now() - 1000).toISOString(), id);
    const state = await wakeState(); expect(Number(state?.requested_generation)).toBeGreaterThan(Number(state?.acknowledged_generation));
    await flushNotificationWake(runtime); await runDurableObjectAlarm(stub);
    expect(await alarm()).toBeNull();
  });
  it("retains a recovery alarm while processing is leased, then reclaims a stale event", async () => {
    const id = await event("processing"); await flushNotificationWake(runtime, true); await runDurableObjectAlarm(stub);
    expect(await alarm()).not.toBeNull();
    await run("UPDATE notification_events SET updated_at = ? WHERE id = ?", new Date(Date.now() - 700_000).toISOString(), id);
    await runDurableObjectAlarm(stub);
    expect((await db.prepare("SELECT status FROM notification_events WHERE id = ?").bind(id).first())?.status).toBe("processed");
    expect(await alarm()).toBeNull();
  });
  it("a concurrent queue insertion and idle reconciliation cannot lose the wake", async () => {
    for (let i = 0; i < 5; i++) {
      const id = await event(); await flushNotificationWake(runtime);
      await Promise.all([runDurableObjectAlarm(stub), (async () => { await event(); await flushNotificationWake(runtime); })()]);
      const pending = await db.prepare("SELECT count(*) AS count FROM notification_events WHERE status IN ('pending','processing')").first();
      if (Number(pending?.count) > 0) { expect(await alarm()).not.toBeNull(); await runDurableObjectAlarm(stub); }
      expect(await alarm()).toBeNull();
      expect((await db.prepare("SELECT status FROM notification_events WHERE id = ?").bind(id).first())?.status).toBe("processed");
    }
    expect((await db.prepare("SELECT count(*) AS count FROM notifications").first())?.count).toBe(10);
  });
  it("a missing binding does not acknowledge an undelivered native wake", async () => {
    await event(); const before = await wakeState();
    await expect(flushNotificationWake({ ...runtime, NOTIFICATION_WAKE: undefined })).rejects.toThrow("notification_wake_failed");
    expect(await wakeState()).toEqual(before); expect(await alarm()).toBeNull();
    await flushNotificationWake(runtime); expect(await alarm()).not.toBeNull();
  });
  it("a missing D1 binding retains a durable retry beyond the platform's six automatic retries", async () => {
    const id = await event(); await flushNotificationWake(runtime);
    await runInDurableObject(stub, (instance: NotificationWakeCoordinator) => { (instance as unknown as { env: Env }).env.FANMARK_DB = undefined; });
    try {
      for (let attempt = 0; attempt < 7; attempt++) {
        expect(await runDurableObjectAlarm(stub)).toBe(true);
        expect(await alarm()).not.toBeNull();
      }
    } finally {
      await runInDurableObject(stub, (instance: NotificationWakeCoordinator) => { (instance as unknown as { env: Env }).env.FANMARK_DB = db; });
    }
    await runDurableObjectAlarm(stub);
    expect((await db.prepare("SELECT status FROM notification_events WHERE id = ?").bind(id).first())?.status).toBe("processed");
    expect(await alarm()).toBeNull();
  });
  it("native wake generations cannot be rewound by a later writer", async () => {
    await event(); await flushNotificationWake(runtime);
    await expect(run("UPDATE notification_worker_wake_state SET requested_generation = requested_generation - 1, acknowledged_generation = acknowledged_generation - 1"))
      .rejects.toThrow("notification_wake_generation_rewind");
    await runDurableObjectAlarm(stub); expect(await alarm()).toBeNull();
  });
  it("cutover freeze preserves queued work and the retry alarm", async () => {
    const id = await event(); await flushNotificationWake(runtime);
    await runInDurableObject(stub, (instance: NotificationWakeCoordinator) => { (instance as unknown as { env: Env }).env.CUTOVER_WRITE_FREEZE = "true"; });
    await runDurableObjectAlarm(stub);
    expect((await db.prepare("SELECT status FROM notification_events WHERE id = ?").bind(id).first())?.status).toBe("pending");
    expect(await alarm()).not.toBeNull();
    await runInDurableObject(stub, (instance: NotificationWakeCoordinator) => { delete (instance as unknown as { env: Env }).env.CUTOVER_WRITE_FREEZE; });
    await runDurableObjectAlarm(stub); expect(await alarm()).toBeNull();
  });
  it("an interrupted bridge is recoverable through the protected operator endpoint", async () => {
    await event(); expect(await alarm()).toBeNull();
    const req = new Request("https://app.example.test/api/admin/notifications/wake", { method: "POST", headers: { origin: "https://app.example.test" } });
    const denial = await handleNotificationWakeRepairRequest(req, runtime, async () => new Response(null, { status: 403 }));
    expect(denial?.status).toBe(403); expect(await alarm()).toBeNull();
    const response = await handleNotificationWakeRepairRequest(req, runtime, async () => ({ userId: OWNER, sessionId: "verified-current-session" }));
    expect(response?.status).toBe(200); expect(await response?.json()).toEqual({ success: true });
    await runDurableObjectAlarm(stub); expect(await alarm()).toBeNull();
  });
  it("MFA-protected status reports the real alarm and only bounded queue metadata", async () => {
    const req = new Request("https://app.example.test/api/admin/notifications/wake", { headers: { origin: "https://app.example.test" } });
    expect((await handleNotificationWakeRepairRequest(req, runtime, async () => new Response(null, { status: 403 })))?.status).toBe(403);
    const auth = async () => ({ userId: OWNER, sessionId: "verified-current-session" });
    const read = async () => (await handleNotificationWakeRepairRequest(req, runtime, auth))!.json<{
      nextAlarmAt: number | null; pendingEvents: number; processingEvents: number;
      requestedGeneration: number; acknowledgedGeneration: number;
    }>();
    const idle = await read(); expect(idle.nextAlarmAt).toBeNull();
    expect(Object.keys(idle).sort()).toEqual(["acknowledgedGeneration", "nextAlarmAt", "pendingEvents", "processingEvents", "requestedGeneration"]);
    await event(); await flushNotificationWake(runtime);
    const active = await read(); expect(active.pendingEvents).toBe(1); expect(active.nextAlarmAt).not.toBeNull();
    await runDurableObjectAlarm(stub);
    expect(await read()).toMatchObject({ pendingEvents: 0, processingEvents: 0, nextAlarmAt: null });
  });
  it("only the fixed internal POST route can reach the coordinator", async () => {
    expect((await stub.fetch("https://notification-wake.internal/other", { method: "POST" })).status).toBe(404);
    expect((await stub.fetch("https://notification-wake.internal/wake")).status).toBe(404);
    const response = await handleNotificationWakeRepairRequest(new Request("https://app.example.test/api/admin/notifications/wake", { method: "POST" }), runtime,
      async () => { throw new Error("origin rejection must precede authorization"); });
    expect(response?.status).toBe(403);
  });
  it("native generation suppression aborts the event instead of losing its wake", async () => {
    await run("CREATE TRIGGER test_ignore_wake BEFORE UPDATE ON notification_worker_wake_state BEGIN SELECT RAISE(IGNORE); END");
    try { await expect(event()).rejects.toThrow("notification_wake_update_suppressed"); }
    finally { await run("DROP TRIGGER test_ignore_wake"); }
    expect((await db.prepare("SELECT count(*) AS count FROM notification_events").first())?.count).toBe(0);
  });
  it("the daily entrypoint replays a failed bridge even with expiry disabled, then leaves an empty queue asleep", async () => {
    expect(runtime.LICENSE_EXPIRY_BACKEND).toBeUndefined();
    expect(await alarm()).toBeNull();
    await event();
    const pending = await wakeState();
    await expect(flushNotificationWake({ ...runtime, NOTIFICATION_WAKE: undefined })).rejects.toThrow();
    expect(await wakeState()).toEqual(pending);
    expect(await alarm()).toBeNull();
    const ctx = createExecutionContext();
    await worker.scheduled({ cron: "0 0 * * *", scheduledTime: Date.now(), noRetry() {} } as ScheduledController, runtime, ctx);
    await waitOnExecutionContext(ctx); expect(await alarm()).not.toBeNull();
    await runDurableObjectAlarm(stub); expect(await alarm()).toBeNull();
    const drained = await wakeState();
    expect(drained?.acknowledged_generation).toBe(drained?.requested_generation);
    const idleCtx = createExecutionContext();
    await worker.scheduled({ cron: "0 0 * * *", scheduledTime: Date.now(), noRetry() {} } as ScheduledController, runtime, idleCtx);
    await waitOnExecutionContext(idleCtx);
    expect(await alarm()).toBeNull();
    expect(await wakeState()).toEqual(drained);
  });
  it("the deployed fetch entrypoint flushes a committed outbox before its lifetime ends", async () => {
    await event(); const ctx = createExecutionContext();
    await worker.fetch(new Request("https://app.example.test/api/unknown", { method: "POST" }), runtime, ctx);
    await waitOnExecutionContext(ctx); expect(await alarm()).not.toBeNull();
    await runDurableObjectAlarm(stub); expect(await alarm()).toBeNull();
  });
  it("the actual fetch finally cannot bypass an Origin or authorization refusal on the repair route", async () => {
    await event(); const before = await wakeState();
    for (const origin of [undefined, "https://untrusted.example.test", "https://app.example.test"]) {
      const ctx = createExecutionContext();
      const response = await worker.fetch(new Request("https://app.example.test/api/admin/notifications/wake", {
        method: "POST", headers: origin ? { origin } : {},
      }), runtime, ctx);
      expect(response.status).toBe(origin === "https://app.example.test" ? 503 : 403);
      await waitOnExecutionContext(ctx);
      expect(await alarm()).toBeNull(); expect(await wakeState()).toEqual(before);
    }
    await flushNotificationWake(runtime, true); await runDurableObjectAlarm(stub);
  });
});
