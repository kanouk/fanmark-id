import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {Miniflare} from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import {handleProductionDomainAlias as handle} from '../../workers/api/src/production-domain-alias.mjs';
const enabled = {PRODUCTION_ALIAS_REDIRECT: 'enabled'};
const request = (path, method = 'GET') => new Request(path, {method});

test('www preserves public path and query, fixes origin, and suppresses fragment inheritance', () => {
  for (const path of ['/f/example?lang=ja&page=2', '/%F0%9F%8C%B8', '//evil.invalid/path', '/about?next=https%3A%2F%2Fevil.invalid']) {
    const response = handle(request(`https://www.fanmark.id${path}#access_token=old`), enabled);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), `https://fanmark.id${path}#`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  }
});
test('admin only maps its known root and does not guess other paths or query semantics', async () => {
  const response = handle(request('https://admin.fanmark.id/', 'HEAD'), enabled);
  assert.equal(response.headers.get('location'), 'https://fanmark.id/admin#');
  assert.equal(await response.text(), '');
  for (const path of ['/unknown', '/?tab=users']) assert.equal(handle(request(`https://admin.fanmark.id${path}`), enabled).status, 404);
});
test('old authentication and API traffic never redirects', () => {
  assert.equal(handle(new Request('https://www.fanmark.id/', {headers:{authorization:'Bearer fixture'}}), enabled).status, 409);
  for (const path of ['/api/auth/callback/apple', '/auth', '/AUTH/v1/callback', '/%61pi/test', '/reset-password', '/storage/v1/object', '/functions/v1/handler', '/rest/v1/users', '/%2561pi/test', '/bad%ZZ', '/bad%0apath', '/?CODE=x', '/?access_token=x', '/?client_secret=x', '/?state=x', '/?session_id=x', '/?key=x']) {
    const response = handle(request(`https://www.fanmark.id${path}`), enabled);
    assert.ok([400,409].includes(response.status), path);
    assert.equal(response.headers.get('location'), null);
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = handle(request('https://www.fanmark.id/', method), enabled);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('location'), null);
  }
});
test('unknown hosts and unactivated config remain closed without accessing a backend', () => {
  for (const url of ['https://fanmark.id/', 'https://auth.fanmark.id/', 'https://www.fanmark.id.evil.invalid/', 'https://www.fanmark.id:8443/']) assert.equal(handle(request(url), enabled).status, 421);
  for (const value of [undefined, '', 'disabled', 'true']) assert.equal(handle(request('https://www.fanmark.id/'), {PRODUCTION_ALIAS_REDIRECT:value}).status, 503);
  const config = JSON.parse(readFileSync(new URL('../../workers/api/wrangler.alias-production-closed.jsonc', import.meta.url)));
  assert.equal(config.workers_dev, false); assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []); assert.deepEqual(config.triggers.crons, []);
  assert.deepEqual(config.vars, {PRODUCTION_ALIAS_REDIRECT:'disabled'});
  for (const binding of ['d1_databases','r2_buckets','services','durable_objects','assets']) assert.equal(config[binding], undefined);
});

test('native Worker keeps redirect headers and blocks unsafe requests without backend bindings', async () => {
  const source = readFileSync(new URL('../../workers/api/src/production-domain-alias.mjs', import.meta.url), 'utf8');
  const mf = new Miniflare({workers: ['enabled', 'disabled'].map(value => ({config: {
    name:value, type:'worker', compatibilityDate:'2026-09-18',
    env:{PRODUCTION_ALIAS_REDIRECT:{type:'text',value}},
    manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:source}}},
  }}))});
  try {
    const worker = await mf.getWorker('enabled');
    const response = await worker.fetch('https://www.fanmark.id/f/example?lang=ja', {redirect:'manual'});
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), 'https://fanmark.id/f/example?lang=ja#');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    const head = await worker.fetch('https://admin.fanmark.id/', {method:'HEAD',redirect:'manual'});
    assert.equal(head.headers.get('location'), 'https://fanmark.id/admin#');
    assert.equal(await head.text(), '');
    assert.equal((await worker.fetch('https://www.fanmark.id/api/auth/callback/apple', {method:'POST',body:'code=fixture',redirect:'manual'})).status, 405);
    assert.equal((await worker.fetch('https://www.fanmark.id/?access_token=fixture', {redirect:'manual'})).status, 409);
    assert.equal((await (await mf.getWorker('disabled')).fetch('https://www.fanmark.id/', {redirect:'manual'})).status, 503);
  } finally { await mf.dispose(); }
});
