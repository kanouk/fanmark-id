/**
 * Source-shaped D1 credential artifact preparation.
 *
 * This module never writes a credential row. It binds a one-use source
 * projection to the exact D1 license incarnation/generation state, stores a
 * prepared bcrypt artifact, and returns only fields for the specialized row
 * writer. The canonical source value stays in a WeakMap and is never included
 * in an error, report, or SQL binding.
 */
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  CREDENTIAL_CODEC_COST,
  CREDENTIAL_CODEC_ID,
  CREDENTIAL_COLUMN,
  CREDENTIAL_NONCREDENTIAL_COLUMNS,
  CREDENTIAL_SOURCE_RELATION,
  CREDENTIAL_TRANSFORM_CONTRACT_VERSION,
  CREDENTIAL_POLICY_VERSION,
} from "./credential-descriptor.mjs";
import {
  compileCredentialImportProjection,
  consumeCredentialTransformInput,
} from "./credential-import-projection.mjs";
import {
  canonicalJson,
  getPrimaryKeyInfo,
  rowRecordForEnvelope,
  sha256Hex,
} from "./snapshot-format.mjs";

const requireFromWorker = createRequire(new URL("../../workers/api/package.json", import.meta.url));
const bcrypt = requireFromWorker("bcryptjs");
const HEX64_RE = /^[0-9a-f]{64}$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DEFAULT_LEASE_MS = 30_000;
const MAX_SAFE_SQL_INTEGER = Number.MAX_SAFE_INTEGER;
const reservationInputs = new WeakMap();

export class CredentialImportTransformError extends Error {
  constructor(code) {
    super(code);
    this.name = "CredentialImportTransformError";
    this.code = code;
  }
}

function fail(code) {
  throw new CredentialImportTransformError(code);
}

function exactDataRecord(value, keys) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const actual = Reflect.ownKeys(value);
    if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key))) return false;
    return keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
    });
  } catch {
    return false;
  }
}

function assertIdentity(value, code) {
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) fail(code);
}

function readNow(now) {
  let value;
  try {
    value = typeof now === "function" ? now() : Date.now();
  } catch {
    fail("credential_transform_clock_invalid");
  }
  const milliseconds = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) fail("credential_transform_clock_invalid");
  return milliseconds;
}

function isoTimestamp(milliseconds) {
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    fail("credential_transform_clock_invalid");
  }
}

function assertDatabase(database) {
  if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") {
    fail("credential_transform_database_invalid");
  }
}

async function queryRows(database, sql, bindings, code) {
  let result;
  try {
    result = await database.prepare(sql).bind(...bindings).all();
  } catch {
    fail(code);
  }
  if (!result || result.success === false || !Array.isArray(result.results)) fail(code);
  return result.results;
}

async function runBatch(database, sql, bindings, code) {
  let results;
  try {
    results = await database.batch([database.prepare(sql).bind(...bindings)]);
  } catch {
    fail(code);
  }
  if (!Array.isArray(results) || results.length !== 1 || results[0]?.success === false) fail(code);
  return results[0];
}

