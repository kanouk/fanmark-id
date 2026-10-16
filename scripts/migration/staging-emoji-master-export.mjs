#!/usr/bin/env node
/** Export only the current staging Master draft. Never import or activate a release. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { resolveStagingEmojiTarget } from './staging-emoji-targets.mjs';
import { createEmojiReleaseArtifacts } from '../build-emoji-release.ts';

export const STAGING_EMOJI_TARGET = Object.freeze({
  account: 'bfc2890741f0b3fb236e2d755b6c9adc',
  worker: 'fanmark-app-staging',
  databaseId: '02681378-5528-45a9-8093-76805a4705c9',
  databaseName: 'fanmark-recovery-staging-v2-e434eb11-master',
});
const MAX_BYTES = 8 * 1024 * 1024;
const VERSION_RE = /^[0-9a-f]{64}$/u;
export function assertPinnedEmojiRuntime(version = process.version) {
  // The existing generator uses ICU localeCompare; Node 24 changes module bytes.
  if (version !== 'v22.6.0') throw new Error('emoji_export_requires_node_22_6_0');
}
const SQL = `SELECT id, emoji, short_name, keywords, category, subcategory, codepoints, sort_order,
  (SELECT release_version FROM fanmark_emoji_master_active_release WHERE singleton_id = 1) AS active_version
  FROM emoji_master ORDER BY id LIMIT 10001`;

function assertMasterBinding(settings, expectedTarget) {
  assert.ok(Array.isArray(settings?.bindings));
  const bindings = settings.bindings.filter(row => row.name === 'MASTER_DB');
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].type, 'd1');
  const target=resolveStagingEmojiTarget(bindings[0].id,settings.bindings.find(row=>row.name==='RECOVERY_DRAIN_SCOPE_DIGEST')?.text);
  if(expectedTarget)assert.equal(target.name,expectedTarget.name);
  assert.equal(settings.bindings.find(row => row.name === 'D1_TOPOLOGY')?.text, 'split');
  return target;
}

/** Fixed endpoints and one fixed public-master SELECT; callers cannot supply SQL or a target. */
export async function readStagingEmojiMaster({ token, fetchImpl = fetch, expectedActive } = {}) {
  assertPinnedEmojiRuntime();
  assert.ok(typeof token === 'string' && token.length >= 16 && !/\s/u.test(token));
  if (expectedActive !== undefined) assert.match(expectedActive, VERSION_RE);
  const { account, worker } = STAGING_EMOJI_TARGET;
  async function request(resource, payload) {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${account}/${resource}`, {
      method: payload === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(30000),
    });
    assert.ok(response.ok);
    const reader = response.body?.getReader();
    assert.ok(reader);
    let size = 0;
    const chunks = [];
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error('emoji_export_response_too_large'); }
        chunks.push(Buffer.from(next.value));
      }
    } finally { reader.releaseLock(); }
    const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(envelope.success, true);
    return envelope.result;
  }
  const target=assertMasterBinding(await request(`workers/scripts/${worker}/settings`));
  const databaseId=target.masterId,databaseName=target.masterName;
  const identity = await request(`d1/database/${databaseId}`);
  assert.equal(identity.uuid ?? identity.id, databaseId);
  assert.equal(identity.name, databaseName);
  const result = await request(`d1/database/${databaseId}/query`, { sql: SQL, params: [] });
  assert.equal(result.length, 1);
  assert.equal(result[0].success, true);
  assert.equal(result[0].meta?.rows_written, 0);
  assert.equal(result[0].meta?.changed_db, false);
  const rows = result[0].results;
  assert.ok(Array.isArray(rows) && rows.length > 0 && rows.length <= 10000);
  const activeVersion = rows[0].active_version;
  assert.match(activeVersion, VERSION_RE);
  if (expectedActive !== undefined) assert.equal(activeVersion, expectedActive);
  const records = rows.map(row => {
    assert.equal(row.active_version, activeVersion);
    return {
      id: row.id, emoji: row.emoji, short_name: row.short_name,
      keywords: JSON.parse(row.keywords), category: row.category, subcategory: row.subcategory,
      codepoints: JSON.parse(row.codepoints), sort_order: row.sort_order,
    };
  });
  const built = createEmojiReleaseArtifacts(records);
  // Refuse an export if the application's Master binding moved while it was read.
  assertMasterBinding(await request(`workers/scripts/${worker}/settings`),target);
  return { activeVersion, draftVersion: built.version, recordsSource: built.recordsSource,
    records: built.records, recordCount: built.records.length, rowsWritten: 0 };
}

export function parseEmojiExportArguments(argv) {
  assert.equal(argv[0], '--read-only');
  let output, expectedActive;
  for (let i = 1; i < argv.length; i += 2) {
    const value = argv[i + 1];
    assert.ok(value && !value.startsWith('--'));
    if (argv[i] === '--output' && output === undefined) output = path.resolve(value);
    else if (argv[i] === '--expected-active' && expectedActive === undefined) {
      assert.match(value, VERSION_RE); expectedActive = value;
    } else throw new Error('emoji_export_arguments_invalid');
  }
  assert.ok(output && path.extname(output) === '.json');
  return { output, expectedActive };
}

function monitorToken() {
  if (process.env.FANMARK_STAGING_MONITOR_API_TOKEN) return process.env.FANMARK_STAGING_MONITOR_API_TOKEN;
  return execFileSync('security', ['find-generic-password', '-s', 'fanmark-app-staging-monitor',
    '-a', 'fanmark.id@gmail.com', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export async function exportEmojiMain(argv, { readSnapshot = readStagingEmojiMaster, readToken = monitorToken } = {}) {
  assertPinnedEmojiRuntime();
  const { output, expectedActive } = parseEmojiExportArguments(argv);
  const snapshot = await readSnapshot({ token: readToken(), expectedActive });
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, snapshot.recordsSource, { flag: 'wx', mode: 0o600 });
    // Link only after validation and complete writing; never overwrite an existing export.
    await link(temporary, output);
  } finally { await unlink(temporary).catch(() => {}); }
  return { output, activeVersion: snapshot.activeVersion, draftVersion: snapshot.draftVersion,
    recordCount: snapshot.recordCount, draftEqualsActive: snapshot.draftVersion === snapshot.activeVersion,
    rowsWritten: 0, catalogActivated: false };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(await exportEmojiMain(process.argv.slice(2)))); }
  catch { console.error(JSON.stringify({ code: 'staging_emoji_export_failed' })); process.exitCode = 1; }
}
