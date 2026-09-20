import bcrypt from "bcryptjs";

export const CODEC_ID = "bcryptjs@3.0.3";
export const BCRYPT_COST = 10;
export const TRANSFORM_CONTRACT_VERSION = 1;
export const POLICY_VERSION = 1;
export const DEFAULT_LEASE_MS = 5_000;

// This value is used only for disabled synthetic rows whose destination schema
// requires a non-null bcrypt column. It is never an enabled credential.
const DISABLED_BCRYPT_HASH =
  "$2b$10$EMIaSXLiF70qXWKgX4HYkuVEN64Td.KjBaV89Eef1aNvJCzvMe1qy";
const textEncoder = new TextEncoder();

export class CredentialTransformError extends Error {
  constructor(code) {
    super(code);
    this.name = "CredentialTransformError";
    this.code = code;
  }
}

function fail(code) {
  throw new CredentialTransformError(code);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function asBytes(value) {
  if (typeof value === "string") return textEncoder.encode(value);
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  fail("invalid_source_envelope");
}

function compareUtf8(left, right) {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
  }
  return leftBytes.length - rightBytes.length;
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sameBytes(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function sha256HexBytes(value) {
  const digest = await crypto.subtle.digest("SHA-256", asBytes(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256HexJson(value) {
  return sha256HexBytes(canonicalJson(value));
}

function readClock(testClock) {
  const now = typeof testClock === "function" ? testClock() : Date.now();
  if (!Number.isFinite(Number(now))) fail("invalid_clock");
  return Number(now);
}

// Production lease guards use SQLite's execution-time clock. A deterministic
// SQL parameter exists only for the local integration proof and is never a
// request-controlled value in a Worker.
function sqlClockExpression(testClock) {
  return typeof testClock === "function"
    ? "?"
    : "((julianday('now') - 2440587.5) * 86400000.0)";
}

function randomId() {
  return crypto.randomUUID();
}

function leaseId() {
  return randomId();
}

function parseSourceEnvelope(source) {
  const bytes = asBytes(source?.sourceEnvelopeBytes);
  let decoded;
  let envelope;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    envelope = JSON.parse(decoded);
  } catch {
    fail("invalid_source_envelope");
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    fail("invalid_source_envelope");
  }
  const canonicalBytes = textEncoder.encode(canonicalJson(envelope));
  if (!sameBytes(bytes, canonicalBytes)) fail("invalid_source_envelope");
  return envelope;
}

function validateSource(source) {
  if (!source || typeof source !== "object") fail("invalid_source");
  const required = [
    "targetIdentity",
    "targetIncarnation",
    "sourceManifestDigest",
    "sourceRelation",
    "sourcePrimaryKey",
    "sourceRevision",
    "destinationLicenseId",
    "licenseIncarnation",
  ];
  for (const key of required) {
    if (!isNonEmptyString(source[key]) && !Number.isInteger(source[key])) {
      fail("invalid_source");
    }
  }
  if (!isNonEmptyString(source.targetIncarnation)) fail("invalid_source");
  if (!Number.isInteger(source.licenseIncarnation) || source.licenseIncarnation < 1) {
    fail("invalid_source");
  }
  try {
    asBytes(source.sourceEnvelopeBytes);
  } catch {
    fail("invalid_source");
  }
  const envelope = parseSourceEnvelope(source);
  const mirroredKeys = [
    "targetIdentity",
    "targetIncarnation",
    "sourceManifestDigest",
    "sourceRelation",
    "sourcePrimaryKey",
    "sourceRevision",
    "destinationLicenseId",
    "licenseIncarnation",
  ];
  for (const key of mirroredKeys) {
    if (envelope[key] !== source[key]) fail("source_changed");
  }
  if (typeof envelope.enabled !== "boolean") fail("invalid_source_envelope");
  if (envelope.enabled) {
    if (typeof envelope.credentialInput !== "string" || !/^\d{4}$/.test(envelope.credentialInput)) {
      fail("invalid_input");
    }
  } else if (envelope.credentialInput !== null && envelope.credentialInput !== undefined) {
    fail("invalid_source_envelope");
  }
  return envelope;
}

async function bindingMetadata(source) {
  const envelope = validateSource(source);
  const sourceEnvelopeDigest = await sha256HexBytes(source.sourceEnvelopeBytes);
  const sourceIdentityDigest = await sha256HexJson({
    targetIdentity: source.targetIdentity,
    targetIncarnation: source.targetIncarnation,
    sourceRelation: source.sourceRelation,
    sourcePrimaryKey: source.sourcePrimaryKey,
    destinationLicenseId: source.destinationLicenseId,
  });
  const sourceBindingDigest = await sha256HexJson({
    destinationIdentity: source.targetIdentity,
    destinationIncarnation: source.targetIncarnation,
    sourceManifestDigest: source.sourceManifestDigest,
    sourceRelation: source.sourceRelation,
    sourcePrimaryKey: source.sourcePrimaryKey,
    sourceRevision: source.sourceRevision,
    sourceEnvelopeDigest,
    destinationLicenseId: source.destinationLicenseId,
    licenseIncarnation: source.licenseIncarnation,
    transformContractVersion: TRANSFORM_CONTRACT_VERSION,
    codecId: CODEC_ID,
    cost: BCRYPT_COST,
    policyVersion: POLICY_VERSION,
  });
  return {
    envelope,
    sourceEnvelopeDigest,
    sourceIdentityDigest,
    sourceBindingDigest,
  };
}

export async function deriveBinding(source) {
  const metadata = await bindingMetadata(source);
  return {
    sourceEnvelopeDigest: metadata.sourceEnvelopeDigest,
    sourceIdentityDigest: metadata.sourceIdentityDigest,
    sourceBindingDigest: metadata.sourceBindingDigest,
  };
}

function asRow(result) {
  return result || null;
}

async function first(db, sql, ...values) {
  try {
    return asRow(await db.prepare(sql).bind(...values).first());
  } catch {
    fail("database_unavailable");
  }
}

async function run(db, statement) {
  try {
    return await statement.run();
  } catch {
    fail("database_unavailable");
  }
}

async function batch(db, statements) {
  try {
    return await db.batch(statements);
  } catch (error) {
    if (error instanceof CredentialTransformError) throw error;
    fail("database_batch_failed");
  }
}

async function targetSnapshot(db, source) {
  const row = await first(
    db,
    `SELECT
       t.target_identity,
       t.target_incarnation,
       l.id AS license_id,
       l.status AS license_status,
       l.returned AS license_returned,
       COALESCE(i.incarnation, 0) AS license_incarnation,
       v.password_generation,
       v.lifecycle_generation
     FROM migration_targets t
     JOIN fanmark_licenses l ON l.id = ?
     LEFT JOIN fanmark_license_incarnations i ON i.license_id = l.id
     JOIN fanmark_access_versions v ON v.license_id = l.id
     WHERE t.target_identity = ?
     LIMIT 2`,
    source.destinationLicenseId,
    source.targetIdentity,
  );
  if (!row) fail("target_not_found");
  if (
    String(row.target_incarnation) !== source.targetIncarnation ||
    Number(row.license_incarnation) !== source.licenseIncarnation
  ) {
    fail("target_changed");
  }
  if (row.license_status !== "active" || Number(row.license_returned) !== 0) {
    fail("target_ineligible");
  }
  return row;
}

function safeArtifact(row) {
  if (!row) return null;
  return {
    artifactId: row.artifact_id,
    artifactKey: row.artifact_key,
    sourceBindingDigest: row.source_binding_digest,
    destinationTransformDigest: row.destination_transform_digest || null,
    state: row.state,
    targetIdentity: row.target_identity,
    targetIncarnation: String(row.target_incarnation),
    destinationLicenseId: row.destination_license_id,
    licenseIncarnation: Number(row.license_incarnation),
    fencingToken: Number(row.fencing_token),
  };
}

function handleFromRow(row) {
  const safe = safeArtifact(row);
  return {
    ...safe,
    leaseId: row.lease_id || null,
    leaseExpiresAt: row.lease_expires_at == null ? null : Number(row.lease_expires_at),
  };
}

async function artifactById(db, artifactId) {
  return first(db, "SELECT * FROM credential_transform_artifacts WHERE artifact_id = ?", artifactId);
}

async function artifactByIdentity(db, sourceIdentityDigest) {
  return first(
    db,
    "SELECT * FROM credential_transform_artifacts WHERE source_identity_digest = ?",
    sourceIdentityDigest,
  );
}

function assertBindingMatches(row, source, metadata) {
  if (!row) fail("artifact_missing");
  if (row.source_envelope_digest !== metadata.sourceEnvelopeDigest || row.source_revision !== source.sourceRevision) {
    fail("source_changed");
  }
  if (
    row.target_identity !== source.targetIdentity ||
    String(row.target_incarnation) !== source.targetIncarnation ||
    row.destination_license_id !== source.destinationLicenseId ||
    Number(row.license_incarnation) !== source.licenseIncarnation
  ) {
    fail("target_changed");
  }
}

function assertFence(row, handle, now) {
  if (
    !handle ||
    row.lease_id !== handle.leaseId ||
    Number(row.fencing_token) !== Number(handle.fencingToken) ||
    row.lease_expires_at == null ||
    Number(row.lease_expires_at) <= now
  ) {
    fail("stale_fence");
  }
}

async function makeArtifactKey(source, metadata) {
  return sha256HexJson({
    destinationIdentity: source.targetIdentity,
    targetIncarnation: source.targetIncarnation,
    sourceManifestDigest: source.sourceManifestDigest,
    sourceRelation: source.sourceRelation,
    sourcePrimaryKey: source.sourcePrimaryKey,
    sourceEnvelopeDigest: metadata.sourceEnvelopeDigest,
    destinationLicenseId: source.destinationLicenseId,
    licenseIncarnation: source.licenseIncarnation,
    transformContractVersion: TRANSFORM_CONTRACT_VERSION,
    codecId: CODEC_ID,
    policyVersion: POLICY_VERSION,
  });
}

export async function reserveArtifact({ db, source, testClock, leaseMs = DEFAULT_LEASE_MS, fault = null } = {}) {
  const currentNow = readClock(testClock);
  if (!Number.isFinite(Number(leaseMs)) || Number(leaseMs) <= 0) fail("invalid_lease");
  const metadata = await bindingMetadata(source);
  const artifactKey = await makeArtifactKey(source, metadata);
  const target = await targetSnapshot(db, source);
  const existing = await artifactByIdentity(db, metadata.sourceIdentityDigest);
  if (existing) {
    assertBindingMatches(existing, source, metadata);
    if (existing.artifact_key !== artifactKey) fail("source_changed");
    if (existing.state === "applied" || existing.state === "reconciled") return handleFromRow(existing);
    if (
      existing.lease_expires_at != null &&
      Number(existing.lease_expires_at) > currentNow &&
      existing.lease_id
    ) {
      fail("lease_busy");
    }
    const nextLease = leaseId();
    const nextFence = Number(existing.fencing_token) + 1;
    const leaseClockSql = sqlClockExpression(testClock);
    const reclaimValues = [
      nextLease,
      currentNow + Number(leaseMs),
      nextFence,
      existing.artifact_id,
    ];
    if (typeof testClock === "function") reclaimValues.push(currentNow);
    reclaimValues.push(nextFence);
    const updated = await run(
      db,
      db.prepare(
        `UPDATE credential_transform_artifacts
         SET lease_id = ?, lease_expires_at = ?, fencing_token = ?
         WHERE artifact_id = ?
           AND state IN ('reserved', 'prepared')
           AND (lease_expires_at IS NULL OR lease_expires_at <= ${leaseClockSql})
           AND fencing_token < ?`,
      ).bind(...reclaimValues),
    );
    if (Number(updated?.meta?.changes || 0) !== 1) fail("stale_fence");
    const claimed = await artifactById(db, existing.artifact_id);
    if (!claimed) fail("artifact_missing");
    if (fault === "crash-after-reserve") fail("simulated_crash");
    return handleFromRow(claimed);
  }

  const artifactId = randomId();
  const newLease = leaseId();
  try {
    await db.prepare(
      `INSERT INTO credential_transform_artifacts
         (artifact_id, artifact_key, source_identity_digest, source_binding_digest,
          source_manifest_digest, source_relation, source_primary_key, source_envelope_digest,
          source_revision, target_identity, target_incarnation, destination_license_id,
          license_incarnation, enabled, codec_id, codec_cost, policy_version, state,
          lease_id, lease_expires_at, fencing_token, expected_password_generation,
          expected_lifecycle_generation, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, 1, ?, ?, ?)`,
      ).bind(
        artifactId,
        artifactKey,
        metadata.sourceIdentityDigest,
        metadata.sourceBindingDigest,
        source.sourceManifestDigest,
        source.sourceRelation,
        source.sourcePrimaryKey,
        metadata.sourceEnvelopeDigest,
        source.sourceRevision,
        source.targetIdentity,
        source.targetIncarnation,
        source.destinationLicenseId,
        source.licenseIncarnation,
        metadata.envelope.enabled ? 1 : 0,
        CODEC_ID,
        BCRYPT_COST,
        POLICY_VERSION,
        newLease,
        currentNow + Number(leaseMs),
        Number(target.password_generation),
        Number(target.lifecycle_generation),
        currentNow,
      ).run();
  } catch {
    const raced = await artifactByIdentity(db, metadata.sourceIdentityDigest);
    if (!raced) fail("database_batch_failed");
    assertBindingMatches(raced, source, metadata);
    if (raced.artifact_key !== artifactKey) fail("source_changed");
    if (raced.state === "applied" || raced.state === "reconciled") return handleFromRow(raced);
    fail("lease_busy");
  }
  const created = await artifactById(db, artifactId);
  if (!created) fail("artifact_missing");
  if (fault === "crash-after-reserve") fail("simulated_crash");
  return handleFromRow(created);
}

async function destinationDigest(source, metadata, destinationHash) {
  return sha256HexJson({
    artifactBinding: metadata.sourceBindingDigest,
    targetIdentity: source.targetIdentity,
    targetIncarnation: source.targetIncarnation,
    destinationLicenseId: source.destinationLicenseId,
    licenseIncarnation: source.licenseIncarnation,
    enabled: metadata.envelope.enabled,
    hashScheme: "bcrypt",
    codecId: CODEC_ID,
    cost: BCRYPT_COST,
    destinationHash,
  });
}

function wrongInput(input) {
  return input === "9999" ? "0000" : "9999";
}

async function verifyCandidate(input, hash) {
  try {
    const [positive, negative] = await Promise.all([
      bcrypt.compare(input, hash),
      bcrypt.compare(wrongInput(input), hash),
    ]);
    if (!positive || negative) fail("transform_verify_failed");
  } catch (error) {
    if (error instanceof CredentialTransformError) throw error;
    fail("transform_verify_failed");
  }
}

export async function prepareArtifact({ db, source, handle, testClock, fault = null, onHash } = {}) {
  const startedAt = readClock(testClock);
  const metadata = await bindingMetadata(source);
  await targetSnapshot(db, source);
  const row = await artifactById(db, handle?.artifactId);
  assertBindingMatches(row, source, metadata);
  if (row.state === "prepared" || row.state === "applied" || row.state === "reconciled") {
    return handleFromRow(row);
  }
  if (row.state !== "reserved") fail("artifact_state");
  assertFence(row, handle, startedAt);

  let destinationHash = DISABLED_BCRYPT_HASH;
  if (metadata.envelope.enabled) {
    if (typeof onHash === "function") onHash();
    try {
      destinationHash = await bcrypt.hash(metadata.envelope.credentialInput, BCRYPT_COST);
    } catch {
      fail("transform_failed");
    }
    await verifyCandidate(metadata.envelope.credentialInput, destinationHash);
  }
  const transformDigest = await destinationDigest(source, metadata, destinationHash);
  if (fault === "after-hash-before-prepare") fail("simulated_crash");
  const preparedAt = readClock(testClock);
  const leaseClockSql = sqlClockExpression(testClock);
  const prepareValues = [
    destinationHash,
    transformDigest,
    preparedAt,
    row.artifact_id,
    handle.leaseId,
    handle.fencingToken,
  ];
  if (typeof testClock === "function") prepareValues.push(preparedAt);

  await batch(db, [
    db.prepare(
      `UPDATE credential_transform_artifacts
       SET destination_hash = ?, destination_transform_digest = ?, state = 'prepared',
           prepared_at = ?
       WHERE artifact_id = ? AND state = 'reserved'
         AND lease_id = ? AND fencing_token = ? AND lease_expires_at > ${leaseClockSql}
         AND EXISTS (
           SELECT 1
           FROM migration_targets t
           JOIN fanmark_licenses l ON l.id = credential_transform_artifacts.destination_license_id
           JOIN fanmark_access_versions v ON v.license_id = l.id
           LEFT JOIN fanmark_license_incarnations i ON i.license_id = l.id
           WHERE t.target_identity = credential_transform_artifacts.target_identity
             AND t.target_incarnation = credential_transform_artifacts.target_incarnation
             AND l.status = 'active' AND l.returned = 0
             AND COALESCE(i.incarnation, 0) = credential_transform_artifacts.license_incarnation
             AND v.password_generation = credential_transform_artifacts.expected_password_generation
             AND v.lifecycle_generation = credential_transform_artifacts.expected_lifecycle_generation
         )`,
    ).bind(...prepareValues),
  ]);
  const prepared = await artifactById(db, row.artifact_id);
  if (!prepared || prepared.state !== "prepared" || prepared.destination_transform_digest !== transformDigest) {
    fail("stale_fence");
  }
  return handleFromRow(prepared);
}

function applyGuardSql(testClock) {
  const leaseClockSql = sqlClockExpression(testClock);
  return `
    INSERT INTO credential_transform_apply_guards (request_id, allowed)
    SELECT ?, CASE WHEN EXISTS (
      SELECT 1
      FROM credential_transform_artifacts a
      JOIN migration_targets t ON t.target_identity = a.target_identity
      JOIN fanmark_licenses l ON l.id = a.destination_license_id
      JOIN fanmark_access_versions v ON v.license_id = l.id
      LEFT JOIN fanmark_license_incarnations i ON i.license_id = l.id
      LEFT JOIN fanmark_access_configs c ON c.license_id = l.id
      WHERE a.artifact_id = ?
        AND a.state = 'prepared'
        AND a.lease_id = ?
        AND a.fencing_token = ?
        AND a.lease_expires_at > ${leaseClockSql}
        AND t.target_incarnation = a.target_incarnation
        AND l.status = 'active'
        AND l.returned = 0
        AND COALESCE(i.incarnation, 0) = a.license_incarnation
        AND v.password_generation = a.expected_password_generation
        AND v.lifecycle_generation = a.expected_lifecycle_generation
        AND (c.license_id IS NULL OR (
          c.source_binding_digest = a.source_binding_digest
          AND c.destination_transform_digest = a.destination_transform_digest
        ))
    ) THEN 1 ELSE 0 END
  `;
}

export async function applyArtifact({ db, source, handle, testClock, fault = null } = {}) {
  const currentNow = readClock(testClock);
  const metadata = await bindingMetadata(source);
  await targetSnapshot(db, source);
  const row = await artifactById(db, handle?.artifactId);
  assertBindingMatches(row, source, metadata);
  if (row.state === "reconciled" || row.state === "applied") return handleFromRow(row);
  if (row.state !== "prepared") fail("artifact_state");
  assertFence(row, handle, currentNow);
  if (!isNonEmptyString(row.destination_hash)) fail("artifact_tampered");
  const expectedTransformDigest = await destinationDigest(source, metadata, row.destination_hash);
  if (expectedTransformDigest !== row.destination_transform_digest) fail("artifact_tampered");
  const requestId = randomId();
  const applyGuardValues = [requestId, row.artifact_id, handle.leaseId, handle.fencingToken];
  if (typeof testClock === "function") applyGuardValues.push(currentNow);
  const statements = [
    db.prepare(applyGuardSql(testClock)).bind(...applyGuardValues),
    db.prepare(
      `UPDATE fanmark_access_configs
       SET enabled = (SELECT enabled FROM credential_transform_artifacts WHERE artifact_id = ?),
           hash_scheme = 'bcrypt',
           password_hash = (SELECT destination_hash FROM credential_transform_artifacts WHERE artifact_id = ?),
           source_binding_digest = (SELECT source_binding_digest FROM credential_transform_artifacts WHERE artifact_id = ?),
           destination_transform_digest = (SELECT destination_transform_digest FROM credential_transform_artifacts WHERE artifact_id = ?)
       WHERE license_id = ?`,
    ).bind(row.artifact_id, row.artifact_id, row.artifact_id, row.artifact_id, row.destination_license_id),
    db.prepare(
      `INSERT INTO fanmark_access_configs
         (license_id, enabled, hash_scheme, password_hash, source_binding_digest, destination_transform_digest)
       SELECT destination_license_id, enabled, 'bcrypt', destination_hash,
              source_binding_digest, destination_transform_digest
       FROM credential_transform_artifacts
       WHERE artifact_id = ?
         AND NOT EXISTS (SELECT 1 FROM fanmark_access_configs WHERE license_id = ?)`,
    ).bind(row.artifact_id, row.destination_license_id),
    db.prepare(
      `UPDATE fanmark_access_versions
       SET password_generation = password_generation + 1,
           updated_at = ?
       WHERE license_id = ?
         AND password_generation = ?
         AND lifecycle_generation = ?`,
    ).bind(currentNow, row.destination_license_id, row.expected_password_generation, row.expected_lifecycle_generation),
    db.prepare(
      `UPDATE credential_transform_artifacts
       SET state = 'applied', applied_at = ?, lease_id = NULL, lease_expires_at = NULL
       WHERE artifact_id = ? AND state = 'prepared'
         AND fencing_token = ? AND destination_transform_digest = ?`,
    ).bind(currentNow, row.artifact_id, handle.fencingToken, row.destination_transform_digest),
  ];
  if (fault === "batch-abort") {
    statements.push(db.prepare("INSERT INTO credential_transform_faults (id, value) VALUES (?, 1)").bind(randomId()));
  }
  statements.push(db.prepare("DELETE FROM credential_transform_apply_guards WHERE request_id = ?").bind(requestId));
  await batch(db, statements);
  if (fault === "ack-unknown") fail("ack_unknown");
  const applied = await artifactById(db, row.artifact_id);
  if (!applied || applied.state !== "applied") fail("apply_not_committed");
  return handleFromRow(applied);
}

export async function reconcileArtifact({ db, source, artifactId, testClock, testBeforeFinalize } = {}) {
  const metadata = await bindingMetadata(source);
  const row = await artifactById(db, artifactId);
  assertBindingMatches(row, source, metadata);
  if (row.state === "reserved" || row.state === "prepared") return safeArtifact(row);
  const target = await first(
    db,
    `SELECT
       a.state,
       a.enabled AS artifact_enabled,
       a.source_binding_digest AS artifact_binding_digest,
       a.destination_hash,
       a.destination_transform_digest AS artifact_transform_digest,
       a.target_identity,
       a.target_incarnation,
       a.expected_password_generation,
       a.expected_lifecycle_generation,
       a.destination_license_id,
       a.license_incarnation,
       t.target_identity AS current_target_identity,
       t.target_incarnation AS current_target_incarnation,
       c.enabled,
       c.hash_scheme,
       c.password_hash,
       c.source_binding_digest,
       c.destination_transform_digest AS config_transform_digest,
       l.status AS license_status,
       l.returned AS license_returned,
       COALESCE(i.incarnation, 0) AS current_incarnation,
       v.password_generation,
       v.lifecycle_generation
     FROM credential_transform_artifacts a
     JOIN migration_targets t ON t.target_identity = a.target_identity
     JOIN fanmark_licenses l ON l.id = a.destination_license_id
     JOIN fanmark_access_versions v ON v.license_id = l.id
     LEFT JOIN fanmark_license_incarnations i ON i.license_id = l.id
     JOIN fanmark_access_configs c ON c.license_id = l.id
     WHERE a.artifact_id = ?
       AND t.target_incarnation = a.target_incarnation`,
    artifactId,
  );
  if (!target || target.state !== "applied" && target.state !== "reconciled") fail("reconcile_mismatch");
  if (!isNonEmptyString(target.destination_hash)) fail("reconcile_mismatch");
  const expectedTransformDigest = await destinationDigest(source, metadata, target.destination_hash);
  if (
    target.current_target_identity !== row.target_identity ||
    String(target.current_target_incarnation) !== String(row.target_incarnation) ||
    Number(target.artifact_enabled) !== Number(row.enabled) ||
    Number(target.enabled) !== Number(row.enabled) ||
    target.hash_scheme !== "bcrypt" ||
    target.password_hash !== target.destination_hash ||
    target.artifact_binding_digest !== row.source_binding_digest ||
    target.source_binding_digest !== row.source_binding_digest ||
    target.artifact_transform_digest !== row.destination_transform_digest ||
    target.config_transform_digest !== row.destination_transform_digest ||
    target.config_transform_digest !== expectedTransformDigest ||
    target.artifact_transform_digest !== expectedTransformDigest ||
    target.license_status !== "active" ||
    Number(target.license_returned) !== 0 ||
    Number(target.current_incarnation) !== Number(row.license_incarnation) ||
    Number(target.password_generation) !== Number(row.expected_password_generation) + 1 ||
    Number(target.lifecycle_generation) !== Number(row.expected_lifecycle_generation)
  ) {
    fail("reconcile_mismatch");
  }
  if (row.state === "applied") {
    if (typeof testBeforeFinalize === "function") await testBeforeFinalize();
    const finalized = await run(
      db,
      db.prepare(
        `UPDATE credential_transform_artifacts AS a
         SET state = 'reconciled', reconciled_at = ?
         WHERE a.artifact_id = ?
           AND a.state = 'applied'
           AND a.source_binding_digest = ?
           AND a.destination_hash = ?
           AND a.destination_transform_digest = ?
           AND EXISTS (
             SELECT 1
             FROM migration_targets t
             JOIN fanmark_licenses l ON l.id = a.destination_license_id
             JOIN fanmark_access_versions v ON v.license_id = l.id
             LEFT JOIN fanmark_license_incarnations i ON i.license_id = l.id
             JOIN fanmark_access_configs c ON c.license_id = l.id
             WHERE t.target_identity = a.target_identity
               AND t.target_incarnation = a.target_incarnation
               AND l.status = 'active'
               AND l.returned = 0
               AND COALESCE(i.incarnation, 0) = a.license_incarnation
               AND v.password_generation = a.expected_password_generation + 1
               AND v.lifecycle_generation = a.expected_lifecycle_generation
               AND c.enabled = a.enabled
               AND c.hash_scheme = 'bcrypt'
               AND c.password_hash = a.destination_hash
               AND c.source_binding_digest = a.source_binding_digest
               AND c.destination_transform_digest = a.destination_transform_digest
               AND c.password_hash = ?
               AND c.destination_transform_digest = ?
           )`,
      ).bind(
        readClock(testClock),
        artifactId,
        row.source_binding_digest,
        row.destination_hash,
        row.destination_transform_digest,
        target.destination_hash,
        expectedTransformDigest,
      ),
    );
    if (Number(finalized?.meta?.changes || 0) !== 1) fail("reconcile_mismatch");
  }
  const reconciled = await artifactById(db, artifactId);
  if (!reconciled || reconciled.state !== "reconciled") fail("reconcile_mismatch");
  return safeArtifact(reconciled);
}

export async function transformCredential({ db, source, testClock, leaseMs = DEFAULT_LEASE_MS, fault = null, onHash } = {}) {
  const reservation = await reserveArtifact({ db, source, testClock, leaseMs, fault });
  if (reservation.state === "applied" || reservation.state === "reconciled") {
    return reconcileArtifact({ db, source, artifactId: reservation.artifactId, testClock });
  }
  const prepared = await prepareArtifact({ db, source, handle: reservation, testClock, fault, onHash });
  if (prepared.state === "applied" || prepared.state === "reconciled") {
    return reconcileArtifact({ db, source, artifactId: prepared.artifactId, testClock });
  }
  const applied = await applyArtifact({ db, source, handle: prepared, testClock, fault });
  return reconcileArtifact({ db, source, artifactId: applied.artifactId, testClock });
}
