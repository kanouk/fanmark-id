/**
 * Source-profile grace-to-expired transition, including pending lotteries.
 *
 * Every selected license is fenced by incarnation and lifecycle/access
 * generations. Expiration, configuration cleanup, audit, notification outbox,
 * lottery effects, journal, and claim release commit in a single D1 batch.
 * A one-shot synthetic staging canary has verified the lottery path; scheduled
 * execution remains disabled pending the broader migration readiness review.
 */

import { buildAccessGenerationAdvanceStatement } from "./protected-access-generation.mjs";
import { assertCanonicalUtcMicrosecond, roundUpToNextUtcMidnight } from "./license-expiry.mjs";
import {
  createLicenseLotterySeed,
  selectLicenseLotteryOutcome,
} from "./license-lottery-selection.mjs";

export const SOURCE_GRACE_FINALIZATION_PAGE_SIZE = 32;
export const SOURCE_GRACE_FINALIZATION_RESULT_LIMIT = 32;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/u;
const SEED_PATTERN = /^[0-9a-f]{64}$/u;
const EVENT_TYPE = "license_expired";
const EVENT_SCHEMA = "license_expired.v1";
const ACTION = "license_expired";
const MAX_SAFE_SQL_INTEGER = Number.MAX_SAFE_INTEGER;
const MAX_LOTTERY_INPUT_BYTES = 1_000_000;
const MAX_LOTTERY_EFFECTS_BYTES = 1_000_000;
const MAX_LOTTERY_JOURNAL_BYTES = 1_800_000;
const CONFIG_TABLES = [
  "fanmark_basic_configs",
  "fanmark_redirect_configs",
  "fanmark_messageboard_configs",
  "fanmark_password_configs",
];

export class SourceGraceFinalizationError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "SourceGraceFinalizationError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code, cause) {
  return new SourceGraceFinalizationError(code, cause);
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

function nullableUtc(value, name) {
  return value === null || value === undefined ? null : assertCanonicalUtcMicrosecond(value, name);
}

function candidateFromRow(row) {
  const isReturned = Number(row.is_returned);
  if (isReturned !== 0 && isReturned !== 1) throw fail("invalid_is_returned");
  return {
    licenseId: assertUuid(String(row.license_id ?? ""), "license_id"),
    fanmarkId: assertUuid(String(row.fanmark_id ?? ""), "fanmark_id"),
    fanmarkShortId: assertText(row.fanmark_short_id, "fanmark_short_id", { maximum: 128 }),
    fanmarkName: assertText(row.fanmark_name, "fanmark_name", { allowEmpty: true }),
    userId: ownerFromRow(row.user_id),
    licenseEnd: nullableUtc(row.license_end, "license_end"),
    graceExpiresAt: assertCanonicalUtcMicrosecond(row.grace_expires_at, "grace_expires_at"),
    isReturned,
    licenseIncarnation: assertGeneration(row.license_incarnation, "license_incarnation"),
    licenseLifecycleGeneration: assertGeneration(
      row.license_lifecycle_generation,
      "license_lifecycle_generation",
    ),
    accessGeneration: assertGeneration(row.access_generation, "access_generation"),
  };
}

function itemFromRow(row) {
  const candidate = candidateFromRow(row);
  const outcome = String(row.outcome ?? "");
  if (!["pending", "processed", "conflict"].includes(outcome)) throw fail("run_item_invalid");
  const lotterySeed = row.lottery_seed === null || row.lottery_seed === undefined
    ? null
    : String(row.lottery_seed);
  const lotteryInputsJson = row.lottery_inputs_json === null || row.lottery_inputs_json === undefined
    ? null
    : String(row.lottery_inputs_json);
  const lotteryPlanJson = row.lottery_plan_json === null || row.lottery_plan_json === undefined
    ? null
    : String(row.lottery_plan_json);
  if (
    jsonByteLength(lotteryInputsJson ?? "") + jsonByteLength(lotteryPlanJson ?? "") >
    MAX_LOTTERY_JOURNAL_BYTES
  ) throw fail("lottery_journal_too_large");
  if (lotterySeed !== null && !SEED_PATTERN.test(lotterySeed)) throw fail("lottery_journal_seed_invalid");
  if ((lotteryInputsJson !== null || lotteryPlanJson !== null) && lotterySeed === null) {
    throw fail("lottery_journal_binding_invalid");
  }
  if (lotteryPlanJson !== null && lotteryInputsJson === null) throw fail("lottery_journal_binding_invalid");
  for (const [json, code] of [
    [lotteryInputsJson, "lottery_inputs_invalid"],
    [lotteryPlanJson, "lottery_plan_invalid"],
  ]) {
    if (json === null) continue;
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw fail(code, error);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || JSON.stringify(parsed) !== json) {
      throw fail(code);
    }
  }
  return {
    ...candidate,
    runId: assertUuid(String(row.run_id ?? ""), "run_id"),
    operationId: assertUuid(String(row.operation_id ?? ""), "operation_id"),
    auditId: assertUuid(String(row.audit_id ?? ""), "audit_id"),
    notificationEventId: assertUuid(String(row.notification_event_id ?? ""), "notification_event_id"),
    lotterySeed,
    lotteryInputsJson,
    lotteryPlanJson,
    outcome,
  };
}

function expirationValues(item, runId, capturedNow) {
  const nextLifecycleGeneration = item.licenseLifecycleGeneration + 1;
  const nextAccessGeneration = item.accessGeneration + 1;
  if (!Number.isSafeInteger(nextLifecycleGeneration) || nextLifecycleGeneration > MAX_SAFE_SQL_INTEGER) {
    throw fail("license_lifecycle_generation_overflow");
  }
  if (!Number.isSafeInteger(nextAccessGeneration) || nextAccessGeneration > MAX_SAFE_SQL_INTEGER) {
    throw fail("access_generation_overflow");
  }
  const auditMetadata = JSON.stringify({
    schema_version: 1,
    run_id: runId,
    operation_id: item.operationId,
    license_id: item.licenseId,
    fanmark_id: item.fanmarkId,
    fanmark_short_id: item.fanmarkShortId,
    license_incarnation: item.licenseIncarnation,
    license_lifecycle_generation: nextLifecycleGeneration,
    access_generation: nextAccessGeneration,
    expired_at: capturedNow,
    grace_expires_at: item.graceExpiresAt,
    license_end: item.licenseEnd,
    config_deletion_errors: 0,
  });
  const notificationPayload = JSON.stringify({
    user_id: item.userId,
    fanmark_id: item.fanmarkId,
    fanmark_name: item.fanmarkName,
    expired_at: capturedNow,
    license_end: item.licenseEnd,
  });
  const licenseEndEpochMs = item.licenseEnd === null ? 0 : Date.parse(item.licenseEnd);
  if (!Number.isSafeInteger(licenseEndEpochMs) || licenseEndEpochMs < 0) throw fail("invalid_license_end");
  return {
    nextLifecycleGeneration,
    nextAccessGeneration,
    auditMetadata,
    notificationPayload,
    dedupeKey: `expired_${item.licenseId}_${licenseEndEpochMs}`,
  };
}

function jsonByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function compactLotterySelection(selection) {
  return {
    schemaVersion: selection.schemaVersion,
    seed: selection.seed,
    weightScale: selection.weightScale,
    winnerEntryId: selection.winnerEntryId,
    draws: selection.draws,
    entries: selection.entries.map(({ entryId, status }) => ({ entryId, status })),
  };
}

function lotteryOutcomes(input, selection) {
  const statuses = new Map(selection.entries.map((entry) => [entry.entryId, entry.status]));
  return input.entries.map((entry) => ({ ...entry, status: statuses.get(entry.entryId) ?? "limit_exceeded" }));
}

async function deterministicUuid(namespace) {
  let digest;
  try {
    digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(namespace))).slice(0, 16);
  } catch (error) {
    throw fail("lottery_effect_id_unavailable", error);
  }
  digest[6] = (digest[6] & 0x0f) | 0x40;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function lotteryProbabilityDistribution(outcomes) {
  return outcomes.map((entry) => ({
    user_id: entry.userId,
    lottery_probability: entry.lotteryProbability,
    ...(entry.status === "limit_exceeded" ? { rejected_reason: "limit_exceeded" } : {}),
  }));
}

