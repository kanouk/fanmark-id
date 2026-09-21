import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspect } from 'node:util';
import { canonicalJson, getPrimaryKeyInfo, rowRecordForEnvelope } from './snapshot-format.mjs';
import { compileRowConverter } from './row-conversion.mjs';
import { CREDENTIAL_CODEC_COST, CREDENTIAL_CODEC_ID, CREDENTIAL_SOURCE_COLUMNS } from './credential-descriptor.mjs';
import { compileCredentialImportProjection, consumeCredentialTransformInput } from './credential-import-projection.mjs';
function column(table_name, column_name, ordinal, postgres_type, not_null = true) {
  return {
    table_name,
    column_name,
    ordinal,
    postgres_type,
    type_schema: "pg_catalog",
    type_name: postgres_type,
    type_kind: "b",
    not_null,
    default_expression: null,
    identity: "",
    generated: "",
    collation: null,
  };
}

function constraint(table_name, name, kind, definition) {
  return {
    table_name,
    name,
    kind,
    definition,
    validated: true,
    deferrable: false,
    initially_deferred: false,
  };
}

function index(table_name, name, definition, unique = false, primary = false) {
  return { table_name, name, definition, valid: true, unique, primary };
}

function catalog() {
  return {
    observed_at: "2026-09-21T00:00:00Z",
    columns: [
      column("fanmark_password_configs", "id", 1, "uuid"),
      column("fanmark_password_configs", "license_id", 2, "uuid"),
      column("fanmark_password_configs", "access_password", 3, "text"),
      column("fanmark_password_configs", "is_enabled", 4, "boolean"),
      column("fanmark_password_configs", "created_at", 5, "timestamp with time zone"),
      column("fanmark_password_configs", "updated_at", 6, "timestamp with time zone"),
    ],
    constraints: [
      constraint("fanmark_password_configs", "fanmark_password_configs_pkey", "p", "PRIMARY KEY (id)"),
      constraint("fanmark_password_configs", "fanmark_password_configs_license_id_key", "u", "UNIQUE (license_id)"),
      constraint(
        "fanmark_password_configs",
        "fanmark_password_configs_license_id_fkey",
        "f",
        "FOREIGN KEY (license_id) REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE",
      ),
    ],
    indexes: [
      index("fanmark_password_configs", "fanmark_password_configs_pkey", "CREATE UNIQUE INDEX fanmark_password_configs_pkey ON public.fanmark_password_configs USING btree (id)", true, true),
      index("fanmark_password_configs", "fanmark_password_configs_license_id_key", "CREATE UNIQUE INDEX fanmark_password_configs_license_id_key ON public.fanmark_password_configs USING btree (license_id)", true),
    ],
    enums: [],
  };
}

function descriptor() {
  return {
    version: 1,
    sourceRelation: "fanmark_password_configs",
    sourceColumn: "access_password",
    sourcePrimaryKeyColumns: ["id"],
    enabledColumn: "is_enabled",
    licenseColumn: "license_id",
    destinationRelation: "fanmark_password_configs",
    destinationColumn: "access_password",
    transformKind: "credential_to_bcrypt",
    codecId: CREDENTIAL_CODEC_ID,
    codecCost: CREDENTIAL_CODEC_COST,
    transformContractVersion: 1,
    policyVersion: 1,
    inactiveLicensePolicy: "migration_gate",
  };
}


function envelope(secret = ' 秘密\n香水🔑  ') {
  return { schemaVersion: 1, table: 'fanmark_password_configs', columns: [...CREDENTIAL_SOURCE_COLUMNS], values: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    license_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    access_password: secret, is_enabled: 'true',
    created_at: '2026-09-21T00:00:00.123456Z', updated_at: '2026-09-21T00:00:00.654321Z',
  }, arrayMetadata: {} };
}
function record(input = envelope()) {
  return rowRecordForEnvelope(input, getPrimaryKeyInfo(catalog(), 'fanmark_password_configs'), 7);
}
function compile(c = catalog()) { return compileCredentialImportProjection({ catalog: c, descriptor: descriptor() }); }
function safeFailure(fn, secret) {
  assert.throws(fn, error => {
    assert.equal(error.name, 'CredentialImportProjectionError');
    assert.equal('cause' in error, false);
    assert.equal(inspect(error, { depth: null }).includes(secret), false);
    assert.equal(JSON.stringify(error).includes(secret), false);
    return true;
  });
}

