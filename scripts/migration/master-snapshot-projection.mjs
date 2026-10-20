import { createHash } from 'node:crypto';
import { compileRowConverter } from './row-conversion.mjs';
import { canonicalJson, compareUtf8Tuple, getPrimaryKeyInfo, rowRecordForEnvelope } from './snapshot-format.mjs';
import { createEmojiReleaseArtifacts } from '../build-emoji-release.ts';
import { moneyUsdTextToCents, renderReferenceMasterReleaseSql, REFERENCE_MASTER_TABLES } from './reference-master-release.mjs';

export const MASTER_SOURCE_TABLES = Object.freeze(['emoji_master', ...REFERENCE_MASTER_TABLES]);
const MAX_BYTES = 32 * 1024 * 1024;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error('master_projection_' + code); };
const emojiColumns = ['id', 'emoji', 'short_name', 'keywords', 'category', 'subcategory', 'codepoints', 'sort_order', 'created_at', 'updated_at'];

/** Offline conversion of five already exported table streams. This checks the
 * selected streams, not the full snapshot/cohort, source freeze or admission to
 * production. The caller must verify those separately before any remote write.
 * No network, database, credentials or filesystem access occurs here. */
export function projectMasterSnapshot({ catalog, tables, approvedEmojiIdentity, credentialDescriptor }) {
  try {
    if (!/^[0-9a-f]{64}$/.test(approvedEmojiIdentity ?? '')) fail('approved_identity_required');
    if (!Array.isArray(tables) || tables.length !== MASTER_SOURCE_TABLES.length ||
        new Set(tables.map(t => t?.entry?.table)).size !== MASTER_SOURCE_TABLES.length ||
        tables.some(t => !MASTER_SOURCE_TABLES.includes(t?.entry?.table))) fail('table_set_invalid');
    const byName = new Map(tables.map(t => [t.entry.table, t]));
    const rows = {}, hashes = {};
    let totalBytes = 0;
    for (const name of MASTER_SOURCE_TABLES) {
      const { entry, stream } = byName.get(name);
      if (!(stream instanceof Uint8Array)) fail('stream_invalid');
      totalBytes += stream.byteLength;
      if (totalBytes > MAX_BYTES) fail('capacity_exceeded');
      const bytes = Buffer.from(stream);
      if (!/^[0-9a-f]{64}$/.test(entry.streamHash ?? '') || sha256(bytes) !== entry.streamHash ||
          String(bytes.length) !== entry.byteCount) fail('stream_digest_mismatch');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (text && !text.endsWith('\n')) fail('terminal_newline_missing');
      const lines = text ? text.slice(0, -1).split('\n') : [];
      if (String(lines.length) !== entry.rowCount) fail('row_count_mismatch');
      const convert = compileRowConverter(catalog, name, { credentialDescriptor }), primary = getPrimaryKeyInfo(catalog, name);
      // The row converter validates the complete source column contract. Entry
      // metadata is checked against each envelope below, including empty tables.
      const expectedColumns = catalog.columns.filter(c => c.table_name === name).sort((a, b) => a.ordinal - b.ordinal).map(c => c.column_name);
      if (canonicalJson(entry.columns) !== canonicalJson(expectedColumns) ||
          canonicalJson(entry.primaryKey) !== canonicalJson(primary.columns.map(c => c.name))) fail('columns_mismatch');
      let previous = null;
      rows[name] = lines.map((line, ordinal) => {
        const record = JSON.parse(line), converted = convert(record.envelope);
        const expected = rowRecordForEnvelope(record.envelope, primary, ordinal);
        if (canonicalJson(record) !== line || canonicalJson(record) !== canonicalJson(expected)) fail('row_record_invalid');
        if (previous && compareUtf8Tuple(previous, record.primaryKey) >= 0) fail('primary_key_order_invalid');
        previous = record.primaryKey;
        const row = Object.fromEntries(converted.columns.map((column, i) => [column, converted.bindings[i]]));
        if (name === 'emoji_master') {
          if (canonicalJson(Object.keys(row).sort()) !== canonicalJson([...emojiColumns].sort())) fail('emoji_columns_invalid');
        } else {
          if (![0, 1].includes(row.is_active)) fail('boolean_invalid');
          row.is_active = row.is_active === 1;
          if (name === 'fanmark_tiers') {
            // The generic Business converter emits cents; the reference release
            // API accepts the original decimal dollar text and converts once.
            const dollars = record.envelope.values.monthly_price_usd;
            if (moneyUsdTextToCents(dollars) !== row.monthly_price_usd) fail('money_unit_mismatch');
            row.monthly_price_usd = dollars;
          }
        }
        return row;
      });
      hashes[name] = entry.streamHash;
    }
    const canonicalEmojiRows = rows.emoji_master;
    const emojiArtifact = createEmojiReleaseArtifacts(canonicalEmojiRows.map(({ created_at, updated_at, ...row }) =>
      ({ ...row, keywords: JSON.parse(row.keywords), codepoints: JSON.parse(row.codepoints) })));
    if (!canonicalEmojiRows.length || emojiArtifact.manifest.identitySHA256 !== approvedEmojiIdentity) fail('approved_identity_mismatch');
    const referenceSnapshot = REFERENCE_MASTER_TABLES.map(table_name => ({ table_name,
      row_count: rows[table_name].length, source_sha256: hashes[table_name], records: rows[table_name] }));
    const referenceSnapshotSha256 = sha256(JSON.stringify(referenceSnapshot));
    // Reuse the release writer's field/type validation without executing SQL.
    renderReferenceMasterReleaseSql({ snapshot: referenceSnapshot, snapshotSha256: referenceSnapshotSha256,
      activationId: 'offline-master-projection-validation' });
    return { format: 'fanmark-master-projection-v1', canonicalEmojiRows, emojiArtifact,
      referenceSnapshot, referenceSnapshotSha256, sourceTableHashes: hashes,
      sourceFreezeVerified: false, fullSnapshotVerified: false, productionReady: false };
  } catch (error) {
    // Source content and parser exceptions may contain customer-controlled text.
    if (/^master_projection_[a-z_]+$/.test(error?.message ?? '')) throw error;
    fail('invalid');
  }
}