function formatLotteryLicenseEnd(value) {
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

async function buildLotteryEffects(item, bindings, input, selection) {
  const outcomes = lotteryOutcomes(input, selection);
  const winner = outcomes.find((entry) => entry.status === "won") ?? null;
  const isCurrentOwnerWin = Boolean(winner && winner.userId === item.userId);
  const licenseEnd = winner
    ? roundUpToNextUtcMidnight(bindings.capturedNow, input.licenseDays, "captured_now")
    : null;
  const newLicenseId = winner
    ? await deterministicUuid(`${item.operationId}:lottery-winner-license`)
    : null;
  const historyId = await deterministicUuid(`${item.operationId}:lottery-history`);
  const probabilityDistribution = JSON.stringify(lotteryProbabilityDistribution(outcomes));
  const entryEffects = outcomes.map((entry) => ({
    entryId: entry.entryId,
    status: entry.status,
    // The source CHECK constraint does not allow "limit_exceeded" as an
    // entry_status. Keep the valid terminal "lost" state while retaining the
    // precise capacity rejection in the replayable journal, history, and event.
    entryStatus: entry.status === "won" ? "won" : "lost",
  }));
  const entryEffectsJson = JSON.stringify(entryEffects);
  const lotteryEvents = [];
  for (const entry of outcomes) {
    const eventId = await deterministicUuid(`${item.operationId}:lottery-event:${entry.entryId}`);
    let eventType;
    let payload;
    if (entry.status === "limit_exceeded") {
      eventType = "lottery_limit_exceeded";
      payload = {
        user_id: entry.userId,
        fanmark_id: item.fanmarkId,
        fanmark_name: item.fanmarkName,
        current_count: entry.capacity.activeCount,
        limit: entry.capacity.limit,
      };
    } else if (winner) {
      const isWinner = entry.entryId === winner.entryId;
      eventType = isWinner ? "lottery_won" : "lottery_lost";
      payload = {
        user_id: entry.userId,
        fanmark_id: item.fanmarkId,
        fanmark_name: item.fanmarkName,
        ...(isWinner ? {
          license_id: newLicenseId,
          license_end: licenseEnd,
          license_end_formatted: formatLotteryLicenseEnd(licenseEnd),
        } : {}),
        total_applicants: outcomes.length,
        is_current_owner_win: isWinner && isCurrentOwnerWin,
      };
    } else {
      continue;
    }
    lotteryEvents.push({
      id: eventId,
      eventType,
      payload: JSON.stringify(payload),
      triggerAt: bindings.capturedNow,
      createdAt: bindings.capturedNow,
      updatedAt: bindings.capturedNow,
    });
  }
  const lotteryEventsJson = JSON.stringify(lotteryEvents);
  if ([probabilityDistribution, entryEffectsJson, lotteryEventsJson].some((value) =>
    jsonByteLength(value) > MAX_LOTTERY_EFFECTS_BYTES)) {
    throw fail("lottery_effects_too_large");
  }
  return {
    outcomes,
    winner,
    isCurrentOwnerWin,
    licenseEnd,
    newLicenseId,
    historyId,
    probabilityDistribution,
    entryEffectsJson,
    entryEffects,
    lotteryEventsJson,
    lotteryEvents,
  };
}

const ITEM_COLUMNS = `run_id, license_id, fanmark_id, fanmark_short_id, fanmark_name,
  user_id, license_end, grace_expires_at, is_returned, license_incarnation,
  license_lifecycle_generation, access_generation, operation_id, audit_id,
  notification_event_id, lottery_seed, lottery_inputs_json, lottery_plan_json, outcome`;

async function readRun(database, runId) {
  try {
    return await database.prepare(`
      SELECT run_id, target_incarnation, schema_extension_digest, captured_now,
             status, last_license_id, candidate_count, processed_count, conflict_count
      FROM license_grace_finalization_runs WHERE run_id = ?
    `).bind(runId).first() ?? null;
  } catch (error) {
    throw fail("finalization_run_query_failed", error);
  }
}

async function ensureRun(database, bindings) {
  try {
    const result = await database.prepare(`
      INSERT INTO license_grace_finalization_runs
        (run_id, target_incarnation, schema_extension_digest, captured_now,
         status, last_license_id, candidate_count, processed_count, conflict_count)
      VALUES (?, ?, ?, ?, 'running', '', 0, 0, 0)
      ON CONFLICT (run_id) DO NOTHING
    `).bind(
      bindings.runId,
      bindings.targetIncarnation,
      bindings.schemaExtensionDigest,
      bindings.capturedNow,
    ).run();
    if (result?.success === false) throw fail("finalization_run_insert_failed");
  } catch (error) {
    if (error instanceof SourceGraceFinalizationError) throw error;
    throw fail("finalization_run_insert_failed", error);
  }

  const run = await readRun(database, bindings.runId);
  if (
    !run || run.target_incarnation !== bindings.targetIncarnation ||
    run.schema_extension_digest !== bindings.schemaExtensionDigest ||
    run.captured_now !== bindings.capturedNow || !["running", "completed"].includes(run.status)
  ) throw fail("finalization_run_binding_mismatch");
  return run;
}

async function readCandidatesPage(database, capturedNow, lastLicenseId) {
  let result;
  try {
    result = await database.prepare(`
      SELECT l.id AS license_id, l.fanmark_id, f.short_id AS fanmark_short_id,
             f.normalized_emoji AS fanmark_name, l.user_id, l.license_end,
             l.grace_expires_at, l.is_returned,
             registry.incarnation AS license_incarnation,
             l.lifecycle_generation AS license_lifecycle_generation,
             access.access_generation
      FROM fanmark_licenses AS l
      JOIN fanmarks AS f ON f.id = l.fanmark_id
      JOIN fanmark_license_incarnations AS registry ON registry.license_id = l.id
      JOIN fanmark_access_versions AS access
        ON access.license_id = l.id AND access.license_incarnation = registry.incarnation
      WHERE l.id > ? AND l.status = 'grace' AND l.grace_expires_at IS NOT NULL
        AND l.grace_expires_at <= ? AND l.lifecycle_claim_id IS NULL
        AND f.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM license_expiry_run_items AS transitioned
          JOIN license_expiry_runs AS expiry_run ON expiry_run.run_id = transitioned.run_id
          WHERE transitioned.license_id = l.id AND transitioned.outcome = 'processed'
            AND expiry_run.captured_now = ?
        )
      ORDER BY l.id ASC LIMIT ?
    `).bind(lastLicenseId, capturedNow, capturedNow, SOURCE_GRACE_FINALIZATION_PAGE_SIZE).all();
  } catch (error) {
    throw fail("finalization_candidate_query_failed", error);
  }
  if (result?.success === false || !Array.isArray(result?.results)) {
    throw fail("finalization_candidate_query_failed");
  }
  return result.results.map(candidateFromRow);
}

async function readItemsPage(database, runId, lastLicenseId) {
  let result;
  try {
    result = await database.prepare(`
      SELECT ${ITEM_COLUMNS} FROM license_grace_finalization_items
      WHERE run_id = ? AND license_id > ? ORDER BY license_id ASC LIMIT ?
    `).bind(runId, lastLicenseId, SOURCE_GRACE_FINALIZATION_PAGE_SIZE).all();
  } catch (error) {
    throw fail("finalization_item_query_failed", error);
  }
  if (result?.success === false || !Array.isArray(result?.results)) {
    throw fail("finalization_item_query_failed");
  }
  return result.results.map(itemFromRow);
}

async function seedItems(database, runId, page, uuidFactory) {
  const statements = page.map((candidate) => database.prepare(`
    INSERT INTO license_grace_finalization_items
      (run_id, license_id, fanmark_id, fanmark_short_id, fanmark_name, user_id,
       license_end, grace_expires_at, is_returned, license_incarnation,
       license_lifecycle_generation, access_generation, operation_id, audit_id,
       notification_event_id, lottery_seed, lottery_inputs_json, lottery_plan_json, outcome)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'pending')
    ON CONFLICT (run_id, license_id) DO NOTHING
  `).bind(
    runId,
    candidate.licenseId,
    candidate.fanmarkId,
    candidate.fanmarkShortId,
    candidate.fanmarkName,
    candidate.userId,
    candidate.licenseEnd,
    candidate.graceExpiresAt,
    candidate.isReturned,
    candidate.licenseIncarnation,
    candidate.licenseLifecycleGeneration,
    candidate.accessGeneration,
    assertUuid(uuidFactory(), "operation_id"),
    assertUuid(uuidFactory(), "audit_id"),
    assertUuid(uuidFactory(), "notification_event_id"),
  ));
  try {
    assertBatch(await database.batch(statements), "finalization_item_seed_failed");
  } catch (error) {
    if (error instanceof SourceGraceFinalizationError) throw error;
    throw fail("finalization_item_seed_failed", error);
  }

  const placeholders = page.map(() => "?").join(", ");
  let result;
  try {
    result = await database.prepare(`
      SELECT ${ITEM_COLUMNS} FROM license_grace_finalization_items
      WHERE run_id = ? AND license_id IN (${placeholders})
    `).bind(runId, ...page.map((item) => item.licenseId)).all();
  } catch (error) {
    throw fail("finalization_item_query_failed", error);
  }
  if (result?.success === false || !Array.isArray(result?.results) || result.results.length !== page.length) {
    throw fail("finalization_item_binding_mismatch");
  }
  const byId = new Map(result.results.map((row) => [row.license_id, itemFromRow(row)]));
  for (const candidate of page) {
    const item = byId.get(candidate.licenseId);
    if (!item || item.runId !== runId ||
        item.fanmarkId !== candidate.fanmarkId || item.fanmarkShortId !== candidate.fanmarkShortId ||
        item.fanmarkName !== candidate.fanmarkName || item.userId !== candidate.userId ||
        item.licenseEnd !== candidate.licenseEnd || item.graceExpiresAt !== candidate.graceExpiresAt ||
        item.isReturned !== candidate.isReturned || item.licenseIncarnation !== candidate.licenseIncarnation ||
        item.licenseLifecycleGeneration !== candidate.licenseLifecycleGeneration ||
        item.accessGeneration !== candidate.accessGeneration) {
      throw fail("finalization_item_binding_mismatch");
    }
  }
}

async function readItem(database, runId, licenseId) {
  try {
    const row = await database.prepare(`
      SELECT ${ITEM_COLUMNS} FROM license_grace_finalization_items
      WHERE run_id = ? AND license_id = ?
    `).bind(runId, licenseId).first();
    return row ? itemFromRow(row) : null;
  } catch (error) {
    throw fail("finalization_item_query_failed", error);
  }
}

async function lotteryInputsFromD1(database, item, bindings) {
  let result;
  try {
    result = await database.prepare(`
      SELECT entry.id AS entry_id, entry.user_id, entry.lottery_probability,
             COALESCE(settings.plan_type, 'free') AS plan_type,
             (SELECT setting.setting_value FROM system_settings AS setting
               WHERE setting.setting_key = COALESCE(settings.plan_type, 'free') || '_fanmark_limit'
               ORDER BY setting.id LIMIT 1) AS plan_limit_setting,
             (SELECT COUNT(*) FROM fanmark_licenses AS active
               WHERE active.user_id = entry.user_id AND active.status = 'active'
                 AND active.is_returned = 0
                 AND active.license_end > ?) AS active_count
      FROM fanmark_lottery_entries AS entry
      LEFT JOIN user_settings AS settings ON settings.user_id = entry.user_id
      WHERE entry.license_id = ? AND entry.entry_status = 'pending'
      ORDER BY entry.id
    `).bind(bindings.capturedNow, item.licenseId).all();
  } catch (error) {
    throw fail("lottery_inputs_query_failed", error);
  }
  if (result?.success === false || !Array.isArray(result?.results)) {
    throw fail("lottery_inputs_query_failed");
  }
  const entries = result.results.map((row) => {
    const planType = assertText(row.plan_type, "lottery_plan_type", { maximum: 160 });
    const limitSetting = row.plan_limit_setting;
    let limit = 3;
    if (limitSetting !== null && limitSetting !== undefined) {
      if (typeof limitSetting !== "string" || !/^\d+$/u.test(limitSetting)) {
        throw fail("lottery_plan_limit_invalid");
      }
      limit = Number(limitSetting);
      if (!Number.isSafeInteger(limit) || limit < 0) throw fail("lottery_plan_limit_invalid");
    }
    const activeCount = Number(row.active_count);
    if (!Number.isSafeInteger(activeCount) || activeCount < 0) throw fail("lottery_active_count_invalid");
    if (typeof row.lottery_probability !== "string") throw fail("lottery_weight_not_exact_text");
    return {
      entryId: assertUuid(String(row.entry_id ?? ""), "lottery_entry_id"),
      userId: assertUuid(String(row.user_id ?? ""), "lottery_user_id"),
      lotteryProbability: row.lottery_probability,
      capacity: { planType, activeCount, limit },
    };
  });
  let tier;
  try {
    tier = await database.prepare(`
      SELECT tier.initial_license_days
      FROM fanmarks AS fanmark
      LEFT JOIN fanmark_tiers AS tier ON tier.tier_level = fanmark.tier_level
      WHERE fanmark.id = ?
    `).bind(item.fanmarkId).first();
  } catch (error) {
    throw fail("lottery_tier_query_failed", error);
  }
  const licenseDays = Number(tier?.initial_license_days || 30);
  if (!Number.isSafeInteger(licenseDays) || licenseDays < 1 || licenseDays > 36_500) {
    throw fail("lottery_tier_days_invalid");
  }
  return {
    schemaVersion: 1,
    runId: item.runId,
    licenseId: item.licenseId,
    capturedNow: bindings.capturedNow,
    seed: item.lotterySeed,
    licenseDays,
    entries,
  };
}

function parsedLotteryInputs(item, bindings) {
  if (!item.lotteryInputsJson) return null;
  let input;
  try {
    input = JSON.parse(item.lotteryInputsJson);
  } catch (error) {
    throw fail("lottery_inputs_invalid", error);
  }
  if (
    input?.schemaVersion !== 1 || input.runId !== item.runId || input.licenseId !== item.licenseId ||
    input.capturedNow !== bindings.capturedNow || input.seed !== item.lotterySeed ||
    !Number.isSafeInteger(input.licenseDays) || input.licenseDays < 1 || input.licenseDays > 36_500 ||
    !Array.isArray(input.entries)
  ) throw fail("lottery_inputs_binding_mismatch");
  return input;
}

async function sha256Hex(value) {
  let digest;
  try {
    digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  } catch (error) {
    throw fail("lottery_plan_digest_unavailable", error);
  }
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validatedStoredLotteryPlan(item, bindings, input) {
  if (!item.lotteryPlanJson) return null;
  let plan;
  try {
    plan = JSON.parse(item.lotteryPlanJson);
  } catch (error) {
    throw fail("lottery_plan_invalid", error);
  }
  if (
    !input || plan?.schemaVersion !== 1 || plan.runId !== item.runId || plan.licenseId !== item.licenseId ||
    plan.capturedNow !== bindings.capturedNow || plan.seed !== item.lotterySeed ||
    plan.inputSha256 !== await sha256Hex(item.lotteryInputsJson) ||
    !plan.selection || plan.selection.seed !== item.lotterySeed
  ) throw fail("lottery_plan_binding_mismatch");

  let replay;
  try {
    replay = await selectLicenseLotteryOutcome({
      entries: input.entries,
      seed: item.lotterySeed,
    });
  } catch (error) {
    throw fail("lottery_plan_replay_failed", error);
  }
  if (JSON.stringify(compactLotterySelection(replay)) !== JSON.stringify(plan.selection)) {
    throw fail("lottery_plan_replay_mismatch");
  }
  return plan;
}

async function claimLotteryLicense(database, item, bindings) {
  let result;
  try {
    result = await database.prepare(`
      UPDATE fanmark_licenses SET lifecycle_claim_id = ?
      WHERE id = ? AND fanmark_id = ? AND user_id IS ? AND status = 'grace'
        AND grace_expires_at = ? AND grace_expires_at <= ? AND lifecycle_generation = ?
        AND lifecycle_claim_id IS NULL
        AND EXISTS (SELECT 1 FROM fanmarks AS f WHERE f.id = fanmark_licenses.fanmark_id
          AND f.status = 'active' AND f.short_id = ? AND f.normalized_emoji IS ?)
        AND EXISTS (SELECT 1 FROM fanmark_license_incarnations AS registry
          WHERE registry.license_id = fanmark_licenses.id AND registry.incarnation = ?)
        AND EXISTS (SELECT 1 FROM fanmark_access_versions AS access
          WHERE access.license_id = fanmark_licenses.id AND access.license_incarnation = ?
            AND access.access_generation = ?)
        AND EXISTS (SELECT 1 FROM license_grace_finalization_items AS item
          WHERE item.run_id = ? AND item.license_id = fanmark_licenses.id
            AND item.operation_id = ? AND item.outcome = 'pending')
        AND EXISTS (SELECT 1 FROM fanmark_lottery_entries AS entry
          WHERE entry.license_id = fanmark_licenses.id AND entry.entry_status = 'pending')
    `).bind(
      item.operationId, item.licenseId, item.fanmarkId, item.userId,
      item.graceExpiresAt, bindings.capturedNow, item.licenseLifecycleGeneration,
      item.fanmarkShortId, item.fanmarkName, item.licenseIncarnation,
      item.licenseIncarnation, item.accessGeneration, item.runId, item.operationId,
    ).run();
  } catch (error) {
    throw fail("lottery_claim_failed", error);
  }
  if (result?.success === false) throw fail("lottery_claim_failed");
  if (resultChanges(result) === 1) return;

  let current;
  try {
    current = await database.prepare(`
      SELECT status, lifecycle_claim_id FROM fanmark_licenses WHERE id = ?
    `).bind(item.licenseId).first();
  } catch (error) {
    throw fail("lottery_claim_readback_failed", error);
  }
  if (current?.status === "grace" && current.lifecycle_claim_id === item.operationId) return;
  throw fail("lottery_claim_conflict");
}

async function storeLotteryJournalField(database, item, field, value) {
  const allowed = new Set(["lottery_seed", "lottery_inputs_json", "lottery_plan_json"]);
  if (!allowed.has(field)) throw fail("lottery_journal_field_invalid");
  const dependency = field === "lottery_seed"
    ? "AND lottery_inputs_json IS NULL AND lottery_plan_json IS NULL"
    : field === "lottery_inputs_json"
      ? "AND lottery_seed = ? AND lottery_plan_json IS NULL"
      : "AND lottery_seed = ? AND lottery_inputs_json = ?";
  const dependencyBindings = field === "lottery_seed"
    ? []
    : field === "lottery_inputs_json"
      ? [item.lotterySeed]
      : [item.lotterySeed, item.lotteryInputsJson];
  let result;
  try {
    result = await database.prepare(`
      UPDATE license_grace_finalization_items SET ${field} = ?
      WHERE run_id = ? AND license_id = ? AND operation_id = ? AND outcome = 'pending'
        AND ${field} IS NULL ${dependency}
        AND EXISTS (SELECT 1 FROM fanmark_licenses AS l
          WHERE l.id = license_grace_finalization_items.license_id
            AND l.status = 'grace' AND l.lifecycle_claim_id = ?)
    `).bind(value, item.runId, item.licenseId, item.operationId, ...dependencyBindings, item.operationId).run();
  } catch (error) {
    throw fail("lottery_journal_write_failed", error);
  }
  if (result?.success === false) throw fail("lottery_journal_write_failed");
  return resultChanges(result) === 1;
}

async function confirmCommitted(database, item, bindings) {
  const values = expirationValues(item, bindings.runId, bindings.capturedNow);
  try {
    const [license, registry, access, journal, audit, event, configs, pending, guard] = await Promise.all([
      database.prepare(`SELECT status, excluded_at, lifecycle_generation, lifecycle_claim_id,
          fanmark_id, user_id, grace_expires_at, is_returned FROM fanmark_licenses WHERE id = ?`)
        .bind(item.licenseId).first(),
      database.prepare("SELECT incarnation FROM fanmark_license_incarnations WHERE license_id = ?")
        .bind(item.licenseId).first(),
      database.prepare("SELECT license_incarnation, access_generation, updated_at FROM fanmark_access_versions WHERE license_id = ?")
        .bind(item.licenseId).first(),
      database.prepare(`SELECT outcome, completed_at FROM license_grace_finalization_items
          WHERE run_id = ? AND license_id = ? AND operation_id = ?`)
        .bind(bindings.runId, item.licenseId, item.operationId).first(),
      database.prepare(`SELECT id, user_id, action, resource_type, resource_id, request_id,
          metadata, created_at FROM audit_logs WHERE id = ?`)
        .bind(item.auditId).first(),
      database.prepare(`SELECT id, event_type, event_version, source, payload, payload_schema,
          trigger_at, dedupe_key, status, retry_count, created_at, updated_at
          FROM notification_events WHERE id = ?`)
        .bind(item.notificationEventId).first(),
      database.prepare(`SELECT
          (SELECT COUNT(*) FROM fanmark_basic_configs WHERE license_id = ?) +
          (SELECT COUNT(*) FROM fanmark_redirect_configs WHERE license_id = ?) +
          (SELECT COUNT(*) FROM fanmark_messageboard_configs WHERE license_id = ?) +
          (SELECT COUNT(*) FROM fanmark_password_configs WHERE license_id = ?) AS count`)
        .bind(item.licenseId, item.licenseId, item.licenseId, item.licenseId).first(),
      database.prepare("SELECT COUNT(*) AS count FROM fanmark_lottery_entries WHERE license_id = ? AND entry_status = 'pending'")
        .bind(item.licenseId).first(),
      database.prepare("SELECT operation_id FROM license_expiry_effect_guards WHERE operation_id = ?")
        .bind(item.operationId).first(),
    ]);
    return license?.status === "expired" && license.excluded_at === bindings.capturedNow &&
      Number(license.lifecycle_generation) === values.nextLifecycleGeneration &&
      license.lifecycle_claim_id === null && license.fanmark_id === item.fanmarkId &&
      license.user_id === item.userId && license.grace_expires_at === item.graceExpiresAt &&
      Number(license.is_returned) === item.isReturned &&
      Number(registry?.incarnation) === item.licenseIncarnation &&
      Number(access?.license_incarnation) === item.licenseIncarnation &&
      Number(access?.access_generation) === values.nextAccessGeneration &&
      access?.updated_at === bindings.capturedNow &&
      journal?.outcome === "processed" && journal.completed_at === bindings.capturedNow &&
      audit?.id === item.auditId && audit.user_id === item.userId && audit.action === ACTION &&
      audit.resource_type === "fanmark_license" && audit.resource_id === item.licenseId &&
      audit.request_id === item.operationId && audit.metadata === values.auditMetadata &&
      audit.created_at === bindings.capturedNow &&
      event?.id === item.notificationEventId && event.event_type === EVENT_TYPE &&
      Number(event.event_version) === 1 && event.source === "cron_job" &&
      event.payload === values.notificationPayload && event.payload_schema === EVENT_SCHEMA &&
      event.trigger_at === bindings.capturedNow && event.dedupe_key === values.dedupeKey &&
      event.status === "pending" && Number(event.retry_count) === 0 &&
      event.created_at === bindings.capturedNow && event.updated_at === bindings.capturedNow &&
      Number(configs?.count) === 0 && Number(pending?.count) === 0 && !guard;
  } catch {
    return false;
  }
}

function finalizationBatch(database, item, bindings) {
  const values = expirationValues(item, bindings.runId, bindings.capturedNow);
  const { nextLifecycleGeneration, nextAccessGeneration } = values;
  const operationId = item.operationId;
  const statements = [
    database.prepare(`
      UPDATE fanmark_licenses
      SET status = 'expired', excluded_at = ?, lifecycle_generation = lifecycle_generation + 1,
          lifecycle_claim_id = ?
      WHERE id = ? AND fanmark_id = ? AND user_id IS ? AND status = 'grace'
        AND grace_expires_at = ? AND grace_expires_at <= ? AND is_returned = ?
        AND lifecycle_generation = ? AND lifecycle_claim_id IS NULL
        AND EXISTS (SELECT 1 FROM fanmarks AS f WHERE f.id = fanmark_licenses.fanmark_id
          AND f.status = 'active' AND f.short_id = ? AND f.normalized_emoji IS ?)
        AND EXISTS (SELECT 1 FROM fanmark_license_incarnations AS registry
          WHERE registry.license_id = fanmark_licenses.id AND registry.incarnation = ?)
        AND EXISTS (SELECT 1 FROM fanmark_access_versions AS access
          WHERE access.license_id = fanmark_licenses.id AND access.license_incarnation = ?
            AND access.access_generation = ?)
        AND NOT EXISTS (SELECT 1 FROM fanmark_lottery_entries AS entry
          WHERE entry.license_id = fanmark_licenses.id AND entry.entry_status = 'pending')
        AND NOT EXISTS (SELECT 1 FROM license_expiry_run_items AS transitioned
          JOIN license_expiry_runs AS expiry_run ON expiry_run.run_id = transitioned.run_id
          WHERE transitioned.license_id = fanmark_licenses.id AND transitioned.outcome = 'processed'
            AND expiry_run.captured_now = ?)
        AND EXISTS (SELECT 1 FROM license_grace_finalization_items AS item
          WHERE item.run_id = ? AND item.license_id = fanmark_licenses.id
            AND item.operation_id = ? AND item.audit_id = ?
            AND item.notification_event_id = ? AND item.outcome = 'pending'
            AND item.license_incarnation = ?
            AND item.license_lifecycle_generation = fanmark_licenses.lifecycle_generation
            AND item.access_generation = ?)
    `).bind(
      bindings.capturedNow, operationId, item.licenseId, item.fanmarkId, item.userId,
      item.graceExpiresAt, bindings.capturedNow, item.isReturned,
      item.licenseLifecycleGeneration, item.fanmarkShortId, item.fanmarkName,
      item.licenseIncarnation, item.licenseIncarnation, item.accessGeneration,
      bindings.capturedNow,
      bindings.runId, operationId, item.auditId, item.notificationEventId,
      item.licenseIncarnation, item.accessGeneration,
    ),
    buildAccessGenerationAdvanceStatement(database, {
      licenseId: item.licenseId,
      licenseIncarnation: item.licenseIncarnation,
      expectedAccessGeneration: item.accessGeneration,
      lifecycleClaimId: operationId,
      expectedLicenseLifecycleGeneration: nextLifecycleGeneration,
      expectedLicenseStatus: "expired",
      updatedAt: bindings.capturedNow,
    }),
    ...CONFIG_TABLES.map((table) => database.prepare(`
      DELETE FROM "${table}" WHERE license_id = ? AND EXISTS (
        SELECT 1 FROM fanmark_licenses AS l WHERE l.id = ? AND l.status = 'expired'
          AND l.lifecycle_generation = ? AND l.lifecycle_claim_id = ?
      )
    `).bind(item.licenseId, item.licenseId, nextLifecycleGeneration, operationId)),
    database.prepare(`
      INSERT INTO audit_logs
        (id, user_id, action, resource_type, resource_id, request_id, metadata, created_at)
      SELECT ?, l.user_id, ?, 'fanmark_license', l.id, ?, ?, ? FROM fanmark_licenses AS l
      WHERE l.id = ? AND l.status = 'expired' AND l.lifecycle_generation = ?
        AND l.lifecycle_claim_id = ? AND l.user_id IS ? AND l.fanmark_id = ?
    `).bind(
      item.auditId, ACTION, operationId, values.auditMetadata, bindings.capturedNow,
      item.licenseId, nextLifecycleGeneration, operationId, item.userId, item.fanmarkId,
    ),
    database.prepare(`
      INSERT INTO notification_events
        (id, event_type, event_version, source, payload, payload_schema, trigger_at,
         dedupe_key, status, retry_count, created_at, updated_at)
      SELECT ?, ?, 1, 'cron_job', ?, ?, ?, ?, 'pending', 0, ?, ?
      FROM fanmark_licenses AS l WHERE l.id = ? AND l.status = 'expired'
        AND l.lifecycle_generation = ? AND l.lifecycle_claim_id = ?
        AND l.user_id IS ? AND l.fanmark_id = ?
    `).bind(
      item.notificationEventId, EVENT_TYPE, values.notificationPayload, EVENT_SCHEMA,
      bindings.capturedNow, values.dedupeKey, bindings.capturedNow, bindings.capturedNow,
      item.licenseId, nextLifecycleGeneration, operationId, item.userId, item.fanmarkId,
    ),
    database.prepare(`
      UPDATE license_grace_finalization_items SET outcome = 'processed', completed_at = ?
      WHERE run_id = ? AND license_id = ? AND operation_id = ? AND audit_id = ?
        AND notification_event_id = ? AND license_incarnation = ?
        AND license_lifecycle_generation = ? AND access_generation = ? AND outcome = 'pending'
        AND EXISTS (SELECT 1 FROM fanmark_licenses AS l
          WHERE l.id = license_grace_finalization_items.license_id AND l.status = 'expired'
            AND l.lifecycle_generation = ? AND l.lifecycle_claim_id = ?
            AND l.fanmark_id = license_grace_finalization_items.fanmark_id
            AND l.user_id IS license_grace_finalization_items.user_id)
    `).bind(
      bindings.capturedNow, bindings.runId, item.licenseId, operationId, item.auditId,
      item.notificationEventId, item.licenseIncarnation, item.licenseLifecycleGeneration,
      item.accessGeneration, nextLifecycleGeneration, operationId,
    ),
    database.prepare(`
      INSERT INTO license_expiry_effect_guards (operation_id, allowed)
      SELECT ?, CASE WHEN
        EXISTS (SELECT 1 FROM fanmark_licenses AS l
          JOIN fanmark_license_incarnations AS registry ON registry.license_id = l.id
          JOIN fanmark_access_versions AS access ON access.license_id = l.id
          WHERE l.id = ? AND l.fanmark_id = ? AND l.user_id IS ? AND l.status = 'expired'
            AND l.excluded_at = ? AND l.grace_expires_at = ? AND l.is_returned = ?
            AND l.lifecycle_generation = ? AND l.lifecycle_claim_id = ?
            AND registry.incarnation = ? AND access.license_incarnation = registry.incarnation
            AND access.access_generation = ? AND access.updated_at = ?)
        AND EXISTS (SELECT 1 FROM fanmarks AS f WHERE f.id = ? AND f.status = 'active'
          AND f.short_id = ? AND f.normalized_emoji IS ?)
        AND NOT EXISTS (SELECT 1 FROM fanmark_lottery_entries AS entry
          WHERE entry.license_id = ? AND entry.entry_status = 'pending')
        AND NOT EXISTS (SELECT 1 FROM license_expiry_run_items AS transitioned
          JOIN license_expiry_runs AS expiry_run ON expiry_run.run_id = transitioned.run_id
          WHERE transitioned.license_id = ? AND transitioned.outcome = 'processed'
            AND expiry_run.captured_now = ?)
        AND NOT EXISTS (SELECT 1 FROM fanmark_basic_configs WHERE license_id = ?)
        AND NOT EXISTS (SELECT 1 FROM fanmark_redirect_configs WHERE license_id = ?)
        AND NOT EXISTS (SELECT 1 FROM fanmark_messageboard_configs WHERE license_id = ?)
        AND NOT EXISTS (SELECT 1 FROM fanmark_password_configs WHERE license_id = ?)
        AND EXISTS (SELECT 1 FROM audit_logs WHERE id = ? AND user_id IS ? AND action = ?
          AND resource_type = 'fanmark_license' AND resource_id = ? AND request_id = ?
          AND metadata = ? AND created_at = ?)
        AND EXISTS (SELECT 1 FROM notification_events WHERE id = ? AND event_type = ?
          AND event_version = 1 AND source = 'cron_job' AND payload = ? AND payload_schema = ?
          AND trigger_at = ? AND dedupe_key = ? AND status = 'pending' AND retry_count = 0
          AND created_at = ? AND updated_at = ?)
        AND EXISTS (SELECT 1 FROM license_grace_finalization_items WHERE run_id = ?
          AND license_id = ? AND operation_id = ? AND outcome = 'processed'
          AND completed_at = ?)
      THEN 1 ELSE 0 END
      FROM fanmark_licenses AS l WHERE l.id = ? AND l.lifecycle_claim_id = ?
        AND l.status = 'expired' AND l.lifecycle_generation = ?
    `).bind(
      operationId,
      item.licenseId, item.fanmarkId, item.userId, bindings.capturedNow,
      item.graceExpiresAt, item.isReturned, nextLifecycleGeneration, operationId,
      item.licenseIncarnation, nextAccessGeneration, bindings.capturedNow,
      item.fanmarkId, item.fanmarkShortId, item.fanmarkName,
      item.licenseId, item.licenseId, bindings.capturedNow,
      item.licenseId, item.licenseId, item.licenseId, item.licenseId,
      item.auditId, item.userId, ACTION, item.licenseId, operationId,
      values.auditMetadata, bindings.capturedNow,
      item.notificationEventId, EVENT_TYPE, values.notificationPayload, EVENT_SCHEMA,
      bindings.capturedNow, values.dedupeKey, bindings.capturedNow, bindings.capturedNow,
      bindings.runId, item.licenseId, operationId, bindings.capturedNow,
      item.licenseId, operationId, nextLifecycleGeneration,
    ),
    database.prepare(`UPDATE fanmark_licenses SET lifecycle_claim_id = NULL
      WHERE id = ? AND status = 'expired' AND lifecycle_generation = ? AND lifecycle_claim_id = ?`)
      .bind(item.licenseId, nextLifecycleGeneration, operationId),
    database.prepare("DELETE FROM license_expiry_effect_guards WHERE operation_id = ?")
      .bind(operationId),
    database.prepare(`INSERT INTO license_expiry_effect_guards (operation_id, allowed)
      SELECT ?, 0 WHERE EXISTS (SELECT 1 FROM license_expiry_effect_guards WHERE operation_id = ?)`)
      .bind(operationId, operationId),
  ];
  return statements;
}

function lotteryFinalizationBatch(database, item, bindings, input, effects) {
  const values = expirationValues(item, bindings.runId, bindings.capturedNow);
  const nextLifecycleGeneration = values.nextLifecycleGeneration;
  const nextAccessGeneration = values.nextAccessGeneration;
  const winnerLimit = effects.winner?.capacity.limit ?? null;
  const winnerUserId = effects.winner?.userId ?? null;
  const statements = [
    database.prepare(`
      UPDATE fanmark_licenses
      SET status = 'expired', excluded_at = ?, lifecycle_generation = lifecycle_generation + 1
      WHERE id = ? AND fanmark_id = ? AND user_id IS ? AND status = 'grace'
        AND grace_expires_at = ? AND grace_expires_at <= ? AND is_returned = ?
        AND lifecycle_generation = ? AND lifecycle_claim_id = ?
        AND EXISTS (SELECT 1 FROM fanmarks AS f WHERE f.id = fanmark_licenses.fanmark_id
          AND f.status = 'active' AND f.short_id = ? AND f.normalized_emoji IS ?)
        AND EXISTS (SELECT 1 FROM fanmark_license_incarnations AS registry
          WHERE registry.license_id = fanmark_licenses.id AND registry.incarnation = ?)
        AND EXISTS (SELECT 1 FROM fanmark_access_versions AS access
          WHERE access.license_id = fanmark_licenses.id AND access.license_incarnation = ?
            AND access.access_generation = ?)
        AND EXISTS (SELECT 1 FROM license_grace_finalization_items AS item
          WHERE item.run_id = ? AND item.license_id = fanmark_licenses.id
            AND item.operation_id = ? AND item.audit_id = ?
            AND item.notification_event_id = ? AND item.outcome = 'pending'
            AND item.license_incarnation = ?
            AND item.license_lifecycle_generation = fanmark_licenses.lifecycle_generation
            AND item.access_generation = ? AND item.lottery_seed = ?
            AND item.lottery_inputs_json = ? AND item.lottery_plan_json = ?)
        AND (SELECT COUNT(*) FROM fanmark_lottery_entries AS entry
          WHERE entry.license_id = fanmark_licenses.id AND entry.entry_status = 'pending') =
          json_array_length(json_extract(?, '$.entries'))
        AND NOT EXISTS (SELECT 1 FROM fanmark_lottery_entries AS live
          WHERE live.license_id = fanmark_licenses.id AND live.entry_status = 'pending'
            AND NOT EXISTS (SELECT 1 FROM json_each(json_extract(?, '$.entries')) AS expected
              WHERE json_extract(expected.value, '$.entryId') = live.id
                AND json_extract(expected.value, '$.userId') = live.user_id
                AND json_extract(expected.value, '$.lotteryProbability') IS live.lottery_probability))
        AND (? IS NULL OR (SELECT COUNT(*) FROM fanmark_licenses AS active
          WHERE active.user_id = ? AND active.status = 'active' AND active.is_returned = 0
            AND active.license_end > ?) < ?)
    `).bind(
      bindings.capturedNow, item.licenseId, item.fanmarkId, item.userId,
      item.graceExpiresAt, bindings.capturedNow, item.isReturned,
      item.licenseLifecycleGeneration, item.operationId,
      item.fanmarkShortId, item.fanmarkName, item.licenseIncarnation,
      item.licenseIncarnation, item.accessGeneration,
      bindings.runId, item.operationId, item.auditId, item.notificationEventId,
      item.licenseIncarnation, item.accessGeneration, item.lotterySeed,
      item.lotteryInputsJson, item.lotteryPlanJson,
      item.lotteryInputsJson, item.lotteryInputsJson,
      winnerLimit, winnerUserId, bindings.capturedNow, winnerLimit,
    ),
    buildAccessGenerationAdvanceStatement(database, {
      licenseId: item.licenseId,
      licenseIncarnation: item.licenseIncarnation,
      expectedAccessGeneration: item.accessGeneration,
      lifecycleClaimId: item.operationId,
      expectedLicenseLifecycleGeneration: nextLifecycleGeneration,
      expectedLicenseStatus: "expired",
      updatedAt: bindings.capturedNow,
    }),
    ...CONFIG_TABLES.map((table) => database.prepare(`
      DELETE FROM "${table}" WHERE license_id = ? AND EXISTS (
        SELECT 1 FROM fanmark_licenses AS l WHERE l.id = ? AND l.status = 'expired'
          AND l.lifecycle_generation = ? AND l.lifecycle_claim_id = ?
      )
    `).bind(item.licenseId, item.licenseId, nextLifecycleGeneration, item.operationId)),
    database.prepare(`
      UPDATE fanmark_lottery_entries
      SET entry_status = (SELECT json_extract(effect.value, '$.entryStatus')
            FROM json_each(?) AS effect
            WHERE json_extract(effect.value, '$.entryId') = fanmark_lottery_entries.id),
          won_at = CASE WHEN (SELECT json_extract(effect.value, '$.status')
              FROM json_each(?) AS effect
              WHERE json_extract(effect.value, '$.entryId') = fanmark_lottery_entries.id) = 'won'
            THEN ? ELSE NULL END,
          lottery_executed_at = ?, updated_at = ?
      WHERE license_id = ? AND entry_status = 'pending'
        AND EXISTS (SELECT 1 FROM json_each(?) AS effect
          WHERE json_extract(effect.value, '$.entryId') = fanmark_lottery_entries.id)
        AND EXISTS (SELECT 1 FROM fanmark_licenses AS l WHERE l.id = fanmark_lottery_entries.license_id
          AND l.status = 'expired' AND l.lifecycle_generation = ? AND l.lifecycle_claim_id = ?)
    `).bind(
      effects.entryEffectsJson, effects.entryEffectsJson,
      bindings.capturedNow, bindings.capturedNow, bindings.capturedNow,
      item.licenseId, effects.entryEffectsJson, nextLifecycleGeneration, item.operationId,
    ),
    database.prepare(`
      INSERT INTO fanmark_licenses
        (id, fanmark_id, user_id, license_start, license_end, status,
         is_initial_license, created_at, updated_at, display_fanmark, is_returned, is_transferred)
      SELECT ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, 0, 0
      WHERE ? IS NOT NULL AND EXISTS (SELECT 1 FROM fanmark_licenses AS old
        WHERE old.id = ? AND old.status = 'expired' AND old.lifecycle_generation = ?
          AND old.lifecycle_claim_id = ?)
        AND EXISTS (SELECT 1 FROM fanmark_lottery_entries AS winner
          WHERE winner.id = ? AND winner.license_id = ? AND winner.user_id = ?
            AND winner.entry_status = 'won' AND winner.lottery_executed_at = ?)
    `).bind(
      effects.newLicenseId, item.fanmarkId, winnerUserId, bindings.capturedNow,
      effects.licenseEnd, bindings.capturedNow, bindings.capturedNow, item.fanmarkName,
      effects.newLicenseId, item.licenseId, nextLifecycleGeneration, item.operationId,
      effects.winner?.entryId ?? null, item.licenseId, winnerUserId, bindings.capturedNow,
    ),
    database.prepare(`UPDATE fanmark_access_versions SET updated_at = ?
      WHERE license_id = ? AND license_incarnation = 0 AND access_generation = 0`)
      .bind(bindings.capturedNow, effects.newLicenseId),
    database.prepare(`
      INSERT INTO fanmark_lottery_history
        (id, fanmark_id, license_id, total_entries, winner_user_id, winner_entry_id,
         probability_distribution, random_seed, executed_at, execution_method, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'automatic', ?
      WHERE EXISTS (SELECT 1 FROM fanmark_licenses AS old
        WHERE old.id = ? AND old.status = 'expired' AND old.lifecycle_generation = ?
          AND old.lifecycle_claim_id = ?)
    `).bind(
      effects.historyId, item.fanmarkId, item.licenseId, input.entries.length,
      winnerUserId, effects.winner?.entryId ?? null, effects.probabilityDistribution,
      item.lotterySeed, bindings.capturedNow, bindings.capturedNow,
      item.licenseId, nextLifecycleGeneration, item.operationId,
    ),
    database.prepare(`
      INSERT INTO audit_logs
        (id, user_id, action, resource_type, resource_id, request_id, metadata, created_at)
      SELECT ?, l.user_id, ?, 'fanmark_license', l.id, ?, ?, ? FROM fanmark_licenses AS l
      WHERE l.id = ? AND l.status = 'expired' AND l.lifecycle_generation = ?
        AND l.lifecycle_claim_id = ? AND l.user_id IS ? AND l.fanmark_id = ?
    `).bind(
      item.auditId, ACTION, item.operationId, values.auditMetadata, bindings.capturedNow,
      item.licenseId, nextLifecycleGeneration, item.operationId, item.userId, item.fanmarkId,
    ),
    database.prepare(`
      INSERT INTO notification_events
        (id, event_type, event_version, source, payload, payload_schema, trigger_at,
         dedupe_key, status, retry_count, created_at, updated_at)
      SELECT ?, ?, 1, 'cron_job', ?, ?, ?, ?, 'pending', 0, ?, ?
      FROM fanmark_licenses AS l WHERE l.id = ? AND l.status = 'expired'
        AND l.lifecycle_generation = ? AND l.lifecycle_claim_id = ?
        AND l.user_id IS ? AND l.fanmark_id = ?
    `).bind(
      item.notificationEventId, EVENT_TYPE, values.notificationPayload, EVENT_SCHEMA,
      bindings.capturedNow, values.dedupeKey, bindings.capturedNow, bindings.capturedNow,
      item.licenseId, nextLifecycleGeneration, item.operationId, item.userId, item.fanmarkId,
    ),
    database.prepare(`
      INSERT INTO notification_events
        (id, event_type, event_version, source, payload, payload_schema, trigger_at,
         dedupe_key, status, retry_count, created_at, updated_at)
      SELECT json_extract(effect.value, '$.id'), json_extract(effect.value, '$.eventType'),
        1, 'cron_job', json_extract(effect.value, '$.payload'), NULL,
        json_extract(effect.value, '$.triggerAt'), NULL, 'pending', 0,
        json_extract(effect.value, '$.createdAt'), json_extract(effect.value, '$.updatedAt')
      FROM json_each(?) AS effect
      WHERE EXISTS (SELECT 1 FROM fanmark_licenses AS l WHERE l.id = ?
        AND l.status = 'expired' AND l.lifecycle_generation = ? AND l.lifecycle_claim_id = ?)
    `).bind(effects.lotteryEventsJson, item.licenseId, nextLifecycleGeneration, item.operationId),
    database.prepare(`
      UPDATE license_grace_finalization_items SET outcome = 'processed', completed_at = ?
      WHERE run_id = ? AND license_id = ? AND operation_id = ? AND audit_id = ?
        AND notification_event_id = ? AND license_incarnation = ?
        AND license_lifecycle_generation = ? AND access_generation = ?
        AND lottery_seed = ? AND lottery_inputs_json = ? AND lottery_plan_json = ?
        AND outcome = 'pending' AND EXISTS (SELECT 1 FROM fanmark_licenses AS l
          WHERE l.id = license_grace_finalization_items.license_id AND l.status = 'expired'
            AND l.lifecycle_generation = ? AND l.lifecycle_claim_id = ?)
    `).bind(
      bindings.capturedNow, bindings.runId, item.licenseId, item.operationId, item.auditId,
      item.notificationEventId, item.licenseIncarnation, item.licenseLifecycleGeneration,
      item.accessGeneration, item.lotterySeed, item.lotteryInputsJson, item.lotteryPlanJson,
      nextLifecycleGeneration, item.operationId,
    ),
    database.prepare(`
      INSERT INTO license_expiry_effect_guards (operation_id, allowed)
      SELECT ?, CASE WHEN
        EXISTS (SELECT 1 FROM fanmark_licenses AS l JOIN fanmark_access_versions AS access
          ON access.license_id = l.id AND access.license_incarnation = ?
            AND access.access_generation = ? AND access.updated_at = ?
          WHERE l.id = ? AND l.fanmark_id = ? AND l.user_id IS ? AND l.status = 'expired'
            AND l.excluded_at = ? AND l.grace_expires_at = ? AND l.is_returned = ?
            AND l.lifecycle_generation = ? AND l.lifecycle_claim_id = ?)
        AND NOT EXISTS (SELECT 1 FROM fanmark_lottery_entries
          WHERE license_id = ? AND entry_status = 'pending')
        AND (SELECT COUNT(*) FROM json_each(?) AS expected) = ?
        AND NOT EXISTS (SELECT 1 FROM json_each(?) AS expected
          LEFT JOIN fanmark_lottery_entries AS entry
            ON entry.id = json_extract(expected.value, '$.entryId')
              AND entry.license_id = ?
          WHERE entry.id IS NULL
            OR entry.entry_status IS NOT json_extract(expected.value, '$.entryStatus')
            OR entry.lottery_executed_at IS NOT ?)
        AND EXISTS (SELECT 1 FROM fanmark_lottery_history AS history
          WHERE history.id = ? AND history.fanmark_id = ? AND history.license_id = ?
            AND history.total_entries = ? AND history.winner_user_id IS ?
            AND history.winner_entry_id IS ? AND history.probability_distribution = ?
            AND history.random_seed = ? AND history.executed_at = ?
            AND history.execution_method = 'automatic' AND history.created_at = ?)
        AND EXISTS (SELECT 1 FROM audit_logs AS audit WHERE audit.id = ? AND audit.user_id IS ?
          AND audit.action = ? AND audit.resource_type = 'fanmark_license'
          AND audit.resource_id = ? AND audit.request_id = ? AND audit.metadata = ?
          AND audit.created_at = ?)
        AND EXISTS (SELECT 1 FROM notification_events AS expired WHERE expired.id = ?
          AND expired.event_type = ? AND expired.event_version = 1 AND expired.source = 'cron_job'
          AND expired.payload = ? AND expired.payload_schema = ? AND expired.trigger_at = ?
          AND expired.dedupe_key = ? AND expired.status = 'pending' AND expired.retry_count = 0
          AND expired.created_at = ? AND expired.updated_at = ?)
        AND (SELECT COUNT(*) FROM notification_events AS event
          JOIN json_each(?) AS expected ON event.id = json_extract(expected.value, '$.id')) = ?
        AND EXISTS (SELECT 1 FROM license_grace_finalization_items AS item
          WHERE item.run_id = ? AND item.license_id = ? AND item.operation_id = ?
            AND item.outcome = 'processed' AND item.completed_at = ?)
        AND (SELECT (SELECT COUNT(*) FROM fanmark_basic_configs WHERE license_id = ?) +
          (SELECT COUNT(*) FROM fanmark_redirect_configs WHERE license_id = ?) +
          (SELECT COUNT(*) FROM fanmark_messageboard_configs WHERE license_id = ?) +
          (SELECT COUNT(*) FROM fanmark_password_configs WHERE license_id = ?)) = 0
        AND (? IS NULL OR (EXISTS (SELECT 1 FROM fanmark_licenses AS winner
            JOIN fanmark_license_incarnations AS registry ON registry.license_id = winner.id
            JOIN fanmark_access_versions AS new_access ON new_access.license_id = winner.id
              AND new_access.license_incarnation = registry.incarnation
              AND new_access.access_generation = 0 AND new_access.updated_at = ?
            WHERE winner.id = ? AND winner.fanmark_id = ? AND winner.user_id = ?
              AND winner.status = 'active' AND winner.license_start = ?
              AND winner.license_end = ? AND winner.display_fanmark IS ?
              AND winner.is_initial_license = 0 AND winner.is_returned = 0
              AND winner.is_transferred = 0 AND registry.incarnation = 0))
          AND (SELECT COUNT(*) FROM fanmark_licenses AS active
            WHERE active.user_id = ? AND active.status = 'active' AND active.is_returned = 0
              AND active.license_end > ?) <= ?)
      THEN 1 ELSE 0 END
      FROM fanmark_licenses AS source WHERE source.id = ?
        AND source.status = 'expired' AND source.lifecycle_generation = ?
        AND source.lifecycle_claim_id = ?
    `).bind(
      item.operationId,
      item.licenseIncarnation, nextAccessGeneration, bindings.capturedNow,
      item.licenseId, item.fanmarkId, item.userId, bindings.capturedNow,
      item.graceExpiresAt, item.isReturned, nextLifecycleGeneration, item.operationId,
      item.licenseId, effects.entryEffectsJson, input.entries.length,
      effects.entryEffectsJson, item.licenseId, bindings.capturedNow,
      effects.historyId, item.fanmarkId, item.licenseId, input.entries.length,
      winnerUserId, effects.winner?.entryId ?? null, effects.probabilityDistribution,
      item.lotterySeed, bindings.capturedNow, bindings.capturedNow,
      item.auditId, item.userId, ACTION, item.licenseId, item.operationId,
      values.auditMetadata, bindings.capturedNow,
      item.notificationEventId, EVENT_TYPE, values.notificationPayload, EVENT_SCHEMA,
      bindings.capturedNow, values.dedupeKey, bindings.capturedNow, bindings.capturedNow,
      effects.lotteryEventsJson, effects.lotteryEvents.length,
      bindings.runId, item.licenseId, item.operationId, bindings.capturedNow,
      item.licenseId, item.licenseId, item.licenseId, item.licenseId,
      effects.newLicenseId, bindings.capturedNow, effects.newLicenseId,
      item.fanmarkId, winnerUserId, bindings.capturedNow, effects.licenseEnd,
      item.fanmarkName, winnerUserId, bindings.capturedNow, winnerLimit,
      item.licenseId, nextLifecycleGeneration, item.operationId,
    ),
    database.prepare(`UPDATE fanmark_licenses SET lifecycle_claim_id = NULL
      WHERE id = ? AND status = 'expired' AND lifecycle_generation = ? AND lifecycle_claim_id = ?`)
      .bind(item.licenseId, nextLifecycleGeneration, item.operationId),
    database.prepare("DELETE FROM license_expiry_effect_guards WHERE operation_id = ?")
      .bind(item.operationId),
    database.prepare(`INSERT INTO license_expiry_effect_guards (operation_id, allowed)
      SELECT ?, 0 WHERE EXISTS (SELECT 1 FROM license_expiry_effect_guards WHERE operation_id = ?)`)
      .bind(item.operationId, item.operationId),
  ];
  return statements;
}

async function applyFinalization(database, item, bindings) {
  const statements = finalizationBatch(database, item, bindings);
  let result;
  try {
    result = assertBatch(await database.batch(statements), "grace_finalization_batch_failed");
  } catch (error) {
    if (await confirmCommitted(database, item, bindings)) {
      return { status: "processed", recovered: true, operationId: item.operationId };
    }
    if (error instanceof SourceGraceFinalizationError) throw error;
    throw fail("grace_finalization_batch_failed", error);
  }

  const changes = result.map(resultChanges);
  const expectedExact = changes[0] === 1 && changes[1] === 1 &&
    changes.slice(2, 6).every((value) => Number.isSafeInteger(value) && value >= 0) &&
    changes[6] === 1 && changes[7] === 1 && changes[8] === 1 &&
    changes[9] === 1 && changes[10] === 1 && changes[11] === 0 && changes[12] === 0;
  if (expectedExact) return { status: "processed", recovered: false, operationId: item.operationId };
  if (await confirmCommitted(database, item, bindings)) {
    return { status: "processed", recovered: true, operationId: item.operationId };
  }
  return { status: "conflict", operationId: item.operationId };
}

async function confirmLotteryCommitted(database, item, bindings, input, plan, effects) {
  try {
    const base = await confirmCommitted(database, item, bindings);
    if (!base) return false;
    const [history, entries, events] = await Promise.all([
      database.prepare(`SELECT id, fanmark_id, license_id, total_entries, winner_user_id,
          winner_entry_id, probability_distribution, random_seed, executed_at,
          execution_method, created_at FROM fanmark_lottery_history WHERE id = ?`)
        .bind(effects.historyId).first(),
      database.prepare(`SELECT entry.id, entry.user_id, entry.entry_status,
          entry.lottery_executed_at, entry.won_at
        FROM json_each(?) AS expected
        JOIN fanmark_lottery_entries AS entry
          ON entry.id = json_extract(expected.value, '$.entryId')
        WHERE entry.license_id = ? ORDER BY entry.id`)
        .bind(effects.entryEffectsJson, item.licenseId).all(),
      database.prepare(`SELECT event.id, event.event_type, event.event_version, event.source,
          event.payload, event.payload_schema, event.trigger_at, event.dedupe_key,
          event.status, event.retry_count, event.created_at, event.updated_at
        FROM json_each(?) AS expected
        JOIN notification_events AS event ON event.id = json_extract(expected.value, '$.id')
        ORDER BY event.id`)
        .bind(effects.lotteryEventsJson).all(),
    ]);
    if (history?.fanmark_id !== item.fanmarkId || history.license_id !== item.licenseId ||
        Number(history.total_entries) !== input.entries.length ||
        history.winner_user_id !== (effects.winner?.userId ?? null) ||
        history.winner_entry_id !== (effects.winner?.entryId ?? null) ||
        history.probability_distribution !== effects.probabilityDistribution ||
        history.random_seed !== item.lotterySeed || history.executed_at !== bindings.capturedNow ||
        history.execution_method !== "automatic" || history.created_at !== bindings.capturedNow ||
        !Array.isArray(entries?.results) || entries.results.length !== effects.entryEffects.length ||
        !Array.isArray(events?.results) || events.results.length !== effects.lotteryEvents.length) {
      return false;
    }
    const expectedEntries = new Map(effects.outcomes.map((outcome) => [outcome.entryId, outcome]));
    for (const row of entries.results) {
      const expected = expectedEntries.get(row.id);
      if (!expected || row.user_id !== expected.userId ||
          row.entry_status !== (expected.status === "won" ? "won" : "lost") ||
          row.lottery_executed_at !== bindings.capturedNow ||
          row.won_at !== (expected.status === "won" ? bindings.capturedNow : null)) return false;
    }
    const expectedEvents = new Map(effects.lotteryEvents.map((event) => [event.id, event]));
    for (const row of events.results) {
      const expected = expectedEvents.get(row.id);
      if (!expected || row.event_type !== expected.eventType || Number(row.event_version) !== 1 ||
          row.source !== "cron_job" || row.payload !== expected.payload ||
          row.payload_schema !== null || row.trigger_at !== expected.triggerAt ||
          row.dedupe_key !== null || row.status !== "pending" || Number(row.retry_count) !== 0 ||
          row.created_at !== expected.createdAt || row.updated_at !== expected.updatedAt) return false;
    }

    if (effects.winner) {
      const winnerLicense = await database.prepare(`SELECT l.id, l.fanmark_id, l.user_id,
          l.license_start, l.license_end, l.status, l.is_initial_license, l.display_fanmark,
          l.is_returned, l.is_transferred, registry.incarnation,
          access.license_incarnation, access.access_generation, access.updated_at
        FROM fanmark_licenses AS l
        JOIN fanmark_license_incarnations AS registry ON registry.license_id = l.id
        JOIN fanmark_access_versions AS access ON access.license_id = l.id
        WHERE l.id = ?`)
        .bind(effects.newLicenseId).first();
      const activeCount = await database.prepare(`SELECT COUNT(*) AS count
        FROM fanmark_licenses WHERE user_id = ? AND status = 'active'
          AND is_returned = 0 AND license_end > ?`)
        .bind(effects.winner.userId, bindings.capturedNow).first();
      if (winnerLicense?.id !== effects.newLicenseId || winnerLicense.fanmark_id !== item.fanmarkId ||
          winnerLicense.user_id !== effects.winner.userId || winnerLicense.license_start !== bindings.capturedNow ||
          winnerLicense.license_end !== effects.licenseEnd || winnerLicense.status !== "active" ||
          Number(winnerLicense.is_initial_license) !== 0 || winnerLicense.display_fanmark !== item.fanmarkName ||
          Number(winnerLicense.is_returned) !== 0 || Number(winnerLicense.is_transferred) !== 0 ||
          Number(winnerLicense.incarnation) !== 0 || Number(winnerLicense.license_incarnation) !== 0 ||
          Number(winnerLicense.access_generation) !== 0 || winnerLicense.updated_at !== bindings.capturedNow ||
          (effects.winner.capacity.limit !== null && Number(activeCount?.count) > effects.winner.capacity.limit)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function applyLotteryFinalization(database, item, bindings) {
  const input = parsedLotteryInputs(item, bindings);
  const plan = await validatedStoredLotteryPlan(item, bindings, input);
  if (!plan) throw fail("lottery_plan_write_failed");
  const effects = await buildLotteryEffects(item, bindings, input, plan.selection);
  const statements = lotteryFinalizationBatch(database, item, bindings, input, effects);
  try {
    assertBatch(await database.batch(statements), "grace_lottery_finalization_batch_failed");
  } catch (error) {
    if (await confirmLotteryCommitted(database, item, bindings, input, plan, effects)) {
      return { status: "processed", recovered: true, operationId: item.operationId };
    }
    if (error instanceof SourceGraceFinalizationError) throw error;
    throw fail("grace_lottery_finalization_batch_failed", error);
  }
  if (await confirmLotteryCommitted(database, item, bindings, input, plan, effects)) {
    return { status: "processed", recovered: false, operationId: item.operationId };
  }
  return { status: "conflict", operationId: item.operationId };
}

async function markConflict(database, bindings, item) {
  let result;
  try {
    result = await database.batch([
      database.prepare(`
        UPDATE license_grace_finalization_items SET outcome = 'conflict', completed_at = ?
        WHERE run_id = ? AND license_id = ? AND operation_id = ? AND outcome = 'pending'
      `).bind(bindings.capturedNow, bindings.runId, item.licenseId, item.operationId),
      database.prepare(`UPDATE fanmark_licenses SET lifecycle_claim_id = NULL
        WHERE id = ? AND status = 'grace' AND lifecycle_claim_id = ?
          AND EXISTS (SELECT 1 FROM license_grace_finalization_items AS item
            WHERE item.run_id = ? AND item.license_id = fanmark_licenses.id
              AND item.operation_id = ? AND item.outcome = 'conflict')`)
        .bind(item.licenseId, item.operationId, bindings.runId, item.operationId),
    ]);
  } catch (error) {
    throw fail("finalization_item_update_failed", error);
  }
  assertBatch(result, "finalization_item_update_failed");
  const current = await readItem(database, bindings.runId, item.licenseId);
  if (!current) throw fail("finalization_item_query_failed");
  return current.outcome;
}

async function updateRunProgress(database, runId, expectedCursor, nextCursor, counts) {
  let result;
  try {
    result = await database.prepare(`
      UPDATE license_grace_finalization_runs
      SET last_license_id = ?, candidate_count = candidate_count + ?,
          processed_count = processed_count + ?, conflict_count = conflict_count + ?
      WHERE run_id = ? AND status = 'running' AND last_license_id = ?
    `).bind(nextCursor, counts.candidates, counts.processed, counts.conflicts, runId, expectedCursor).run();
  } catch (error) {
    throw fail("finalization_run_progress_failed", error);
  }
  if (result?.success === false) throw fail("finalization_run_progress_failed");
  return resultChanges(result) === 1;
}

async function completeRun(database, runId, cursor) {
  let result;
  try {
    result = await database.prepare(`
      UPDATE license_grace_finalization_runs
      SET status = 'completed', completed_at = captured_now
      WHERE run_id = ? AND status = 'running' AND last_license_id = ?
        AND candidate_count = processed_count + conflict_count
        AND NOT EXISTS (SELECT 1 FROM license_grace_finalization_items
          WHERE run_id = ? AND outcome = 'pending')
    `).bind(runId, cursor, runId).run();
  } catch (error) {
    throw fail("finalization_run_completion_failed", error);
  }
  if (result?.success === false) throw fail("finalization_run_completion_failed");
  return resultChanges(result) === 1;
}

function summaryFromRun(run, results = [], pagesProcessed = 0) {
  return {
    runId: run.run_id,
    capturedNow: run.captured_now,
    candidateCount: Number(run.candidate_count),
    processed: Number(run.processed_count),
    conflicts: Number(run.conflict_count),
    pagesProcessed,
    status: run.status,
    results,
  };
}

/** Create a bounded, durable source-profile finalizer for expired grace rows. */
export function createSourceGraceFinalizationRepository({
  database,
  runId,
  targetIncarnation,
  schemaExtensionDigest,
  capturedNow,
  maxPages,
  uuidFactory = () => globalThis.crypto.randomUUID(),
}) {
  assertDatabase(database);
  const bindings = {
    runId: assertUuid(runId, "run_id"),
    targetIncarnation: assertToken(targetIncarnation, "target_incarnation"),
    schemaExtensionDigest: typeof schemaExtensionDigest === "string" && DIGEST_PATTERN.test(schemaExtensionDigest)
      ? schemaExtensionDigest
      : (() => { throw fail("invalid_schema_extension_digest"); })(),
    capturedNow: assertCanonicalUtcMicrosecond(capturedNow, "captured_now"),
  };
  if (typeof uuidFactory !== "function") throw fail("invalid_uuid_factory");
  if (maxPages !== undefined && (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100)) {
    throw fail("invalid_max_pages");
  }

  return {
    async prepareLotteryPlan(licenseIdValue) {
      const licenseId = assertUuid(licenseIdValue, "license_id");
      let item = await readItem(database, bindings.runId, licenseId);
      if (!item || item.outcome !== "pending") throw fail("lottery_journal_item_unavailable");

      let pending;
      try {
        pending = await database.prepare(`
          SELECT id FROM fanmark_lottery_entries
          WHERE license_id = ? AND entry_status = 'pending' LIMIT 1
        `).bind(licenseId).first();
      } catch (error) {
        throw fail("lottery_pending_lookup_failed", error);
      }
      if (!pending && !item.lotteryInputsJson && !item.lotteryPlanJson) {
        return { status: "no_pending_entries", runId: item.runId, licenseId };
      }

      await claimLotteryLicense(database, item, bindings);
      item = await readItem(database, bindings.runId, licenseId);
      if (!item || item.outcome !== "pending") throw fail("lottery_journal_item_unavailable");

      if (item.lotterySeed === null) {
        const seed = createLicenseLotterySeed();
        await storeLotteryJournalField(database, item, "lottery_seed", seed);
        item = await readItem(database, bindings.runId, licenseId);
        if (!item?.lotterySeed) throw fail("lottery_journal_seed_write_failed");
      }

      if (item.lotteryInputsJson === null) {
        const snapshot = await lotteryInputsFromD1(database, item, bindings);
        const snapshotJson = JSON.stringify(snapshot);
        if (
          jsonByteLength(snapshotJson) > MAX_LOTTERY_INPUT_BYTES ||
          jsonByteLength(snapshotJson) + jsonByteLength(item.lotteryPlanJson ?? "") > MAX_LOTTERY_JOURNAL_BYTES
        ) throw fail("lottery_inputs_too_large");
        await storeLotteryJournalField(database, item, "lottery_inputs_json", snapshotJson);
        item = await readItem(database, bindings.runId, licenseId);
        if (!item?.lotteryInputsJson) throw fail("lottery_inputs_write_failed");
      }

      const input = parsedLotteryInputs(item, bindings);
      let storedPlan = await validatedStoredLotteryPlan(item, bindings, input);
      if (!storedPlan) {
        let selection;
        try {
          selection = await selectLicenseLotteryOutcome({ entries: input.entries, seed: item.lotterySeed });
        } catch (error) {
          throw fail("lottery_selection_failed", error);
        }
        const plan = {
          schemaVersion: 1,
          runId: item.runId,
          licenseId: item.licenseId,
          capturedNow: bindings.capturedNow,
          seed: item.lotterySeed,
          inputSha256: await sha256Hex(item.lotteryInputsJson),
          selection: compactLotterySelection(selection),
        };
        const planJson = JSON.stringify(plan);
        if (
          jsonByteLength(planJson) > MAX_LOTTERY_INPUT_BYTES ||
          jsonByteLength(item.lotteryInputsJson) + jsonByteLength(planJson) > MAX_LOTTERY_JOURNAL_BYTES
        ) throw fail("lottery_plan_too_large");
        await storeLotteryJournalField(database, item, "lottery_plan_json", planJson);
        item = await readItem(database, bindings.runId, licenseId);
        if (!item?.lotteryPlanJson) throw fail("lottery_plan_write_failed");
        storedPlan = await validatedStoredLotteryPlan(item, bindings, parsedLotteryInputs(item, bindings));
      }
      if (!storedPlan) throw fail("lottery_plan_write_failed");
      return {
        status: "prepared",
        runId: item.runId,
        licenseId: item.licenseId,
        seed: item.lotterySeed,
        entryCount: input.entries.length,
        winnerEntryId: storedPlan.selection.winnerEntryId,
        outcomes: lotteryOutcomes(input, storedPlan.selection),
        plan: storedPlan,
      };
    },

    async runExpiredGraceFinalization() {
      let run = await ensureRun(database, bindings);
      if (run.status === "completed") return summaryFromRun(run);
      const samples = [];
      let pagesProcessed = 0;

      while (true) {
        run = await readRun(database, bindings.runId);
        if (!run || run.target_incarnation !== bindings.targetIncarnation ||
            run.schema_extension_digest !== bindings.schemaExtensionDigest ||
            run.captured_now !== bindings.capturedNow) throw fail("finalization_run_binding_mismatch");
        if (run.status === "completed") return summaryFromRun(run, samples, pagesProcessed);
        if (maxPages !== undefined && pagesProcessed >= maxPages) return summaryFromRun(run, samples, pagesProcessed);

        const cursor = String(run.last_license_id ?? "");
        let page = await readItemsPage(database, bindings.runId, cursor);
        if (page.length === 0) {
          const candidates = await readCandidatesPage(database, bindings.capturedNow, cursor);
          if (candidates.length === 0) {
            if (!await completeRun(database, bindings.runId, cursor)) {
              const current = await readRun(database, bindings.runId);
              if (!current) throw fail("finalization_run_query_failed");
              if (current.status === "completed" || current.last_license_id !== cursor) continue;
              const pending = await readItemsPage(database, bindings.runId, cursor);
              if (pending.length > 0) continue;
              const arrived = await readCandidatesPage(database, bindings.capturedNow, cursor);
              if (arrived.length > 0) continue;
              throw fail("finalization_run_reconciliation_failed");
            }
            const completed = await readRun(database, bindings.runId);
            if (!completed) throw fail("finalization_run_query_failed");
            return summaryFromRun(completed, samples, pagesProcessed);
          }
          await seedItems(database, bindings.runId, candidates, uuidFactory);
          page = await readItemsPage(database, bindings.runId, cursor);
          if (page.length === 0) throw fail("finalization_item_query_failed");
        }

        const pageResults = [];
        for (const item of page) {
          let outcome = item.outcome;
          let transition = null;
          if (outcome === "pending") {
            const lottery = await this.prepareLotteryPlan(item.licenseId);
            if (lottery.status === "prepared") {
              const currentItem = await readItem(database, bindings.runId, item.licenseId);
              if (!currentItem) throw fail("finalization_item_query_failed");
              transition = await applyLotteryFinalization(database, currentItem, bindings);
            } else if (lottery.status === "no_pending_entries") {
              transition = await applyFinalization(database, item, bindings);
            } else {
              throw fail("lottery_preparation_status_invalid");
            }
            if (transition.status === "conflict") outcome = await markConflict(database, bindings, item);
            else outcome = "processed";
          }
          pageResults.push({ ...item, outcome, transition });
        }

        const counts = {
          candidates: page.length,
          processed: pageResults.filter((item) => item.outcome === "processed").length,
          conflicts: pageResults.filter((item) => item.outcome === "conflict").length,
        };
        const nextCursor = page.at(-1).licenseId;
        if (!await updateRunProgress(database, bindings.runId, cursor, nextCursor, counts)) {
          const current = await readRun(database, bindings.runId);
          if (!current || current.last_license_id !== nextCursor) throw fail("finalization_run_progress_conflict");
        }
        samples.push(...pageResults.slice(0, SOURCE_GRACE_FINALIZATION_RESULT_LIMIT - samples.length));
        pagesProcessed += 1;
      }
    },
  };
}
