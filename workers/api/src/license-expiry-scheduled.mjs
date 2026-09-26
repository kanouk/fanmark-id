import { createSourceLicenseExpiryRepository } from "./license-expiry-source.mjs";
import { createSourceGraceFinalizationRepository } from "./license-grace-finalization-source.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export class ScheduledLicenseExpiryError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "ScheduledLicenseExpiryError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code, cause) {
  throw new ScheduledLicenseExpiryError(code, cause);
}

function canonicalScheduledTime(scheduledTime) {
  if (!Number.isSafeInteger(scheduledTime) || scheduledTime < 0) fail("invalid_scheduled_time");
  let iso;
  try {
    iso = new Date(scheduledTime).toISOString();
  } catch (error) {
    fail("invalid_scheduled_time", error);
  }
  return iso.replace(/\.(\d{3})Z$/u, (_match, milliseconds) => `.${milliseconds}000Z`);
}

async function runIdForPhase(phase, targetIncarnation, capturedNow) {
  const input = new TextEncoder().encode(
    `fanmark-license-expiry:${phase}:v1:${targetIncarnation}:${capturedNow}`,
  );
  let digest;
  try {
    digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input)).slice(0, 16);
  } catch (error) {
    fail("run_id_unavailable", error);
  }
  digest[6] = (digest[6] & 0x0f) | 0x80;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function activeToGraceRunIdFor(targetIncarnation, capturedNow) {
  return runIdForPhase("active-to-grace", targetIncarnation, capturedNow);
}

async function graceFinalizationRunIdFor(targetIncarnation, capturedNow) {
  return runIdForPhase("grace-to-expired", targetIncarnation, capturedNow);
}

function parsePositiveInteger(value, code, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value.trim())) fail(code);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) fail(code);
  return number;
}

function assertDatabase(database) {
  if (
    !database || typeof database.prepare !== "function" || typeof database.batch !== "function"
  ) fail("business_database_unavailable");
}

async function readGracePeriodDays(database) {
  let row;
  try {
    row = await database.prepare(`
      SELECT setting_value
      FROM system_settings
      WHERE setting_key = 'grace_period_days'
      LIMIT 2
    `).all();
  } catch (error) {
    fail("grace_period_setting_unavailable", error);
  }
  if (row?.success === false || !Array.isArray(row?.results) || row.results.length !== 1) {
    fail("grace_period_setting_unavailable");
  }
  const settingValue = row.results[0]?.setting_value;
  if (typeof settingValue !== "string") fail("grace_period_setting_invalid");
  const days = Number.parseInt(settingValue, 10);
  if (!Number.isFinite(days) || days < 1) return 1;
  if (!Number.isSafeInteger(days)) fail("grace_period_setting_invalid");
  return days;
}

async function readOpenRun(database, bindings) {
  let result;
  try {
    result = await database.prepare(`
      SELECT run_id, target_incarnation, schema_extension_digest, captured_now, grace_period_days
      FROM license_expiry_runs
      WHERE status = 'running'
      ORDER BY captured_now ASC, run_id ASC
      LIMIT 2
    `).all();
  } catch (error) {
    fail("run_lookup_failed", error);
  }
  if (result?.success === false || !Array.isArray(result?.results)) fail("run_lookup_failed");
  if (result.results.length > 1) fail("multiple_open_runs");
  if (result.results.length === 0) return null;

  const run = result.results[0];
  if (
    typeof run.run_id !== "string" || !UUID_PATTERN.test(run.run_id) ||
    run.target_incarnation !== bindings.targetIncarnation ||
    run.schema_extension_digest !== bindings.schemaExtensionDigest ||
    typeof run.captured_now !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(run.captured_now) ||
    !Number.isSafeInteger(Number(run.grace_period_days)) || Number(run.grace_period_days) < 1
  ) fail("open_run_binding_mismatch");

  return {
    runId: run.run_id,
    capturedNow: run.captured_now,
    gracePeriodDays: Number(run.grace_period_days),
  };
}

async function readOpenGraceFinalizationRun(database, bindings) {
  let result;
  try {
    result = await database.prepare(`
      SELECT run_id, target_incarnation, schema_extension_digest, captured_now
      FROM license_grace_finalization_runs
      WHERE status = 'running'
      ORDER BY captured_now ASC, run_id ASC
      LIMIT 2
    `).all();
  } catch (error) {
    fail("finalization_run_lookup_failed", error);
  }
  if (result?.success === false || !Array.isArray(result?.results)) fail("finalization_run_lookup_failed");
  if (result.results.length > 1) fail("multiple_open_finalization_runs");
  if (result.results.length === 0) return null;

  const run = result.results[0];
  if (
    typeof run.run_id !== "string" || !UUID_PATTERN.test(run.run_id) ||
    run.target_incarnation !== bindings.targetIncarnation ||
    run.schema_extension_digest !== bindings.schemaExtensionDigest ||
    typeof run.captured_now !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(run.captured_now)
  ) fail("open_finalization_run_binding_mismatch");

  return { runId: run.run_id, capturedNow: run.captured_now };
}

