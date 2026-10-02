import { selectD1Database, type Env } from "./repository";
import { toUtcMicrosecondTimestamp } from "./utc-timestamp.ts";

const DEFAULT_LANGUAGE = "ja";
const EVENT_BATCH_LIMIT = 50;
export const NOTIFICATION_EVENT_STALE_PROCESSING_MS = 10 * 60 * 1000;
const NOTIFICATION_ARCHIVE_AGE_DAYS = 90;
const NOTIFICATION_ARCHIVE_BATCH_LIMIT = 250;
const NOTIFICATION_ARCHIVE_MAX_BATCHES = 10;
const DATE_PLACEHOLDERS = new Set(["grace_expires_at", "license_end", "expires_at", "created_at", "updated_at"]);

type NotificationEvent = {
  id: string;
  event_type: string;
  payload: string;
  retry_count: number;
};

type NotificationRule = {
  id: string;
  event_type: string;
  channel: string;
  template_id: string;
  template_version: number;
  delay_seconds: number;
  priority: number;
  segment_filter: string | null;
  cooldown_window_seconds: number | null;
  max_per_user: number | null;
  enabled: number;
};

type NotificationTemplate = { title: string | null; body: string; summary: string | null };
type JsonRecord = Record<string, unknown>;

export class ScheduledNotificationProcessorError extends Error {
  readonly code = "notification_processor_failed";
  constructor() {
    super("notification processor failed");
    this.name = "ScheduledNotificationProcessorError";
  }
}

export class ScheduledNotificationArchiveError extends Error {
  readonly code = "notification_archive_failed";
  constructor() {
    super("notification archive failed");
    this.name = "ScheduledNotificationArchiveError";
  }
}

