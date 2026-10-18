/** Initial Master stage. Multiple transactions, never a whole-store atomic
 * operation. A partial/unknown outcome must keep the global fence and be
 * independently resolved; this stage neither resumes nor cleans up a target.
 */
import { prepareMasterImportProjection, verifyImportedMasterProjection, MASTER_EMPTY_IMPORT_TABLES } from './master-import-readback.mjs';
import { verifyMasterRuntimeSchema } from './master-runtime-schema.mjs';
import { isProductionRemoteD1, assertProductionRemoteD1Target } from './production-remote-d1.mjs';
import { isIsolatedRemoteD1 } from './isolated-remote-d1.mjs';
import { createEmojiReleaseArtifacts } from '../build-emoji-release.ts';
import { stageVerifiedEmojiMasterRelease } from './emoji-master-release-stage-core.mjs';
import { activateVerifiedEmojiMasterRelease } from './emoji-master-release-activation-core.mjs';
import { stageReferenceMasterRelease, activateReferenceMasterRelease } from './reference-master-release.mjs';

const fail = code => { throw Error('master_import_stage_' + code); };
const dirty = MASTER_EMPTY_IMPORT_TABLES.map(table => `EXISTS (SELECT 1 FROM "${table}")`).join(' OR ') +
  ' OR (SELECT count(*) FROM "mfaGeneration") <> 1 OR NOT EXISTS (SELECT 1 FROM "mfaGeneration" WHERE id = 1 AND generation = 0)';
const guard = `INSERT INTO "mfaAssurance" (id,userId,sessionId,factorId,generation,verifiedAt,expiresAt)
  SELECT NULL,NULL,NULL,NULL,NULL,NULL,NULL WHERE ${dirty}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function importMasterProjectionStage({ database, readDatabase, projection, targetIncarnation, activationIds, mode = 'local' } = {}) {
  const expected = prepareMasterImportProjection(projection);
  if (!activationIds || Object.keys(activationIds).sort().join(',') !== 'emoji,reference' ||
      !uuid.test(activationIds.emoji) || !uuid.test(activationIds.reference) || activationIds.emoji === activationIds.reference) fail('activation_ids_invalid');
  const ids = { ...activationIds }, production = isProductionRemoteD1(database);
  if (!['local', 'production-stage'].includes(mode) ||
      (mode === 'local' && (production || isProductionRemoteD1(readDatabase) || isIsolatedRemoteD1(database) || isIsolatedRemoteD1(readDatabase))) ||
      (mode === 'production-stage' && (!production || !isProductionRemoteD1(readDatabase)))) fail('transport_invalid');
  if (production) {
    if (database.access !== 'import' || readDatabase.access !== 'read-only' || database.targetIdentity.databaseName !== 'fanmark-production-master' ||
        JSON.stringify(database.targetIdentity) !== JSON.stringify(readDatabase.targetIdentity)) fail('transport_invalid');
    try { await assertProductionRemoteD1Target(database, targetIncarnation); await assertProductionRemoteD1Target(readDatabase, targetIncarnation); }
    catch { fail('target_invalid'); }
  }
  let state;
  try { await verifyMasterRuntimeSchema(readDatabase); state = await readDatabase.prepare(`SELECT CASE WHEN ${dirty} THEN 1 ELSE 0 END AS dirty`).all(); }
  catch { fail('preflight_failed'); }
  if (state?.success !== true || state.meta?.rows_written !== 0 || state.results?.length !== 1 || state.results[0].dirty !== 0) fail('target_not_empty_or_invalid');
  try {
    for (let offset = 0; offset < expected.canonicalEmojiRows.length; offset += 50) {
      const statements = offset === 0 ? [database.prepare(guard)] : [];
      for (const row of expected.canonicalEmojiRows.slice(offset, offset + 50)) {
        const columns = Object.keys(row);
        statements.push(database.prepare(`INSERT INTO emoji_master (${columns.map(c => `"${c}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`).bind(...columns.map(c => row[c])));
      }
      const result = await database.batch(statements);
      if (!Array.isArray(result) || result.length !== statements.length || result.some(row => row?.success !== true)) fail('write_acknowledgement_unknown');
    }
    await stageVerifiedEmojiMasterRelease({ database, artifact: expected.emojiArtifact, freshOnly: true });
    await activateVerifiedEmojiMasterRelease({ database, artifact: expected.emojiArtifact, rebuild: createEmojiReleaseArtifacts,
      expectedCurrentVersion: null, activationId: ids.emoji });
    await stageReferenceMasterRelease({ database, snapshot: expected.referenceSnapshot, snapshotSha256: expected.referenceSnapshotSha256, freshOnly: true });
    await activateReferenceMasterRelease({ database, releaseVersion: expected.referenceSnapshotSha256, expectedActiveVersion: null, activationId: ids.reference });
  } catch { fail('partial_or_unknown_write'); }
  const report = await verifyImportedMasterProjection({ database: readDatabase, projection: expected, targetIncarnation, activationIds: ids });
  return { ...report, scope: 'initial-master-import-stage', atomicWholeStore: false, sourceFreezeVerified: false, coordinatorCompleted: false };
}
