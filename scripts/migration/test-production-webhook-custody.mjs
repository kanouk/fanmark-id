import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, realpath, readFile, readdir, rm, chmod, symlink, link, writeFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes, randomUUID, webcrypto} from 'node:crypto';
import {canonicalJson, sha256Hex} from './snapshot-format.mjs';
import {prepareProductionWebhookRegistration, beginProductionWebhookRegistration, captureProductionWebhookResponse,
  verifyProductionWebhookRegistration, openProductionWebhookSecret} from './production-webhook-custody.mjs';

async function fixture(t, provider = 'stripe') {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'fanmark-webhook-custody-'));
  await chmod(directory, 0o700); t.after(() => rm(directory, {recursive: true, force: true}));
  const options = {directory, provider, operationId: randomUUID(), archiveKeyId: 'production-backup-' + randomUUID(),
    archiveKeyHex: randomBytes(32).toString('hex')};
  const begun = await beginProductionWebhookRegistration(options);
  options.expectedIntentSha256 = begun.intentSha256;
  const secret = 'whsec_' + randomBytes(32).toString('base64');
  const endpoint = provider === 'stripe' ? {id: 'we_fixture123', object: 'webhook_endpoint', status: 'enabled',
    livemode: true, application: null, url: begun.request.body.url, api_version: begun.request.body.api_version,
    metadata: begun.request.body.metadata, enabled_events: begun.request.body.enabled_events} :
    {id: randomUUID(), object: 'webhook', status: 'enabled', endpoint: begun.request.body.endpoint, events: begun.request.body.events};
  const response = provider === 'stripe' ? {...endpoint, secret} : {object: 'webhook', id: endpoint.id, signing_secret: secret};
  const readback = provider === 'stripe' ? {accountId: begun.request.accountId, endpoint} :
    {senderDomain: {name: 'fanmark.id', status: 'verified'}, endpoint: {...endpoint, signing_secret: secret}};
  return {options, begun, secret, endpoint, response, readback};
}

