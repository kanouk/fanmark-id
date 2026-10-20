/** Build the source-shaped six-column INSERT from a filtered projection and a prepared hash. */

import {
  CREDENTIAL_CODEC_COST,
  CREDENTIAL_CODEC_ID,
  CREDENTIAL_COLUMN,
  CREDENTIAL_NONCREDENTIAL_COLUMNS,
  CREDENTIAL_SOURCE_COLUMNS,
  CREDENTIAL_SOURCE_RELATION,
} from "./credential-descriptor.mjs";
import { sha256Hex } from "./snapshot-format.mjs";

const HEX64_RE = /^[0-9a-f]{64}$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BCRYPT_RE = /^\$2[ab]\$10\$[./A-Za-z0-9]{53}$/u;

export const CREDENTIAL_INSERT_SQL = `INSERT INTO "${CREDENTIAL_SOURCE_RELATION}" (${CREDENTIAL_SOURCE_COLUMNS.map((name) => `"${name}"`).join(", ")}) VALUES (${CREDENTIAL_SOURCE_COLUMNS.map(() => "?").join(", ")})`;

export class CredentialImportRowError extends Error {
  constructor(code) {
    super(code);
    this.name = "CredentialImportRowError";
    this.code = code;
  }
}

function fail(code) {
  throw new CredentialImportRowError(code);
}

function sameStringArray(value, expected) {
  return Array.isArray(value) && value.length === expected.length && value.every((entry, index) => entry === expected[index]);
}

function exactDataRecord(value, keys) {
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return false;
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

function validUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Reassemble a prepared credential hash with only the five ordinary projected
 * bindings. The opaque source handle is never consumed or inspected here.
 */
export function buildCredentialTargetInsert({ projection, preparedArtifact, descriptorDigest } = {}) {
  if (!projection || typeof projection !== "object" || Array.isArray(projection)) fail("credential_projection_invalid");
  if (!preparedArtifact || typeof preparedArtifact !== "object" || Array.isArray(preparedArtifact)) fail("credential_artifact_invalid");
  const projectionKeys = ["table", "ordinal", "primaryKey", "rowHash", "sourceEnvelopeDigest", "sourceRowIdentityDigest", "columns", "bindings", "credentialDescriptorDigest", "transformInput"];
  const artifactKeys = ["artifactId", "state", "descriptorDigest", "sourceRowIdentityDigest", "sourceEnvelopeDigest", "sourceRevision", "sourcePrimaryKeyJson", "destinationTransformDigest", "destinationRelation", "destinationColumn", "destinationLicenseId", "enabled", "codecId", "codecCost", "destinationHash"];
  if (!exactDataRecord(projection, projectionKeys)) fail("credential_projection_shape_invalid");
  if (!exactDataRecord(preparedArtifact, artifactKeys)) fail("credential_artifact_invalid");
  if (typeof descriptorDigest !== "string" || !HEX64_RE.test(descriptorDigest)) fail("credential_descriptor_digest_invalid");
  if (projection.table !== CREDENTIAL_SOURCE_RELATION || !sameStringArray(projection.columns, CREDENTIAL_NONCREDENTIAL_COLUMNS)) fail("credential_projection_shape_invalid");
  if (!Number.isSafeInteger(projection.ordinal) || projection.ordinal < 0) fail("credential_projection_identity_invalid");
  if (!Array.isArray(projection.bindings) || projection.bindings.length !== CREDENTIAL_NONCREDENTIAL_COLUMNS.length) fail("credential_projection_bindings_invalid");
  if (!Array.isArray(projection.primaryKey) || projection.primaryKey.length !== 1 || !validUuid(projection.primaryKey[0])) fail("credential_projection_identity_invalid");
  if (!HEX64_RE.test(projection.rowHash ?? "") || projection.sourceEnvelopeDigest !== projection.rowHash) fail("credential_source_digest_invalid");
  if (projection.credentialDescriptorDigest !== descriptorDigest) fail("credential_descriptor_digest_mismatch");
  if (preparedArtifact.sourceRevision !== `${projection.ordinal}:${projection.rowHash}`) fail("credential_artifact_source_mismatch");
  const sourceRowIdentityDigest = sha256Hex({
    sourceRelation: CREDENTIAL_SOURCE_RELATION,
    sourcePrimaryKey: projection.primaryKey,
  });
  if (projection.sourceRowIdentityDigest !== sourceRowIdentityDigest) fail("credential_source_identity_mismatch");

  const [id, licenseId, enabled, createdAt, updatedAt] = projection.bindings;
  if (!validUuid(id) || id !== projection.primaryKey[0] || !validUuid(licenseId)) fail("credential_projection_identity_invalid");
  if (![0, 1].includes(enabled)) fail(typeof enabled === "string" ? "raw_credential_binding" : "credential_projection_enabled_invalid");
  if (typeof createdAt !== "string" || typeof updatedAt !== "string") fail("credential_projection_timestamp_invalid");

  const artifact = preparedArtifact;
  if (artifact.state !== "prepared" || artifact.descriptorDigest !== descriptorDigest) fail("credential_artifact_not_prepared");
  if (!HEX64_RE.test(artifact.destinationTransformDigest ?? "")) fail("credential_artifact_digest_invalid");
  if (artifact.sourceRowIdentityDigest !== sourceRowIdentityDigest || artifact.sourceEnvelopeDigest !== projection.sourceEnvelopeDigest) fail("credential_artifact_source_mismatch");
  if (artifact.sourcePrimaryKeyJson !== JSON.stringify(projection.primaryKey)) fail("credential_artifact_source_mismatch");
  if (artifact.destinationRelation !== CREDENTIAL_SOURCE_RELATION || artifact.destinationColumn !== CREDENTIAL_COLUMN) fail("credential_artifact_destination_mismatch");
  if (artifact.destinationLicenseId !== licenseId || artifact.enabled !== enabled) fail("credential_artifact_source_mismatch");
  if (artifact.codecId !== CREDENTIAL_CODEC_ID || artifact.codecCost !== CREDENTIAL_CODEC_COST) fail("credential_artifact_codec_mismatch");
  if (typeof artifact.artifactId !== "string" || artifact.artifactId.length === 0) fail("credential_artifact_identity_invalid");
  if (typeof artifact.destinationHash !== "string" || !BCRYPT_RE.test(artifact.destinationHash)) fail("credential_artifact_hash_invalid");

  const bindings = [id, licenseId, artifact.destinationHash, enabled, createdAt, updatedAt];
  return Object.freeze({
    table: CREDENTIAL_SOURCE_RELATION,
    columns: CREDENTIAL_SOURCE_COLUMNS,
    bindings: Object.freeze(bindings),
    sql: CREDENTIAL_INSERT_SQL,
    artifactId: artifact.artifactId,
    sourceRowIdentityDigest,
    sourceEnvelopeDigest: projection.sourceEnvelopeDigest,
    destinationLicenseId: licenseId,
    descriptorDigest,
    destinationTransformDigest: artifact.destinationTransformDigest,
  });
}