function validateProjection(projection, catalog, input) {
  const keys = [
    "table", "ordinal", "primaryKey", "rowHash", "sourceEnvelopeDigest",
    "sourceRowIdentityDigest", "columns", "bindings", "credentialDescriptorDigest", "transformInput",
  ];
  if (!exactDataRecord(projection, keys)) fail("credential_projection_shape_invalid");
  if (
    typeof input?.sourceEnvelopeBytes !== "string" ||
    input.sourceRelation !== CREDENTIAL_SOURCE_RELATION ||
    !Number.isSafeInteger(input.sourceOrdinal) ||
    input.sourceOrdinal < 0 ||
    !Array.isArray(input.sourcePrimaryKey) ||
    input.sourcePrimaryKey.length !== 1 ||
    !UUID_RE.test(input.sourcePrimaryKey[0]) ||
    !HEX64_RE.test(input.sourceEnvelopeDigest ?? "") ||
    !HEX64_RE.test(input.sourceRowIdentityDigest ?? "") ||
    !HEX64_RE.test(input.descriptorDigest ?? "")
  ) fail("credential_source_record_invalid");

  let envelope;
  let expectedProjection;
  try {
    envelope = JSON.parse(input.sourceEnvelopeBytes);
    if (canonicalJson(envelope) !== input.sourceEnvelopeBytes) fail("credential_source_record_invalid");
    const record = rowRecordForEnvelope(
      envelope,
      getPrimaryKeyInfo(catalog, CREDENTIAL_SOURCE_RELATION),
      input.sourceOrdinal,
    );
    if (
      canonicalJson(record.primaryKey) !== canonicalJson(input.sourcePrimaryKey) ||
      record.rowHash !== input.sourceEnvelopeDigest
    ) fail("credential_source_record_invalid");
    expectedProjection = compileCredentialImportProjection({
      catalog,
      descriptor: input.descriptor,
    })(canonicalJson(record));
    const expectedInput = consumeCredentialTransformInput(expectedProjection.transformInput);
    if (
      expectedInput.sourceRowIdentityDigest !== input.sourceRowIdentityDigest ||
      expectedInput.sourceEnvelopeDigest !== input.sourceEnvelopeDigest ||
      expectedInput.descriptorDigest !== input.descriptorDigest
    ) fail("credential_source_record_invalid");
  } catch {
    fail("credential_source_record_invalid");
  }
  const stripHandle = (value) => {
    const { transformInput: _ignored, ...publicFields } = value;
    return publicFields;
  };
  if (canonicalJson(stripHandle(projection)) !== canonicalJson(stripHandle(expectedProjection))) {
    fail("credential_projection_mismatch");
  }
  if (
    projection.table !== CREDENTIAL_SOURCE_RELATION ||
    canonicalJson(projection.columns) !== canonicalJson(CREDENTIAL_NONCREDENTIAL_COLUMNS) ||
    projection.credentialDescriptorDigest !== input.descriptorDigest
  ) fail("credential_projection_shape_invalid");
  return envelope;
}

async function readLicenseState(database, licenseId) {
  const rows = await queryRows(
    database,
    [
      'SELECT l."id", l."status", l."is_returned", l."lifecycle_generation",',
      'i."incarnation" AS "license_incarnation",',
      'v."license_incarnation" AS "version_license_incarnation",',
      'v."password_generation", v."access_generation"',
      'FROM "fanmark_licenses" AS l',
      'LEFT JOIN "fanmark_license_incarnations" AS i ON i."license_id" = l."id"',
      'LEFT JOIN "fanmark_access_versions" AS v ON v."license_id" = l."id"',
      'WHERE l."id" = ? LIMIT 2',
    ].join(" "),
    [licenseId],
    "credential_license_read_failed",
  );
  if (rows.length !== 1) fail("credential_license_missing_or_duplicate");
  const row = rows[0];
  if (
    row.license_incarnation == null ||
    row.version_license_incarnation == null ||
    row.password_generation == null ||
    row.access_generation == null ||
    row.lifecycle_generation == null
  ) fail("credential_license_runtime_state_invalid");
  const numbers = [
    row.license_incarnation,
    row.version_license_incarnation,
    row.password_generation,
    row.access_generation,
    row.lifecycle_generation,
  ].map(Number);
  if (
    numbers.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    numbers[0] !== numbers[1] ||
    row.status == null ||
    row.is_returned == null
  ) fail("credential_license_runtime_state_invalid");
  return {
    status: String(row.status),
    returned: Number(row.is_returned),
    licenseIncarnation: numbers[0],
    passwordGeneration: numbers[2],
    accessGeneration: numbers[3],
    lifecycleGeneration: numbers[4],
  };
}

function assertEligibleLicense(state) {
  if (state.status !== "active" || state.returned !== 0) fail("credential_row_deferred_inactive");
}

function assertLiveStateMatchesArtifact(state, binding, wasApplied) {
  assertEligibleLicense(state);
  const generationDelta = wasApplied ? 1 : 0;
  if (
    state.licenseIncarnation !== binding.licenseIncarnation ||
    state.passwordGeneration !== binding.expectedPasswordGeneration + generationDelta ||
    state.accessGeneration !== binding.expectedAccessGeneration + generationDelta ||
    state.lifecycleGeneration !== binding.expectedLifecycleGeneration
  ) fail("credential_artifact_target_changed");
}

