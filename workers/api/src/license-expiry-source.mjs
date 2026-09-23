/**
 * Local integration repository for the source-shaped fanmark.id schema.
 *
 * This is intentionally not wired to a Worker route, cron, or remote D1. It
 * accepts only internal run bindings and a server-captured timestamp. Its
 * synthetic tests use the catalog-converted schema and target extensions.
 */

import { buildAccessGenerationAdvanceStatement } from "./protected-access-generation.mjs";
import {
  assertCanonicalUtcMicrosecond,
  roundUpToNextUtcMidnight,
} from "./license-expiry.mjs";

export const SOURCE_EXPIRY_PAGE_SIZE = 64;
export const SOURCE_EXPIRY_RESULT_LIMIT = 32;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/u;
const EVENT_TYPE = "license_grace_started";
const ACTION = "license_grace_started";
const EVENT_SCHEMA = "license_grace_started.v1";
const MAX_SAFE_SQL_INTEGER = Number.MAX_SAFE_INTEGER;

export class SourceLicenseExpiryError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "SourceLicenseExpiryError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code, cause) {
  return new SourceLicenseExpiryError(code, cause);
}

function assertUuid(value, name) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw fail(`invalid_${name}`);
  return value;
}

function assertToken(value, name) {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) throw fail(`invalid_${name}`);
  return value;
}

function assertText(value, name, { allowEmpty = false, maximum = 4096 } = {}) {
  if (
    typeof value !== "string" || value.length > maximum || value.includes("\0") ||
    (!allowEmpty && value.length === 0)
  ) throw fail(`invalid_${name}`);
  return value;
}

function assertGeneration(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number >= MAX_SAFE_SQL_INTEGER) {
    throw fail(`invalid_${name}`);
  }
  return number;
}

function assertDays(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value >= MAX_SAFE_SQL_INTEGER) {
    throw fail("invalid_grace_period_days");
  }
  return value;
}

function defaultUuidFactory() {
  if (typeof globalThis.crypto?.randomUUID !== "function") throw fail("uuid_generator_unavailable");
  return globalThis.crypto.randomUUID();
}

function assertDatabase(database) {
  if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") {
    throw fail("database_unavailable");
  }
}

