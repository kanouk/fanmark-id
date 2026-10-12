import assert from 'node:assert/strict';
import {STAGING_EMOJI_PUBLICATION_TARGETS} from './staging-emoji-targets.mjs';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createEmojiReleaseArtifacts } from '../build-emoji-release.ts';
import { STAGING_EMOJI_TARGET as target, readStagingEmojiMaster, exportEmojiMain,
  parseEmojiExportArguments, assertPinnedEmojiRuntime } from './staging-emoji-master-export.mjs';

const record = { id: '00000000-0000-4000-8000-000000000001', emoji: '👋🏽', short_name: 'wave',
  keywords: ['wave'], category: null, subcategory: 'hand', codepoints: ['1F44B', '1F3FD'], sort_order: 2 };
const activeVersion = createEmojiReleaseArtifacts([record]).version;
const row = { ...record, keywords: JSON.stringify(record.keywords), codepoints: JSON.stringify(record.codepoints),
  active_version: activeVersion, unrelated_private_column: 'not-to-be-exported' };
const token = 'synthetic-monitor-token';
test('release export rejects other Node runtimes to keep ICU-generated release hashes reproducible', () => {
  assert.doesNotThrow(() => assertPinnedEmojiRuntime('v22.6.0'));
  for (const version of ['v24.21.0', 'v22.7.0', 'v18.17.0']) {
    assert.throws(() => assertPinnedEmojiRuntime(version), /emoji_export_requires_node_22_6_0/u);
  }
});
function fixture({ rows = [row], meta = { rows_written: 0, changed_db: false }, bindingId,
  afterBindingId, profile=STAGING_EMOJI_PUBLICATION_TARGETS[0], identityName = profile.masterName } = {}) {
  const calls = []; let settingsReads = 0;
  const fetchImpl = async (url, init) => {
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.authorization, `Bearer ${token}`);
    calls.push({ url, method: init.method, body: init.body });
    let result;
    if (url.endsWith('/settings')) {
      settingsReads++;
      result = { bindings: [{ name: 'MASTER_DB', type: 'd1',
        id: settingsReads > 1 ? afterBindingId ?? profile.masterId : bindingId ?? profile.masterId },
      { name: 'D1_TOPOLOGY', type: 'plain_text', text: 'split' },{name:'RECOVERY_DRAIN_SCOPE_DIGEST',type:'plain_text',text:profile.scope}] };
    } else if (url.endsWith('/query')) {
      assert.equal(init.method, 'POST');
      const payload = JSON.parse(init.body);
      assert.deepEqual(payload.params, []);
      assert.match(payload.sql, /^SELECT /u);
      assert.match(payload.sql, /FROM emoji_master ORDER BY id LIMIT 10001/u);
      assert.doesNotMatch(payload.sql, /INSERT|UPDATE|DELETE|\buser\b|\baccount\b|\bsession\b/iu);
      result = [{ success: true, results: rows, meta }];
    } else {
      assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${target.account}/d1/database/${profile.masterId}`);
      result = { uuid: profile.masterId, name: identityName };
    }
    return Response.json({ success: true, result });
  };
  return { calls, fetchImpl };
}

test('fixed Master draft export decodes arrays, preserves UUID/sort order and does not expose extra fields', async () => {
  const f = fixture();
  const snapshot = await readStagingEmojiMaster({ token, fetchImpl: f.fetchImpl, expectedActive: activeVersion });
  assert.deepEqual(snapshot.records, [record]);
  assert.equal(snapshot.draftVersion, activeVersion);
  assert.equal(snapshot.activeVersion, activeVersion);
  assert.equal(snapshot.rowsWritten, 0);
  assert.doesNotMatch(snapshot.recordsSource, /not-to-be-exported/);
  assert.equal(f.calls.filter(x => x.method === 'POST').length, 1);
  assert.ok(f.calls.every(x => !x.url.includes('supabase') && !x.url.includes('/auth')));
});

test('wrong binding or database identity is rejected before the fixed query; changed binding also rejects output', async () => {
  for (const options of [{ bindingId: 'wrong' }, { identityName: 'old-master' }]) {
    const f = fixture(options);
    await assert.rejects(readStagingEmojiMaster({ token, fetchImpl: f.fetchImpl }));
    assert.equal(f.calls.filter(x => x.method === 'POST').length, 0);
  }
  const f = fixture({ afterBindingId: 'wrong' });
  await assert.rejects(readStagingEmojiMaster({ token, fetchImpl: f.fetchImpl }));
});

test('write receipts, mixed versions, duplicates, malformed JSON arrays and stale expected version fail closed', async () => {
  for (const options of [
    { meta: { rows_written: 1, changed_db: true } },
    { rows: [{ ...row, keywords: '{' }] },
    { rows: [{ ...row, codepoints: 'null' }] },
    { rows: [row, row] },
    { rows: [row, { ...row, active_version: 'b'.repeat(64) }] },
    { rows: [] },
    { rows: Array.from({ length: 10001 }, () => row) },
  ]) {
    const f = fixture(options);
    await assert.rejects(readStagingEmojiMaster({ token, fetchImpl: f.fetchImpl }));
  }
  await assert.rejects(readStagingEmojiMaster({ token, fetchImpl: fixture().fetchImpl,
    expectedActive: 'f'.repeat(64) }));
});

test('oversized provider response is rejected before an export is returned', async () => {
  await assert.rejects(readStagingEmojiMaster({ token,
    fetchImpl: async () => new Response('x'.repeat(8 * 1024 * 1024 + 1)) }));
});

test('CLI produces a new complete snapshot only, preserves an existing file and leaves no temp file on failure', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fanmark-master-export-'));
  try {
    const output = path.join(dir, 'records.json');
    const readSnapshot = options => readStagingEmojiMaster({ ...options, fetchImpl: fixture().fetchImpl });
    const args = ['--read-only', '--output', output, '--expected-active', activeVersion];
    const result = await exportEmojiMain(args, { readToken: () => token, readSnapshot });
    assert.equal(result.catalogActivated, false);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), [record]);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    await writeFile(output, 'existing export');
    await assert.rejects(exportEmojiMain(args, { readToken: () => token, readSnapshot }));
    assert.equal(await readFile(output, 'utf8'), 'existing export');
    await assert.rejects(exportEmojiMain(['--read-only', '--output', path.join(dir, 'failed.json')], {
      readToken: () => token, readSnapshot: async () => { throw new Error('private provider diagnostic'); },
    }));
    assert.deepEqual(await readdir(dir), ['records.json']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CLI requires read-only mode and explicit JSON output, rejecting unknown/duplicate flags', () => {
  for (const args of [[], ['--output', 'x.json'], ['--read-only'], ['--read-only', '--output', 'x.ts'],
    ['--read-only', '--output', 'x.json', '--activate', 'yes'],
    ['--read-only', '--output', 'x.json', '--output', 'y.json']]) {
    assert.throws(() => parseEmojiExportArguments(args));
  }
});

test('export selects only the recognized live V3 Master and keeps it pinned across the read',async()=>{
 const profile=STAGING_EMOJI_PUBLICATION_TARGETS[1],f=fixture({profile});
 const result=await readStagingEmojiMaster({token,fetchImpl:f.fetchImpl});
 assert.equal(result.recordCount,1);assert.ok(f.calls.filter(x=>x.url.includes('/d1/database/')).every(x=>x.url.includes(profile.masterId)));
});
test('export recognizes V4 and pins every fixed Master read to that cohort',async()=>{
 const profile=STAGING_EMOJI_PUBLICATION_TARGETS[2],f=fixture({profile});
 const result=await readStagingEmojiMaster({token,fetchImpl:f.fetchImpl});
 assert.equal(result.recordCount,1);assert.ok(f.calls.filter(x=>x.url.includes('/d1/database/')).every(x=>x.url.includes(profile.masterId)));
});