function buildBinding({ projection, input, state, destinationId, targetIncarnation, sourceManifestDigest, targetProfileFingerprint }) {
  const [sourceId, licenseId, enabled] = projection.bindings;
  if (!UUID_RE.test(sourceId ?? "") || !UUID_RE.test(licenseId ?? "")) fail("credential_projection_identity_invalid");
  if (enabled !== 1) fail("credential_row_deferred_disabled");
  const binding = {
    targetProfileFingerprint,
    sourceManifestDigest,
    descriptorDigest: input.descriptorDigest,
    sourceRelation: CREDENTIAL_SOURCE_RELATION,
    sourcePrimaryKeyJson: JSON.stringify(projection.primaryKey),
    sourceRowIdentityDigest: projection.sourceRowIdentityDigest,
    sourceEnvelopeDigest: projection.sourceEnvelopeDigest,
    sourceRevision: String(projection.ordinal) + ":" + projection.rowHash,
    destinationRelation: CREDENTIAL_SOURCE_RELATION,
    destinationColumn: CREDENTIAL_COLUMN,
    destinationLicenseId: licenseId,
    targetIdentity: destinationId,
    targetIncarnation,
    licenseIncarnation: state.licenseIncarnation,
    enabled,
    codecId: CREDENTIAL_CODEC_ID,
    codecParametersVersion: 1,
    codecCost: CREDENTIAL_CODEC_COST,
    transformContractVersion: CREDENTIAL_TRANSFORM_CONTRACT_VERSION,
    policyVersion: CREDENTIAL_POLICY_VERSION,
    expectedPasswordGeneration: state.passwordGeneration,
    expectedAccessGeneration: state.accessGeneration,
    expectedLifecycleGeneration: state.lifecycleGeneration,
  };
  binding.sourceBindingDigest = sha256Hex(binding);
  binding.artifactKey = sha256Hex({ purpose: "fanmark-credential-import", sourceBindingDigest: binding.sourceBindingDigest });
  return binding;
}

function assertArtifactBinding(row, binding) {
  if (
    !row ||
    row.artifact_key !== binding.artifactKey ||
    row.source_binding_digest !== binding.sourceBindingDigest ||
    row.target_profile_fingerprint !== binding.targetProfileFingerprint ||
    row.source_manifest_digest !== binding.sourceManifestDigest ||
    row.descriptor_digest !== binding.descriptorDigest ||
    row.source_relation !== binding.sourceRelation ||
    row.source_primary_key_json !== binding.sourcePrimaryKeyJson ||
    row.source_row_identity_digest !== binding.sourceRowIdentityDigest ||
    row.source_envelope_digest !== binding.sourceEnvelopeDigest ||
    row.source_revision !== binding.sourceRevision ||
    row.destination_relation !== binding.destinationRelation ||
    row.destination_column !== binding.destinationColumn ||
    row.destination_license_id !== binding.destinationLicenseId ||
    row.target_identity !== binding.targetIdentity ||
    row.target_incarnation !== binding.targetIncarnation ||
    Number(row.license_incarnation) !== binding.licenseIncarnation ||
    Number(row.enabled) !== binding.enabled ||
    row.codec_id !== binding.codecId ||
    Number(row.codec_parameters_version) !== binding.codecParametersVersion ||
    Number(row.codec_cost) !== binding.codecCost ||
    Number(row.transform_contract_version) !== binding.transformContractVersion ||
    Number(row.policy_version) !== binding.policyVersion ||
    Number(row.expected_password_generation) !== binding.expectedPasswordGeneration ||
    Number(row.expected_access_generation) !== binding.expectedAccessGeneration ||
    Number(row.expected_lifecycle_generation) !== binding.expectedLifecycleGeneration
  ) fail("credential_import_binding_changed");
}

