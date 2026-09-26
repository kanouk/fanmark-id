/**
 * Shared D1 mutation statement for the protected-access generation fence.
 * Callers include this statement in their own atomic batch and verify its
 * single-row effect before clearing their operation claim.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const UTC_MICROSECOND_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;
const MAX_SAFE_SQL_INTEGER = Number.MAX_SAFE_INTEGER;

function assertUuid(value, name) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new TypeError(`invalid_${name}`);
  }
  return value;
}

function assertGeneration(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= MAX_SAFE_SQL_INTEGER) {
    throw new TypeError("invalid_access_generation");
  }
  return value;
}

/**
 * Build (but do not execute) a single-row, incarnation-bound access-version
 * increment. It never writes password_generation or license-state generation.
 */
export function buildAccessGenerationAdvanceStatement(database, {
  licenseId,
  licenseIncarnation,
  expectedAccessGeneration,
  lifecycleClaimId,
  expectedLicenseLifecycleGeneration,
  expectedLicenseStatus = "grace",
  updatedAt,
}) {
  if (!database || typeof database.prepare !== "function") {
    throw new TypeError("database_unavailable");
  }
  assertUuid(licenseId, "license_id");
  assertUuid(lifecycleClaimId, "lifecycle_claim_id");
  assertGeneration(licenseIncarnation);
  assertGeneration(expectedAccessGeneration);
  if (
    !Number.isSafeInteger(expectedLicenseLifecycleGeneration) ||
    expectedLicenseLifecycleGeneration < 1 ||
    expectedLicenseLifecycleGeneration > MAX_SAFE_SQL_INTEGER
  ) {
    throw new TypeError("invalid_license_lifecycle_generation");
  }
  if (!["grace", "expired"].includes(expectedLicenseStatus)) {
    throw new TypeError("invalid_license_status");
  }
  if (typeof updatedAt !== "string" || !UTC_MICROSECOND_PATTERN.test(updatedAt)) {
    throw new TypeError("invalid_updated_at");
  }

  return database.prepare(`
    UPDATE fanmark_access_versions
    SET access_generation = access_generation + 1,
        updated_at = ?
    WHERE license_id = ?
      AND license_incarnation = ?
      AND access_generation = ?
      AND access_generation < ${MAX_SAFE_SQL_INTEGER}
      AND EXISTS (
        SELECT 1 FROM fanmark_license_incarnations AS incarnation
        WHERE incarnation.license_id = fanmark_access_versions.license_id
          AND incarnation.incarnation = ?
      )
      AND EXISTS (
        SELECT 1 FROM fanmark_licenses AS license
        WHERE license.id = fanmark_access_versions.license_id
          AND license.lifecycle_claim_id = ?
          AND license.lifecycle_generation = ?
          AND license.status = ?
      )
  `).bind(
    updatedAt,
    licenseId,
    licenseIncarnation,
    expectedAccessGeneration,
    licenseIncarnation,
    lifecycleClaimId,
    expectedLicenseLifecycleGeneration,
    expectedLicenseStatus,
  );
}
