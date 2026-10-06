import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from '../../workers/api/node_modules/esbuild/lib/main.js';
import { Miniflare } from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import { applyBusinessRuntimeMigrations, businessMigrationStatements } from './business-runtime-import-schema.mjs';

const bcrypt = createRequire(new URL('../../workers/api/package.json', import.meta.url))('bcryptjs');
const origin = 'https://synthetic-combined-recovery.example.test';
const vars = { RECOVERY_TOKEN: 'a'.repeat(64), RECOVERY_INCARNATION: '91111111-1111-4111-8111-111111111111',
  ...Object.fromEntries(['BUSINESS', 'AUTH', 'MASTER', 'AVATARS', 'COVERS'].map(kind =>
    [`RECOVERY_${kind}_NAME`, `fanmark-recovery-combined-native-${kind.toLowerCase()}`])),
  AUTH_BACKEND: 'better-auth', AUTH_USER_STATUS_BACKEND: 'd1', D1_TOPOLOGY: 'split',
  BETTER_AUTH_URL: origin, CORS_ALLOWED_ORIGINS: origin, STORAGE_BACKEND: 'r2',
  PROFILE_BACKEND: 'd1', OWNED_FANMARKS_BACKEND: 'd1',
  BETTER_AUTH_SECRET: 'synthetic-combined-recovery-secret-not-for-deployment-00000000' };
const owner = '90000000-0000-4000-8000-00000000000d';

test('full recovery Worker gates all stores and joins real Auth and Business reads', async context => {
  const compiled = await build({ entryPoints: [fileURLToPath(new URL('./isolated-recovery-combined-worker.mjs', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*', 'node:*'] });
  const mf = new Miniflare({ workers: [{ config: {
    name: 'synthetic-combined-recovery-native', type: 'worker', compatibilityDate: '2026-09-18',
    env: { ...Object.fromEntries(Object.entries(vars).map(([name, value]) => [name, { type: 'text', value }])),
      FANMARK_DB: { type: 'd1', name: vars.RECOVERY_BUSINESS_NAME }, AUTH_DB: { type: 'd1', name: vars.RECOVERY_AUTH_NAME },
      MASTER_DB: { type: 'd1', name: vars.RECOVERY_MASTER_NAME }, AVATARS_BUCKET: { type: 'r2', name: vars.RECOVERY_AVATARS_NAME },
      COVER_IMAGES_BUCKET: { type: 'r2', name: vars.RECOVERY_COVERS_NAME } },
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: compiled.outputFiles[0].text } } },
  } }] });
  try {
    const db = await mf.getD1Database('AUTH_DB'), business = await mf.getD1Database('FANMARK_DB');
    for (const name of ['0003_better_auth_core.sql', '0007_auth_signup_command.sql', '0008_auth_user_suspension.sql', '0009_auth_oauth_signup.sql']) {
      await db.batch(businessMigrationStatements(await readFile(new URL(`../../workers/api/migrations/${name}`, import.meta.url), 'utf8')).map(sql => db.prepare(sql)));
    }
    await applyBusinessRuntimeMigrations(business);
    const headers = { authorization: `Bearer ${vars.RECOVERY_TOKEN}`, 'x-recovery-incarnation': vars.RECOVERY_INCARNATION, origin };
    const request = (path, options = {}) => mf.dispatchFetch(origin + path, { headers, ...options });
    await context.test('all routes including public images require the recovery identity', async () => {
      for (const path of ['/api/auth/get-session', '/api/me/profile', `/api/storage/public/avatars/${owner}/avatar.png`]) {
        assert.equal((await request(path, { headers: {} })).status, 401);
        assert.equal((await request(path, { headers: { ...headers, 'x-recovery-incarnation': '92222222-2222-4222-8222-222222222222' } })).status, 403);
      }
      assert.deepEqual(await (await request('/_recovery/identity')).json(), { targetIncarnation: vars.RECOVERY_INCARNATION,
        databases: { business: vars.RECOVERY_BUSINESS_NAME, auth: vars.RECOVERY_AUTH_NAME, master: vars.RECOVERY_MASTER_NAME },
        buckets: { avatars: vars.RECOVERY_AVATARS_NAME, covers: vars.RECOVERY_COVERS_NAME } });
    });
    await context.test('application mutation, enrollment and arbitrary SQL remain closed', async () => {
      for (const [path, method] of [['/api/me/profile', 'PATCH'], ['/api/me/fanmarks', 'POST'],
        ['/api/auth/sign-up/email', 'POST'], ['/api/auth/two-factor/enable', 'POST'], ['/_recovery/sql', 'POST']]) {
        assert.equal((await request(path, { method, body: '{}' })).status, 404);
      }
      assert.equal((await request('/api/me/profile?probe=1')).status, 404);
      assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM user').first('count'), 0);
    });
    await context.test('actual SDK login supplies the exact owner to Business profile and fanmark reads', async () => {
      const email = 'synthetic-combined-owner@example.invalid', password = 'Synthetic-combined-only!2026', now = new Date().toISOString();
      await db.batch([db.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)')
        .bind(owner, 'Synthetic combined owner', email, now, now),
      db.prepare("INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,'credential',?,?,?,?)")
        .bind(owner + '-credential', owner, owner, await bcrypt.hash(password, 10), now, now)]);
      await business.prepare("INSERT INTO user_settings(user_id,username,display_name,plan_type,preferred_language,created_at,updated_at,requires_password_setup) VALUES(?,?,?,'free','ja',?,?,0)")
        .bind(owner, 'synthetic_combined_owner', 'Recovered profile', now, now).run();
      assert.equal((await request('/api/me/profile')).status, 401);
      const login = await request('/api/auth/sign-in/email', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
      assert.equal(login.status, 200);
      const cookie = login.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; '), authenticated = { ...headers, cookie };
      const profile = await request('/api/me/profile', { headers: authenticated });
      assert.equal(profile.status, 200); assert.equal((await profile.json()).profile.display_name, 'Recovered profile');
      assert.equal((await request('/api/me/fanmarks', { headers: authenticated })).status, 200);
      assert.equal((await request('/api/me/profile', { headers: { ...authenticated, origin: 'https://wrong-origin.example.invalid' } })).status, 403);
      assert.equal((await request('/api/auth/sign-out', { method: 'POST', headers: { ...authenticated, 'content-type': 'application/json' }, body: '{}' })).status, 200);
      assert.equal((await request('/api/me/profile', { headers: authenticated })).status, 401);
      assert.deepEqual((await business.prepare('PRAGMA foreign_key_check').all()).results, []);
    });
    await context.test('actual application image GET and HEAD use the bound separate R2 buckets', async () => {
      const bytes = new Uint8Array([1, 2, 3]);
      await (await mf.getR2Bucket('AVATARS_BUCKET')).put(`${owner}/avatar.png`, bytes, { httpMetadata: { contentType: 'image/png' } });
      const path = `/api/storage/public/avatars/${owner}/avatar.png`;
      const image = await request(path); assert.equal(image.status, 200); assert.deepEqual(new Uint8Array(await image.arrayBuffer()), bytes);
      assert.equal(image.headers.get('content-type'), 'image/png');
      const head = await request(path, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), '3');
      assert.equal((await request(`/api/storage/public/cover-images/${owner}/cover.png`)).status, 404);
    });
  } finally { await mf.dispose(); }
});
