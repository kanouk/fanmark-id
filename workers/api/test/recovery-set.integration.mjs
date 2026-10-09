import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile, mkdtemp, rm, stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Miniflare} from 'miniflare';
import {checkedInSqlStatements} from './schema-statements.ts';
import {applyBusinessRuntimeMigrations} from '../../../scripts/migration/business-runtime-import-schema.mjs';
import {BUSINESS_MIGRATION_SEQUENCE} from '../../../scripts/migration/business-migration-ledger.mjs';
import {RECOVERY_SET_STORES as stores, collectRecoverySet, openRecoverySet, restoreRecoverySet} from '../src/recovery-set.ts';
import {D1_RECOVERY_SCHEMA_SQL, d1RecoveryDigest} from '../src/d1-store-recovery.ts';
import {AUTH_RECOVERY_SCHEMA_SQL, authRecoveryDigest} from '../src/auth-d1-recovery.ts';
import {saveRecoverySetFile, readRecoverySetFile} from '../../../scripts/migration/recovery-set-files.mjs';

const masterMigrations = ['0000_emoji_master.sql', '0001_emoji_master_release_staging.sql', '0002_emoji_master_release_activation.sql',
  '0003_better_auth_core.sql', '0004_reference_master_releases.sql', '0005_emoji_master_admin_guards.sql',
  '0006_reference_master_extension_prices.sql', '0007_release_audit_timestamps.sql', '0008_emoji_master_change_audits.sql'];
const authMigrations = ['0003_better_auth_core.sql', '0007_auth_signup_command.sql', '0008_auth_user_suspension.sql', '0009_auth_oauth_signup.sql'];
const user = '90000000-0000-4000-8000-000000000001', secret = 'synthetic-only-sdk-secret-not-for-deployment-2026';
function wrapped(object, overrides) {return new Proxy(object, {get(target, property) {
  if (property in overrides) return overrides[property]; const v = Reflect.get(target, property); return typeof v === 'function' ? v.bind(target) : v;
}});}
// Only the pinned Miniflare empty storageClass field is supplemented. No deployed coordinator does this.
function standardLocalBucket(native) {
  const object = value => value === null ? null : wrapped(value, {storageClass: value.storageClass === '' ? 'Standard' : value.storageClass});
  return wrapped(native, {get: async (...args) => object(await native.get(...args)), head: async (...args) => object(await native.head(...args)),
    put: async (...args) => object(await native.put(...args)), list: async (...args) => {
      const page = await native.list(...args); return {...page, objects: page.objects.map(object)};
    }});
}