async function findArtifacts(database, binding) {
  return queryRows(
    database,
    [
      'SELECT * FROM "credential_transform_artifacts"',
      'WHERE "target_identity" = ? AND "target_incarnation" = ?',
      'AND "source_relation" = ? AND "source_row_identity_digest" = ? LIMIT 2',
    ].join(" "),
    [binding.targetIdentity, binding.targetIncarnation, binding.sourceRelation, binding.sourceRowIdentityDigest],
    "credential_artifact_read_failed",
  );
}

function makeReservation(row) {
  return Object.freeze({
    artifactId: row.artifact_id,
    artifactKey: row.artifact_key,
    sourceBindingDigest: row.source_binding_digest,
    state: row.state,
    targetIdentity: row.target_identity,
    targetIncarnation: row.target_incarnation,
    destinationLicenseId: row.destination_license_id,
    licenseIncarnation: Number(row.license_incarnation),
    fencingToken: Number(row.fencing_token),
    leaseId: row.lease_id ?? null,
    leaseExpiresAt: row.lease_expires_at == null ? null : Number(row.lease_expires_at),
  });
}

function makePreparedArtifact(row) {
  if (!row || !["prepared", "applied", "reconciled"].includes(row.state)) fail("credential_artifact_not_prepared");
  if (typeof row.destination_hash !== "string" || row.destination_hash.length === 0) fail("credential_artifact_hash_invalid");
  return Object.freeze({
    artifactId: row.artifact_id,
    state: row.state,
    descriptorDigest: row.descriptor_digest,
    sourceRowIdentityDigest: row.source_row_identity_digest,
    sourceEnvelopeDigest: row.source_envelope_digest,
    sourceRevision: row.source_revision,
    sourcePrimaryKeyJson: row.source_primary_key_json,
    destinationTransformDigest: row.destination_transform_digest,
    destinationRelation: row.destination_relation,
    destinationColumn: row.destination_column,
    destinationLicenseId: row.destination_license_id,
    enabled: Number(row.enabled),
    codecId: row.codec_id,
    codecCost: Number(row.codec_cost),
    destinationHash: row.destination_hash,
  });
}

async function reserveNew(database, binding, nowMs, leaseMs) {
  const artifactId = randomUUID();
  const leaseId = randomUUID();
  const sql = [
    'INSERT INTO "credential_transform_artifacts" (',
    '"artifact_id", "artifact_key", "source_binding_digest", "target_profile_fingerprint",',
    '"source_manifest_digest", "descriptor_digest", "source_relation", "source_primary_key_json",',
    '"source_row_identity_digest", "source_envelope_digest", "source_revision",',
    '"destination_relation", "destination_column", "destination_license_id",',
    '"target_identity", "target_incarnation", "license_incarnation", "enabled",',
    '"codec_id", "codec_parameters_version", "codec_cost", "transform_contract_version",',
    '"policy_version", "expected_password_generation", "expected_access_generation",',
    '"expected_lifecycle_generation", "state", "lease_id", "lease_expires_at", "fencing_token", "created_at"',
    ') VALUES (',
    '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,',
    '\'reserved\', ?, ?, 1, ?)',
  ].join(" ");
  const values = [
    artifactId, binding.artifactKey, binding.sourceBindingDigest, binding.targetProfileFingerprint,
    binding.sourceManifestDigest, binding.descriptorDigest, binding.sourceRelation, binding.sourcePrimaryKeyJson,
    binding.sourceRowIdentityDigest, binding.sourceEnvelopeDigest, binding.sourceRevision,
    binding.destinationRelation, binding.destinationColumn, binding.destinationLicenseId,
    binding.targetIdentity, binding.targetIncarnation, binding.licenseIncarnation, binding.enabled,
    binding.codecId, binding.codecParametersVersion, binding.codecCost, binding.transformContractVersion,
    binding.policyVersion, binding.expectedPasswordGeneration, binding.expectedAccessGeneration,
    binding.expectedLifecycleGeneration, leaseId, nowMs + leaseMs, isoTimestamp(nowMs),
  ];
  try {
    await runBatch(database, sql, values, "credential_artifact_reserve_failed");
  } catch {
    const raced = await findArtifacts(database, binding);
    if (raced.length === 1) {
      assertArtifactBinding(raced[0], binding);
      fail("credential_artifact_lease_busy");
    }
    fail("credential_artifact_reserve_failed");
  }
  const rows = await queryRows(
    database,
    'SELECT * FROM "credential_transform_artifacts" WHERE "artifact_id" = ? LIMIT 2',
    [artifactId],
    "credential_artifact_read_failed",
  );
  if (rows.length !== 1 || rows[0].state !== "reserved") fail("credential_artifact_reserve_failed");
  return rows[0];
}