/**
 * One bounded scheduled invocation of the source-shaped license lifecycle job.
 * The backend is opt-in and uses only trusted Worker configuration, never HTTP
 * input. A single running run is resumed on subsequent invocations.
 */
export async function runScheduledLicenseExpiry({
  scheduledTime,
  env,
  database,
  repositoryFactory = createSourceLicenseExpiryRepository,
  finalizationRepositoryFactory = createSourceGraceFinalizationRepository,
}) {
  const backend = env?.LICENSE_EXPIRY_BACKEND?.trim();
  if (!backend) return { status: "disabled" };
  if (backend !== "d1") fail("invalid_backend");
  if (env?.D1_TOPOLOGY?.trim() !== "split") fail("split_d1_required");
  assertDatabase(database);

  const targetIncarnation = env.LICENSE_EXPIRY_TARGET_INCARNATION?.trim();
  const schemaExtensionDigest = env.LICENSE_EXPIRY_SCHEMA_EXTENSION_DIGEST?.trim();
  if (!targetIncarnation || !TOKEN_PATTERN.test(targetIncarnation)) fail("target_incarnation_unavailable");
  if (!schemaExtensionDigest || !DIGEST_PATTERN.test(schemaExtensionDigest)) {
    fail("schema_extension_digest_unavailable");
  }

  const maxPages = parsePositiveInteger(env.LICENSE_EXPIRY_MAX_PAGES ?? "4", "invalid_max_pages", 100);
  const scheduledNow = canonicalScheduledTime(scheduledTime);
  const bindings = { targetIncarnation, schemaExtensionDigest };
  const openRun = await readOpenRun(database, bindings);
  const gracePeriodDays = openRun?.gracePeriodDays ?? await readGracePeriodDays(database);
  const capturedNow = openRun?.capturedNow ?? scheduledNow;
  const runId = openRun?.runId ?? await activeToGraceRunIdFor(targetIncarnation, scheduledNow);

  const repository = repositoryFactory({
    database,
    runId,
    targetIncarnation,
    schemaExtensionDigest,
    capturedNow,
    gracePeriodDays,
    maxPages,
  });
  let summary;
  try {
    summary = await repository.runActiveToGrace();
  } catch (error) {
    const repositoryCode = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
    if (/^[a-z0-9_]{1,80}$/u.test(repositoryCode)) fail(repositoryCode, error);
    fail("expiry_run_failed", error);
  }
  if (summary.status !== "completed") {
    return {
      ...summary,
      graceFinalization: { status: "deferred_active_to_grace_running" },
      pagesLimit: maxPages,
    };
  }

  const activePages = Number.isSafeInteger(summary.pagesProcessed) && summary.pagesProcessed > 0
    ? summary.pagesProcessed
    : 0;
  const finalizationPageLimit = Math.max(0, maxPages - activePages);
  if (finalizationPageLimit === 0) {
    return {
      ...summary,
      graceFinalization: { status: "deferred_page_budget" },
      pagesLimit: maxPages,
    };
  }

  const openFinalizationRun = await readOpenGraceFinalizationRun(database, bindings);
  const finalizationCapturedNow = openFinalizationRun?.capturedNow ?? capturedNow;
  const finalizationRunId = openFinalizationRun?.runId ??
    await graceFinalizationRunIdFor(targetIncarnation, finalizationCapturedNow);
  const finalizationRepository = finalizationRepositoryFactory({
    database,
    runId: finalizationRunId,
    targetIncarnation,
    schemaExtensionDigest,
    capturedNow: finalizationCapturedNow,
    maxPages: finalizationPageLimit,
  });
  let graceFinalization;
  try {
    graceFinalization = await finalizationRepository.runExpiredGraceFinalization();
  } catch (error) {
    const finalizationCode = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
    if (/^[a-z0-9_]{1,80}$/u.test(finalizationCode)) fail(finalizationCode, error);
    fail("grace_finalization_run_failed", error);
  }
  return { ...summary, graceFinalization, pagesLimit: maxPages };
}