test('one private recovery set restores native split D1 and both R2 stores with exact resume', {timeout: 90_000}, async t => {
  const env = {};
  for (const prefix of ['S', 'T', 'REVOKED']) for (const store of stores) env[prefix + '_' + store] =
    {type: ['avatars', 'covers'].includes(store) ? 'r2' : 'd1', name: 'recovery-set-' + prefix + '-' + store};
  const mf = new Miniflare({workers: [{config: {name: 'recovery-set-native', type: 'worker', compatibilityDate: '2026-09-18', env,
    manifest: {mainModule: 'index.js', modules: {'index.js': {type: 'esm', contents: 'export default {fetch(){return new Response("local")}}'}}}}}]});
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fanmark-recovery-set-'));
  const ids = prefix => Object.fromEntries(stores.map(store => [store, prefix + '-' + store]));
  const guard = prefix => ({id: 'isolated-fixture-' + prefix, assertHeld: async expected => {
    // This owned fixture has no application router, jobs or external writers.
    assert.deepEqual(expected, ids(prefix));
  }});
  const bindings = async prefix => Object.fromEntries(await Promise.all(stores.map(async store => [store,
    ['avatars', 'covers'].includes(store) ? standardLocalBucket(await mf.getR2Bucket(prefix + '_' + store)) : await mf.getD1Database(prefix + '_' + store)])));
  try {
    const source = await bindings('S'), target = await bindings('T'), revoked = await bindings('REVOKED');
    for (const [db, migrations] of [[source.auth, authMigrations], [source.master, masterMigrations]]) for (const name of migrations) {
      const sql = await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8');
      await db.batch(checkedInSqlStatements(sql).map(statement => db.prepare(statement)));
    }
    await applyBusinessRuntimeMigrations(source.business);
    const now = '2026-10-08T00:00:00.000Z';
    await source.business.batch([
      source.business.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT NOT NULL)'),
      ...BUSINESS_MIGRATION_SEQUENCE.map((name, i) => source.business.prepare('INSERT INTO d1_migrations VALUES(?,?,?)').bind(i + 1, name, now)),
      source.business.prepare('INSERT INTO user_settings(id,user_id,username,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)')
        .bind('synthetic-profile', user, 'synthetic-owner', '日本語\n$&', now, now),
    ]);
    await source.master.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT NOT NULL)').run();
    await source.master.batch(masterMigrations.map((name, i) => source.master.prepare('INSERT INTO d1_migrations VALUES(?,?,?)').bind(i + 1, name, now)));
    await source.auth.batch([
      source.auth.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)')
        .bind(user, 'Synthetic', 'synthetic-recovery-set@example.invalid', now, now),
      source.auth.prepare("INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,'credential',?,?,?,?)")
        .bind('synthetic-credential', user, user, 'synthetic-password-hash-bytes', now, now),
      source.auth.prepare('INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,?,?,?,?)')
        .bind('synthetic-session', '2099-01-01T00:00:00Z', 'synthetic-session-token', now, now, user),
      source.auth.prepare('INSERT INTO verification(id,identifier,value,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)')
        .bind('synthetic-verification', 'synthetic', 'synthetic-value', '2099-01-01T00:00:00Z', now, now),
    ]);
    await source.avatars.put(user + '/a.png', new Uint8Array([1, 2, 3]), {storageClass: 'Standard', httpMetadata: {contentType: 'image/png'}, customMetadata: {fixture: 'avatar'}});
    await source.covers.put(user + '/c.png', new Uint8Array([4, 5, 6]), {storageClass: 'Standard', customMetadata: {fixture: 'cover'}});
    const context = {sourceIds: ids('S'), keyId: 'synthetic-archive-key-1', runtimeRevision: 'synthetic-runtime-1', authSecret: secret, schemaHashes: {
      auth: await authRecoveryDigest((await source.auth.prepare(AUTH_RECOVERY_SCHEMA_SQL).all()).results),
      business: await d1RecoveryDigest((await source.business.prepare(D1_RECOVERY_SCHEMA_SQL).all()).results),
      master: await d1RecoveryDigest((await source.master.prepare(D1_RECOVERY_SCHEMA_SQL).all()).results),
    }};
    const key = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
    await t.test('guard refusal and recapture drift produce no finished backup', async () => {
      await assert.rejects(collectRecoverySet(source, context, key, null), /guard_required/);
      await assert.rejects(collectRecoverySet(source, context, key, {...guard('S'), assertHeld: async () => {throw new Error('not closed');}}), /guard_lost/);
      const liveLease = {id: 'isolated-live-lease', paused: true, calls: 0, async assertHeld(expected) {
        assert.deepEqual(expected, ids('S'));
        if (++this.calls === 2) this.paused = false;
        if (!this.paused) throw new Error('lease expired');
      }};
      await assert.rejects(collectRecoverySet(source, context, key, liveLease), /guard_lost/);
      assert.equal(liveLease.paused, false); assert.equal(liveLease.calls, 2);
      let calls = 0;
      await assert.rejects(collectRecoverySet(source, context, key, {...guard('S'), assertHeld: async expected => {
        await guard('S').assertHeld(expected);
        if (++calls === 7) await source.business.prepare("UPDATE user_settings SET display_name='changed'").run();
      }}), /source_changed/);
      await source.business.prepare('UPDATE user_settings SET display_name=?').bind('日本語\n$&').run();
    });
    const archive = await collectRecoverySet(source, context, key, guard('S'));
    const filename = path.join(directory, 'synthetic-recovery-set.json');
    const saved = await saveRecoverySetFile(filename, archive, context, key);
    assert.equal(saved.committed, true); assert.equal((await stat(filename)).mode & 0o777, 0o600);
    const fileBytes = await readFile(filename);
    assert.ok(!fileBytes.includes(Buffer.from(secret))); assert.ok(!fileBytes.includes(Buffer.from('synthetic-recovery-set@example.invalid')));
    const reopened = await readRecoverySetFile(filename, context, key);
    const before = await openRecoverySet(reopened, context, key);
    await t.test('part mixing, wrong SDK key and existing file refuse before target writes', async () => {
      const another = await collectRecoverySet(source, context, key, guard('S'));
      await assert.rejects(openRecoverySet({...reopened, parts: {...reopened.parts, covers: another.parts.covers}}, context, key), /manifest_mismatch/);
      await assert.rejects(openRecoverySet(reopened, {...context, authSecret: 'another-synthetic-sdk-secret-0000000000'}, key), /server_key_mismatch/);
      await assert.rejects(saveRecoverySetFile(filename, archive, context, key), /commit_failed_inspect_destination/);
      assert.deepEqual(await readFile(filename), fileBytes);
      assert.deepEqual((await target.master.prepare(D1_RECOVERY_SCHEMA_SQL).all()).results, []);
    });
    const progress = [];
    const options = {mode: 'resume-exact', sessionPolicy: 'isolated-preserve', isolatedFidelity: true,
      targetIds: ids('T'), targetGuard: guard('T'), progress: async receipt => {progress.push(receipt);}};
    await t.test('a foreign R2 object prevents any D1 write', async () => {
      await target.covers.put('foreign', 'keep', {storageClass: 'Standard'});
      await assert.rejects(restoreRecoverySet(target, reopened, context, key, options), /target_mismatch/);
      assert.equal(progress.length, 0); assert.equal(await (await target.covers.get('foreign')).text(), 'keep');
      for (const store of ['auth', 'business', 'master']) assert.deepEqual((await target[store].prepare(D1_RECOVERY_SCHEMA_SQL).all()).results, []);
      await target.covers.delete('foreign');
    });
    await t.test('committed Business with a lost ACK is kept and resumed without replaying D1', async () => {
      let commits = 0;
      const lost = wrapped(target.business, {batch: async statements => {await target.business.batch(statements); commits++; throw new Error('synthetic ACK lost');}});
      await assert.rejects(restoreRecoverySet({...target, business: lost}, reopened, context, key, options), /restore_failed/);
      assert.equal(commits, 1); assert.equal((await target.business.prepare('SELECT display_name FROM user_settings').first()).display_name, '日本語\n$&');
      let secondWrites = 0;
      const readOnlyCommitted = wrapped(target.business, {batch: async statements => {
        if (statements.length !== 83) {secondWrites++; throw new Error('committed D1 must not be replayed');}
        return target.business.batch(statements);
      }});
      assert.equal((await restoreRecoverySet({...target, business: readOnlyCommitted}, reopened, context, key, options)).verified, true);
      assert.equal(secondWrites, 0);
      assert.equal(await target.auth.prepare('SELECT COUNT(*) AS count FROM session').first('count'), 1);
      assert.deepEqual(await (await target.avatars.get(user + '/a.png')).arrayBuffer(), new Uint8Array([1, 2, 3]).buffer);
    });
    await t.test('explicit revocation drops sessions/challenges while keeping credential data', async () => {
      const result = await restoreRecoverySet(revoked, reopened, context, key, {...options, mode: 'new-empty', targetIds: ids('REVOKED'), targetGuard: guard('REVOKED'),
        sessionPolicy: 'revoke-local-sessions-and-challenges', isolatedFidelity: false});
      assert.equal(result.sessionPolicy, 'revoke-local-sessions-and-challenges');
      assert.notEqual(result.restoredHashes.auth, before.manifest.parts.auth.snapshotHash);
      assert.equal(await revoked.auth.prepare('SELECT COUNT(*) AS count FROM session').first('count'), 0);
      assert.equal(await revoked.auth.prepare('SELECT COUNT(*) AS count FROM verification').first('count'), 0);
      assert.equal(await revoked.auth.prepare('SELECT password FROM account').first('password'), before.snapshots.auth.tables.account[0].password);
      for (const store of ['auth', 'business', 'master']) assert.equal((await revoked[store].prepare('PRAGMA foreign_key_check').all()).results.length, 0);
    });
    console.info(JSON.stringify({proof: 'recovery-set-native-local', stores: 5, privateFile: true, allPartsAuthenticatedBeforeWrites: true,
      exactD1ResumeAfterLostAck: true, explicitSessionRevocation: true, localStorageClassAdapter: true, remoteWrites: 0,
      operationalQuiescenceAdopted: false, schedulerEnabled: false}));
  } finally {await mf.dispose(); await rm(directory, {recursive: true, force: true});}
});
