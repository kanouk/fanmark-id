import { DurableObject } from "cloudflare:workers";
import { selectD1Database, type Env } from "./repository";
import { NOTIFICATION_EVENT_STALE_PROCESSING_MS, runScheduledNotificationEvents } from "./notifications-scheduled";
import { shouldPauseScheduledJobsForCutover } from "./cutover-write-freeze";
import { shouldFreezeRecoveryWrites } from "./recovery-write-freeze";
import { RecoveryWriterDrainError, withRecoveryWriter } from "./recovery-writer-drain";

const INTERVAL_MS = 60_000;
const INTERNAL_URL = "https://notification-wake.internal/wake";
const INTERNAL_STATUS_URL = "https://notification-wake.internal/status";
const OBJECT_NAME = "business-notification-events-v1";
const REPAIR_PATH = "/api/admin/notifications/wake";
type WakeState = { requested_generation: number; acknowledged_generation: number };

export class NotificationWakeError extends Error {
  constructor() { super("notification_wake_failed"); this.name = "NotificationWakeError"; }
}

function databaseFor(env: Env): D1Database {
  const database = selectD1Database(env, "business");
  if (env.NOTIFICATION_WAKE_BACKEND?.trim() !== "durable-object" ||
      env.NOTIFICATION_PROCESSOR_BACKEND?.trim() !== "d1" || !database) throw new NotificationWakeError();
  return database;
}

async function readState(database: D1Database): Promise<WakeState> {
  const row = await database.prepare(`SELECT requested_generation, acknowledged_generation
    FROM notification_worker_wake_state WHERE singleton_id = 1`).first<WakeState>();
  if (!row || !Number.isSafeInteger(row.requested_generation) || !Number.isSafeInteger(row.acknowledged_generation) ||
      row.acknowledged_generation < 0 || row.requested_generation < row.acknowledged_generation) throw new NotificationWakeError();
  return row;
}

/** Flush only a committed native outbox generation; never forward user headers/payload. */
export async function flushNotificationWake(env: Env, force = false): Promise<void> {
  if (shouldFreezeRecoveryWrites(env.RECOVERY_WRITE_FREEZE)) return;
  if (env.NOTIFICATION_WAKE_BACKEND?.trim() !== "durable-object") return;
  const database = databaseFor(env);
  if (!env.NOTIFICATION_WAKE) throw new NotificationWakeError();
  const state = await readState(database);
  if (!force && state.requested_generation === state.acknowledged_generation) return;
  const stub = env.NOTIFICATION_WAKE.get(env.NOTIFICATION_WAKE.idFromName(OBJECT_NAME));
  const response = await stub.fetch(INTERNAL_URL, { method: "POST" });
  if (response.status !== 204) throw new NotificationWakeError();
}

export async function flushNotificationWakeSafely(env: Env): Promise<void> {
  try { await flushNotificationWake(env); }
  catch { console.error(JSON.stringify({ job: "notification-wake", status: "failed", code: "notification_wake_failed" })); }
}