for (const provider of ['stripe', 'resend']) test(provider + ' custody preserves encrypted response and opens only after independent readback', async t => {
  const f = await fixture(t, provider);
  const captured = await captureProductionWebhookResponse({...f.options, httpStatus: 201, response: f.response});
  f.options.expectedResponseSha256 = captured.responseSha256;
  await assert.rejects(openProductionWebhookSecret({...f.options, expectedReportSha256: 'a'.repeat(64)}));
  const verified = await verifyProductionWebhookRegistration({...f.options, readback: f.readback});
  const opened = await openProductionWebhookSecret({...f.options, expectedReportSha256: verified.reportSha256});
  assert.equal(opened.secret, f.secret); assert.equal(opened.binding, f.begun.request.binding);
  assert.equal(verified.productionReady, false); assert.equal(captured.retryAllowed, false);
  const publicOutputs = JSON.stringify([f.begun, captured, verified]);
  assert.ok(!publicOutputs.includes(f.secret)); assert.ok(!publicOutputs.includes(f.options.archiveKeyHex));
  for (const name of await readdir(f.options.directory)) {
    const path = join(f.options.directory, name), bytes = await readFile(path, 'utf8');
    assert.ok(!bytes.includes(f.secret)); assert.ok(!bytes.includes(f.options.archiveKeyHex));
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
  // Independently decode the real saved AES-GCM envelope using WebCrypto.
  const e = JSON.parse(await readFile(join(f.options.directory, provider + '-registration-response.enc.json'), 'utf8'));
  const key = await webcrypto.subtle.importKey('raw', Buffer.from(f.options.archiveKeyHex, 'hex'), 'AES-GCM', false, ['decrypt']);
  const clear = await webcrypto.subtle.decrypt({name: 'AES-GCM', iv: Buffer.from(e.nonce, 'base64'),
    additionalData: Buffer.from(canonicalJson(e.header))}, key, Buffer.concat([Buffer.from(e.ciphertext, 'base64'), Buffer.from(e.tag, 'base64')]));
  assert.deepEqual(JSON.parse(Buffer.from(clear).toString('utf8')), {httpStatus: 201, response: f.response});
  new Uint8Array(clear).fill(0);
});

test('a different operation ID cannot erase or bypass a previous unknown attempt in the same directory', async t => {
  const f = await fixture(t);
  const path = join(f.options.directory, 'stripe-registration-intent.json'), before = await readFile(path);
  const attempts = await Promise.allSettled([1, 2].map(() => beginProductionWebhookRegistration({...f.options, operationId: randomUUID()})));
  assert.ok(attempts.every(x => x.status === 'rejected'));
  assert.deepEqual(await readFile(path), before);
  assert.deepEqual(await readdir(f.options.directory), ['stripe-registration-intent.json']);
});

test('two simultaneous first attempts persist exactly one identity', async t => {
  const f = await fixture(t);
  await rm(join(f.options.directory, 'stripe-registration-intent.json'));
  const ids = [randomUUID(), randomUUID()];
  const results = await Promise.allSettled(ids.map(operationId => beginProductionWebhookRegistration({...f.options, operationId})));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const stored = JSON.parse(await readFile(join(f.options.directory, 'stripe-registration-intent.json'), 'utf8'));
  assert.equal(stored.request.operationId, ids[results.findIndex(r => r.status === 'fulfilled')]);
});

test('response capture snapshots caller input before asynchronous filesystem checks', async t => {
  const f = await fixture(t), options = {...f.options, httpStatus: 200, response: structuredClone(f.response)};
  const pending = captureProductionWebhookResponse(options);
  options.response.secret = 'whsec_replaced_by_caller'; options.httpStatus = 500;
  const captured = await pending;
  const verified = await verifyProductionWebhookRegistration({...f.options, expectedResponseSha256: captured.responseSha256, readback: f.readback});
  const opened = await openProductionWebhookSecret({...f.options, expectedResponseSha256: captured.responseSha256,
    expectedReportSha256: verified.reportSha256});
  assert.equal(opened.secret, f.secret);
});

test('bad/unknown provider replies remain encrypted and cannot yield a verified registration or a secret', async t => {
  const f = await fixture(t);
  const response = {error: {message: f.secret}, id: f.response.id, secret: f.secret};
  const r = await captureProductionWebhookResponse({...f.options, httpStatus: 500, response});
  await assert.rejects(verifyProductionWebhookRegistration({...f.options, expectedResponseSha256: r.responseSha256, readback: f.readback}),
    e => e.message === 'production_webhook_custody_readback_mismatch' && !e.message.includes(f.secret));
  await assert.rejects(captureProductionWebhookResponse({...f.options, httpStatus: 200, response: f.response}), /EEXIST/);
  assert.ok((await readdir(f.options.directory)).includes('stripe-registration-response.enc.json'));
  assert.ok(!(await readdir(f.options.directory)).includes('stripe-registration-verified.json'));
});

test('wrong account, mode, endpoint, version, event set, operation or Connect application cannot verify', async t => {
  const f = await fixture(t);
  const r = await captureProductionWebhookResponse({...f.options, httpStatus: 200, response: f.response});
  const mutations = [r => {r.accountId = 'acct_wrong';}, r => {r.endpoint.livemode = false;},
    r => {r.endpoint.url = 'https://example.com';}, r => {r.endpoint.api_version = '2025-10-29.clover';},
    r => {r.endpoint.enabled_events = ['*'];}, r => {r.endpoint.metadata = {};},
    r => {r.endpoint.status = 'disabled';}, r => {r.endpoint.application = 'ca_wrong';},
    r => {r.endpoint.id = 'we_other';}];
  for (const mutate of mutations) {
    const readback = structuredClone(f.readback); mutate(readback);
    await assert.rejects(verifyProductionWebhookRegistration({...f.options, expectedResponseSha256: r.responseSha256, readback}), /readback_mismatch/);
  }
  assert.ok(!(await readdir(f.options.directory)).includes('stripe-registration-verified.json'));
});

test('Resend requires verified sender identity and the exact key if GET supplies it', async t => {
  const f = await fixture(t, 'resend');
  const r = await captureProductionWebhookResponse({...f.options, httpStatus: 201, response: f.response});
  for (const mutate of [r => {r.senderDomain.status = 'pending';}, r => {r.senderDomain.name = 'other.example';},
    r => {r.endpoint.signing_secret = 'whsec_wrong';}, r => {r.endpoint.events = ['email.sent'];}]) {
    const readback = structuredClone(f.readback); mutate(readback);
    await assert.rejects(verifyProductionWebhookRegistration({...f.options, expectedResponseSha256: r.responseSha256, readback}), /readback_mismatch/);
  }
});

test('a Resend key too short for the actual receiver stays preserved but unverified', async t => {
  const f = await fixture(t, 'resend');
  f.response.signing_secret = 'whsec_' + Buffer.alloc(12, 1).toString('base64');
  const captured = await captureProductionWebhookResponse({...f.options, httpStatus: 201, response: f.response});
  f.readback.endpoint.signing_secret = f.response.signing_secret;
  await assert.rejects(verifyProductionWebhookRegistration({...f.options,
    expectedResponseSha256: captured.responseSha256, readback: f.readback}), /signing_secret_invalid/);
});

test('a changed custody key cannot capture a response under a different archive key', async t => {
  const f = await fixture(t);
  await assert.rejects(captureProductionWebhookResponse({...f.options, archiveKeyHex: randomBytes(32).toString('hex'),
    httpStatus: 200, response: f.response}), /envelope_invalid/);
  assert.deepEqual(await readdir(f.options.directory), ['stripe-registration-intent.json']);
});

test('tampered encrypted header or payload is rejected even if the caller supplies its new file hash', async t => {
  const f = await fixture(t);
  await captureProductionWebhookResponse({...f.options, httpStatus: 200, response: f.response});
  const path = join(f.options.directory, 'stripe-registration-response.enc.json'), before = JSON.parse(await readFile(path, 'utf8'));
  for (const mutate of [e => {e.header.operationId = randomUUID();}, e => {e.ciphertext = Buffer.from('tampered').toString('base64');}]) {
    const e = structuredClone(before); mutate(e); const bytes = canonicalJson(e) + '\n';
    await writeFile(path, bytes);
    await assert.rejects(verifyProductionWebhookRegistration({...f.options, expectedResponseSha256: sha256Hex(bytes), readback: f.readback}), /envelope_invalid/);
  }
});

test('private permissions, symlinks and hardlinks are enforced before response capture', async t => {
  const f = await fixture(t), intentPath = join(f.options.directory, 'stripe-registration-intent.json');
  await chmod(f.options.directory, 0o755);
  await assert.rejects(captureProductionWebhookResponse({...f.options, httpStatus: 200, response: f.response}), /directory_invalid/);
  await chmod(f.options.directory, 0o700); await chmod(intentPath, 0o644);
  await assert.rejects(captureProductionWebhookResponse({...f.options, httpStatus: 200, response: f.response}), /file_invalid/);
  await chmod(intentPath, 0o600);
  await link(intentPath, join(f.options.directory, 'linked.json'));
  await assert.rejects(captureProductionWebhookResponse({...f.options, httpStatus: 200, response: f.response}), /file_invalid/);
  await rm(join(f.options.directory, 'linked.json'));
  await symlink(intentPath, join(f.options.directory, 'stripe-registration-response.enc.json'));
  await assert.rejects(captureProductionWebhookResponse({...f.options, httpStatus: 200, response: f.response}));
});

test('fixed provider request cannot point to a different account or destination', () => {
  assert.throws(() => prepareProductionWebhookRegistration({provider: 'unknown', operationId: randomUUID()}), /identity_invalid/);
  const a = prepareProductionWebhookRegistration({provider: 'stripe', operationId: randomUUID()});
  a.body.enabled_events.length = 0;
  const b = prepareProductionWebhookRegistration({provider: 'stripe', operationId: randomUUID()});
  assert.equal(b.body.enabled_events.length, 10);
  assert.equal(b.body.connect, false);
  assert.equal(b.body.url, 'https://fanmark.id/api/stripe/webhook');
});
