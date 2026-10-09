import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from '../../workers/api/node_modules/esbuild/lib/main.js';
import { Miniflare } from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import { businessMigrationStatements } from './business-runtime-import-schema.mjs';

const bcrypt = createRequire(new URL('../../workers/api/package.json', import.meta.url))('bcryptjs');

const origin = 'https://synthetic-auth-recovery.example.test';
const vars = { RECOVERY_TOKEN: 'a'.repeat(64), RECOVERY_INCARNATION: '91111111-1111-4111-8111-111111111111',
  RECOVERY_AUTH_NAME: 'fanmark-recovery-synthetic-native-auth', AUTH_BACKEND: 'better-auth',
  AUTH_USER_STATUS_BACKEND: 'd1', D1_TOPOLOGY: 'split', BETTER_AUTH_URL: origin,
  CORS_ALLOWED_ORIGINS: origin, BETTER_AUTH_SECRET: 'synthetic-native-recovery-secret-not-for-deployment-00000000' };

test('temporary Auth recovery Worker gates actual application routes behind token and incarnation', async context => {
  const compiled = await build({ entryPoints: [fileURLToPath(new URL('./isolated-recovery-auth-worker.mjs', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*', 'node:*'] });
  const mf = new Miniflare({ workers: [{ config: {
    name: 'synthetic-auth-recovery-native', type: 'worker', compatibilityDate: '2026-09-18',
    env: { ...Object.fromEntries(Object.entries(vars).map(([name, value]) => [name, { type: 'text', value }])),
      AUTH_DB: { type: 'd1', name: vars.RECOVERY_AUTH_NAME } },
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: compiled.outputFiles[0].text } } },
  } }] });
  try {
    const db = await mf.getD1Database('AUTH_DB');
    for (const name of ['0003_better_auth_core.sql', '0007_auth_signup_command.sql', '0008_auth_user_suspension.sql', '0009_auth_oauth_signup.sql']) {
      const sql = await readFile(new URL(`../../workers/api/migrations/${name}`, import.meta.url), 'utf8');
      await db.batch(businessMigrationStatements(sql).map(statement => db.prepare(statement)));
    }
    const headers = { authorization: `Bearer ${vars.RECOVERY_TOKEN}`, 'x-recovery-incarnation': vars.RECOVERY_INCARNATION, origin };
    const request = (path, options = {}) => mf.dispatchFetch(origin + path, { headers, ...options });
    await context.test('anonymous and wrong-incarnation requests cannot reach Auth', async () => {
      assert.equal((await request('/api/auth/get-session', { headers: {} })).status, 401);
      assert.equal((await request('/api/auth/get-session', { headers: { ...headers, 'x-recovery-incarnation': '92222222-2222-4222-8222-222222222222' } })).status, 403);
      assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM session').first('count'), 0);
    });
    await context.test('identity is exact; enrollment, deletion, signup and generic SQL are closed', async () => {
      assert.deepEqual(await (await request('/_recovery/identity')).json(),
        { targetIncarnation: vars.RECOVERY_INCARNATION, authDatabaseName: vars.RECOVERY_AUTH_NAME });
      for (const path of ['/api/auth/sign-up/email', '/api/auth/delete-user', '/api/auth/two-factor/enable', '/_recovery/query']) {
        assert.equal((await request(path, { method: 'POST', body: '{}' })).status, 404);
      }
      assert.equal((await request('/api/auth/get-session?probe=1')).status, 404);
      assert.equal((await request('/api/auth/sign-out')).status, 404);
    });
    await context.test('allowed routes use the actual Worker session and admin authorization', async () => {
      const session = await request('/api/auth/get-session');
      assert.equal(session.status, 200); assert.equal(await session.json(), null);
      assert.equal(session.headers.get('cache-control'), 'no-store');
      assert.equal((await request('/api/admin/session')).status, 401);
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
    });
    await context.test('real password login passes application cookies; logout revokes the session', async () => {
      const id = 'a0000000-0000-4000-8000-000000000001';
      const email = 'synthetic-wrapper-recovery@example.invalid';
      const password = 'Synthetic-wrapper-only!2026';
      const now = new Date().toISOString();
      await db.batch([
        db.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)')
          .bind(id, 'Synthetic wrapper fixture', email, now, now),
        db.prepare("INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,'credential',?,?,?,?)")
          .bind(id + '-credential', id, id, await bcrypt.hash(password, 10), now, now),
      ]);
      const login = await request('/api/auth/sign-in/email', { method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
      assert.equal(login.status, 200);
      const cookie = login.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
      assert.ok(cookie);
      const authenticated = { ...headers, cookie };
      assert.equal((await (await request('/api/auth/get-session', { headers: authenticated })).json()).user.id, id);
      assert.equal((await request('/api/admin/session', { headers: authenticated })).status, 403);
      assert.equal((await request('/api/auth/sign-out', { method: 'POST',
        headers: { ...authenticated, 'content-type': 'application/json' }, body: '{}' })).status, 200);
      assert.equal(await (await request('/api/auth/get-session', { headers: authenticated })).json(), null);
      assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM session').first('count'), 0);
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
    });
  } finally { await mf.dispose(); }
});
