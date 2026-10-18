import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Miniflare } from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import { projectMasterSnapshot, MASTER_SOURCE_TABLES } from './master-snapshot-projection.mjs';
import { canonicalJson, getPrimaryKeyInfo, rowRecordForEnvelope } from './snapshot-format.mjs';
import { createEmojiReleaseArtifacts } from '../build-emoji-release.ts';
import { businessMigrationStatements } from './business-runtime-import-schema.mjs';
import { stageReferenceMasterRelease, verifyStagedReferenceMasterRelease } from './reference-master-release.mjs';
import { CREDENTIAL_CODEC_COST, CREDENTIAL_CODEC_ID } from './credential-descriptor.mjs';

import { importMasterProjectionStage } from './master-import-stage.mjs';
import { verifyImportedMasterProjection } from './master-import-readback.mjs';
import { MASTER_RUNTIME_MIGRATIONS } from './master-runtime-schema.mjs';
import { isReadOnlyProductionSql } from './production-remote-d1.mjs';
import { stageVerifiedEmojiMasterRelease } from './emoji-master-release-stage-core.mjs';
const catalog = JSON.parse(await readFile(new URL('./fixtures/business-import-structure.json', import.meta.url)));
const time = '2026-10-19T00:00:00.123456Z';
const id = '00000000-0000-4000-8000-000000000001';
const emoji = { id, emoji: '🧪', short_name: 'test tube', keywords: ['science'], category: 'Objects', subcategory: 'science', codepoints: ['1F9EA'], sort_order: 1 };
const source = {
  emoji_master: { ...emoji, created_at: time, updated_at: time },
  fanmark_tiers: { id, tier_level: 1, emoji_count_min: 1, emoji_count_max: 2, monthly_price_usd: '9.99', initial_license_days: null, description: null, is_active: true, created_at: time, updated_at: time, display_name: 'Synthetic tier' },
  languages: { id, code: 'ja', label: 'Japanese', native_label: '日本語', is_active: true, sort_order: 1, created_at: time, updated_at: time },
  reserved_emoji_patterns: { id, pattern: '🧪', price_yen: 1200, description: null, is_active: false, created_at: time, updated_at: time },
  fanmark_tier_extension_prices: { id, tier_level: 1, months: 3, price_yen: 1200, is_active: true, created_at: time, updated_at: time, stripe_price_id: 'price_syntheticTest', stripe_price_id_live: null },
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function replaceRecords(table, records) {
  table.stream = Buffer.from(records.map(record => canonicalJson(record) + '\n').join(''));
  Object.assign(table.entry, { rowCount: String(records.length), byteCount: String(table.stream.length), streamHash: hash(table.stream) });
}
function fixture() {
  return { catalog: structuredClone(catalog), approvedEmojiIdentity: createEmojiReleaseArtifacts([emoji]).manifest.identitySHA256,
    credentialDescriptor: { version: 1, sourceRelation: 'fanmark_password_configs', sourceColumn: 'access_password',
      sourcePrimaryKeyColumns: ['id'], enabledColumn: 'is_enabled', licenseColumn: 'license_id',
      destinationRelation: 'fanmark_password_configs', destinationColumn: 'access_password', transformKind: 'credential_to_bcrypt',
      codecId: CREDENTIAL_CODEC_ID, codecCost: CREDENTIAL_CODEC_COST, transformContractVersion: 1, policyVersion: 1, inactiveLicensePolicy: 'migration_gate' },
    tables: MASTER_SOURCE_TABLES.map(table => {
      const columns = catalog.columns.filter(c => c.table_name === table).sort((a, b) => a.ordinal - b.ordinal);
      const values = {}, arrayMetadata = {};
      for (const column of columns) {
        const value = source[table][column.column_name];
        values[column.column_name] = value === null ? null : Array.isArray(value) ? JSON.stringify(value) : String(value);
        if (column.postgres_type.endsWith('[]')) arrayMetadata[column.column_name] = { isNull: false, ndims: 1, lowerBound: 1 };
      }
      const envelope = { schemaVersion: 1, table, columns: columns.map(c => c.column_name), values, arrayMetadata };
      const primary = getPrimaryKeyInfo(catalog, table);
      const result = { entry: { table, columns: envelope.columns, primaryKey: primary.columns.map(c => c.name) } };
      replaceRecords(result, [rowRecordForEnvelope(envelope, primary, 0)]);
      return result;
    }) };
}
function changeEnvelope(input, name, change) {
  const table = input.tables.find(t => t.entry.table === name);
  const record = JSON.parse(table.stream.toString());
  change(record.envelope);
  replaceRecords(table, [rowRecordForEnvelope(record.envelope, getPrimaryKeyInfo(input.catalog, name), 0)]);
}

const activationIds = { emoji: '11111111-1111-4111-8111-111111111111', reference: '22222222-2222-4222-8222-222222222222' };
async function nativeFixture(run, { seed = true } = {}) {
  const mf = new Miniflare({ workers: [{ config: { name: 'master-import-test', type: 'worker', compatibilityDate: '2026-09-18',
    env: { DB: { type: 'd1', name: 'master-import-test' } }, manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response(null)}}' } } } } }] });
  try {
    const db = await mf.getD1Database('DB');
    for (const name of MASTER_RUNTIME_MIGRATIONS) await db.batch(businessMigrationStatements(await readFile(new URL('../../workers/api/migrations/' + name, import.meta.url), 'utf8')).map(sql => db.prepare(sql)));
    const projection = projectMasterSnapshot(fixture());
    const readDatabase = { prepare(sql) { assert.equal(isReadOnlyProductionSql(sql), true); return db.prepare(sql); } };
    const options = { database: db, readDatabase, projection, activationIds };
    if (seed) await importMasterProjectionStage(options);
    await run(db, options);
  } finally { await mf.dispose(); }
}
test('initial native Master import compares source rows, both releases, activations and trigger audits', async () => nativeFixture(async (db, options) => {
  const report = await verifyImportedMasterProjection({ ...options, database: options.readDatabase });
  assert.deepEqual(report.totals, { emoji: 1, reference: 4 });
  assert.equal(report.productionReady, false);
  assert.equal(report.fullMigrationReconciled, false);
  assert.equal(report.consistency, 'unfenced-readback');
  assert.equal(report.initialChangeAuditShapeVerified, true);
  assert.doesNotMatch(JSON.stringify(report), /Synthetic|price_|science|11111111/);
  await assert.rejects(importMasterProjectionStage(options), /target_not_empty_or_invalid/);
  await assert.rejects(stageVerifiedEmojiMasterRelease({ database: db, artifact: options.projection.emojiArtifact, freshOnly: true }), /initial_import_target_not_empty/);
  await assert.rejects(stageReferenceMasterRelease({ database: db, snapshot: options.projection.referenceSnapshot, snapshotSha256: options.projection.referenceSnapshotSha256, freshOnly: true }), /initial_target_not_empty/);
}));
test('equal counts cannot hide source timestamps, amounts, audit metadata or release state changes', async () => nativeFixture(async (db, options) => {
  const read = () => verifyImportedMasterProjection({ ...options, database: options.readDatabase });
  for (const [table, column, value, error] of [
    ['fanmark_tier_release_rows', 'monthly_price_cents', 99900, /release_mismatch/],
    ['fanmark_emoji_master_release_staging', 'short_name', 'changed', /release_mismatch/],
    ['fanmark_emoji_master_change_audits', 'metadata', '{"emoji":"wrong","short_name":"wrong"}', /change_audit_mismatch/],
    ['fanmark_reference_master_releases', 'verified_at', '2026-01-01T00:00:00.000000Z', /release_mismatch/],
  ]) {
    const previous = await db.prepare(`SELECT "${column}" FROM "${table}"`).first(column);
    const triggers = (await db.prepare("SELECT name,sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?").bind(table).all()).results;
    const setValue = async value => {
      for (const trigger of triggers) await db.prepare(`DROP TRIGGER "${trigger.name}"`).run();
      await db.prepare(`UPDATE "${table}" SET "${column}" = ?`).bind(value).run();
      for (const trigger of triggers) await db.prepare(trigger.sql).run();
    };
    // Simulate a corrupted restore, reinstating the exact schema before readback.
    await setValue(value);
    await assert.rejects(read(), error);
    await setValue(previous);
  }
  await db.prepare('UPDATE emoji_master SET created_at = ?').bind('2026-01-01T00:00:00.000000Z').run();
  // Remove only the update audit in this disposable fixture: the original row
  // mismatch must still be detected when aggregate counts happen to match.
  await db.prepare("DELETE FROM fanmark_emoji_master_change_audits WHERE action = 'EMOJI_MASTER_UPDATE'").run();
  await assert.rejects(read(), /canonical_row_mismatch/);
}));
test('activation identity, unused Auth residue and schema drift are rejected', async () => nativeFixture(async (db, options) => {
  await assert.rejects(verifyImportedMasterProjection({ ...options, activationIds: { ...activationIds, emoji: '33333333-3333-4333-8333-333333333333' } }), /activation_mismatch/);
  await db.prepare('INSERT INTO verification (id,identifier,value,expiresAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').bind('v','SYNTHETIC','SECRET',time,time,time).run();
  await assert.rejects(verifyImportedMasterProjection(options), /table_count_mismatch/);
  await db.prepare('DELETE FROM verification').run();
  await db.prepare('DROP TRIGGER fanmark_emoji_master_change_audit_insert').run();
  await assert.rejects(verifyImportedMasterProjection(options), /schema_unconfirmed/);
}));
test('a schema failure happens before target writes', async () => nativeFixture(async (db, options) => {
  await db.prepare('DROP TRIGGER fanmark_emoji_master_change_audit_insert').run();
  let writes = 0;
  const writer = { prepare: sql => db.prepare(sql), batch() { writes++; throw Error('no-write'); } };
  await assert.rejects(importMasterProjectionStage({ ...options, database: writer }), /preflight_failed/);
  assert.equal(writes, 0);
}, { seed: false }));
test('atomic initial guard rejects a late competing write; lost acknowledgement is never replayed', async () => nativeFixture(async (db, options) => {
  let writes = 0;
  const race = { prepare: sql => db.prepare(sql), async batch(items) {
    writes++;
    await db.prepare('INSERT INTO verification (id,identifier,value,expiresAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').bind('v','SYNTHETIC','SECRET',time,time,time).run();
    return db.batch(items);
  } };
  await assert.rejects(importMasterProjectionStage({ ...options, database: race }), /partial_or_unknown_write/);
  assert.equal(writes, 1);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM emoji_master').first('n'), 0);
  await db.prepare('DELETE FROM verification').run();
  const lost = { prepare: sql => db.prepare(sql), async batch(items) { writes++; await db.batch(items); throw Error('SYNTHETIC_PROVIDER_SECRET'); } };
  await assert.rejects(importMasterProjectionStage({ ...options, database: lost }), { message: 'master_import_stage_partial_or_unknown_write' });
  assert.equal(writes, 2);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM emoji_master').first('n'), 1);
  await assert.rejects(importMasterProjectionStage(options), /target_not_empty_or_invalid/);
}, { seed: false }));
test('mode, malformed projection and changed artifact fail before database access', async () => {
  const db = { prepare() { throw Error('DATABASE_MUST_NOT_BE_ACCESSED'); } };
  const projection = projectMasterSnapshot(fixture());
  await assert.rejects(importMasterProjectionStage({ database: db, readDatabase: db, projection, activationIds, mode: 'production-stage' }), /transport_invalid/);
  for (const change of [p => { p.canonicalEmojiRows[0].short_name = 'changed'; }, p => { p.referenceSnapshot[0].records[0].monthly_price_usd = '0.01'; },
    p => { p.sourceTableHashes.languages = '0'.repeat(64); }, p => { p.canonicalEmojiRows.push(p.canonicalEmojiRows[0]); }]) {
    const p = structuredClone(projection); change(p);
    await assert.rejects(importMasterProjectionStage({ database: db, readDatabase: db, projection: p, activationIds }), /projection_invalid/);
  }
});
test('provider failures and claimed writes in a readback do not leak their contents', async () => {
  const projection = projectMasterSnapshot(fixture());
  for (const all of [async () => { throw Error('SYNTHETIC_PRIVATE_TOKEN'); }, async () => ({ success: false, results: [] }),
    async () => ({ success: true, results: [], meta: { rows_written: 1 } })]) {
    await assert.rejects(verifyImportedMasterProjection({ projection, activationIds, database: { prepare: () => ({ bind: () => ({ all }) }) } }),
      error => error.message === 'master_import_readback_schema_unconfirmed' && !error.cause);
  }
});

function manyRows(projection) {
  const template = projection.canonicalEmojiRows[0];
  projection.canonicalEmojiRows = Array.from({ length: 101 }, (_, i) => ({ ...template,
    id: '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
    emoji: String.fromCodePoint(0x1f600 + i), codepoints: JSON.stringify([(0x1f600 + i).toString(16).toUpperCase()]) }));
  projection.emojiArtifact = createEmojiReleaseArtifacts(projection.canonicalEmojiRows.map(({ created_at, updated_at, ...row }) =>
    ({ ...row, keywords: JSON.parse(row.keywords), codepoints: JSON.parse(row.codepoints) })));
}
test('paged readback detaches expectations before remote reads and rejects a changed row past page one', async () => nativeFixture(async (db, options) => {
  manyRows(options.projection);
  await importMasterProjectionStage(options);
  let mutated = false;
  const changingReader = { prepare(sql) {
    if (!mutated) { mutated = true; options.projection.canonicalEmojiRows[100].short_name = 'MUTATED_AFTER_START'; }
    return options.readDatabase.prepare(sql);
  } };
  assert.equal((await verifyImportedMasterProjection({ ...options, database: changingReader })).totals.emoji, 101);
  options.projection.canonicalEmojiRows[100].short_name = 'test tube';
  await db.prepare('UPDATE emoji_master SET short_name = ? WHERE id = ?').bind('changed', options.projection.canonicalEmojiRows[100].id).run();
  await db.prepare("DELETE FROM fanmark_emoji_master_change_audits WHERE action = 'EMOJI_MASTER_UPDATE'").run();
  await assert.rejects(verifyImportedMasterProjection({ ...options, database: options.readDatabase }), /canonical_row_mismatch/);
}, { seed: false }));
test('unknown second batch keeps a partial target and does not stage or activate any release', async () => nativeFixture(async (db, options) => {
  manyRows(options.projection);
  let batches = 0;
  const writer = { prepare: sql => db.prepare(sql), async batch(items) {
    batches++;
    const result = await db.batch(items);
    if (batches === 2) throw Error('SYNTHETIC_LOST_ACK');
    return result;
  } };
  await assert.rejects(importMasterProjectionStage({ ...options, database: writer }), /partial_or_unknown_write/);
  assert.equal(batches, 2);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM emoji_master').first('n'), 100);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM fanmark_emoji_master_release_imports').first('n'), 0);
  await assert.rejects(importMasterProjectionStage(options), /target_not_empty_or_invalid/);
}, { seed: false }));
