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
test('offline projection preserves source timestamps, dollar units, booleans and immutable emoji identities', () => {
  const input = fixture(), result = projectMasterSnapshot(input);
  assert.equal(result.referenceSnapshot[0].records[0].monthly_price_usd, '9.99');
  assert.equal(result.referenceSnapshot[2].records[0].is_active, false);
  assert.equal(result.canonicalEmojiRows[0].created_at, time);
  assert.equal(result.canonicalEmojiRows[0].keywords, '["science"]');
  assert.deepEqual(result.emojiArtifact.records, [emoji]);
  assert.equal(result.productionReady, false);
  assert.equal(result.fullSnapshotVerified, false);
  assert.equal(result.sourceFreezeVerified, false);
  const repeat = projectMasterSnapshot({ ...input, tables: [...input.tables].reverse() });
  assert.deepEqual(repeat, result);
  input.tables[0].stream.fill(0);
  input.catalog.columns.length = 0;
  assert.equal(result.canonicalEmojiRows[0].emoji, '🧪');
});
test('selected stream hash, count, byte size, column set, record hashes, order and identities are checked', () => {
  const changes = [
    input => { input.tables[0].stream[0] = 0; },
    input => { input.tables[0].entry.rowCount = '2'; },
    input => { input.tables[0].entry.byteCount = '2'; },
    input => { input.tables[0].entry.columns = ['id']; },
    input => { input.tables[0].entry.primaryKey = ['emoji']; },
    input => { const t = input.tables[0], r = JSON.parse(t.stream.toString()); r.rowHash = '0'.repeat(64); replaceRecords(t, [r]); },
    input => { const t = input.tables[0], r = JSON.parse(t.stream.toString()); replaceRecords(t, [r, rowRecordForEnvelope(r.envelope, getPrimaryKeyInfo(catalog, 'emoji_master'), 1)]); },
    input => { input.approvedEmojiIdentity = '0'.repeat(64); },
    input => { input.tables[0] = input.tables[1]; },
    input => { input.tables.pop(); },
  ];
  for (const change of changes) { const input = fixture(); change(input); assert.throws(() => projectMasterSnapshot(input), /^Error: master_projection_/); }
});
test('malformed units, booleans, schema drift and parser errors fail without exposing row contents', () => {
  for (const [name, field, value] of [['fanmark_tiers', 'monthly_price_usd', '9.999'], ['languages', 'is_active', 'SYNTHETIC_SECRET'], ['emoji_master', 'keywords', 'SYNTHETIC_SECRET']]) {
    const input = fixture(); changeEnvelope(input, name, e => { e.values[field] = value; });
    assert.throws(() => projectMasterSnapshot(input), error => error.message === 'master_projection_invalid' && !error.cause);
  }
  const input = fixture(); input.catalog.columns.find(c => c.table_name === 'fanmark_tiers' && c.column_name === 'monthly_price_usd').postgres_type = 'integer';
  changeEnvelope(input, 'fanmark_tiers', e => { e.values.monthly_price_usd = '999'; });
  assert.throws(() => projectMasterSnapshot(input), /master_projection_invalid/);
});
test('dollar amounts are converted exactly once by the actual native reference release writer', async () => {
  const mf = new Miniflare({ workers: [{ config: { name: 'master-projection-test', type: 'worker', compatibilityDate: '2026-09-18',
    env: { DB: { type: 'd1', name: 'master-projection' } }, manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response(null)}}' } } } } }] });
  try {
    const db = await mf.getD1Database('DB');
    for (const name of ['0000_emoji_master.sql', '0001_emoji_master_release_staging.sql', '0002_emoji_master_release_activation.sql', '0003_better_auth_core.sql', '0004_reference_master_releases.sql', '0005_emoji_master_admin_guards.sql', '0006_reference_master_extension_prices.sql', '0007_release_audit_timestamps.sql', '0008_emoji_master_change_audits.sql']) {
      await db.batch(businessMigrationStatements(await readFile(new URL('../../workers/api/migrations/' + name, import.meta.url), 'utf8')).map(sql => db.prepare(sql)));
    }
    for (const dollars of ['0.00', '0.01', '9.99', '99999999.99']) {
      const input = fixture(); changeEnvelope(input, 'fanmark_tiers', e => { e.values.monthly_price_usd = dollars; });
      const result = projectMasterSnapshot(input);
      const options = { database: db, snapshot: result.referenceSnapshot, snapshotSha256: result.referenceSnapshotSha256 };
      await stageReferenceMasterRelease(options);
      assert.equal(await verifyStagedReferenceMasterRelease(options), true);
      const row = await db.prepare('SELECT monthly_price_cents FROM fanmark_tier_release_rows WHERE release_version = ?').bind(result.referenceSnapshotSha256).first();
      assert.equal(row.monthly_price_cents, Number(BigInt(dollars.replace('.', ''))));
    }
  } finally { await mf.dispose(); }
});
