/** Independent readback of the initial Master import. This does not prove a
 * frozen source, a complete snapshot, coordinator ownership or public readiness.
 * Generated audit IDs/times are checked structurally; source fields are exact.
 */
import { createHash } from 'node:crypto';
import { createEmojiReleaseArtifacts } from '../build-emoji-release.ts';
import { canonicalJson } from './snapshot-format.mjs';
import { renderReferenceMasterReleaseSql, verifyStagedReferenceMasterRelease, REFERENCE_MASTER_TABLES } from './reference-master-release.mjs';
import { readVerifiedEmojiMasterActiveRelease } from './emoji-master-release-activation-core.mjs';
import { verifyMasterRuntimeSchema } from './master-runtime-schema.mjs';
import { isProductionRemoteD1, assertProductionRemoteD1Target, isReadOnlyProductionSql } from './production-remote-d1.mjs';
import { assertUtcMicrosecondTimestamp } from '../../workers/api/src/utc-timestamp.mjs';

const fail = code => { throw Error('master_import_readback_' + code); };
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value).sort(), [...expected].sort());
const columns = 'id emoji short_name keywords category subcategory codepoints sort_order created_at updated_at'.split(' ');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const MASTER_EMPTY_AUTH_TABLES = Object.freeze(['user', 'account', 'session', 'verification', 'twoFactor', 'adminRole', 'mfaAssurance']);
const releaseRows = ['fanmark_tier_release_rows', 'fanmark_language_release_rows', 'fanmark_reserved_emoji_pattern_release_rows', 'fanmark_extension_price_release_rows'];
export const MASTER_EMPTY_IMPORT_TABLES = Object.freeze([
  'emoji_master', 'fanmark_emoji_master_release_imports', 'fanmark_emoji_master_release_staging',
  'fanmark_emoji_master_active_release', 'fanmark_emoji_master_release_activations',
  'fanmark_emoji_master_mutation_context', 'fanmark_emoji_master_change_audits',
  'fanmark_reference_master_releases', 'fanmark_reference_master_release_tables',
  'fanmark_reference_master_extension_price_manifests', 'fanmark_reference_master_active_release',
  'fanmark_reference_master_release_activations', ...releaseRows, ...MASTER_EMPTY_AUTH_TABLES,
]);

export function prepareMasterImportProjection(projection) {
  // Detach before the first await. An operator cannot change the expectation
  // while an import or independent comparison is in flight.
  try {
    const expected = structuredClone(projection);
    if (expected?.format !== 'fanmark-master-projection-v1' || Buffer.byteLength(JSON.stringify(expected)) > 32 * 1024 * 1024 ||
        !Array.isArray(expected.canonicalEmojiRows) || !expected.canonicalEmojiRows.length || expected.canonicalEmojiRows.length > 8000 ||
        !keys(expected.sourceTableHashes, ['emoji_master', ...REFERENCE_MASTER_TABLES]) ||
        Object.values(expected.sourceTableHashes).some(value => !/^[0-9a-f]{64}$/.test(value)) ||
        !Array.isArray(expected.referenceSnapshot) || expected.referenceSnapshot.length !== 4) fail('projection_invalid');
    let previous = '';
    for (const row of expected.canonicalEmojiRows) {
      if (!keys(row, columns) || typeof row.id !== 'string' || !uuid.test(row.id) || previous >= row.id) fail('projection_invalid');
      previous = row.id;
      assertUtcMicrosecondTimestamp(row.created_at); assertUtcMicrosecondTimestamp(row.updated_at);
    }
    const artifact = createEmojiReleaseArtifacts(expected.canonicalEmojiRows.map(({ created_at, updated_at, ...row }) =>
      ({ ...row, keywords: JSON.parse(row.keywords), codepoints: JSON.parse(row.codepoints) })));
    if (!same(artifact, expected.emojiArtifact)) fail('projection_invalid');
    if (expected.referenceSnapshotSha256 !== hash(JSON.stringify(expected.referenceSnapshot))) fail('projection_invalid');
    for (let i = 0; i < 4; i++) {
      const entry = expected.referenceSnapshot[i];
      if (entry.table_name !== REFERENCE_MASTER_TABLES[i] || entry.source_sha256 !== expected.sourceTableHashes[entry.table_name] ||
          !Array.isArray(entry.records) || entry.records.length > 4000) fail('projection_invalid');
    }
    renderReferenceMasterReleaseSql({ snapshot: expected.referenceSnapshot, snapshotSha256: expected.referenceSnapshotSha256, activationId: 'projection-validation' });
    return expected;
  } catch { fail('projection_invalid'); }
}