/** One SQLite-backed object coordinates wake/sleep; no event payload or identity is stored here. */
export class NotificationWakeCoordinator extends DurableObject<Env> {
  private async reconcile(now: number): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const database = databaseFor(this.env);
      const state = await readState(database);
      const queue = await database.prepare(`SELECT count(*) AS count, min(CASE
          WHEN status = 'pending' THEN trigger_at
          ELSE strftime('%Y-%m-%dT%H:%M:%f000Z', julianday(updated_at) + ? / 86400000.0)
        END) AS due_at FROM notification_events WHERE status IN ('pending', 'processing')`)
        .bind(NOTIFICATION_EVENT_STALE_PROCESSING_MS).first<{ count: number; due_at: string | null }>();
      if (!queue || !Number.isSafeInteger(queue.count) || queue.count < 0) throw new NotificationWakeError();
      if (queue.count > 0) {
        const due = Date.parse(queue.due_at ?? "");
        if (!Number.isFinite(due)) throw new NotificationWakeError();
        const target = Math.min(now + INTERVAL_MS, Math.max(now + 1000, due));
        const current = await this.ctx.storage.getAlarm();
        // A later producer must not postpone an already scheduled wake.
        await this.ctx.storage.setAlarm(current === null ? target : Math.min(current, target));
      }
      const acknowledged = await database.prepare(`UPDATE notification_worker_wake_state
        SET acknowledged_generation = ? WHERE singleton_id = 1 AND requested_generation = ?`)
        .bind(state.requested_generation, state.requested_generation).run();
      if (!acknowledged.success) throw new NotificationWakeError();
      if (acknowledged.meta.changes !== 1) {
        if ((await readState(database)).requested_generation === state.requested_generation) throw new NotificationWakeError();
        // Another D1 writer committed after our snapshot. Keep a durable wake.
        const current = await this.ctx.storage.getAlarm();
        await this.ctx.storage.setAlarm(Math.min(current ?? now + 1000, now + 1000));
      } else if (queue.count === 0) {
        await this.ctx.storage.deleteAlarm();
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (shouldFreezeRecoveryWrites(this.env.RECOVERY_WRITE_FREEZE)) {
      return new Response(null, { status: 503, headers: { "retry-after": "60", "cache-control": "no-store" } });
    }
    if (request.url === INTERNAL_STATUS_URL && request.method === "GET") {
      try {
        const status = await this.ctx.blockConcurrencyWhile(async () => {
          const database = databaseFor(this.env);
          const state = await readState(database);
          const counts = await database.prepare(`SELECT
            (SELECT count(*) FROM notification_events WHERE status = 'pending') AS pending,
            (SELECT count(*) FROM notification_events WHERE status = 'processing') AS processing`).first<{ pending: number; processing: number }>();
          if (!counts || !Number.isSafeInteger(counts.pending) || !Number.isSafeInteger(counts.processing)) throw new NotificationWakeError();
          return { nextAlarmAt: await this.ctx.storage.getAlarm(), requestedGeneration: state.requested_generation,
            acknowledgedGeneration: state.acknowledged_generation, pendingEvents: counts.pending, processingEvents: counts.processing };
        });
        return new Response(JSON.stringify(status), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
      } catch { return new Response(null, { status: 503 }); }
    }
    if (request.url !== INTERNAL_URL || request.method !== "POST") return new Response(null, { status: 404 });
    try { await withRecoveryWriter(this.env, () => this.reconcile(Date.now())); return new Response(null, { status: 204 }); }
    catch { return new Response(null, { status: 503 }); }
  }

  async alarm(): Promise<void> {
    if (this.env.NOTIFICATION_WAKE_BACKEND?.trim() !== "durable-object" ||
        this.env.NOTIFICATION_PROCESSOR_BACKEND?.trim() !== "d1") return;
    // Persist the next attempt before D1 work: a hard interruption must not
    // rely solely on the platform's finite alarm retry count.
    await this.ctx.storage.setAlarm(Date.now() + INTERVAL_MS);
    if (shouldFreezeRecoveryWrites(this.env.RECOVERY_WRITE_FREEZE) ||
        shouldPauseScheduledJobsForCutover(this.env.CUTOVER_WRITE_FREEZE)) return;
    try { await withRecoveryWriter(this.env, async () => {
      const summary = await runScheduledNotificationEvents({ env: this.env, scheduledTime: Date.now() });
      await this.reconcile(Date.now());
      console.log(JSON.stringify({ job: "notification-events-alarm", ...summary,
        alarmScheduled: (await this.ctx.storage.getAlarm()) !== null }));
    }); } catch (error) {
      // The persisted next alarm remains. No payload, request or provider error is logged.
      console.error(JSON.stringify({ job: "notification-events-alarm", status: error instanceof RecoveryWriterDrainError ? "paused" : "failed",
        code: error instanceof RecoveryWriterDrainError ? "recovery_writer_unavailable" : "notification_processor_failed" }));
    }
  }
}

type Authorize = (request: Request, headers: Headers) => Promise<Response | { userId: string; sessionId: string }>;
export async function handleNotificationWakeRepairRequest(request: Request, env: Env, authorize: Authorize): Promise<Response | null> {
  if (new URL(request.url).pathname !== REPAIR_PATH) return null;
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  const response = (error: string, status: number) => new Response(JSON.stringify({ error }), { status, headers });
  if (!["POST", "GET"].includes(request.method)) return response("method_not_allowed", 405);
  const origin = request.headers.get("origin");
  const allowed = (env.CORS_ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim());
  if (!origin || !allowed.includes(origin)) return response("origin_not_allowed", 403);
  const authorization = await authorize(request, headers);
  if (authorization instanceof Response) return authorization;
  if (env.NOTIFICATION_WAKE_BACKEND?.trim() !== "durable-object") return response("notification_wake_unavailable", 503);
  try {
    if (request.method === "GET") {
      databaseFor(env);
      if (!env.NOTIFICATION_WAKE) throw new NotificationWakeError();
      const stub = env.NOTIFICATION_WAKE.get(env.NOTIFICATION_WAKE.idFromName(OBJECT_NAME));
      const status = await stub.fetch(INTERNAL_STATUS_URL);
      if (status.status !== 200) throw new NotificationWakeError();
      return new Response(await status.text(), { headers });
    }
    await flushNotificationWake(env, true);
    return new Response(JSON.stringify({ success: true }), { headers });
  } catch { return response("notification_wake_unavailable", 503); }
}