test('source-shaped projection preserves ordinary values, source hash and exact private envelope', () => {
  const source = envelope();
  const r = record(source);
  const projected = compile()(canonicalJson(r));
  assert.deepEqual(projected.columns, ['id', 'license_id', 'is_enabled', 'created_at', 'updated_at']);
  const original = compileRowConverter(catalog(), 'fanmark_password_configs')(source);
  assert.deepEqual(projected.bindings, original.bindings.filter((_v, i) => i !== 2));
  assert.equal(original.bindings[2], source.values.access_password);
  assert.equal(projected.rowHash, r.rowHash);
  assert.deepEqual(projected.primaryKey, r.primaryKey);
  assert.equal(projected.ordinal, 7);
  assert.equal(JSON.stringify(projected).includes('秘密'), false);
  assert.equal(inspect(projected, { showHidden: true, depth: null }).includes('秘密'), false);
  assert.deepEqual(Reflect.ownKeys(projected.transformInput), []);
  const input = consumeCredentialTransformInput(projected.transformInput);
  assert.equal(input.sourceEnvelopeBytes, canonicalJson(source));
  assert.equal(input.sourceEnvelopeDigest, r.rowHash);
  assert.equal(input.descriptorDigest, projected.credentialDescriptorDigest);
  assert.throws(() => consumeCredentialTransformInput(projected.transformInput));
  assert.throws(() => { projected.bindings[0] = 'changed'; }, TypeError);
});

test('malformed records, hashes, keys, column order and invalid values fail without input in errors', () => {
  const project = compile();
  const secret = 'DO_NOT_LOG_SYNTHETIC_SECRET';
  safeFailure(() => project('{"secret":"' + secret), secret);
  safeFailure(() => project(' ' + canonicalJson(record(envelope(secret)))), secret);
  for (const mutate of [
    r => { r.rowHash = '0'.repeat(64); },
    r => { r.primaryKey = ['cccccccc-cccc-4ccc-8ccc-cccccccccccc']; },
    r => { r.ordinal = -1; },
    r => { r.recordVersion = 2; },
    r => { r.extra = secret; },
    r => { r.envelope.columns.reverse(); },
    r => { r.envelope.values.is_enabled = secret; },
    r => { r.envelope.values.access_password = null; },
    r => { r.envelope.values.created_at = secret; },
  ]) {
    const r = record(envelope(secret)); mutate(r);
    safeFailure(() => project(canonicalJson(r)), secret);
  }
  safeFailure(() => compileCredentialImportProjection({ catalog: catalog(), descriptor: { ...descriptor(), codecId: secret } }), secret);
});

test('compiled policy is immutable after caller mutation and disabled rows retain transform input', () => {
  const c = catalog(), d = descriptor();
  const project = compileCredentialImportProjection({ catalog: c, descriptor: d });
  c.columns.find(x => x.column_name === 'access_password').not_null = false;
  d.codecCost = 4;
  const source = envelope(); source.values.is_enabled = 'false';
  const p = project(canonicalJson(record(source)));
  assert.equal(p.bindings[2], 0);
  assert.equal(consumeCredentialTransformInput(p.transformInput).descriptor.codecCost, 10);
  source.values.access_password = null;
  safeFailure(() => project(canonicalJson(record(source))), 'null-secret-sentinel');
  assert.throws(() => { project.plan.ordinaryColumns.push('access_password'); }, TypeError);
});

test('opaque handles reject forged copies and cannot cross-contaminate or replay', () => {
  const project = compile();
  const a = project(canonicalJson(record(envelope('first-secret'))));
  const b = project(canonicalJson(record(envelope('second-secret'))));
  for (const fake of [{}, Object.create(null), { ...a.transformInput }, JSON.parse(JSON.stringify(a.transformInput)), null]) {
    assert.throws(() => consumeCredentialTransformInput(fake));
  }
  assert.equal(JSON.parse(consumeCredentialTransformInput(b.transformInput).sourceEnvelopeBytes).values.access_password, 'second-secret');
  assert.equal(JSON.parse(consumeCredentialTransformInput(a.transformInput).sourceEnvelopeBytes).values.access_password, 'first-secret');
  assert.throws(() => consumeCredentialTransformInput(a.transformInput));
  assert.throws(() => consumeCredentialTransformInput(b.transformInput));
});
