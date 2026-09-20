/**
 * Synthetic D1 repository for the active -> grace license transition.
 *
 * This module is intentionally not wired into the Worker entrypoint or cron.
 * It accepts only server-core inputs: a D1 binding, an internal run identity,
 * and one canonical UTC timestamp captured by that core. It never accepts an
 * owner, current time, or transition decision from an HTTP caller.
 */

const UTC_MICROSECOND_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/u;
const INTERNAL_TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/u;
const ACTIVE_TO_GRACE_ACTION = "license_grace_started";
const ACTIVE_TO_GRACE_EVENT = "license_grace_started";
export const CANDIDATE_PAGE_SIZE = 64;
export const MAX_RESULT_SAMPLES = 32;

export class LicenseExpiryError extends Error {
  constructor(code, message = code, options = {}) {
    super(message, options);
    this.name = "LicenseExpiryError";
    this.code = code;
  }
}

function fail(code, message = code, cause) {
  return new LicenseExpiryError(code, message, cause === undefined ? {} : { cause });
}

function assertInternalToken(value, name) {
  if (typeof value !== "string" || !INTERNAL_TOKEN_PATTERN.test(value)) {
    throw fail(`invalid_${name}`);
  }
  return value;
}

/**
 * Validate a timestamp emitted by the source value codec. Date.parse is not
 * used for the comparison itself because it loses the final three digits.
 */
export function assertCanonicalUtcMicrosecond(value, name = "timestamp") {
  if (typeof value !== "string") throw fail(`invalid_${name}`);
  const match = UTC_MICROSECOND_PATTERN.exec(value);
  if (!match) throw fail(`invalid_${name}`);

  const year = Number(match[1]);
  if (year < 1 || year > 9999) throw fail(`invalid_${name}`);
  const millisecondText = `${value.slice(0, 19)}.${match[7].slice(0, 3)}Z`;
  const parsed = new Date(millisecondText);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== millisecondText) {
    throw fail(`invalid_${name}`);
  }
  return value;
}

function parseCanonicalUtcMicrosecond(value, name = "timestamp") {
  assertCanonicalUtcMicrosecond(value, name);
  const match = UTC_MICROSECOND_PATTERN.exec(value);
  // The assertion above guarantees a match.
  const date = new Date(`${value.slice(0, 19)}.${value.slice(20, 23)}Z`);
  return {
    date,
    microsRemainder: Number(match[7].slice(3)),
  };
}

function formatCanonicalUtcMicrosecond(date, microsRemainder = 0) {
  const year = date.getUTCFullYear();
  if (year < 1 || year > 9999) throw fail("timestamp_out_of_supported_range");
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, "0");
  const remainder = String(microsRemainder).padStart(3, "0");
  return `${date.toISOString().slice(0, 19)}.${milliseconds}${remainder}Z`;
}

/**
 * Add UTC calendar days and round any non-midnight value up to the next UTC
 * midnight. The microsecond remainder is retained until the round decision.
 */
export function roundUpToNextUtcMidnight(value, days, name = "timestamp") {
  if (!Number.isSafeInteger(days) || days < 0) throw fail("invalid_grace_period_days");
  const parsed = parseCanonicalUtcMicrosecond(value, name);
  const { date, microsRemainder } = parsed;
  date.setUTCDate(date.getUTCDate() + days);
  if (Number.isNaN(date.getTime())) throw fail("timestamp_out_of_supported_range");

  const exactMidnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0 &&
    microsRemainder === 0;
  if (exactMidnight) return formatCanonicalUtcMicrosecond(date, 0);

  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 1);
  return formatCanonicalUtcMicrosecond(date, 0);
}

/**
 * Preserve the source setting behavior: parseInt accepts a numeric prefix,
 * while a missing, non-positive, or non-finite value falls back to one day.
 */
