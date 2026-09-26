/** Pure, private snapshot-record projection. No SQL, hashing of passwords, or IO. */
import { compileCredentialDescriptor } from './credential-descriptor.mjs';
import { compileRowConverter } from './row-conversion.mjs';
import { canonicalJson, getPrimaryKeyInfo, rowRecordForEnvelope, sha256Hex } from './snapshot-format.mjs';

const transformInputs = new WeakMap();

export class CredentialImportProjectionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CredentialImportProjectionError';
    this.code = code;
  }
}

function fail(code) { throw new CredentialImportProjectionError(code); }
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Consume once, only inside the trusted credential transformer. The returned
 * value contains source bytes and MUST NOT be logged or written to a report.
 * Opaque handles resist accidental serialization; they are not a sandbox or
 * a promise of memory zeroization. The consumed string lives until GC.
 */
export function consumeCredentialTransformInput(handle) {
  if (!handle || typeof handle !== 'object' || !transformInputs.has(handle)) {
    fail('credential_transform_handle_invalid');
  }
  const input = transformInputs.get(handle);
  transformInputs.delete(handle);
  return input;
}

/**
 * Compile once from validated metadata. Input is one exact canonical snapshot
 * record string (without its NDJSON newline), as persisted by snapshot-export.
 * This verifies row-local identity only: the caller must first verify the
 * snapshot manifest, stream order/hash, revision and target binding.
 */
export function compileCredentialImportProjection(options = {}) {
  let mapping, converter, primaryKey;
  try {
    // Validate before cloning so hidden/accessor descriptor fields cannot be
    // silently removed by a serializer. Capture catalog to prevent later edits
    // changing the existing converter's captured column descriptors.
    mapping = compileCredentialDescriptor(options);
    const catalog = structuredClone(options.catalog);
    converter = compileRowConverter(catalog, mapping.source.relation, { credentialDescriptor: mapping.descriptor });
    primaryKey = getPrimaryKeyInfo(catalog, mapping.source.relation);
  } catch {
    // Never attach parser/converter causes: they can contain raw source text.
    fail('credential_projection_configuration_invalid');
  }
  const ordinaryIndexes = mapping.ordinarySourceColumns.map(name =>
    mapping.source.columns.findIndex(column => column.name === name));
  const plan = freeze({
    table: mapping.source.relation,
    sourceColumns: mapping.source.columns.map(column => column.name),
    ordinaryColumns: [...mapping.ordinarySourceColumns],
    credentialDescriptorDigest: mapping.descriptorDigest,
  });

  const project = (recordBytes) => {
    let record, converted, expected;
    try {
      if (typeof recordBytes !== 'string') fail('credential_source_record_invalid');
      record = JSON.parse(recordBytes);
      if (canonicalJson(record) !== recordBytes) fail('credential_source_record_invalid');
      converted = converter(record.envelope);
      expected = rowRecordForEnvelope(record.envelope, primaryKey, record.ordinal);
      if (canonicalJson(expected) !== recordBytes) fail('credential_source_record_invalid');
    } catch {
      fail('credential_source_record_invalid');
    }
    const handle = Object.freeze(Object.create(null));
    const sourceRowIdentityDigest = sha256Hex({
      sourceRelation: mapping.source.relation,
      sourcePrimaryKey: expected.primaryKey,
    });
    // Exact canonical envelope is embedded unchanged in the canonical record.
    // No target metadata is inserted into that envelope.
    const input = freeze({
      sourceEnvelopeBytes: canonicalJson(record.envelope),
      sourceRelation: mapping.source.relation,
      sourcePrimaryKey: [...expected.primaryKey],
      sourceOrdinal: expected.ordinal,
      sourceRowIdentityDigest,
      sourceEnvelopeDigest: expected.rowHash,
      descriptor: mapping.descriptor,
      descriptorDigest: mapping.descriptorDigest,
    });
    transformInputs.set(handle, input);
    return freeze({
      table: mapping.source.relation,
      ordinal: expected.ordinal,
      primaryKey: [...expected.primaryKey],
      rowHash: expected.rowHash,
      sourceEnvelopeDigest: expected.rowHash,
      sourceRowIdentityDigest,
      columns: [...mapping.ordinarySourceColumns],
      bindings: ordinaryIndexes.map(index => converted.bindings[index]),
      credentialDescriptorDigest: mapping.descriptorDigest,
      transformInput: handle,
    });
  };
  Object.defineProperty(project, 'plan', { value: plan, enumerable: true });
  return Object.freeze(project);
}