async function reclaim(database, row, binding, nowMs, leaseMs) {
  const nextFence = Number(row.fencing_token) + 1;
  if (!Number.isSafeInteger(nextFence) || nextFence > MAX_SAFE_SQL_INTEGER) fail("credential_artifact_fence_exhausted");
  const nextLease = randomUUID();
  const sql = [
    'UPDATE "credential_transform_artifacts"',
    'SET "lease_id" = ?, "lease_expires_at" = ?, "fencing_token" = ?',
    'WHERE "artifact_id" = ? AND "fencing_token" = ?',
    'AND "state" IN (\'reserved\', \'prepared\')',
    'AND ("lease_expires_at" IS NULL OR "lease_expires_at" <= ?)',
  ].join(" ");
  await runBatch(
    database,
    sql,
    [nextLease, nowMs + leaseMs, nextFence, row.artifact_id, Number(row.fencing_token), nowMs],
    "credential_artifact_reclaim_failed",
  );
  const refreshed = await queryRows(
    database,
    'SELECT * FROM "credential_transform_artifacts" WHERE "artifact_id" = ? LIMIT 2',
    [row.artifact_id],
    "credential_artifact_read_failed",
  );
  if (
    refreshed.length !== 1 ||
    refreshed[0].lease_id !== nextLease ||
    Number(refreshed[0].fencing_token) !== nextFence
  ) fail("credential_artifact_stale_fence");
  assertArtifactBinding(refreshed[0], binding);
  return refreshed[0];
}

/**
 * Reserve/reclaim an artifact. The returned reservation object is an
 * in-memory continuation; only this exact object can reach the prepare step.
 */
export async function reserveCredentialImportArtifact({
  database,
  projection,
  catalog,
  destinationId,
  targetIncarnation,
  sourceManifestDigest,
  targetProfileFingerprint,
  now = () => new Date(),
  leaseMs = DEFAULT_LEASE_MS,
} = {}) {
  assertDatabase(database);
  const nowMs = readNow(now);
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 10 * 60_000) fail("credential_artifact_lease_invalid");
  assertIdentity(destinationId, "credential_artifact_target_invalid");
  assertIdentity(targetIncarnation, "credential_artifact_target_invalid");
  if (!HEX64_RE.test(sourceManifestDigest ?? "") || !HEX64_RE.test(targetProfileFingerprint ?? "")) {
    fail("credential_artifact_profile_invalid");
  }
  let input;
  try {
    input = consumeCredentialTransformInput(projection?.transformInput);
  } catch {
    fail("credential_transform_handle_invalid");
  }
  validateProjection(projection, catalog, input);
  if (input.descriptorDigest !== projection.credentialDescriptorDigest) fail("credential_descriptor_digest_mismatch");
  const licenseId = projection.bindings[1];
  if (projection.bindings[2] !== 1) fail("credential_row_deferred_disabled");
  const identity = {
    targetIdentity: destinationId,
    targetIncarnation,
    sourceRelation: CREDENTIAL_SOURCE_RELATION,
    sourceRowIdentityDigest: projection.sourceRowIdentityDigest,
  };
  const existing = await findArtifacts(database, identity);
  if (existing.length > 1) fail("credential_artifact_duplicate");
  let row;
  let binding;
  if (existing.length === 0) {
    const state = await readLicenseState(database, licenseId);
    assertEligibleLicense(state);
    binding = buildBinding({
      projection,
      input,
      state,
      destinationId,
      targetIncarnation,
      sourceManifestDigest,
      targetProfileFingerprint,
    });
    row = await reserveNew(database, binding, nowMs, leaseMs);
  } else {
    row = existing[0];
    binding = buildBinding({
      projection,
      input,
      state: {
        licenseIncarnation: Number(row.license_incarnation),
        passwordGeneration: Number(row.expected_password_generation),
        accessGeneration: Number(row.expected_access_generation),
        lifecycleGeneration: Number(row.expected_lifecycle_generation),
      },
      destinationId,
      targetIncarnation,
      sourceManifestDigest,
      targetProfileFingerprint,
    });
    assertArtifactBinding(row, binding);
    const state = await readLicenseState(database, licenseId);
    assertLiveStateMatchesArtifact(state, binding, ["applied", "reconciled"].includes(row.state));
    if (["applied", "reconciled"].includes(row.state)) return makeReservation(row);
    if (!["reserved", "prepared"].includes(row.state)) fail("credential_artifact_state_invalid");
    const expiresAt = row.lease_expires_at == null ? 0 : Number(row.lease_expires_at);
    if (row.lease_id && expiresAt > nowMs) fail("credential_artifact_lease_busy");
    row = await reclaim(database, row, binding, nowMs, leaseMs);
  }
  const reservation = makeReservation(row);
  if (row.state === "reserved") {
    const sourceEnvelope = JSON.parse(input.sourceEnvelopeBytes);
    const sourcePassword = sourceEnvelope?.values?.[input.descriptor.sourceColumn];
    if (typeof sourcePassword !== "string") fail("credential_source_value_invalid");
    reservationInputs.set(reservation, { sourcePassword, binding });
  }
  return reservation;
}

