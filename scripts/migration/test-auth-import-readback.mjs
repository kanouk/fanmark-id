import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Miniflare } from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import { businessMigrationStatements } from './business-runtime-import-schema.mjs';
import { projectSupabaseAuth } from './supabase-auth-projection.mjs';
import { verifyImportedAuthProjection } from './auth-import-readback.mjs';
import { importAuthProjectionStage } from './auth-import-stage.mjs';

const id = 'aaaaaaaa-1111-4111-8111-111111111111', time = '2026-10-19T00:00:00.000Z';
async function projection() {
  return projectSupabaseAuth({ version: 1, observedAt: time,
    users: [{ id, email: 'synthetic@example.invalid', encrypted_password: '$2b$10$' + 'a'.repeat(53), email_confirmed_at: time,
      banned_until: null, is_anonymous: false, is_sso_user: false, is_super_admin: null, deleted_at: null, created_at: time, updated_at: time }],
    identities: [{ id: 'bbbbbbbb-1111-4111-8111-111111111111', user_id: id, provider: 'google', provider_id: 'SYNTHETIC_SUBJECT', subject: 'SYNTHETIC_SUBJECT', created_at: time, updated_at: time }],
    factors: [{ id: 'cccccccc-1111-4111-8111-111111111111', user_id: id, factor_type: 'totp', status: 'verified', secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' }],
    settings: [{ user_id: id, display_name: 'SYNTHETIC_NAME', plan_type: 'admin' }], roles: [{ user_id: id, role: 'admin' }],
  }, { encrypt: async value => 'SYNTHETIC_CIPHERTEXT:' + value });
}
async function fixture(run, { seed = true } = {}) {
  const mf = new Miniflare({ workers: [{ config: { name: 'auth-import-readback-test', type: 'worker', compatibilityDate: '2026-09-18',
    env: { DB: { type: 'd1', name: 'auth-import-readback-test' } },
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("local")}}' } } } } }] });
  try {
    const db = await mf.getD1Database('DB'), expected = await projection();
    for (const name of ['0003_better_auth_core.sql', '0007_auth_signup_command.sql', '0008_auth_user_suspension.sql', '0009_auth_oauth_signup.sql']) {
      const sql = await readFile(new URL('../../workers/api/migrations/' + name, import.meta.url), 'utf8');
      await db.batch(businessMigrationStatements(sql).map(statement => db.prepare(statement)));
    }
    if (seed) for (const [table, rows] of Object.entries(expected.tables)) for (const row of rows) {
      const columns = Object.keys(row);
      await db.prepare(`INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`).bind(...Object.values(row)).run();
    }
    await run(db, expected);
  } finally { await mf.dispose(); }
}
test('native readback matches every field without writing or disclosing identities or credentials', async () => fixture(async (db, expected) => {
  const statements = [];
  const readonly = { prepare(sql) { assert.match(sql, /^SELECT\s/); statements.push(sql); return db.prepare(sql); } };
  const report = await verifyImportedAuthProjection({ database: readonly, projection: expected });
  assert.deepEqual(report.totals, { users: 1, accounts: 2, factors: 1, admins: 1 });
  assert.equal(report.projectionRowsReconciled, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.consistency, 'unfenced-readback');
  assert.doesNotMatch(JSON.stringify(report), /SYNTHETIC|example.invalid|aaaaaaaa|\$2b/);
  assert.ok(statements.length > 8);
  const duplicate = structuredClone(expected); duplicate.tables.account.push(duplicate.tables.account[0]);
  await assert.rejects(verifyImportedAuthProjection({ database: readonly, projection: duplicate }), /projection_invalid/);
}));
test('equal counts cannot hide changed credentials, subjects, MFA state, signup commands or extra columns', async () => fixture(async (db, expected) => {
  for (const [table, column, value] of [
    ['account', 'password', 'SYNTHETIC_CHANGED_HASH'], ['account', 'accountId', 'SYNTHETIC_CHANGED_SUBJECT'],
    ['twoFactor', 'secret', 'SYNTHETIC_CHANGED_CIPHER'], ['twoFactor', 'backupCodes', 'SYNTHETIC_CHANGED_CODES'],
    ['twoFactor', 'failedVerificationCount', 1], ['user', 'emailVerified', 0],
    ['user', 'signupCommandId', 'unexpected-command'], ['account', 'accessToken', 'SYNTHETIC_TOKEN'],
  ]) {
    const key = expected.tables[table][0].id;
    const before = await db.prepare(`SELECT "${column}" FROM "${table}" WHERE id = ?`).bind(key).first();
    await db.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE id = ?`).bind(value, key).run();
    await assert.rejects(verifyImportedAuthProjection({ database: db, projection: expected }), /auth_import_readback_(row_mismatch|generation_mismatch)/);
    await db.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE id = ?`).bind(before[column], key).run();
    // Native secret-update triggers intentionally advance generation; restore
    // the synthetic fixture explicitly rather than teaching readback to repair.
    await db.prepare('UPDATE "mfaGeneration" SET generation = 1 WHERE id = 1').run();
  }
  await db.prepare('ALTER TABLE "user" ADD COLUMN unexpected text').run();
  await assert.rejects(verifyImportedAuthProjection({ database: db, projection: expected }), /schema_unconfirmed/);
}));
test('session residue, extra identities, missing rows and lost identity constraints are refused', async () => fixture(async (db, expected) => {
  await db.prepare('INSERT INTO verification (id,identifier,value,expiresAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').bind('v', 'SYNTHETIC', 'SYNTHETIC_TOKEN', time, time, time).run();
  await assert.rejects(verifyImportedAuthProjection({ database: db, projection: expected }), /unexpected_session_or_audit_state/);
  await db.prepare('DELETE FROM verification').run();
  await db.prepare('INSERT INTO account (id,accountId,providerId,userId,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').bind('extra', 'SYNTHETIC_EXTRA', 'github', id, time, time).run();
  await assert.rejects(verifyImportedAuthProjection({ database: db, projection: expected }), /row_mismatch/);
  await db.prepare('DELETE FROM account WHERE id = ?').bind('extra').run();
  await db.prepare('DROP INDEX account_providerId_accountId_key').run();
  await assert.rejects(verifyImportedAuthProjection({ database: db, projection: expected }), /schema_unconfirmed/);
  await db.prepare('CREATE UNIQUE INDEX "account_providerId_accountId_key"\n  ON "account" ("providerId", "accountId")').run();
  await db.prepare('DELETE FROM account WHERE providerId = ?').bind('google').run();
  await assert.rejects(verifyImportedAuthProjection({ database: db, projection: expected }), /row_mismatch/);
}));
test('provider errors, malformed results and reported writes never pass or expose private data', async () => {
  const expected = await projection();
  for (const all of [async () => { throw Error('SYNTHETIC_PRIVATE_TOKEN'); }, async () => ({ success: false, results: [] }),
    async () => ({ success: true, results: [], meta: { rows_written: 1 } })]) {
    await assert.rejects(verifyImportedAuthProjection({ projection: expected, database: { prepare: () => ({ bind: () => ({ all }) }) } }),
      error => /^auth_import_readback_(read_failed|result_invalid|schema_unconfirmed)$/.test(error.message) && error.cause === undefined);
  }
});
test('multi-page comparison freezes its expectation and rejects an extra row at the page boundary', async () => fixture(async (db, expected) => {
  const template = expected.tables.account[1];
  for (let i = 0; i < 98; i++) {
    const row = { ...template, id: `page-${i}`, accountId: `SYNTHETIC_PAGE_${i}` };
    expected.tables.account.push(row);
    await db.prepare('INSERT INTO account (id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)').bind(...Object.values(row)).run();
  }
  let first = true;
  const captured = { prepare(sql) {
    const all = async (values = []) => {
      if (first) { first = false; expected.tables.user[0].name = 'MUTATED_AFTER_START'; }
      return db.prepare(sql).bind(...values).all();
    };
    return { all: () => all(), bind: (...values) => ({ all: () => all(values) }) };
  } };
  assert.equal((await verifyImportedAuthProjection({ database: captured, projection: expected })).totals.accounts, 100);
  expected.tables.user[0].name = 'SYNTHETIC_NAME';
  await db.prepare('INSERT INTO account (id,accountId,providerId,userId,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').bind('zz-extra', 'SYNTHETIC_EXTRA', 'github', id, time, time).run();
  await assert.rejects(verifyImportedAuthProjection({ database: db, projection: expected }), /row_mismatch/);
}));
test('atomic Auth stage imports once, independently reads back and refuses repeated import', async () => fixture(async (db, expected) => {
  const report = await importAuthProjectionStage({ database: db, readDatabase: db, projection: expected });
  assert.equal(report.atomicStatements, 6);
  assert.equal(report.projectionRowsReconciled, true);
  assert.equal(report.sourceFreezeVerified, false);
  assert.equal(report.coordinatorCompleted, false);
  await assert.rejects(importAuthProjectionStage({ database: db, readDatabase: db, projection: expected }), /target_not_empty_or_invalid/);
}, { seed: false }));
test('late native FK failure rolls back users, credentials and MFA generation together', async () => fixture(async (db, expected) => {
  expected.tables.adminRole[0].userId = 'dddddddd-1111-4111-8111-111111111111';
  await assert.rejects(importAuthProjectionStage({ database: db, readDatabase: db, projection: expected }), /write_acknowledgement_unknown/);
  for (const table of Object.keys(expected.tables)) assert.equal(await db.prepare(`SELECT count(*) AS n FROM "${table}"`).first('n'), 0);
  assert.equal(await db.prepare('SELECT generation FROM mfaGeneration').first('generation'), 0);
}, { seed: false }));
test('atomic guard catches a write after preflight; lost commit acknowledgement is never retried', async () => fixture(async (db, expected) => {
  let writes = 0;
  const raced = { prepare: sql => db.prepare(sql), async batch(statements) {
    writes++;
    await db.prepare('INSERT INTO verification (id,identifier,value,expiresAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').bind('race', 'SYNTHETIC', 'SYNTHETIC_TOKEN', time, time, time).run();
    return db.batch(statements);
  } };
  await assert.rejects(importAuthProjectionStage({ database: raced, readDatabase: db, projection: expected }), /write_acknowledgement_unknown/);
  assert.equal(writes, 1);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM "user"').first('n'), 0);
  await db.prepare('DELETE FROM verification').run();
  const lost = { prepare: sql => db.prepare(sql), async batch(statements) {
    writes++; await db.batch(statements); throw Error('SYNTHETIC_SECRET_PROVIDER_ERROR');
  } };
  await assert.rejects(importAuthProjectionStage({ database: lost, readDatabase: db, projection: expected }), { message: 'auth_import_stage_write_acknowledgement_unknown' });
  assert.equal(writes, 2);
  assert.equal((await verifyImportedAuthProjection({ database: db, projection: expected })).projectionRowsReconciled, true);
}, { seed: false }));
test('capacity and mode failures happen before any database access', async () => {
  const expected = await projection();
  const db = { prepare() { throw Error('DATABASE_MUST_NOT_BE_ACCESSED'); }, batch() { throw Error('DATABASE_MUST_NOT_BE_ACCESSED'); } };
  await assert.rejects(importAuthProjectionStage({ database: db, readDatabase: db, projection: expected, mode: 'production-stage' }), /transport_invalid/);
  for (let i = 0; i < 100; i++) expected.tables.account.push({ ...expected.tables.account[1], id: `extra-${i}`, accountId: `subject-${i}` });
  await assert.rejects(importAuthProjectionStage({ database: db, readDatabase: db, projection: expected }), /atomic_capacity_or_admin_invalid/);
});
test('missing native MFA trigger is detected before importing any credentials', async () => fixture(async (db, expected) => {
  await db.prepare('DROP TRIGGER mfa_generation_factor_insert').run();
  let writes = 0;
  const writer = { prepare: sql => db.prepare(sql), batch() { writes++; throw Error('must_not_write'); } };
  await assert.rejects(importAuthProjectionStage({ database: writer, readDatabase: db, projection: expected }), /preflight_failed/);
  assert.equal(writes, 0);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM "user"').first('n'), 0);
}, { seed: false }));