export async function verifyImportedMasterProjection({ database, projection, targetIncarnation, activationIds } = {}) {
  const expected = prepareMasterImportProjection(projection);
  if (!keys(activationIds, ['emoji', 'reference']) || !uuid.test(activationIds.emoji) || !uuid.test(activationIds.reference) ||
      activationIds.emoji === activationIds.reference) fail('activation_ids_invalid');
  const ids = { ...activationIds }, production = isProductionRemoteD1(database);
  if (production && (database.access !== 'read-only' || database.targetIdentity.databaseName !== 'fanmark-production-master')) fail('target_invalid');
  async function identity() {
    if (production) try { await assertProductionRemoteD1Target(database, targetIncarnation); } catch { fail('target_invalid'); }
  }
  async function query(sql, bindings = []) {
    if (!isReadOnlyProductionSql(sql)) fail('read_only_violation');
    let result;
    try { result = await database.prepare(sql).bind(...bindings).all(); } catch { fail('read_failed'); }
    if (result?.success !== true || !Array.isArray(result.results) || result.meta?.rows_written !== 0 ||
        result.results.some(row => !row || typeof row !== 'object' || Array.isArray(row))) fail('result_invalid');
    return result.results;
  }
  const facade = { prepare(sql) {
    const statement = values => ({ bind: (...next) => statement(next), all: async () => ({ success: true, results: await query(sql, values), meta: { rows_written: 0 } }),
      first: async () => (await query(sql, values))[0] ?? null });
    return statement([]);
  } };
  async function counts() {
    const expectedCounts = Object.fromEntries(MASTER_EMPTY_IMPORT_TABLES.map(table => [table, 0]));
    Object.assign(expectedCounts, { emoji_master: expected.canonicalEmojiRows.length,
      fanmark_emoji_master_release_imports: 1, fanmark_emoji_master_release_staging: expected.canonicalEmojiRows.length,
      fanmark_emoji_master_active_release: 1, fanmark_emoji_master_release_activations: 1,
      fanmark_emoji_master_change_audits: expected.canonicalEmojiRows.length,
      fanmark_reference_master_releases: 1, fanmark_reference_master_release_tables: 3,
      fanmark_reference_master_extension_price_manifests: 1, fanmark_reference_master_active_release: 1,
      fanmark_reference_master_release_activations: 1 });
    releaseRows.forEach((table, i) => { expectedCounts[table] = expected.referenceSnapshot[i].records.length; });
    const actual = await query('SELECT ' + Object.keys(expectedCounts).map(table => `(SELECT count(*) FROM "${table}") AS "${table}"`).join(','));
    if (actual.length !== 1 || !same(actual[0], expectedCounts)) fail('table_count_mismatch');
    const generations = await query('SELECT id,generation FROM mfaGeneration');
    if (!same(generations, [{ id: 1, generation: 0 }])) fail('unexpected_auth_state');
  }
  async function activation(prefix, version, id) {
    const active = await query(`SELECT * FROM ${prefix}_active_release`), audits = await query(`SELECT * FROM ${prefix}_release_activations`);
    if (active.length !== 1 || audits.length !== 1) fail('activation_mismatch');
    const a = active[0], audit = audits[0];
    try { assertUtcMicrosecondTimestamp(a.updated_at); } catch { fail('activation_mismatch'); }
    if (!same(a, { singleton_id: 1, release_version: version, previous_release_version: null, activation_id: id, action: 'promotion', generation: 1, updated_at: a.updated_at }) ||
        !same(audit, { activation_id: id, generation: 1, action: 'promotion', from_version: null, to_version: version, created_at: a.updated_at })) fail('activation_mismatch');
  }
  await identity();
  let schema;
  try { schema = await verifyMasterRuntimeSchema(facade); } catch { fail('schema_unconfirmed'); }
  await counts();
  const wanted = new Map(expected.canonicalEmojiRows.map(row => [row.id, row]));
  const seen = new Set(), auditSeen = new Set();
  for (let offset = 0; offset <= wanted.size; offset += 100) {
    const rows = await query('SELECT * FROM emoji_master ORDER BY id LIMIT 100 OFFSET ?', [offset]);
    if (rows.length > 100) fail('result_invalid');
    for (const row of rows) {
      if (!wanted.has(row.id) || seen.has(row.id) || !same(row, wanted.get(row.id))) fail('canonical_row_mismatch');
      seen.add(row.id);
    }
    const audits = await query('SELECT * FROM fanmark_emoji_master_change_audits ORDER BY resource_id,id LIMIT 100 OFFSET ?', [offset]);
    if (audits.length > 100) fail('result_invalid');
    for (const audit of audits) {
      const row = wanted.get(audit.resource_id);
      try { assertUtcMicrosecondTimestamp(audit.created_at); } catch { fail('change_audit_mismatch'); }
      if (!row || auditSeen.has(row.id) || !uuid.test(audit.id) ||
          !same(audit, { id: audit.id, user_id: null, action: 'EMOJI_MASTER_INSERT', resource_type: 'emoji_master', resource_id: row.id,
            request_id: null, metadata: JSON.stringify({ emoji: row.emoji, short_name: row.short_name }), created_at: audit.created_at })) fail('change_audit_mismatch');
      auditSeen.add(row.id);
    }
    if (rows.length < 100 && audits.length < 100) break;
  }
  if (seen.size !== wanted.size || auditSeen.size !== wanted.size) fail('canonical_row_mismatch');
  try {
    const active = await readVerifiedEmojiMasterActiveRelease(facade, createEmojiReleaseArtifacts);
    if (!active || active.version !== expected.emojiArtifact.version || active.generation !== 1 ||
        !same(active.records, expected.emojiArtifact.records) ||
        !await verifyStagedReferenceMasterRelease({ database: facade, snapshot: expected.referenceSnapshot, snapshotSha256: expected.referenceSnapshotSha256 })) fail('release_mismatch');
  } catch { fail('release_mismatch'); }
  for (const table of ['fanmark_emoji_master_release_imports', 'fanmark_reference_master_releases']) {
    const rows = await query(`SELECT status,created_at,verified_at FROM ${table}`);
    if (rows.length !== 1 || rows[0].status !== 'ready') fail('release_mismatch');
    try { assertUtcMicrosecondTimestamp(rows[0].created_at); assertUtcMicrosecondTimestamp(rows[0].verified_at); } catch { fail('release_mismatch'); }
    if (rows[0].verified_at < rows[0].created_at) fail('release_mismatch');
  }
  await activation('fanmark_emoji_master', expected.emojiArtifact.version, ids.emoji);
  await activation('fanmark_reference_master', expected.referenceSnapshotSha256, ids.reference);
  if ((await query('SELECT * FROM pragma_foreign_key_check')).length) fail('foreign_key_failed');
  await counts();
  try { await verifyMasterRuntimeSchema(facade); } catch { fail('schema_unconfirmed'); }
  await identity();
  return { version: 1, scope: 'master-projection-readback', consistency: 'unfenced-readback', canonicalRowsReconciled: true,
    releaseRowsReconciled: true, initialActivationsReconciled: true, initialChangeAuditShapeVerified: true, unusedAuthStateEmpty: true,
    totals: { emoji: wanted.size, reference: expected.referenceSnapshot.reduce((n, table) => n + table.records.length, 0) },
    schemaSha256: schema.schemaSha256, productionReady: false, fullMigrationReconciled: false, deployable: false };
}