function negativeCandidate(password) {
  if (password.length === 0) return "!";
  return (password[0] === "!" ? "?" : "!") + password.slice(1);
}

async function verifyHash(password, hash) {
  try {
    if (!(await bcrypt.compare(password, hash)) || await bcrypt.compare(negativeCandidate(password), hash)) {
      fail("credential_transform_verification_failed");
    }
  } catch (error) {
    if (error instanceof CredentialImportTransformError) throw error;
    fail("credential_transform_verification_failed");
  }
}

function destinationDigest(binding, hash) {
  return sha256Hex({
    sourceBindingDigest: binding.sourceBindingDigest,
    targetIdentity: binding.targetIdentity,
    targetIncarnation: binding.targetIncarnation,
    destinationLicenseId: binding.destinationLicenseId,
    licenseIncarnation: binding.licenseIncarnation,
    enabled: binding.enabled,
    hashScheme: "bcrypt",
    codecId: binding.codecId,
    cost: binding.codecCost,
    destinationHash: hash,
  });
}

async function assertRuntimeBinding(database, reservation, binding) {
  const state = await readLicenseState(database, binding.destinationLicenseId);
  assertLiveStateMatchesArtifact(state, binding, false);
  if (
    reservation.targetIdentity !== binding.targetIdentity ||
    reservation.targetIncarnation !== binding.targetIncarnation
  ) fail("credential_artifact_target_changed");
}

/**
 * Hash and persist a prepared artifact. Re-entry after ACK-unknown reads and
 * reuses a committed hash instead of hashing the source value again.
 */
