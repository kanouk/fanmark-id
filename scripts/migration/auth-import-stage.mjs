/** A bounded atomic Auth stage, not the production cutover runner. The caller
 * must freeze the source and retain the exact encrypted projection. Production
 * writes use the coordinated journal transport; verification uses a separate
 * read-only transport. No retries, upserts, session transfer or key generation.
 */
import { prepareAuthImportProjection, verifyImportedAuthProjection } from './auth-import-readback.mjs';
import { inspectAuthIdentityReadiness } from './auth-identity-preflight.mjs';
import { isProductionRemoteD1, assertProductionRemoteD1Target } from './production-remote-d1.mjs';
import { isIsolatedRemoteD1 } from './isolated-remote-d1.mjs';
import { verifyAuthRuntimeSchema } from './auth-runtime-schema.mjs';

const fail = code => { throw new Error(`auth_import_stage_${code}`); };
const tables = ['user', 'account', 'twoFactor', 'adminRole', 'session', 'verification', 'mfaAssurance', 'adminUserStatusAudit'];
const dirty = tables.map(table => `EXISTS (SELECT 1 FROM "${table}")`).join(' OR ') +
  ' OR (SELECT count(*) FROM "mfaGeneration") <> 1 OR NOT EXISTS (SELECT 1 FROM "mfaGeneration" WHERE id = 1 AND generation = 0)';
// NOT NULL rejects a nonempty/drifted target inside the same atomic D1 batch.
// On an empty target this INSERT selects no rows and changes nothing.
const guard = `INSERT INTO "mfaAssurance" (id,userId,sessionId,factorId,generation,verifiedAt,expiresAt)
  SELECT NULL,NULL,NULL,NULL,NULL,NULL,NULL WHERE ${dirty}`;

export async function importAuthProjectionStage({ database, readDatabase, projection, targetIncarnation, mode = 'local' } = {}) {
  const { expected } = prepareAuthImportProjection(projection);
  const rows = Object.entries(expected.tables).flatMap(([table, records]) => records.map(row => ({ table, row })));
  // The source currently has 45 projected rows. Keep this stage one atomic
  // provider transaction, refusing larger datasets before any target access.
  if (!expected.tables.user.length || !expected.tables.adminRole.length || rows.length > 99 ||
      rows.reduce((sum, { row }) => sum + Object.keys(row).length, 0) > 900 ||
      Buffer.byteLength(JSON.stringify(expected.tables)) > 256 * 1024) fail('atomic_capacity_or_admin_invalid');
  const production = isProductionRemoteD1(database);
  if (!['local', 'production-stage'].includes(mode) ||
      (mode === 'local' && (production || isProductionRemoteD1(readDatabase) || isIsolatedRemoteD1(database) || isIsolatedRemoteD1(readDatabase))) ||
      (mode === 'production-stage' && (!production || !isProductionRemoteD1(readDatabase)))) fail('transport_invalid');
  if (production) {
    if (database.access !== 'import' || readDatabase.access !== 'read-only' ||
        database.targetIdentity.databaseName !== 'fanmark-production-auth' ||
        JSON.stringify(database.targetIdentity) !== JSON.stringify(readDatabase.targetIdentity)) fail('transport_invalid');
    try {
      await assertProductionRemoteD1Target(database, targetIncarnation);
      await assertProductionRemoteD1Target(readDatabase, targetIncarnation);
    } catch { fail('target_invalid'); }
  }
  let state, readiness;
  try {
    await verifyAuthRuntimeSchema(readDatabase);
    state = await readDatabase.prepare(`SELECT CASE WHEN ${dirty} THEN 1 ELSE 0 END AS dirty`).all();
    readiness = await inspectAuthIdentityReadiness(readDatabase);
  } catch { fail('preflight_failed'); }
  if (state?.success !== true || state.meta?.rows_written !== 0 || state.results?.length !== 1 ||
      state.results[0].dirty !== 0 || !readiness.identityAndMfaChecksPassed) fail('target_not_empty_or_invalid');
  // Plan before the only write. A provider failure may mean committed data;
  // leave the global coordinator and journal pending and do not retry here.
  let result;
  try {
    const statements = [database.prepare(guard), ...rows.map(({ table, row }) => {
      const columns = Object.keys(row);
      return database.prepare(`INSERT INTO "${table}" (${columns.map(column => `"${column}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`).bind(...columns.map(column => row[column]));
    })];
    result = await database.batch(statements);
  } catch { fail('write_acknowledgement_unknown'); }
  if (!Array.isArray(result) || result.length !== rows.length + 1 || result.some(row => row?.success !== true)) fail('write_acknowledgement_unknown');
  const readback = await verifyImportedAuthProjection({ database: readDatabase, projection: expected, targetIncarnation });
  return { ...readback, scope: 'atomic-auth-import-stage', atomicStatements: rows.length + 1,
    sourceFreezeVerified: false, coordinatorCompleted: false };
}
