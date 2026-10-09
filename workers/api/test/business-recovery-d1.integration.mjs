import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { applyBusinessRuntimeMigrations } from '../../../scripts/migration/business-runtime-import-schema.mjs';
import { BUSINESS_MIGRATION_SEQUENCE } from '../../../scripts/migration/business-migration-ledger.mjs';
import { BUSINESS_RECOVERY_TABLES, BUSINESS_RECOVERY_SCHEMA_SQL, businessRecoveryDigest,
  captureBusinessRecoverySnapshot as capture, sealBusinessRecoverySnapshot as seal,
  openBusinessRecoverySnapshot as open, restoreBusinessRecoverySnapshot as restore } from '../src/business-d1-recovery.ts';

const schema = async db => (await db.prepare(BUSINESS_RECOVERY_SCHEMA_SQL).all()).results;
const canonical = tables => Object.fromEntries(BUSINESS_RECOVERY_TABLES.map(name => [name,
  tables[name].map(row => Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])))
    .sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0)]));
const changed = async (snapshot, change) => {
  const copy = structuredClone(snapshot); change(copy);
  copy.rowsHash = await businessRecoveryDigest(canonical(copy.tables)); return copy;
};
function wrapped(db, batch) {
  return new Proxy(db, {get(database, property) {
    if (property === 'batch') return batch;
    const value = Reflect.get(database, property); return typeof value === 'function' ? value.bind(database) : value;
  }});
}

