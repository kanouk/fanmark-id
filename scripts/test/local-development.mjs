import assert from 'node:assert/strict';
import { request as httpsRequest } from 'node:https';
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { startLocalStack } from '../dev/local-stack.mjs';
import { verifyLocalBrowser } from './local-browser.mjs';

function totp(uri) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const secret = new URL(uri).searchParams.get('secret').toUpperCase().replace(/=+$/u, '');
  const bits = [...secret].map(char => {
    const value = alphabet.indexOf(char);
    assert.notEqual(value, -1);
    return value.toString(2).padStart(5, '0');
  }).join('');
  const key = Buffer.from(bits.match(/.{8}/gu).map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

function client(origin) {
  const cookies = new Map();
  return async (pathname, { method = 'GET', body, headers = {} } = {}) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const request = httpsRequest(origin + pathname, {
        method, rejectUnauthorized: false,
        headers: { Origin: origin, Cookie: [...cookies].map(([name, value]) => name + '=' + value).join('; '),
          ...(bytes ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(bytes) } : {}), ...headers },
      }, response => {
        for (const cookie of response.headers['set-cookie'] ?? []) {
          const pair = cookie.split(';', 1)[0];
          const separator = pair.indexOf('=');
          cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
        }
        let text = '';
        response.on('data', chunk => text += chunk);
        response.on('end', () => {
          let json;
          try { json = JSON.parse(text); } catch { /* HTML and empty responses are legitimate. */ }
          console.log('[local test]', method, pathname, response.statusCode);
          resolve({ status: response.statusCode, headers: response.headers, text, json });
        });
      });
      request.setTimeout(30_000, () => request.destroy(new Error('local_request_timeout')));
      request.on('error', reject);
      if (bytes) request.write(bytes);
      request.end();
    });
  };
}

const stack = await startLocalStack({ port: 0, watch: false });
console.log('[local test] stack ready');
const checks = [];
try {
  const anonymous = client(stack.origin);
  const owner = client(stack.origin);
  const other = client(stack.origin);
  const admin = client(stack.origin);
  const [ownerUser, otherUser, adminUser] = stack.fixtures.users;
  assert.equal((await anonymous('/')).status, 200);
  const catalog = await anonymous('/api/emoji/catalog?limit=500');
  assert.equal(catalog.status, 200);
  assert.equal(catalog.json.total, stack.fixtures.catalogCount);
  const capabilities = await anonymous('/api/auth/capabilities');
  assert.equal(capabilities.status, 200);
  assert.equal(capabilities.json.emailVerification, false);
  assert.deepEqual(capabilities.json.socialProviders, []);
  assert.equal((await anonymous('/api/me/profile')).status, 401);
  assert.equal((await anonymous('/api/admin/session')).status, 401);
  checks.push('public catalog and anonymous refusals');
  for (const [request, user] of [[owner, ownerUser], [other, otherUser], [admin, adminUser]]) {
    assert.equal((await request('/api/auth/sign-in/email', {
      method: 'POST', body: { email: user.email, password: user.password },
    })).status, 200);
  }
  const profile = await owner('/api/me/profile');
  assert.equal(profile.status, 200);
  assert.equal(profile.json.profile.user_id, ownerUser.id);
  assert.equal((await owner('/api/me/fanmarks/' + otherUser.fanmarkId + '/profile')).status, 404);
  assert.equal((await other('/api/me/fanmarks/' + ownerUser.fanmarkId + '/profile')).status, 404);
  const saved = await owner('/api/me/profile', { method: 'PATCH', body: { display_name: 'Local saved name' } });
  assert.equal(saved.status, 200);
  assert.equal((await owner('/api/me/profile')).json.profile.display_name, 'Local saved name');
  const database = await stack.runtime.getD1Database('FANMARK_DB');
  assert.equal((await database.prepare('SELECT display_name FROM user_settings WHERE user_id=?').bind(ownerUser.id).first()).display_name, 'Local saved name');
  checks.push('real login, own profile persistence and cross-owner refusals');
  assert.equal((await owner('/api/admin/session')).status, 403);
  const adminBefore = await admin('/api/admin/session');
  assert.equal(adminBefore.status, 403);
  const enrollment = await admin('/api/auth/two-factor/enable', {
    method: 'POST', body: { method: 'totp', password: adminUser.password },
  });
  assert.equal(enrollment.status, 200);
  assert.equal(typeof enrollment.json.totpURI, 'string');
  const verified = await admin('/api/auth/two-factor/verify-totp', {
    method: 'POST', body: { code: totp(enrollment.json.totpURI) },
  });
  assert.equal(verified.status, 200);
  assert.equal((await admin('/api/admin/session')).status, 200);
  checks.push('real admin enrollment/TOTP and session assurance');
  await stack.rebuildWorker();
  assert.equal((await owner('/api/me/profile')).json.profile.display_name, 'Local saved name');
  assert.equal((await admin('/api/admin/session')).status, 200);
  checks.push('Worker reload preserves database, session and MFA assurance');
  for (const [pathname, body] of [
    ['/api/auth/sign-up/email', { email: 'new@example.invalid', password: ownerUser.password, name: 'Local' }],
    ['/api/auth/request-password-reset', { email: ownerUser.email, redirectTo: stack.origin }],
  ]) {
    const result = await anonymous(pathname, { method: 'POST', body });
    assert.equal(result.status, 403);
  }
  assert.deepEqual(stack.deniedOutbound, []);
  checks.push('disabled external flows and no provider calls');
  await verifyLocalBrowser(stack);
  checks.push('desktop/mobile browser search, acquisition, save and public profile');
  console.log(JSON.stringify({ state: 'verified', checks, catalogCount: stack.fixtures.catalogCount, actualWorker: true }));
} catch (error) {
  console.error('[local test] failed:', error);
  throw error;
} finally {
  await stack.stop();
  assert.equal(existsSync(stack.directory), false, 'temporary local state must be removed');
}