export async function prepareCredentialImportArtifact({
  database,
  reservation,
  now = () => new Date(),
  onHash,
} = {}) {
  assertDatabase(database);
  if (!exactDataRecord(reservation, [
    "artifactId", "artifactKey", "sourceBindingDigest", "state", "targetIdentity",
    "targetIncarnation", "destinationLicenseId", "licenseIncarnation",
    "fencingToken", "leaseId", "leaseExpiresAt",
  ])) fail("credential_artifact_reservation_invalid");
  const nowMs = readNow(now);
  const rows = await queryRows(
    database,
    'SELECT * FROM "credential_transform_artifacts" WHERE "artifact_id" = ? LIMIT 2',
    [reservation.artifactId],
    "credential_artifact_read_failed",
  );
  if (rows.length !== 1) fail("credential_artifact_missing");
  const row = rows[0];
  if (
    row.artifact_key !== reservation.artifactKey ||
    row.source_binding_digest !== reservation.sourceBindingDigest ||
    row.target_identity !== reservation.targetIdentity ||
    row.target_incarnation !== reservation.targetIncarnation ||
    Number(row.license_incarnation) !== reservation.licenseIncarnation
  ) fail("credential_import_binding_changed");
  if (["prepared", "applied", "reconciled"].includes(row.state)) {
    reservationInputs.delete(reservation);
    return makePreparedArtifact(row);
  }
  if (row.state !== "reserved") fail("credential_artifact_state_invalid");
  const privateInput = reservationInputs.get(reservation);
  if (!privateInput) fail("credential_transform_handle_invalid");
  const { binding, sourcePassword } = privateInput;
  assertArtifactBinding(row, binding);
  if (
    row.lease_id !== reservation.leaseId ||
    Number(row.fencing_token) !== reservation.fencingToken ||
    row.lease_expires_at == null ||
    Number(row.lease_expires_at) <= nowMs
  ) fail("credential_artifact_stale_fence");
  await assertRuntimeBinding(database, reservation, binding);

  if (Buffer.byteLength(sourcePassword, "utf8") > 72) {
    reservationInputs.delete(reservation);
    await runBatch(
      database,
      [
        'UPDATE "credential_transform_artifacts"',
        'SET "state" = \'rejected\', "failure_code" = ?, "lease_id" = NULL, "lease_expires_at" = NULL',
        'WHERE "artifact_id" = ? AND "state" = \'reserved\'',
        'AND "lease_id" = ? AND "fencing_token" = ? AND "lease_expires_at" > ?',
      ].join(" "),
      ["credential_input_too_long", row.artifact_id, reservation.leaseId, reservation.fencingToken, nowMs],
      "credential_artifact_reject_failed",
    );
    fail("credential_input_too_long");
  }
  if (typeof onHash === "function") {
    try {
      onHash();
    } catch {
      fail("credential_transform_failed");
    }
  }
  let hash;
  try {
    hash = await bcrypt.hash(sourcePassword, CREDENTIAL_CODEC_COST);
  } catch {
    fail("credential_transform_failed");
  }
  await verifyHash(sourcePassword, hash);
  const transformDigest = destinationDigest(binding, hash);
  const preparedAt = readNow(now);
  const sql = [
    'UPDATE "credential_transform_artifacts"',
    'SET "destination_hash" = ?, "destination_transform_digest" = ?,',
    '"state" = \'prepared\', "prepared_at" = ?',
    'WHERE "artifact_id" = ? AND "state" = \'reserved\'',
    'AND "lease_id" = ? AND "fencing_token" = ? AND "lease_expires_at" > ?',
    'AND EXISTS (',
    'SELECT 1 FROM "fanmark_licenses" AS l',
    'JOIN "fanmark_license_incarnations" AS i ON i."license_id" = l."id"',
    'JOIN "fanmark_access_versions" AS v ON v."license_id" = l."id"',
    'WHERE l."id" = ? AND l."status" = \'active\' AND l."is_returned" = 0',
    'AND i."incarnation" = ? AND v."license_incarnation" = i."incarnation"',
    'AND v."password_generation" = ? AND v."access_generation" = ?',
    'AND l."lifecycle_generation" = ?)',
  ].join(" ");
  await runBatch(
    database,
    sql,
    [
      hash, transformDigest, isoTimestamp(preparedAt), row.artifact_id,
      reservation.leaseId, reservation.fencingToken, preparedAt,
      binding.destinationLicenseId, binding.licenseIncarnation,
      binding.expectedPasswordGeneration, binding.expectedAccessGeneration,
      binding.expectedLifecycleGeneration,
    ],
    "credential_artifact_prepare_failed",
  );
  const after = await queryRows(
    database,
    'SELECT * FROM "credential_transform_artifacts" WHERE "artifact_id" = ? LIMIT 2',
    [row.artifact_id],
    "credential_artifact_read_failed",
  );
  if (after.length !== 1) fail("credential_artifact_missing");
  if (after[0].state !== "prepared" || after[0].destination_transform_digest !== transformDigest) {
    fail("credential_artifact_stale_fence");
  }
  reservationInputs.delete(reservation);
  return makePreparedArtifact(after[0]);
}