export function parseGracePeriodDays(settingValue) {
  const parsed = Number.parseInt(String(settingValue ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function assertDatabase(database) {
  if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") {
    throw fail("database_unavailable");
  }
  return database;
}

function resultChanges(result) {
  const raw = result?.meta?.changes ?? result?.meta?.rows_written ?? result?.meta?.rowsWritten;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function assertSuccessfulResult(result, code) {
  if (!result || result.success === false) throw fail(code);
  return result;
}

async function readGracePeriodDays(database) {
  let result;
  try {
    result = await database
      .prepare("SELECT setting_value FROM system_settings WHERE setting_key = ?")
      .bind("grace_period_days")
      .all();
  } catch (error) {
    throw fail("grace_period_query_failed", "grace_period_query_failed", error);
  }
  if (result?.success === false || !Array.isArray(result?.results) || result.results.length !== 1) {
    throw fail("grace_period_query_failed");
  }
  return parseGracePeriodDays(result.results[0]?.setting_value);
}

async function readRun(database, runId) {
  try {
    const result = await database
      .prepare(`
        SELECT run_id, captured_now, grace_period_days, status, last_license_id,
               candidate_count, processed_count, already_committed_count,
               conflict_count
        FROM license_expiry_runs
        WHERE run_id = ?
      `)
      .bind(runId)
      .first();
    return result ?? null;
  } catch (error) {
    throw fail("run_record_query_failed", "run_record_query_failed", error);
  }
}

async function ensureRun(database, runId, capturedNow, gracePeriodDays) {
  try {
    const result = await database
      .prepare(`
        INSERT INTO license_expiry_runs
          (run_id, captured_now, grace_period_days, status, last_license_id,
           candidate_count, processed_count, already_committed_count, conflict_count)
        VALUES (?, ?, ?, 'running', '', 0, 0, 0, 0)
        ON CONFLICT (run_id) DO NOTHING
      `)
      .bind(runId, capturedNow, gracePeriodDays)
      .run();
    assertSuccessfulResult(result, "run_record_insert_failed");
  } catch (error) {
    if (error instanceof LicenseExpiryError) throw error;
    throw fail("run_record_insert_failed", "run_record_insert_failed", error);
  }

  const run = await readRun(database, runId);
  if (!run || run.captured_now !== capturedNow || Number(run.grace_period_days) !== gracePeriodDays) {
    throw fail("run_binding_mismatch");
  }
  if (run.status !== "running" && run.status !== "completed") {
    throw fail("run_record_invalid");
  }
  return run;
}

async function readCandidatesPage(database, capturedNow, lastLicenseId) {
  let result;
  try {
    result = await database
      .prepare(`
        SELECT
          l.id AS license_id,
          l.fanmark_id,
          l.user_id,
          l.license_end,
          l.generation
        FROM fanmark_licenses AS l
        JOIN fanmarks AS f ON f.id = l.fanmark_id
        WHERE l.id > ?
          AND l.status = 'active'
          AND l.license_end IS NOT NULL
          AND l.license_end < ?
          AND l.lifecycle_claim_id IS NULL
          AND f.status = 'active'
        ORDER BY l.id ASC
        LIMIT ?
      `)
      .bind(lastLicenseId, capturedNow, CANDIDATE_PAGE_SIZE)
      .all();
  } catch (error) {
    throw fail("candidate_query_failed", "candidate_query_failed", error);
  }
  if (result?.success === false || !Array.isArray(result?.results)) {
    throw fail("candidate_query_failed");
  }

  return result.results.map((row) => {
    const licenseId = assertInternalToken(String(row.license_id ?? ""), "license_id");
    const fanmarkId = assertInternalToken(String(row.fanmark_id ?? ""), "fanmark_id");
    const userId = assertInternalToken(String(row.user_id ?? ""), "user_id");
    const licenseEnd = assertCanonicalUtcMicrosecond(row.license_end, "license_end");
    const generation = Number(row.generation);
    if (!Number.isSafeInteger(generation) || generation < 0 || generation >= Number.MAX_SAFE_INTEGER) {
      throw fail("invalid_license_generation");
    }
    return { licenseId, fanmarkId, userId, licenseEnd, generation };
  });
}

function operationIdFor(runId, licenseId, generation) {
  return `${runId}:active-to-grace:${licenseId}:${generation}`;
}

function transitionPayload(candidate, runId, capturedNow, graceExpiresAt, generation) {
  return JSON.stringify({
    schemaVersion: 1,
    eventType: ACTIVE_TO_GRACE_EVENT,
    runId,
    licenseId: candidate.licenseId,
    fanmarkId: candidate.fanmarkId,
    userId: candidate.userId,
    generation,
    licenseEnd: candidate.licenseEnd,
    graceExpiresAt,
    capturedNow,
  });
}

function candidateFromRunItem(row) {
  const licenseId = assertInternalToken(String(row.license_id ?? ""), "license_id");
  const fanmarkId = assertInternalToken(String(row.fanmark_id ?? ""), "fanmark_id");
  const userId = assertInternalToken(String(row.user_id ?? ""), "user_id");
  const licenseEnd = assertCanonicalUtcMicrosecond(row.license_end, "license_end");
  const generation = Number(row.generation);
  if (!Number.isSafeInteger(generation) || generation < 0 || generation >= Number.MAX_SAFE_INTEGER) {
    throw fail("invalid_license_generation");
  }
  const operationId = assertInternalToken(String(row.operation_id ?? ""), "operation_id");
  const outcome = String(row.outcome ?? "");
  if (!["pending", "processed", "already_committed", "conflict"].includes(outcome)) {
    throw fail("run_item_invalid");
  }
  return {
    licenseId,
    fanmarkId,
    userId,
    licenseEnd,
    generation,
    operationId,
    outcome,
    graceExpiresAt: row.grace_expires_at,
  };
}

async function readRunItemsPage(database, runId, lastLicenseId) {
  let result;
  try {
    result = await database
      .prepare(`
        SELECT run_id, license_id, fanmark_id, user_id, license_end, generation,
               operation_id, outcome, grace_expires_at
        FROM license_expiry_run_items
        WHERE run_id = ? AND license_id > ?
        ORDER BY license_id ASC
        LIMIT ?
      `)
      .bind(runId, lastLicenseId, CANDIDATE_PAGE_SIZE)
      .all();
  } catch (error) {
    throw fail("run_item_query_failed", "run_item_query_failed", error);
  }
  if (result?.success === false || !Array.isArray(result?.results)) {
    throw fail("run_item_query_failed");
  }
  return result.results.map(candidateFromRunItem);
}

async function seedRunItems(database, runId, page, gracePeriodDays) {
  const statements = page.map((candidate) => {
    const operationId = operationIdFor(runId, candidate.licenseId, candidate.generation);
    const graceExpiresAt = roundUpToNextUtcMidnight(candidate.licenseEnd, gracePeriodDays, "license_end");
    return database
      .prepare(`
        INSERT INTO license_expiry_run_items
          (run_id, license_id, fanmark_id, user_id, license_end, generation,
           operation_id, outcome, grace_expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        ON CONFLICT (run_id, license_id) DO NOTHING
      `)
      .bind(
        runId,
        candidate.licenseId,
        candidate.fanmarkId,
        candidate.userId,
        candidate.licenseEnd,
        candidate.generation,
        operationId,
        graceExpiresAt,
      );
  });
  try {
    const results = await database.batch(statements);
    if (!Array.isArray(results) || results.some((result) => result?.success === false)) {
      throw fail("run_item_seed_failed");
    }
  } catch (error) {
    if (error instanceof LicenseExpiryError) throw error;
    throw fail("run_item_seed_failed", "run_item_seed_failed", error);
  }

  const placeholders = page.map(() => "?").join(", ");
  let result;
  try {
    result = await database
      .prepare(`
        SELECT run_id, license_id, fanmark_id, user_id, license_end, generation,
               operation_id, outcome, grace_expires_at
        FROM license_expiry_run_items
        WHERE run_id = ? AND license_id IN (${placeholders})
      `)
      .bind(runId, ...page.map((candidate) => candidate.licenseId))
      .all();
  } catch (error) {
    throw fail("run_item_query_failed", "run_item_query_failed", error);
  }
  if (result?.success === false || !Array.isArray(result?.results) || result.results.length !== page.length) {
    throw fail("run_item_binding_mismatch");
  }
  const byId = new Map(result.results.map((row) => [row.license_id, candidateFromRunItem(row)]));
  for (const candidate of page) {
    const item = byId.get(candidate.licenseId);
    const expectedOperation = operationIdFor(runId, candidate.licenseId, candidate.generation);
    if (
      !item ||
      item.fanmarkId !== candidate.fanmarkId ||
      item.userId !== candidate.userId ||
      item.licenseEnd !== candidate.licenseEnd ||
      item.generation !== candidate.generation ||
      item.operationId !== expectedOperation
    ) {
      throw fail("run_item_binding_mismatch");
    }
  }
}

async function readRunItem(database, runId, licenseId) {
  try {
    const result = await database
      .prepare(`
        SELECT run_id, license_id, fanmark_id, user_id, license_end, generation,
               operation_id, outcome, grace_expires_at
        FROM license_expiry_run_items
        WHERE run_id = ? AND license_id = ?
      `)
      .bind(runId, licenseId)
      .first();
    return result ? candidateFromRunItem(result) : null;
  } catch (error) {
    throw fail("run_item_query_failed", "run_item_query_failed", error);
  }
}

async function updateRunItemOutcome(database, runId, item, outcome, capturedNow) {
  if (outcome === "already_committed") {
    // A delivery ACK is not a new logical outcome. The transition batch has
    // already durably recorded `processed`; keep that value immutable so two
    // runners cannot make run counters disagree with the item journal.
    const current = await readRunItem(database, runId, item.licenseId);
    if (!current) throw fail("run_item_query_failed");
    if (current.outcome !== "processed") throw fail("run_item_binding_mismatch");
    return "processed";
  }
  const operationId = item.operationId;
  let result;
  try {
    result = await database
      .prepare(`
        UPDATE license_expiry_run_items
        SET outcome = ?, completed_at = COALESCE(completed_at, ?)
        WHERE run_id = ? AND license_id = ? AND operation_id = ?
          AND outcome = ?
      `)
      .bind(outcome, capturedNow, runId, item.licenseId, operationId, "pending")
      .run();
  } catch (error) {
    throw fail("run_item_update_failed", "run_item_update_failed", error);
  }
  assertSuccessfulResult(result, "run_item_update_failed");
  if (resultChanges(result) === 1) return outcome;
  const current = await readRunItem(database, runId, item.licenseId);
  if (!current) throw fail("run_item_query_failed");
  return current.outcome;
}

async function confirmCommitted(
  database,
  candidate,
  runId,
  capturedNow,
  expectedGeneration,
  graceExpiresAt,
) {
  const nextGeneration = expectedGeneration + 1;
  const operationId = operationIdFor(runId, candidate.licenseId, expectedGeneration);
  const auditId = `${operationId}:audit`;
  const outboxId = `${operationId}:outbox`;
  const dedupeKey = `${candidate.licenseId}:generation:${nextGeneration}:${ACTIVE_TO_GRACE_EVENT}`;
  const payload = transitionPayload(candidate, runId, capturedNow, graceExpiresAt, nextGeneration);

  try {
    const license = await database
      .prepare(`
        SELECT status, generation, lifecycle_claim_id, fanmark_id, user_id,
               license_end, grace_expires_at, is_returned
        FROM fanmark_licenses
        WHERE id = ?
      `)
      .bind(candidate.licenseId)
      .first();
    if (!license) return false;
    if (
      license.status !== "grace" ||
      Number(license.generation) !== nextGeneration ||
      license.lifecycle_claim_id !== null ||
      license.fanmark_id !== candidate.fanmarkId ||
      license.user_id !== candidate.userId ||
      license.license_end !== candidate.licenseEnd ||
      license.grace_expires_at !== graceExpiresAt ||
      Number(license.is_returned) !== 0
    ) {
      return false;
    }

    const item = await readRunItem(database, runId, candidate.licenseId);
    if (!item || item.outcome !== "processed" || item.operationId !== operationId || item.graceExpiresAt !== graceExpiresAt) {
      return false;
    }

    const audit = await database
      .prepare(`
        SELECT id, action, license_id, fanmark_id, user_id, generation, run_id,
               metadata_json
        FROM audit_logs
        WHERE id = ? AND license_id = ? AND generation = ? AND action = ?
      `)
      .bind(auditId, candidate.licenseId, nextGeneration, ACTIVE_TO_GRACE_ACTION)
      .first();
    const outbox = await database
      .prepare(`
        SELECT id, event_type, dedupe_key, license_id, fanmark_id, user_id,
               generation, license_end, grace_expires_at, captured_now, run_id,
               payload_json
        FROM lifecycle_outbox
        WHERE id = ? AND license_id = ? AND generation = ? AND event_type = ?
      `)
      .bind(outboxId, candidate.licenseId, nextGeneration, ACTIVE_TO_GRACE_EVENT)
      .first();
    if (!audit || !outbox) return false;

    return (
      audit.run_id === runId &&
      audit.fanmark_id === candidate.fanmarkId &&
      audit.user_id === candidate.userId &&
      audit.metadata_json === payload &&
      outbox.dedupe_key === dedupeKey &&
      outbox.fanmark_id === candidate.fanmarkId &&
      outbox.user_id === candidate.userId &&
      outbox.license_end === candidate.licenseEnd &&
      outbox.grace_expires_at === graceExpiresAt &&
      outbox.captured_now === capturedNow &&
      outbox.run_id === runId &&
      outbox.payload_json === payload
    );
  } catch {
    return false;
  }
}

async function applyActiveToGrace(database, candidate, runId, capturedNow, gracePeriodDays) {
  const nextGeneration = candidate.generation + 1;
  if (!Number.isSafeInteger(nextGeneration) || nextGeneration > Number.MAX_SAFE_INTEGER) {
    throw fail("license_generation_overflow");
  }
  const operationId = operationIdFor(runId, candidate.licenseId, candidate.generation);
  const graceExpiresAt = candidate.graceExpiresAt ?? roundUpToNextUtcMidnight(candidate.licenseEnd, gracePeriodDays, "license_end");
  const payload = transitionPayload(candidate, runId, capturedNow, graceExpiresAt, nextGeneration);
  const auditId = `${operationId}:audit`;
  const outboxId = `${operationId}:outbox`;
  const dedupeKey = `${candidate.licenseId}:generation:${nextGeneration}:${ACTIVE_TO_GRACE_EVENT}`;

  const statements = [
    database
      .prepare(`
        UPDATE fanmark_licenses
        SET status = 'grace',
            grace_expires_at = ?,
            is_returned = 0,
            generation = generation + 1,
            lifecycle_claim_id = ?
        WHERE id = ?
          AND fanmark_id = ?
          AND user_id = ?
          AND status = 'active'
          AND generation = ?
          AND license_end = ?
          AND license_end IS NOT NULL
          AND license_end < ?
          AND lifecycle_claim_id IS NULL
          AND EXISTS (
            SELECT 1 FROM fanmarks AS f
            WHERE f.id = fanmark_licenses.fanmark_id
              AND f.status = 'active'
          )
          AND EXISTS (
            SELECT 1 FROM license_expiry_run_items AS ri
            WHERE ri.run_id = ?
              AND ri.license_id = fanmark_licenses.id
              AND ri.operation_id = ?
              AND ri.outcome = 'pending'
              AND ri.generation = fanmark_licenses.generation
          )
      `)
      .bind(
        graceExpiresAt,
        operationId,
        candidate.licenseId,
        candidate.fanmarkId,
        candidate.userId,
        candidate.generation,
        candidate.licenseEnd,
        capturedNow,
        runId,
        operationId,
      ),
    database
      .prepare(`
        INSERT INTO audit_logs
          (id, action, license_id, fanmark_id, user_id, generation, run_id, metadata_json)
        SELECT ?, ?, l.id, l.fanmark_id, l.user_id, l.generation, ?, ?
        FROM fanmark_licenses AS l
        WHERE l.id = ?
          AND l.status = 'grace'
          AND l.generation = ?
          AND l.lifecycle_claim_id = ?
      `)
      .bind(
        auditId,
        ACTIVE_TO_GRACE_ACTION,
        runId,
        payload,
        candidate.licenseId,
        nextGeneration,
        operationId,
      ),
    database
      .prepare(`
        INSERT INTO lifecycle_outbox
          (id, event_type, dedupe_key, license_id, fanmark_id, user_id,
           generation, license_end, grace_expires_at, captured_now, run_id,
           payload_json)
        SELECT ?, ?, ?, l.id, l.fanmark_id, l.user_id, l.generation,
               l.license_end, l.grace_expires_at, ?, ?, ?
        FROM fanmark_licenses AS l
        WHERE l.id = ?
          AND l.status = 'grace'
          AND l.generation = ?
          AND l.lifecycle_claim_id = ?
      `)
      .bind(
        outboxId,
        ACTIVE_TO_GRACE_EVENT,
        dedupeKey,
        capturedNow,
        runId,
        payload,
        candidate.licenseId,
        nextGeneration,
        operationId,
      ),
    database
      .prepare(`
        UPDATE license_expiry_run_items
        SET outcome = 'processed', grace_expires_at = ?, completed_at = ?
        WHERE run_id = ? AND license_id = ? AND operation_id = ?
          AND generation = ? AND outcome = 'pending'
          AND EXISTS (
            SELECT 1 FROM fanmark_licenses AS l
            WHERE l.id = license_expiry_run_items.license_id
              AND l.status = 'grace'
              AND l.generation = ?
              AND l.lifecycle_claim_id = ?
          )
      `)
      .bind(
        graceExpiresAt,
        capturedNow,
        runId,
        candidate.licenseId,
        operationId,
        candidate.generation,
        nextGeneration,
        operationId,
      ),
    database
      .prepare(`
        INSERT INTO license_expiry_effect_guards (operation_id, allowed)
        SELECT ?, CASE WHEN
          EXISTS (SELECT 1 FROM audit_logs
            WHERE id = ? AND license_id = ? AND generation = ?
              AND run_id = ? AND metadata_json = ?)
          AND EXISTS (SELECT 1 FROM lifecycle_outbox
            WHERE id = ? AND license_id = ? AND generation = ?
              AND run_id = ? AND dedupe_key = ? AND payload_json = ?)
          AND EXISTS (SELECT 1 FROM license_expiry_run_items
            WHERE run_id = ? AND license_id = ? AND operation_id = ?
              AND generation = ? AND outcome = 'processed'
              AND grace_expires_at = ?)
          THEN 1 ELSE 0 END
        FROM fanmark_licenses
        WHERE id = ? AND lifecycle_claim_id = ?
          AND status = 'grace' AND generation = ?
      `)
      .bind(
        operationId,
        auditId, candidate.licenseId, nextGeneration, runId, payload,
        outboxId, candidate.licenseId, nextGeneration, runId, dedupeKey, payload,
        runId, candidate.licenseId, operationId, candidate.generation, graceExpiresAt,
        candidate.licenseId, operationId, nextGeneration,
      ),
    database
      .prepare(`
        UPDATE fanmark_licenses
        SET lifecycle_claim_id = NULL
        WHERE id = ?
          AND status = 'grace'
          AND generation = ?
          AND lifecycle_claim_id = ?
      `)
      .bind(candidate.licenseId, nextGeneration, operationId),
    database.prepare("DELETE FROM license_expiry_effect_guards WHERE operation_id = ?")
      .bind(operationId),
    // A suppressed cleanup must abort the entire transaction too. This
    // statement writes no row on success; a retained guard violates CHECK.
    database.prepare(`
      INSERT INTO license_expiry_effect_guards (operation_id, allowed)
      SELECT ?, 0 WHERE EXISTS (
        SELECT 1 FROM license_expiry_effect_guards WHERE operation_id = ?
      )
    `).bind(operationId, operationId),
  ];

  let batchResult;
  try {
    batchResult = await database.batch(statements);
    if (!Array.isArray(batchResult) || batchResult.some((result) => result?.success === false)) {
      throw fail("active_to_grace_batch_failed");
    }
  } catch (error) {
    if (await confirmCommitted(database, candidate, runId, capturedNow, candidate.generation, graceExpiresAt)) {
      return {
        status: "already_committed",
        operationId,
        licenseId: candidate.licenseId,
        generation: nextGeneration,
        graceExpiresAt,
      };
    }
    if (error instanceof LicenseExpiryError) throw error;
    throw fail("active_to_grace_batch_failed", "active_to_grace_batch_failed", error);
  }

  const changes = batchResult.map(resultChanges);
  if (changes.length === 8 && changes.slice(0, 7).every((value) => value === 1) && changes[7] === 0) {
    return {
      status: "processed",
      operationId,
      licenseId: candidate.licenseId,
      generation: nextGeneration,
      graceExpiresAt,
    };
  }

  if (await confirmCommitted(database, candidate, runId, capturedNow, candidate.generation, graceExpiresAt)) {
    return {
      status: "already_committed",
      operationId,
      licenseId: candidate.licenseId,
      generation: nextGeneration,
      graceExpiresAt,
    };
  }

  return {
    status: "conflict",
    operationId,
    licenseId: candidate.licenseId,
    generation: nextGeneration,
    graceExpiresAt,
  };
}

async function updateRunProgress(database, runId, expectedCursor, nextCursor, counts) {
  let result;
  try {
    result = await database
      .prepare(`
        UPDATE license_expiry_runs
        SET last_license_id = ?,
            candidate_count = candidate_count + ?,
            processed_count = processed_count + ?,
            already_committed_count = already_committed_count + ?,
            conflict_count = conflict_count + ?
        WHERE run_id = ? AND status = 'running' AND last_license_id = ?
      `)
      .bind(
        nextCursor,
        counts.candidateCount,
        counts.processed,
        counts.alreadyCommitted,
        counts.conflicts,
        runId,
        expectedCursor,
      )
      .run();
  } catch (error) {
    throw fail("run_progress_update_failed", "run_progress_update_failed", error);
  }
  assertSuccessfulResult(result, "run_progress_update_failed");
  return resultChanges(result) === 1;
}

async function completeRun(database, runId, expectedCursor) {
  let result;
  try {
    result = await database
      .prepare(`
        UPDATE license_expiry_runs
        SET status = 'completed', completed_at = captured_now
        WHERE run_id = ? AND status = 'running' AND last_license_id = ?
      `)
      .bind(runId, expectedCursor)
      .run();
  } catch (error) {
    throw fail("run_completion_update_failed", "run_completion_update_failed", error);
  }
  assertSuccessfulResult(result, "run_completion_update_failed");
  return resultChanges(result) === 1;
}

function summaryFromRun(run) {
  return {
    runId: run.run_id,
    capturedNow: run.captured_now,
    gracePeriodDays: Number(run.grace_period_days),
    candidateCount: Number(run.candidate_count),
    processed: Number(run.processed_count),
    alreadyCommitted: Number(run.already_committed_count),
    conflicts: Number(run.conflict_count),
    status: run.status,
    results: [],
  };
}

export function createLicenseExpiryRepository({ database, runId, capturedNow }) {
  assertDatabase(database);
  assertInternalToken(runId, "run_id");
  assertCanonicalUtcMicrosecond(capturedNow, "captured_now");

  return {
    async runActiveToGrace() {
      const gracePeriodDays = await readGracePeriodDays(database);
      let run = await ensureRun(database, runId, capturedNow, gracePeriodDays);
      if (run.status === "completed") return summaryFromRun(run);

      const samples = [];
      while (true) {
        run = await readRun(database, runId);
        if (!run) throw fail("run_record_query_failed");
        if (run.captured_now !== capturedNow || Number(run.grace_period_days) !== gracePeriodDays) {
          throw fail("run_binding_mismatch");
        }
        if (run.status === "completed") {
          return { ...summaryFromRun(run), results: samples };
        }

        const cursor = String(run.last_license_id ?? "");
        let page = await readRunItemsPage(database, runId, cursor);
        if (page.length === 0) {
          const candidates = await readCandidatesPage(database, capturedNow, cursor);
          if (candidates.length === 0) {
            const completed = await completeRun(database, runId, cursor);
            if (!completed) continue;
            const completedRun = await readRun(database, runId);
            if (!completedRun) throw fail("run_record_query_failed");
            return { ...summaryFromRun(completedRun), results: samples };
          }
          await seedRunItems(database, runId, candidates, gracePeriodDays);
          page = await readRunItemsPage(database, runId, cursor);
          if (page.length === 0) throw fail("run_item_query_failed");
        }

        const pageResults = [];
        for (const item of page) {
          let outcome = item.outcome;
          let transition = null;
          if (outcome === "pending") {
            const candidate = {
              licenseId: item.licenseId,
              fanmarkId: item.fanmarkId,
              userId: item.userId,
              licenseEnd: item.licenseEnd,
              generation: item.generation,
              operationId: item.operationId,
              graceExpiresAt: item.graceExpiresAt,
            };
            transition = await applyActiveToGrace(database, candidate, runId, capturedNow, gracePeriodDays);
            if (transition.status === "already_committed") {
              outcome = await updateRunItemOutcome(database, runId, item, "already_committed", capturedNow);
            } else if (transition.status === "conflict") {
              outcome = await updateRunItemOutcome(database, runId, item, "conflict", capturedNow);
            } else {
              outcome = "processed";
            }
          }
          pageResults.push({ ...item, outcome, transition });
        }

        const counts = {
          candidateCount: page.length,
          processed: pageResults.filter((result) => result.outcome === "processed").length,
          alreadyCommitted: pageResults.filter((result) => result.outcome === "already_committed").length,
          conflicts: pageResults.filter((result) => result.outcome === "conflict").length,
        };
        const advanced = await updateRunProgress(
          database,
          runId,
          cursor,
          page.at(-1).licenseId,
          counts,
        );
        if (advanced) {
          for (const result of pageResults) {
            if (samples.length >= MAX_RESULT_SAMPLES) break;
            samples.push({
              licenseId: result.licenseId,
              status: result.outcome,
              operationId: result.operationId,
              generation: result.generation + (result.outcome === "conflict" ? 0 : 1),
              graceExpiresAt: result.transition?.graceExpiresAt ?? result.graceExpiresAt,
            });
          }
        }
      }
    },
  };
}

export const LICENSE_EXPIRY_SQL = Object.freeze({
  settings: "SELECT setting_value FROM system_settings WHERE setting_key = ?",
  candidates: "bounded keyset pages of active licenses joined to active fanmarks with finite license_end < capturedNow",
  event: ACTIVE_TO_GRACE_EVENT,
});