function databaseFor(env: Env): D1Database {
  if (env.NOTIFICATION_PROCESSOR_BACKEND?.trim() !== "d1") {
    throw new ScheduledNotificationProcessorError();
  }
  const database = selectD1Database(env, "business");
  if (!database) throw new ScheduledNotificationProcessorError();
  return database;
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function parseJsonRecord(value: string): JsonRecord {
  try {
    return asRecord(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}

function isD1Success(result: D1Result<unknown>): boolean {
  return result?.success === true;
}

function changedRows(result: D1Result<unknown>): number {
  return isD1Success(result) && Number.isSafeInteger(result.meta?.changes)
    ? Number(result.meta?.changes)
    : 0;
}

function templateValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function renderTemplate(template: NotificationTemplate, payload: JsonRecord): {
  title: string | null;
  body: string;
  summary: string | null;
} {
  let title = template.title;
  let body = template.body;
  let summary = template.summary;
  for (const [key, value] of Object.entries(payload)) {
    if (DATE_PLACEHOLDERS.has(key)) continue;
    const replacement = templateValue(value);
    if (replacement === null) continue;
    const placeholder = `{{${key}}}`;
    title = title?.replaceAll(placeholder, replacement) ?? null;
    body = body.replaceAll(placeholder, replacement);
    summary = summary?.replaceAll(placeholder, replacement) ?? null;
  }
  return { title, body, summary };
}

async function userMatchesSegment(
  database: D1Database,
  userId: string,
  segmentFilter: JsonRecord,
): Promise<boolean> {
  const result = await database.prepare("SELECT * FROM user_settings WHERE user_id = ? LIMIT 1")
    .bind(userId).first<JsonRecord>();
  if (!result) return false;
  return Object.entries(segmentFilter).every(([key, expected]) => {
    const actual = result[key];
    // PostgreSQL returns this column as boolean; the canonical D1 codec stores
    // 0/1. Decode before preserving the source's strict segment comparison.
    if (key === "requires_password_setup") {
      if (actual !== 0 && actual !== 1) throw new ScheduledNotificationProcessorError();
      return (actual === 1) === expected;
    }
    return actual === expected;
  });
}

async function resolveLanguage(database: D1Database, userId: string, payloadLanguage: unknown): Promise<string> {
  if (typeof payloadLanguage === "string") return payloadLanguage;
  const settings = await database.prepare("SELECT preferred_language FROM user_settings WHERE user_id = ? LIMIT 1")
    .bind(userId).first<{ preferred_language?: unknown }>();
  return typeof settings?.preferred_language === "string" ? settings.preferred_language : DEFAULT_LANGUAGE;
}

async function ruleIsAllowed(
  database: D1Database,
  event: NotificationEvent,
  rule: NotificationRule,
  payload: JsonRecord,
  now: string,
): Promise<boolean> {
  const userId = payload.user_id;
  if (typeof userId !== "string" || userId.length === 0) return false;

  if (rule.segment_filter) {
    const segment = asRecord(JSON.parse(rule.segment_filter));
    if (segment && Object.keys(segment).length > 0 &&
        !await userMatchesSegment(database, userId, segment)) return false;
  }

  const fanmarkId = typeof payload.fanmark_id === "string" ? payload.fanmark_id : null;
  if (rule.cooldown_window_seconds) {
    const cutoff = toUtcMicrosecondTimestamp(new Date(Date.parse(now) - rule.cooldown_window_seconds * 1000));
    const recent = await database.prepare(`
      SELECT id FROM notifications
      WHERE user_id = ? AND rule_id = ? AND created_at >= ?
        AND (? IS NULL OR json_extract(payload, '$.fanmark_id') = ?)
      LIMIT 1
    `).bind(userId, rule.id, cutoff, fanmarkId, fanmarkId).first<{ id?: unknown }>();
    if (recent) return false;
  }

  if (rule.max_per_user) {
    const count = await database.prepare(`
      SELECT count(*) AS count FROM notifications
      WHERE user_id = ? AND rule_id = ?
        AND (? IS NULL OR json_extract(payload, '$.fanmark_id') = ?)
    `).bind(userId, rule.id, fanmarkId, fanmarkId).first<{ count?: unknown }>();
    if (typeof count?.count === "number" && count.count >= rule.max_per_user) return false;
  }

  const preference = await database.prepare(`
    SELECT enabled FROM notification_preferences
    WHERE user_id = ? AND channel = ? AND event_type = ? LIMIT 1
  `).bind(userId, rule.channel, event.event_type).first<{ enabled?: unknown }>();
  return preference?.enabled !== 0;
}

async function renderForRule(
  database: D1Database,
  event: NotificationEvent,
  rule: NotificationRule,
  payload: JsonRecord,
): Promise<{ title: string | null; body: string; summary: string | null }> {
  const userId = typeof payload.user_id === "string" ? payload.user_id : "";
  try {
    const language = await resolveLanguage(database, userId, payload.language);
    const template = await database.prepare(`
      SELECT title, body, summary FROM notification_templates
      WHERE template_id = ? AND version = ? AND channel = ? AND language = ? AND is_active = 1
      LIMIT 1
    `).bind(rule.template_id, rule.template_version, rule.channel, language).first<NotificationTemplate>();
    if (!template || typeof template.body !== "string") throw new Error("template_unavailable");
    return renderTemplate(template, payload);
  } catch {
    return { title: event.event_type, body: JSON.stringify(payload), summary: null };
  }
}

async function processEvent(database: D1Database, event: NotificationEvent, now: string): Promise<number> {
  const payload = parseJsonRecord(event.payload);
  const rules = await database.prepare(`
    SELECT id, event_type, channel, template_id, template_version, delay_seconds, priority,
      segment_filter, cooldown_window_seconds, max_per_user, enabled
    FROM notification_rules
    WHERE event_type = ? AND enabled = 1
    ORDER BY priority DESC, id ASC
  `).bind(event.event_type).all<NotificationRule>();
  if (rules.success !== true || !Array.isArray(rules.results)) throw new ScheduledNotificationProcessorError();

  const writes: D1PreparedStatement[] = [];
  for (const rule of rules.results) {
    try {
      if (!await ruleIsAllowed(database, event, rule, payload, now)) continue;
      const rendered = await renderForRule(database, event, rule, payload);
      const delaySeconds = Number.isSafeInteger(rule.delay_seconds) ? rule.delay_seconds : 0;
      const isImmediateInApp = rule.channel === "in_app" && delaySeconds === 0;
      const deliveredAt = isImmediateInApp ? now : null;
      const status = isImmediateInApp ? "delivered" : "pending";
      const extendedPayload = {
        ...rendered,
        link: payload.link ?? null,
        fanmark_id: payload.fanmark_id ?? null,
        fanmark_short_id: payload.fanmark_short_id ?? null,
        metadata: payload,
      };
      const triggerAt = toUtcMicrosecondTimestamp(new Date(Date.parse(now) + delaySeconds * 1000));
      const notificationId = crypto.randomUUID();
      writes.push(database.prepare(`
        INSERT INTO notifications
          (id, event_id, rule_id, user_id, channel, template_id, template_version, payload, status,
           priority, triggered_at, delivered_at, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM notification_events WHERE id = ? AND status = 'processing')
      `).bind(
        notificationId, event.id, rule.id, payload.user_id, rule.channel, rule.template_id, rule.template_version,
        JSON.stringify(extendedPayload), status, rule.priority, triggerAt, deliveredAt, now, now, event.id,
      ));
    } catch {
      // Match the source worker: a failed rule does not prevent other rules for the event.
    }
  }

  writes.push(database.prepare(`
    UPDATE notification_events SET status = 'processed', processed_at = ?, updated_at = ?
    WHERE id = ? AND status = 'processing'
  `).bind(now, now, event.id));
  const results = await database.batch(writes);
  if (results.some((result) => result?.success !== true)) throw new ScheduledNotificationProcessorError();
  return writes.length - 1;
}

export async function runScheduledNotificationEvents(input: {
  env: Env;
  database?: D1Database;
  scheduledTime: number;
}): Promise<{ status: "disabled" } | { status: "completed"; selected: number; processed: number; failed: number }> {
  if (input.env.NOTIFICATION_PROCESSOR_BACKEND?.trim() !== "d1") return { status: "disabled" };
  const database = input.database ?? databaseFor(input.env);
  const now = toUtcMicrosecondTimestamp(new Date(input.scheduledTime));
  const staleBefore = toUtcMicrosecondTimestamp(new Date(input.scheduledTime - NOTIFICATION_EVENT_STALE_PROCESSING_MS));
  const selection = await database.prepare(`
    SELECT id, event_type, payload, retry_count
    FROM notification_events
    WHERE retry_count < 3 AND (
      (status = 'pending' AND trigger_at <= ?) OR
      (status = 'processing' AND updated_at <= ?)
    )
    ORDER BY trigger_at ASC, id ASC
    LIMIT ?
  `).bind(now, staleBefore, EVENT_BATCH_LIMIT).all<NotificationEvent>();
  if (selection.success !== true || !Array.isArray(selection.results)) throw new ScheduledNotificationProcessorError();

  let processed = 0;
  let failed = 0;
  for (const event of selection.results) {
    try {
      const claim = await database.prepare(`
        UPDATE notification_events SET status = 'processing', updated_at = ?
        WHERE id = ? AND retry_count < 3 AND (
          (status = 'pending' AND trigger_at <= ?) OR
          (status = 'processing' AND updated_at <= ?)
        )
      `).bind(now, event.id, now, staleBefore).run();
      if (changedRows(claim) !== 1) continue;

      await processEvent(database, event, now);
      processed += 1;
    } catch {
      await database.prepare(`
        UPDATE notification_events SET status = 'failed', retry_count = retry_count + 1,
          error_reason = ?, updated_at = ?
        WHERE id = ? AND status = 'processing'
      `).bind("notification processing failed", now, event.id).run();
      failed += 1;
    }
  }

  return { status: "completed", selected: selection.results.length, processed, failed };
}

function archivedNotificationJson(alias: string): string {
  return `json_object(
    'id', ${alias}.id,
    'user_id', ${alias}.user_id,
    'event_id', ${alias}.event_id,
    'rule_id', ${alias}.rule_id,
    'template_id', ${alias}.template_id,
    'template_version', ${alias}.template_version,
    'channel', ${alias}.channel,
    'status', ${alias}.status,
    'payload', json(${alias}.payload),
    'priority', ${alias}.priority,
    'triggered_at', ${alias}.triggered_at,
    'delivered_at', ${alias}.delivered_at,
    'read_at', ${alias}.read_at,
    'read_via', ${alias}.read_via,
    'expires_at', ${alias}.expires_at,
    'retry_count', ${alias}.retry_count,
    'error_reason', ${alias}.error_reason,
    'created_at', ${alias}.created_at,
    'updated_at', ${alias}.updated_at
  )`;
}

function archiveCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new ScheduledNotificationArchiveError();
  return Number(value);
}

function archiveChangedRows(result: D1Result<unknown>): number {
  if (result?.success !== true || !Number.isSafeInteger(result.meta?.changes) || Number(result.meta.changes) < 0) {
    throw new ScheduledNotificationArchiveError();
  }
  return Number(result.meta.changes);
}

/** Move old terminal notifications to D1 history using the source RPC's default 90-day cutoff. */
export async function runScheduledNotificationArchive(input: {
  env: Env;
  database?: D1Database;
  now?: Date;
}): Promise<
  | { status: "disabled" }
  | { status: "completed" | "partial"; archived: number; remaining: number; conflicts: number; batches: number }
> {
  if (input.env.NOTIFICATION_ARCHIVE_BACKEND?.trim() !== "d1") return { status: "disabled" };
  const database = input.database ?? selectD1Database(input.env, "business");
  if (!database) throw new ScheduledNotificationArchiveError();

  const operationTime = input.now ?? new Date();
  const operationTimeMs = operationTime.getTime();
  const cutoffTimeMs = operationTimeMs - NOTIFICATION_ARCHIVE_AGE_DAYS * 24 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(operationTimeMs) || !Number.isFinite(cutoffTimeMs)) {
    throw new ScheduledNotificationArchiveError();
  }
  const archivedAt = toUtcMicrosecondTimestamp(operationTime);
  const cutoff = toUtcMicrosecondTimestamp(new Date(cutoffTimeMs));
  const json = archivedNotificationJson("n");
  const conflictFilter = `NOT EXISTS (
    SELECT 1 FROM notifications_history AS prior
    WHERE prior.id = n.id AND prior.original_data <> ${json}
  )`;

  let archived = 0;
  let batches = 0;
  for (let index = 0; index < NOTIFICATION_ARCHIVE_MAX_BATCHES; index += 1) {
    const results = await database.batch([
      database.prepare(`
        INSERT OR IGNORE INTO notifications_history (id, original_data, archived_at)
        SELECT n.id, ${json}, ?
        FROM notifications AS n
        WHERE n.status IN ('delivered', 'failed')
          AND n.created_at < ?
          AND ${conflictFilter}
        ORDER BY n.created_at ASC, n.id ASC
        LIMIT ?
      `).bind(archivedAt, cutoff, NOTIFICATION_ARCHIVE_BATCH_LIMIT),
      database.prepare(`
        DELETE FROM notifications
        WHERE id IN (
          SELECT n.id
          FROM notifications AS n
          JOIN notifications_history AS history ON history.id = n.id
          WHERE n.status IN ('delivered', 'failed')
            AND n.created_at < ?
            AND history.original_data = ${json}
          ORDER BY n.created_at ASC, n.id ASC
          LIMIT ?
        )
      `).bind(cutoff, NOTIFICATION_ARCHIVE_BATCH_LIMIT),
    ]);
    if (results.length !== 2 || results.some((result) => result?.success !== true)) {
      throw new ScheduledNotificationArchiveError();
    }
    batches += 1;
    const moved = archiveChangedRows(results[1]);
    archived += moved;
    if (moved < NOTIFICATION_ARCHIVE_BATCH_LIMIT) break;
  }

  const [remainingRow, conflictRow] = await Promise.all([
    database.prepare(`
      SELECT count(*) AS count FROM notifications
      WHERE status IN ('delivered', 'failed') AND created_at < ?
    `).bind(cutoff).first<{ count?: unknown }>(),
    database.prepare(`
      SELECT count(*) AS count
      FROM notifications AS n
      JOIN notifications_history AS prior ON prior.id = n.id
      WHERE n.status IN ('delivered', 'failed') AND n.created_at < ?
        AND prior.original_data <> ${json}
    `).bind(cutoff).first<{ count?: unknown }>(),
  ]);
  if (!remainingRow || !conflictRow) throw new ScheduledNotificationArchiveError();
  const remaining = archiveCount(remainingRow.count);
  const conflicts = archiveCount(conflictRow.count);
  return {
    status: remaining > 0 ? "partial" : "completed",
    archived,
    remaining,
    conflicts,
    batches,
  };
}