function resultChanges(result) {
  const raw = result?.meta?.changes ?? result?.meta?.rows_written ?? result?.meta?.rowsWritten;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function assertBatch(results, code) {
  if (!Array.isArray(results) || results.some((result) => result?.success === false)) throw fail(code);
  return results;
}

function ownerFromRow(value) {
  return value === null || value === undefined ? null : assertUuid(String(value), "user_id");
}

function candidateFromSourceRow(row) {
  const licenseId = assertUuid(String(row.license_id ?? ""), "license_id");
  const fanmarkId = assertUuid(String(row.fanmark_id ?? ""), "fanmark_id");
  const fanmarkShortId = assertText(row.fanmark_short_id, "fanmark_short_id", { maximum: 128 });
  const fanmarkName = assertText(row.fanmark_name, "fanmark_name", { allowEmpty: true });
  const userId = ownerFromRow(row.user_id);
  const licenseEnd = assertCanonicalUtcMicrosecond(row.license_end, "license_end");
  const licenseIncarnation = assertGeneration(row.license_incarnation, "license_incarnation");
  const licenseLifecycleGeneration = assertGeneration(
    row.license_lifecycle_generation,
    "license_lifecycle_generation",
  );
  const accessGeneration = assertGeneration(row.access_generation, "access_generation");
  return {
    licenseId,
    fanmarkId,
    fanmarkShortId,
    fanmarkName,
    userId,
    licenseEnd,
    licenseIncarnation,
    licenseLifecycleGeneration,
    accessGeneration,
  };
}

function candidateFromRunItem(row) {
  const candidate = candidateFromSourceRow(row);
  const runId = assertUuid(String(row.run_id ?? ""), "run_id");
  const operationId = assertUuid(String(row.operation_id ?? ""), "operation_id");
  const auditId = assertUuid(String(row.audit_id ?? ""), "audit_id");
  const notificationEventId = assertUuid(String(row.notification_event_id ?? ""), "notification_event_id");
  const outcome = String(row.outcome ?? "");
  if (!["pending", "processed", "conflict"].includes(outcome)) throw fail("run_item_invalid");
  const graceExpiresAt = assertCanonicalUtcMicrosecond(row.grace_expires_at, "grace_expires_at");
  return {
    ...candidate,
    runId,
    operationId,
    auditId,
    notificationEventId,
    outcome,
    graceExpiresAt,
  };
}

function transitionValues(candidate, runId, capturedNow) {
  const nextLifecycleGeneration = candidate.licenseLifecycleGeneration + 1;
  const nextAccessGeneration = candidate.accessGeneration + 1;
  if (!Number.isSafeInteger(nextLifecycleGeneration) || nextLifecycleGeneration > MAX_SAFE_SQL_INTEGER) {
    throw fail("license_lifecycle_generation_overflow");
  }
  if (!Number.isSafeInteger(nextAccessGeneration) || nextAccessGeneration > MAX_SAFE_SQL_INTEGER) {
    throw fail("access_generation_overflow");
  }
  const graceExpiresAt = candidate.graceExpiresAt;
  const auditMetadata = JSON.stringify({
    schema_version: 1,
    run_id: runId,
    operation_id: candidate.operationId,
    license_id: candidate.licenseId,
    fanmark_id: candidate.fanmarkId,
    fanmark_short_id: candidate.fanmarkShortId,
    license_incarnation: candidate.licenseIncarnation,
    license_lifecycle_generation: nextLifecycleGeneration,
    access_generation: nextAccessGeneration,
    grace_started_at: capturedNow,
    captured_now: capturedNow,
    license_end: candidate.licenseEnd,
    grace_expires_at: graceExpiresAt,
  });
  const notificationPayload = JSON.stringify({
    run_id: runId,
    operation_id: candidate.operationId,
    license_id: candidate.licenseId,
    user_id: candidate.userId,
    fanmark_id: candidate.fanmarkId,
    fanmark_name: candidate.fanmarkName,
    fanmark_short_id: candidate.fanmarkShortId,
    link: `/f/${candidate.fanmarkShortId}`,
    license_incarnation: candidate.licenseIncarnation,
    license_lifecycle_generation: nextLifecycleGeneration,
    access_generation: nextAccessGeneration,
    captured_now: capturedNow,
    license_end: candidate.licenseEnd,
    grace_expires_at: graceExpiresAt,
  });
  return {
    nextLifecycleGeneration,
    nextAccessGeneration,
    graceExpiresAt,
    auditMetadata,
    notificationPayload,
    dedupeKey: `${candidate.licenseId}:incarnation:${candidate.licenseIncarnation}:lifecycle:${nextLifecycleGeneration}:${EVENT_TYPE}`,
  };
}

async function readRun(database, runId) {
  try {
    return await database.prepare(`
      SELECT run_id, target_incarnation, schema_extension_digest, captured_now,
             grace_period_days, status, last_license_id, candidate_count,
             processed_count, conflict_count
      FROM license_expiry_runs
      WHERE run_id = ?
    `).bind(runId).first() ?? null;
  } catch (error) {
    throw fail("run_record_query_failed", error);
  }
}

async function ensureRun(database, bindings) {
  try {
    const inserted = await database.prepare(`
      INSERT INTO license_expiry_runs
        (run_id, target_incarnation, schema_extension_digest, captured_now,
         grace_period_days, status, last_license_id, candidate_count,
         processed_count, conflict_count)
      VALUES (?, ?, ?, ?, ?, 'running', '', 0, 0, 0)
      ON CONFLICT (run_id) DO NOTHING
    `).bind(
      bindings.runId,
      bindings.targetIncarnation,
      bindings.schemaExtensionDigest,
      bindings.capturedNow,
      bindings.gracePeriodDays,
    ).run();
    if (inserted?.success === false) throw fail("run_record_insert_failed");
  } catch (error) {
    if (error instanceof SourceLicenseExpiryError) throw error;
    throw fail("run_record_insert_failed", error);
  }

  const run = await readRun(database, bindings.runId);
  if (
    !run ||
    run.target_incarnation !== bindings.targetIncarnation ||
    run.schema_extension_digest !== bindings.schemaExtensionDigest ||
    run.captured_now !== bindings.capturedNow ||
    Number(run.grace_period_days) !== bindings.gracePeriodDays ||
    !["running", "completed"].includes(run.status)
  ) {
    throw fail("run_binding_mismatch");
  }
  return run;
}

async function readCandidatesPage(database, capturedNow, lastLicenseId) {
  let result;
  try {
    result = await database.prepare(`
      SELECT l.id AS license_id, l.fanmark_id, f.short_id AS fanmark_short_id,
             f.normalized_emoji AS fanmark_name, l.user_id, l.license_end,
             registry.incarnation AS license_incarnation,
             l.lifecycle_generation AS license_lifecycle_generation,
             access.access_generation
      FROM fanmark_licenses AS l
      JOIN fanmarks AS f ON f.id = l.fanmark_id
      JOIN fanmark_license_incarnations AS registry ON registry.license_id = l.id
      JOIN fanmark_access_versions AS access
        ON access.license_id = l.id
       AND access.license_incarnation = registry.incarnation
      WHERE l.id > ?
        AND l.status = 'active'
        AND l.is_returned = 0
        AND l.license_end IS NOT NULL
        AND l.license_end < ?
        AND l.lifecycle_claim_id IS NULL
        AND f.status = 'active'
      ORDER BY l.id ASC
      LIMIT ?
    `).bind(lastLicenseId, capturedNow, SOURCE_EXPIRY_PAGE_SIZE).all();
  } catch (error) {
    throw fail("candidate_query_failed", error);
  }
  if (result?.success === false || !Array.isArray(result?.results)) throw fail("candidate_query_failed");
  return result.results.map(candidateFromSourceRow);
}

async function readRunItemsPage(database, runId, lastLicenseId) {
  let result;
  try {
    result = await database.prepare(`
      SELECT run_id, license_id, fanmark_id, fanmark_short_id, fanmark_name, user_id, license_end,
             license_incarnation, license_lifecycle_generation, access_generation,
             operation_id, audit_id, notification_event_id, outcome,
             grace_expires_at
      FROM license_expiry_run_items
      WHERE run_id = ? AND license_id > ?
      ORDER BY license_id ASC
      LIMIT ?
    `).bind(runId, lastLicenseId, SOURCE_EXPIRY_PAGE_SIZE).all();
  } catch (error) {
    throw fail("run_item_query_failed", error);
  }
  if (result?.success === false || !Array.isArray(result?.results)) throw fail("run_item_query_failed");
  return result.results.map(candidateFromRunItem);
}

async function seedRunItems(database, runId, page, gracePeriodDays, uuidFactory) {
  const statements = page.map((candidate) => {
    const operationId = assertUuid(uuidFactory(), "operation_id");
    const auditId = assertUuid(uuidFactory(), "audit_id");
    const notificationEventId = assertUuid(uuidFactory(), "notification_event_id");
    const graceExpiresAt = roundUpToNextUtcMidnight(candidate.licenseEnd, gracePeriodDays, "license_end");
    return database.prepare(`
      INSERT INTO license_expiry_run_items
        (run_id, license_id, fanmark_id, fanmark_short_id, fanmark_name, user_id, license_end,
         license_incarnation, license_lifecycle_generation, access_generation,
         operation_id, audit_id, notification_event_id, outcome, grace_expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      ON CONFLICT (run_id, license_id) DO NOTHING
    `).bind(
      runId,
      candidate.licenseId,
      candidate.fanmarkId,
      candidate.fanmarkShortId,
      candidate.fanmarkName,
      candidate.userId,
      candidate.licenseEnd,
      candidate.licenseIncarnation,
      candidate.licenseLifecycleGeneration,
      candidate.accessGeneration,
      operationId,
      auditId,
      notificationEventId,
      graceExpiresAt,
    );
  });

  try {
    assertBatch(await database.batch(statements), "run_item_seed_failed");
  } catch (error) {
    if (error instanceof SourceLicenseExpiryError) throw error;
    throw fail("run_item_seed_failed", error);
  }

  const placeholders = page.map(() => "?").join(", ");
  let result;
  try {
    result = await database.prepare(`
      SELECT run_id, license_id, fanmark_id, fanmark_short_id, fanmark_name, user_id, license_end,
             license_incarnation, license_lifecycle_generation, access_generation,
             operation_id, audit_id, notification_event_id, outcome,
             grace_expires_at
      FROM license_expiry_run_items
      WHERE run_id = ? AND license_id IN (${placeholders})
    `).bind(runId, ...page.map((candidate) => candidate.licenseId)).all();
  } catch (error) {
    throw fail("run_item_query_failed", error);
  }
  if (result?.success === false || !Array.isArray(result?.results) || result.results.length !== page.length) {
    throw fail("run_item_binding_mismatch");
  }
  const byId = new Map(result.results.map((row) => [row.license_id, candidateFromRunItem(row)]));
  for (const candidate of page) {
    const item = byId.get(candidate.licenseId);
    const expectedDeadline = roundUpToNextUtcMidnight(candidate.licenseEnd, gracePeriodDays, "license_end");
    if (
      !item || item.runId !== runId || item.fanmarkId !== candidate.fanmarkId ||
      item.fanmarkShortId !== candidate.fanmarkShortId || item.fanmarkName !== candidate.fanmarkName ||
      item.userId !== candidate.userId || item.licenseEnd !== candidate.licenseEnd ||
      item.licenseIncarnation !== candidate.licenseIncarnation ||
      item.licenseLifecycleGeneration !== candidate.licenseLifecycleGeneration ||
      item.accessGeneration !== candidate.accessGeneration || item.graceExpiresAt !== expectedDeadline
    ) {
      throw fail("run_item_binding_mismatch");
    }
  }
}

async function readRunItem(database, runId, licenseId) {
  try {
    const row = await database.prepare(`
      SELECT run_id, license_id, fanmark_id, fanmark_short_id, fanmark_name, user_id, license_end,
             license_incarnation, license_lifecycle_generation, access_generation,
             operation_id, audit_id, notification_event_id, outcome,
             grace_expires_at
      FROM license_expiry_run_items
      WHERE run_id = ? AND license_id = ?
    `).bind(runId, licenseId).first();
    return row ? candidateFromRunItem(row) : null;
  } catch (error) {
    throw fail("run_item_query_failed", error);
  }
}

async function confirmCommitted(database, item, bindings) {
  const values = transitionValues(item, bindings.runId, bindings.capturedNow);
  const licenseGeneration = values.nextLifecycleGeneration;
  const accessGeneration = values.nextAccessGeneration;
  try {
    const [license, registry, access, journal, audit, event] = await Promise.all([
      database.prepare(`
        SELECT status, lifecycle_generation, lifecycle_claim_id, fanmark_id,
               user_id, license_end, grace_expires_at, is_returned
        FROM fanmark_licenses WHERE id = ?
      `).bind(item.licenseId).first(),
      database.prepare(`
        SELECT incarnation FROM fanmark_license_incarnations WHERE license_id = ?
      `).bind(item.licenseId).first(),
      database.prepare(`
        SELECT license_incarnation, password_generation, access_generation, updated_at
        FROM fanmark_access_versions WHERE license_id = ?
      `).bind(item.licenseId).first(),
      readRunItem(database, bindings.runId, item.licenseId),
      database.prepare(`
        SELECT id, user_id, action, resource_type, resource_id, request_id,
               metadata, created_at
        FROM audit_logs WHERE id = ?
      `).bind(item.auditId).first(),
      database.prepare(`
        SELECT id, event_type, event_version, source, payload, payload_schema,
               trigger_at, dedupe_key, status, retry_count, created_at, updated_at
        FROM notification_events WHERE id = ?
      `).bind(item.notificationEventId).first(),
    ]);
    if (!license || !registry || !access || !journal || !audit || !event) return false;
    if (
      license.status !== "grace" || Number(license.lifecycle_generation) !== licenseGeneration ||
      license.lifecycle_claim_id !== null || license.fanmark_id !== item.fanmarkId ||
      license.user_id !== item.userId || license.license_end !== item.licenseEnd ||
      license.grace_expires_at !== item.graceExpiresAt || Number(license.is_returned) !== 0 ||
      Number(registry.incarnation) !== item.licenseIncarnation ||
      Number(access.license_incarnation) !== item.licenseIncarnation ||
      Number(access.access_generation) !== accessGeneration || access.updated_at !== bindings.capturedNow ||
      journal.outcome !== "processed" || journal.operationId !== item.operationId ||
      journal.auditId !== item.auditId || journal.notificationEventId !== item.notificationEventId
    ) return false;

    if (
      audit.id !== item.auditId || audit.user_id !== item.userId || audit.action !== ACTION ||
      audit.resource_type !== "fanmark_license" || audit.resource_id !== item.licenseId ||
      audit.request_id !== item.operationId || audit.metadata !== values.auditMetadata ||
      audit.created_at !== bindings.capturedNow
    ) return false;
    return (
      event.id === item.notificationEventId && event.event_type === EVENT_TYPE &&
      Number(event.event_version) === 1 && event.source === "cron_job" &&
      event.payload === values.notificationPayload && event.payload_schema === EVENT_SCHEMA &&
      event.trigger_at === bindings.capturedNow && event.dedupe_key === values.dedupeKey &&
      event.status === "pending" && Number(event.retry_count) === 0 &&
      event.created_at === bindings.capturedNow && event.updated_at === bindings.capturedNow
    );
  } catch {
    return false;
  }
}

async function applyActiveToGrace(database, item, bindings) {
  const values = transitionValues(item, bindings.runId, bindings.capturedNow);
  const nextLifecycleGeneration = values.nextLifecycleGeneration;
  const nextAccessGeneration = values.nextAccessGeneration;
  const operationId = item.operationId;

  const statements = [
    database.prepare(`
      UPDATE fanmark_licenses
      SET status = 'grace', grace_expires_at = ?, is_returned = 0,
          lifecycle_generation = lifecycle_generation + 1,
          lifecycle_claim_id = ?
      WHERE id = ? AND fanmark_id = ? AND user_id IS ?
        AND status = 'active' AND is_returned = 0
        AND lifecycle_generation = ? AND license_end = ?
        AND license_end IS NOT NULL AND license_end < ?
        AND lifecycle_claim_id IS NULL
        AND EXISTS (
          SELECT 1 FROM fanmarks AS f
          WHERE f.id = fanmark_licenses.fanmark_id AND f.status = 'active'
            AND f.short_id = ? AND f.normalized_emoji IS ?
        )
        AND EXISTS (
          SELECT 1 FROM fanmark_license_incarnations AS registry
          WHERE registry.license_id = fanmark_licenses.id AND registry.incarnation = ?
        )
        AND EXISTS (
          SELECT 1 FROM fanmark_access_versions AS access
          WHERE access.license_id = fanmark_licenses.id
            AND access.license_incarnation = ? AND access.access_generation = ?
        )
        AND EXISTS (
          SELECT 1 FROM license_expiry_run_items AS item
          WHERE item.run_id = ? AND item.license_id = fanmark_licenses.id
            AND item.operation_id = ? AND item.audit_id = ?
            AND item.notification_event_id = ? AND item.outcome = 'pending'
            AND item.license_incarnation = ?
            AND item.license_lifecycle_generation = fanmark_licenses.lifecycle_generation
            AND item.access_generation = ?
        )
    `).bind(
      item.graceExpiresAt, operationId, item.licenseId, item.fanmarkId, item.userId,
      item.licenseLifecycleGeneration, item.licenseEnd, bindings.capturedNow,
      item.fanmarkShortId, item.fanmarkName,
      item.licenseIncarnation, item.licenseIncarnation, item.accessGeneration,
      bindings.runId, operationId, item.auditId, item.notificationEventId,
      item.licenseIncarnation, item.accessGeneration,
    ),
    buildAccessGenerationAdvanceStatement(database, {
      licenseId: item.licenseId,
      licenseIncarnation: item.licenseIncarnation,
      expectedAccessGeneration: item.accessGeneration,
      lifecycleClaimId: operationId,
      expectedLicenseLifecycleGeneration: nextLifecycleGeneration,
      updatedAt: bindings.capturedNow,
    }),
    database.prepare(`
      INSERT INTO audit_logs
        (id, user_id, action, resource_type, resource_id, request_id, metadata, created_at)
      SELECT ?, l.user_id, ?, 'fanmark_license', l.id, ?, ?, ?
      FROM fanmark_licenses AS l
      WHERE l.id = ? AND l.status = 'grace'
        AND l.lifecycle_generation = ? AND l.lifecycle_claim_id = ?
        AND l.user_id IS ? AND l.fanmark_id = ?
    `).bind(
      item.auditId, ACTION, operationId, values.auditMetadata, bindings.capturedNow,
      item.licenseId, nextLifecycleGeneration, operationId, item.userId, item.fanmarkId,
    ),
    database.prepare(`
      INSERT INTO notification_events
        (id, event_type, event_version, source, payload, payload_schema, trigger_at,
         dedupe_key, status, retry_count, created_at, updated_at)
      SELECT ?, ?, 1, 'cron_job', ?, ?, ?, ?, 'pending', 0, ?, ?
      FROM fanmark_licenses AS l
      WHERE l.id = ? AND l.status = 'grace'
        AND l.lifecycle_generation = ? AND l.lifecycle_claim_id = ?
        AND l.user_id IS ? AND l.fanmark_id = ?
    `).bind(
      item.notificationEventId, EVENT_TYPE, values.notificationPayload, EVENT_SCHEMA,
      bindings.capturedNow, values.dedupeKey, bindings.capturedNow, bindings.capturedNow,
      item.licenseId, nextLifecycleGeneration, operationId, item.userId, item.fanmarkId,
    ),
    database.prepare(`
      UPDATE license_expiry_run_items
      SET outcome = 'processed', completed_at = ?
      WHERE run_id = ? AND license_id = ? AND operation_id = ?
        AND audit_id = ? AND notification_event_id = ?
        AND license_incarnation = ? AND license_lifecycle_generation = ?
        AND access_generation = ? AND outcome = 'pending'
        AND EXISTS (
          SELECT 1 FROM fanmark_licenses AS l
          WHERE l.id = license_expiry_run_items.license_id
            AND l.status = 'grace' AND l.lifecycle_generation = ?
            AND l.lifecycle_claim_id = ? AND l.fanmark_id = license_expiry_run_items.fanmark_id
            AND l.user_id IS license_expiry_run_items.user_id
        )
    `).bind(
      bindings.capturedNow, bindings.runId, item.licenseId, operationId,
      item.auditId, item.notificationEventId, item.licenseIncarnation,
      item.licenseLifecycleGeneration, item.accessGeneration,
      nextLifecycleGeneration, operationId,
    ),
    database.prepare(`
      INSERT INTO license_expiry_effect_guards (operation_id, allowed)
      SELECT ?, CASE WHEN
        EXISTS (
          SELECT 1 FROM fanmark_licenses AS l
          JOIN fanmark_license_incarnations AS registry ON registry.license_id = l.id
          JOIN fanmark_access_versions AS access ON access.license_id = l.id
          WHERE l.id = ? AND l.fanmark_id = ? AND l.user_id IS ?
          AND l.status = 'grace' AND l.is_returned = 0
            AND l.license_end = ? AND l.grace_expires_at = ?
            AND l.lifecycle_generation = ? AND l.lifecycle_claim_id = ?
            AND registry.incarnation = ?
            AND access.license_incarnation = registry.incarnation
            AND access.access_generation = ? AND access.updated_at = ?
        )
        AND EXISTS (
          SELECT 1 FROM fanmarks AS f
          WHERE f.id = ? AND f.status = 'active'
            AND f.short_id = ? AND f.normalized_emoji IS ?
        )
        AND EXISTS (
          SELECT 1 FROM audit_logs
          WHERE id = ? AND user_id IS ? AND action = ?
            AND resource_type = 'fanmark_license' AND resource_id = ?
            AND request_id = ? AND metadata = ? AND created_at = ?
        )
        AND EXISTS (
          SELECT 1 FROM notification_events
          WHERE id = ? AND event_type = ? AND event_version = 1
            AND source = 'cron_job' AND payload = ? AND payload_schema = ?
            AND trigger_at = ? AND dedupe_key = ? AND status = 'pending'
            AND retry_count = 0 AND created_at = ? AND updated_at = ?
        )
        AND EXISTS (
          SELECT 1 FROM license_expiry_run_items
          WHERE run_id = ? AND license_id = ? AND operation_id = ?
            AND audit_id = ? AND notification_event_id = ?
            AND license_incarnation = ? AND license_lifecycle_generation = ?
            AND access_generation = ? AND outcome = 'processed'
            AND grace_expires_at = ? AND completed_at = ?
        )
        THEN 1 ELSE 0 END
      FROM fanmark_licenses AS l
      WHERE l.id = ? AND l.lifecycle_claim_id = ?
        AND l.status = 'grace' AND l.lifecycle_generation = ?
    `).bind(
      operationId,
      item.licenseId, item.fanmarkId, item.userId, item.licenseEnd,
      item.graceExpiresAt, nextLifecycleGeneration, operationId,
      item.licenseIncarnation, nextAccessGeneration, bindings.capturedNow,
      item.fanmarkId, item.fanmarkShortId, item.fanmarkName,
      item.auditId, item.userId, ACTION, item.licenseId, operationId,
      values.auditMetadata, bindings.capturedNow,
      item.notificationEventId, EVENT_TYPE, values.notificationPayload, EVENT_SCHEMA,
      bindings.capturedNow, values.dedupeKey, bindings.capturedNow, bindings.capturedNow,
      bindings.runId, item.licenseId, operationId, item.auditId, item.notificationEventId,
      item.licenseIncarnation, item.licenseLifecycleGeneration, item.accessGeneration,
      item.graceExpiresAt, bindings.capturedNow,
      item.licenseId, operationId, nextLifecycleGeneration,
    ),
    database.prepare(`
      UPDATE fanmark_licenses
      SET lifecycle_claim_id = NULL
      WHERE id = ? AND status = 'grace' AND lifecycle_generation = ?
        AND lifecycle_claim_id = ?
    `).bind(item.licenseId, nextLifecycleGeneration, operationId),
    database.prepare("DELETE FROM license_expiry_effect_guards WHERE operation_id = ?")
      .bind(operationId),
    database.prepare(`
      INSERT INTO license_expiry_effect_guards (operation_id, allowed)
      SELECT ?, 0 WHERE EXISTS (
        SELECT 1 FROM license_expiry_effect_guards WHERE operation_id = ?
      )
    `).bind(operationId, operationId),
  ];

  let result;
  try {
    result = assertBatch(await database.batch(statements), "active_to_grace_batch_failed");
  } catch (error) {
    if (await confirmCommitted(database, item, bindings)) {
      return { status: "processed", recovered: true, operationId };
    }
    if (error instanceof SourceLicenseExpiryError) throw error;
    throw fail("active_to_grace_batch_failed", error);
  }

  const changes = result.map(resultChanges);
  if (changes.length === 9 && changes.slice(0, 8).every((value) => value === 1) && changes[8] === 0) {
    return { status: "processed", recovered: false, operationId };
  }
  if (await confirmCommitted(database, item, bindings)) {
    return { status: "processed", recovered: true, operationId };
  }
  return { status: "conflict", operationId };
}

async function markConflict(database, runId, item, capturedNow) {
  let result;
  try {
    result = await database.prepare(`
      UPDATE license_expiry_run_items
      SET outcome = 'conflict', completed_at = ?
      WHERE run_id = ? AND license_id = ? AND operation_id = ?
        AND outcome = 'pending'
    `).bind(capturedNow, runId, item.licenseId, item.operationId).run();
  } catch (error) {
    throw fail("run_item_update_failed", error);
  }
  if (result?.success === false) throw fail("run_item_update_failed");
  if (resultChanges(result) === 1) return "conflict";
  const current = await readRunItem(database, runId, item.licenseId);
  if (!current) throw fail("run_item_query_failed");
  return current.outcome;
}

async function updateRunProgress(database, runId, expectedCursor, nextCursor, counts) {
  let result;
  try {
    result = await database.prepare(`
      UPDATE license_expiry_runs
      SET last_license_id = ?, candidate_count = candidate_count + ?,
          processed_count = processed_count + ?, conflict_count = conflict_count + ?
      WHERE run_id = ? AND status = 'running' AND last_license_id = ?
    `).bind(
      nextCursor, counts.candidates, counts.processed, counts.conflicts, runId, expectedCursor,
    ).run();
  } catch (error) {
    throw fail("run_progress_update_failed", error);
  }
  if (result?.success === false) throw fail("run_progress_update_failed");
  return resultChanges(result) === 1;
}

async function completeRun(database, runId, expectedCursor) {
  let result;
  try {
    result = await database.prepare(`
      UPDATE license_expiry_runs
      SET status = 'completed', completed_at = captured_now
      WHERE run_id = ? AND status = 'running' AND last_license_id = ?
        AND candidate_count = processed_count + conflict_count
        AND NOT EXISTS (
          SELECT 1 FROM license_expiry_run_items
          WHERE run_id = ? AND outcome = 'pending'
        )
    `).bind(runId, expectedCursor, runId).run();
  } catch (error) {
    throw fail("run_completion_update_failed", error);
  }
  if (result?.success === false) throw fail("run_completion_update_failed");
  return resultChanges(result) === 1;
}

function summaryFromRun(run, results = []) {
  return {
    runId: run.run_id,
    capturedNow: run.captured_now,
    gracePeriodDays: Number(run.grace_period_days),
    candidateCount: Number(run.candidate_count),
    processed: Number(run.processed_count),
    conflicts: Number(run.conflict_count),
    status: run.status,
    results,
  };
}

/**
 * Create a local, source-profile-aware active-to-grace repository. All
 * identity, incarnation, time, and schema bindings come from trusted internal
 * setup; no HTTP input or owner identity is accepted here.
 */
export function createSourceLicenseExpiryRepository({
  database,
  runId,
  targetIncarnation,
  schemaExtensionDigest,
  capturedNow,
  gracePeriodDays,
  uuidFactory = defaultUuidFactory,
}) {
  assertDatabase(database);
  const bindings = {
    runId: assertUuid(runId, "run_id"),
    targetIncarnation: assertToken(targetIncarnation, "target_incarnation"),
    schemaExtensionDigest: typeof schemaExtensionDigest === "string" && DIGEST_PATTERN.test(schemaExtensionDigest)
      ? schemaExtensionDigest
      : (() => { throw fail("invalid_schema_extension_digest"); })(),
    capturedNow: assertCanonicalUtcMicrosecond(capturedNow, "captured_now"),
    gracePeriodDays: assertDays(gracePeriodDays),
  };
  if (typeof uuidFactory !== "function") throw fail("invalid_uuid_factory");

  return {
    async runActiveToGrace() {
      let run = await ensureRun(database, bindings);
      if (run.status === "completed") return summaryFromRun(run);
      const samples = [];

      while (true) {
        run = await readRun(database, bindings.runId);
        if (!run) throw fail("run_record_query_failed");
        if (
          run.target_incarnation !== bindings.targetIncarnation ||
          run.schema_extension_digest !== bindings.schemaExtensionDigest ||
          run.captured_now !== bindings.capturedNow ||
          Number(run.grace_period_days) !== bindings.gracePeriodDays
        ) throw fail("run_binding_mismatch");
        if (run.status === "completed") return summaryFromRun(run, samples);

        const cursor = String(run.last_license_id ?? "");
        let page = await readRunItemsPage(database, bindings.runId, cursor);
        if (page.length === 0) {
          const candidates = await readCandidatesPage(database, bindings.capturedNow, cursor);
          if (candidates.length === 0) {
            if (!await completeRun(database, bindings.runId, cursor)) {
              const current = await readRun(database, bindings.runId);
              if (!current) throw fail("run_record_query_failed");
              if (current.status === "completed" || current.last_license_id !== cursor) continue;
              const unfinished = await readRunItemsPage(database, bindings.runId, cursor);
              if (unfinished.length > 0) continue;
              const arrivedCandidates = await readCandidatesPage(database, bindings.capturedNow, cursor);
              if (arrivedCandidates.length > 0) continue;
              throw fail("run_reconciliation_failed");
            }
            const completed = await readRun(database, bindings.runId);
            if (!completed) throw fail("run_record_query_failed");
            return summaryFromRun(completed, samples);
          }
          await seedRunItems(database, bindings.runId, candidates, bindings.gracePeriodDays, uuidFactory);
          page = await readRunItemsPage(database, bindings.runId, cursor);
          if (page.length === 0) throw fail("run_item_query_failed");
        }

        const pageResults = [];
        for (const item of page) {
          let outcome = item.outcome;
          let transition = null;
          if (outcome === "pending") {
            transition = await applyActiveToGrace(database, item, bindings);
            if (transition.status === "conflict") {
              outcome = await markConflict(database, bindings.runId, item, bindings.capturedNow);
            } else {
              outcome = "processed";
            }
          }
          pageResults.push({ ...item, outcome, transition });
        }

        const counts = {
          candidates: page.length,
          processed: pageResults.filter((item) => item.outcome === "processed").length,
          conflicts: pageResults.filter((item) => item.outcome === "conflict").length,
        };
        const advanced = await updateRunProgress(
          database,
          bindings.runId,
          cursor,
          page.at(-1).licenseId,
          counts,
        );
        if (advanced) {
          for (const item of pageResults) {
            if (samples.length >= SOURCE_EXPIRY_RESULT_LIMIT) break;
            samples.push({
              licenseId: item.licenseId,
              status: item.outcome,
              operationId: item.operationId,
              licenseIncarnation: item.licenseIncarnation,
              licenseLifecycleGeneration: item.licenseLifecycleGeneration +
                (item.outcome === "processed" ? 1 : 0),
              accessGeneration: item.accessGeneration + (item.outcome === "processed" ? 1 : 0),
              graceExpiresAt: item.graceExpiresAt,
            });
          }
        }
      }
    },
  };
}
