/** Checked-in synthetic source only. Never bind a retained staging database. */
import {readFile} from 'node:fs/promises';
import {businessMigrationStatements, applyBusinessRuntimeMigrations} from './business-runtime-import-schema.mjs';
import {BUSINESS_MIGRATION_SEQUENCE} from './business-migration-ledger.mjs';
import {AUTH_RECOVERY_SCHEMA_SQL, authRecoveryDigest} from '../../workers/api/src/auth-d1-recovery.ts';
import {D1_RECOVERY_SCHEMA_SQL, d1RecoveryDigest} from '../../workers/api/src/d1-store-recovery.ts';

export const fixtureUser = '90000000-0000-4000-8000-000000000001';
export const fixtureSecret = 'synthetic-only-sdk-secret-not-for-deployment-2026';
export const fixtureKeys = [fixtureUser + '/a.png', fixtureUser + '/c.png'];
export const authMigrations = ['0003_better_auth_core.sql', '0007_auth_signup_command.sql', '0008_auth_user_suspension.sql', '0009_auth_oauth_signup.sql'];
export const masterMigrations = ['0000_emoji_master.sql', '0001_emoji_master_release_staging.sql', '0002_emoji_master_release_activation.sql',
  '0003_better_auth_core.sql', '0004_reference_master_releases.sql', '0005_emoji_master_admin_guards.sql',
  '0006_reference_master_extension_prices.sql', '0007_release_audit_timestamps.sql', '0008_emoji_master_change_audits.sql'];
const now = '2026-10-08T00:00:00.000Z';

/** Initialization may be chunked ONLY while all three newly owned databases are empty and unrouted. */
export async function seedRecoverySetFixture(source, {skipMaster = false} = {}) {
  for (const [db, names] of [[source.auth, authMigrations], ...(skipMaster ? [] : [[source.master, masterMigrations]])]) for (const name of names) {
    const sql = await readFile(new URL('../../workers/api/migrations/' + name, import.meta.url), 'utf8');
    await db.batch(businessMigrationStatements(sql).map(sql => db.prepare(sql)));
  }
  await applyBusinessRuntimeMigrations(source.business);
  for (const [db, names] of [[source.business, BUSINESS_MIGRATION_SEQUENCE], ...(skipMaster ? [] : [[source.master, masterMigrations]])]) {
    await db.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT NOT NULL)').run();
    await db.batch(names.map((name, i) => db.prepare('INSERT INTO d1_migrations VALUES(?,?,?)').bind(i + 1, name, now)));
  }
  await source.auth.batch([
    source.auth.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)')
      .bind(fixtureUser, 'Synthetic', 'synthetic-recovery-set@example.invalid', now, now),
    source.auth.prepare("INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,'credential',?,?,?,?)")
      .bind('synthetic-credential', fixtureUser, fixtureUser, 'synthetic-password-hash-bytes', now, now),
    source.auth.prepare('INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,?,?,?,?)')
      .bind('synthetic-session', '2099-01-01T00:00:00Z', 'synthetic-session-token', now, now, fixtureUser),
    source.auth.prepare('INSERT INTO verification(id,identifier,value,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)')
      .bind('synthetic-verification', 'synthetic', 'synthetic-value', '2099-01-01T00:00:00Z', now, now),
  ]);
  await source.business.prepare('INSERT INTO user_settings(id,user_id,username,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .bind('synthetic-profile', fixtureUser, 'synthetic-owner', '日本語\n$&', now, now).run();
}

/** Independent pins come from trusted checked-in migrations in a disposable local runtime. */
export async function recoverySetFixturePins() {
  const {Miniflare} = await import('../../workers/api/node_modules/miniflare/dist/src/index.js');
  const mf = new Miniflare({workers: [{config: {name: 'recovery-set-schema-pins', type: 'worker', compatibilityDate: '2026-09-18',
    env: Object.fromEntries(['auth', 'business', 'master'].map(name => [name, {type: 'd1', name}])),
    manifest: {mainModule: 'index.js', modules: {'index.js': {type: 'esm', contents: 'export default {fetch(){return new Response("pins")}}'}}}}}]});
  try {
    const source = Object.fromEntries(await Promise.all(['auth', 'business', 'master'].map(async name => [name, await mf.getD1Database(name)])));
    await seedRecoverySetFixture(source);
    return {auth: await authRecoveryDigest((await source.auth.prepare(AUTH_RECOVERY_SCHEMA_SQL).all()).results),
      business: await d1RecoveryDigest((await source.business.prepare(D1_RECOVERY_SCHEMA_SQL).all()).results),
      master: await d1RecoveryDigest((await source.master.prepare(D1_RECOVERY_SCHEMA_SQL).all()).results)};
  } finally {await mf.dispose();}
}