test('Business recovery preserves actual runtime journals, wake and deleted ID high-water marks', {timeout: 90_000}, async t => {
  const mf = new Miniflare({workers: [{config: {
    name: 'business-recovery-local', type: 'worker', compatibilityDate: '2026-09-18',
    env: Object.fromEntries(['SOURCE', 'TARGET', 'FAILED', 'ACK'].map(name =>
      [name, {type: 'd1', name: 'business-recovery-' + name}])),
    manifest: {mainModule: 'index.js', modules: {'index.js': {type: 'esm',
      contents: 'export default {fetch(){return new Response("local-only")}}'}}},
  }}]});
  try {
    const source = await mf.getD1Database('SOURCE'), target = await mf.getD1Database('TARGET');
    const failed = await mf.getD1Database('FAILED'), ack = await mf.getD1Database('ACK');
    await applyBusinessRuntimeMigrations(source);
    const timestamp = '2026-10-07T00:00:00.000000Z';
    await source.batch([
      source.prepare('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)'),
      ...BUSINESS_MIGRATION_SEQUENCE.map((name, index) => source.prepare('INSERT INTO d1_migrations (id,name,applied_at) VALUES (?,?,?)')
        .bind(index + 1, name, timestamp)),
      source.prepare('INSERT INTO d1_migrations (id,name,applied_at) VALUES (100,\'synthetic-deleted\',?)').bind(timestamp),
      source.prepare('DELETE FROM d1_migrations WHERE id=100'),
      source.prepare('INSERT INTO invitation_codes (id,code,max_uses,used_count,is_active,created_at,updated_at) VALUES (\'synthetic-code\',\'RECOVERY\',2,0,1,?,?)').bind(timestamp, timestamp),
      source.prepare('INSERT INTO user_settings (id,user_id,username,display_name,created_at,updated_at,invited_by_code) VALUES (\'synthetic-profile\',\'synthetic-user\',\'synthetic-owner\',?,?,?,\'RECOVERY\')').bind('日本語\n" $&', timestamp, timestamp),
      source.prepare('INSERT INTO invitation_signup_attempts (attempt_id,email_fingerprint,invitation_code_id,preferred_language,state,auth_user_id,created_at,updated_at,expires_at) VALUES (\'synthetic-attempt\',?,\'synthetic-code\',\'ja\',\'auth_created\',\'synthetic-user\',?,?,?)').bind('a'.repeat(64), timestamp, timestamp, '2099-01-01T00:00:00Z'),
      source.prepare('UPDATE invitation_signup_attempts SET state=\'completed\' WHERE attempt_id=\'synthetic-attempt\''),
      source.prepare('INSERT INTO fanmark_license_incarnations (license_id,incarnation) VALUES (\'synthetic-deleted-license\',8)'),
      source.prepare('INSERT INTO notification_events (id,event_type,source,payload,trigger_at,status,created_at,updated_at) VALUES (\'synthetic-pending\',\'synthetic_event\',\'system\',?, ?,\'pending\',?,?)').bind('{"text":"香り\\n$&"}', timestamp, timestamp, timestamp),
      source.prepare('UPDATE notification_worker_wake_state SET requested_generation=9,acknowledged_generation=7 WHERE singleton_id=1'),
    ]);
    const events = Array.from({length: 1001}, (_, i) => ({id: i + 1, event_type: 'synthetic', normalized_emoji_ids: '["synthetic-emoji"]', created_at: timestamp}));
    await source.prepare('INSERT INTO fanmark_events (id,event_type,normalized_emoji_ids,created_at) SELECT json_extract(value,\'$.id\'),json_extract(value,\'$.event_type\'),json_extract(value,\'$.normalized_emoji_ids\'),json_extract(value,\'$.created_at\') FROM json_each(?)').bind(JSON.stringify(events)).run();
    await source.batch([
      source.prepare('INSERT INTO fanmark_events (id,event_type,normalized_emoji_ids,created_at) VALUES (9000,\'synthetic-deleted\',\'[]\',?)').bind(timestamp),
      source.prepare('DELETE FROM fanmark_events WHERE id=9000'),
    ]);
    // Pin trusted local migration definitions before opening an archive.
    const expectedSchemaHash = await businessRecoveryDigest(await schema(source));
    const snapshot = await capture(source, expectedSchemaHash);
    assert.equal(snapshot.schema.length, 226); assert.equal(Object.keys(snapshot.tables).length, 80);
    assert.equal(snapshot.tables.fanmark_events.length, 1001);
    assert.deepEqual(snapshot.tables.sqlite_sequence, [{name: 'd1_migrations', seq: 100}, {name: 'fanmark_events', seq: 9000}]);
    const key = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
    const archive = await seal(snapshot, key, expectedSchemaHash);
    const reopened = await open(JSON.parse(JSON.stringify(archive)), key, expectedSchemaHash);
    assert.deepEqual(reopened, snapshot);
    assert.ok(!JSON.stringify(archive).includes('synthetic-owner'));

    await t.test('archive identity, integrity and sequence validation reject before writes', async () => {
      const wrong = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
      await assert.rejects(open(archive, wrong, expectedSchemaHash), /decryption_failed/);
      await assert.rejects(open({...archive, format: 'fanmark-master-recovery-v1'}, key, expectedSchemaHash), /schema_mismatch/);
      const ciphertext = Buffer.from(archive.ciphertext, 'base64'); ciphertext[30] ^= 1;
      await assert.rejects(open({...archive, ciphertext: ciphertext.toString('base64')}, key, expectedSchemaHash), /decryption_failed/);
      await assert.rejects(open(archive, key, 'f'.repeat(64)), /schema_mismatch/);
      const rewind = await changed(snapshot, s => s.tables.sqlite_sequence.find(row => row.name === 'fanmark_events').seq = 1);
      await assert.rejects(restore(target, rewind, expectedSchemaHash), /sequence_invalid/);
      const missing = await changed(snapshot, s => s.tables.sqlite_sequence = []);
      await assert.rejects(restore(target, missing, expectedSchemaHash), /sequence_invalid/);
      const unknown = await changed(snapshot, s => s.tables.sqlite_sequence.push({name: 'another_table', seq: 1}));
      await assert.rejects(restore(target, unknown, expectedSchemaHash), /sequence_invalid/);
      assert.deepEqual(await schema(target), []);
    });
    await t.test('real D1 constraint failures roll back data and DDL', async () => {
      const foreignKey = await changed(snapshot, s => s.tables.user_settings[0].invited_by_code = 'MISSING');
      await assert.rejects(restore(failed, foreignKey, expectedSchemaHash), /restore_failed/);
      assert.deepEqual(await schema(failed), []);
      const invalid = await changed(snapshot, s => s.tables.notification_worker_wake_state[0].acknowledged_generation = 10);
      await assert.rejects(restore(failed, invalid, expectedSchemaHash), /restore_failed/);
      assert.deepEqual(await schema(failed), []);
    });
    let restoreStatements = 0;
    await t.test('restore is exact without consuming invites or incrementing historical wake generations', async () => {
      const sizes = [];
      const measured = wrapped(target, async statements => {sizes.push(statements.length); return target.batch(statements);});
      assert.deepEqual(await restore(measured, reopened, expectedSchemaHash), snapshot);
      assert.ok(sizes[0] <= 900); assert.equal(sizes[1], 83);
      restoreStatements = sizes[0];
      assert.equal(await target.prepare('SELECT used_count FROM invitation_codes WHERE id=\'synthetic-code\'').first('used_count'), 1);
      assert.deepEqual(await target.prepare('SELECT requested_generation,acknowledged_generation FROM notification_worker_wake_state').first(), {requested_generation: 9, acknowledged_generation: 7});
      assert.equal(await target.prepare('SELECT incarnation FROM fanmark_license_incarnations').first('incarnation'), 8);
      await assert.rejects(restore(target, reopened, expectedSchemaHash), /target_not_empty/);
      await assert.rejects(target.prepare('UPDATE notification_worker_wake_state SET requested_generation=8 WHERE singleton_id=1').run(), /notification_wake_generation_rewind/);
      await target.prepare('INSERT INTO fanmark_events (event_type,normalized_emoji_ids,created_at) VALUES (\'next\',\'[]\',?)').bind(timestamp).run();
      assert.equal(await target.prepare('SELECT id FROM fanmark_events WHERE event_type=\'next\'').first('id'), 9001);
      await target.prepare('INSERT INTO d1_migrations (name,applied_at) VALUES (\'next\',?)').bind(timestamp).run();
      assert.equal(await target.prepare('SELECT id FROM d1_migrations WHERE name=\'next\'').first('id'), 101);
      await target.prepare('UPDATE notification_events SET trigger_at=? WHERE id=\'synthetic-pending\'').bind('2099-01-02T00:00:00Z').run();
      assert.equal(await target.prepare('SELECT requested_generation FROM notification_worker_wake_state').first('requested_generation'), 10);
    });
    await t.test('lost acknowledgement preserves committed data and refuses a blind replay', async () => {
      await ack.prepare('CREATE TABLE d1_migrations (name TEXT)').run();
      await assert.rejects(restore(ack, reopened, expectedSchemaHash), /target_not_empty/);
      await ack.prepare('DROP TABLE d1_migrations').run(); let commits = 0;
      const lost = wrapped(ack, async statements => {await ack.batch(statements); commits++; throw new Error('synthetic lost acknowledgement');});
      await assert.rejects(restore(lost, reopened, expectedSchemaHash), /restore_failed/);
      assert.equal(commits, 1); assert.deepEqual(await capture(ack, expectedSchemaHash), snapshot);
      await assert.rejects(restore(ack, reopened, expectedSchemaHash), /target_not_empty/);
      assert.deepEqual(await capture(ack, expectedSchemaHash), snapshot);
    });
    assert.deepEqual(await capture(source, expectedSchemaHash), snapshot);
    console.info(JSON.stringify({proof: 'business-recovery-native-d1', tables: 79, internalSequenceTable: 1,
      schemaObjects: 226, schemaHash: expectedSchemaHash, migrations: 27, syntheticEventRows: 1001,
      captureStatements: 83, restoreStatements,
      archiveRoundTrip: true, atomicRollback: true, uncertainCommitPreserved: true,
      historyTriggersDeferred: true, deletedIdHighWaterPreserved: true, remoteWrites: 0}));
  } finally {await mf.dispose();}
});
