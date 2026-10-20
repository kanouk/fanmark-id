/** Independent, read-only comparison against the exact encrypted projection used
 * for import. Never regenerate encryption for comparison. No credential values,
 * row IDs or credential hashes escape in reports or errors. This does not prove
 * a frozen source, encryption-key custody or login.
 */
import { inspectAuthIdentityReadiness } from './auth-identity-preflight.mjs';
import { isProductionRemoteD1, assertProductionRemoteD1Target } from './production-remote-d1.mjs';
import { verifyAuthRuntimeSchema } from './auth-runtime-schema.mjs';

const fields = {
  user: 'id name email emailVerified image twoFactorEnabled banned banExpires banReason createdAt updatedAt'.split(' '),
  account: 'id accountId providerId userId password createdAt updatedAt'.split(' '),
  twoFactor: 'id userId secret backupCodes verified failedVerificationCount lockedUntil'.split(' '),
  adminRole: ['userId', 'role'],
};
const nullFields = {
  user: 'signupCommandId oauthSignupCommandId oauthSignupProfileId oauthSignupProvider oauthSignupSubject oauthSignupLanguage oauthSignupState'.split(' '),
  account: 'accessToken refreshToken idToken accessTokenExpiresAt refreshTokenExpiresAt scope'.split(' '),
  twoFactor: [], adminRole: [],
};
const emptyTables = ['session', 'verification', 'mfaAssurance', 'adminUserStatusAudit'];
const fail = code => { throw new Error(`auth_import_readback_${code}`); };
const sameKeys = (row, keys) => row && typeof row === 'object' && !Array.isArray(row) &&
  JSON.stringify(Object.keys(row).sort()) === JSON.stringify([...keys].sort());

export function prepareAuthImportProjection(projection) {
  // Copy the expectation before the first await: callers cannot alter it while
  // a remote read is in flight. Projection provenance is the runner's concern.
  let expected;
  try { expected = structuredClone(projection); } catch { fail('projection_invalid'); }
  if (expected?.version !== 1 || !sameKeys(expected.tables, Object.keys(fields)) ||
      typeof expected.observedAt !== 'string' || !Number.isFinite(Date.parse(expected.observedAt)) ||
      JSON.stringify(expected.omittedSessionState) !== JSON.stringify(['session', 'verification', 'mfaAssurance'])) fail('projection_invalid');
  const maps = {};
  for (const [table, columns] of Object.entries(fields)) {
    const rows = expected.tables[table], key = table === 'adminRole' ? 'userId' : 'id';
    if (!Array.isArray(rows) || rows.length > 40000) fail('projection_invalid');
    maps[table] = new Map();
    for (const row of rows) {
      if (!sameKeys(row, columns) || typeof row[key] !== 'string' || !row[key] || maps[table].has(row[key]) ||
          Object.values(row).some(value => value !== null && typeof value !== 'string' &&
            !(typeof value === 'number' && Number.isSafeInteger(value)))) fail('projection_invalid');
      maps[table].set(row[key], row);
    }
  }
  return { expected, maps };
}

export async function verifyImportedAuthProjection({ database, projection, targetIncarnation } = {}) {
  const { expected, maps } = prepareAuthImportProjection(projection);
  const production = isProductionRemoteD1(database);
  if (production && (database.access !== 'read-only' || database.targetIdentity.store !== 'auth')) fail('target_invalid');
  async function identity() {
    if (production) {
      try { await assertProductionRemoteD1Target(database, targetIncarnation); } catch { fail('target_invalid'); }
    }
  }
  async function query(sql, values = []) {
    let result;
    try { result = await database.prepare(sql).bind(...values).all(); } catch { fail('read_failed'); }
    if (result?.success !== true || !Array.isArray(result.results) || result.meta?.rows_written !== 0) fail('result_invalid');
    return result.results;
  }
  async function checkEphemeral() {
    const counts = await query('SELECT ' + emptyTables.map(table => `(SELECT count(*) FROM "${table}") AS "${table}"`).join(','));
    if (counts.length !== 1 || !sameKeys(counts[0], emptyTables) || Object.values(counts[0]).some(count => count !== 0)) fail('unexpected_session_or_audit_state');
    const generations = await query('SELECT id,generation FROM "mfaGeneration"');
    if (generations.length !== 1 || !sameKeys(generations[0], ['id', 'generation']) ||
        generations[0].id !== 1 || generations[0].generation !== expected.tables.twoFactor.length) fail('generation_mismatch');
  }
  await identity();
  let schema;
  try { schema = await verifyAuthRuntimeSchema(database); } catch { fail('schema_unconfirmed'); }
  await checkEphemeral();
  for (const [table, columns] of Object.entries(fields)) {
    const key = table === 'adminRole' ? 'userId' : 'id', seen = new Set();
    // Fixed-size pages bound D1 response size. Read one extra page to reject
    // unexpected rows even when the expected count is an exact multiple.
    for (let offset = 0; offset <= maps[table].size; offset += 100) {
      const rows = await query(`SELECT * FROM "${table}" ORDER BY "${key}" LIMIT 100 OFFSET ?`, [offset]);
      if (rows.length > 100) fail('result_invalid');
      for (const row of rows) {
        const wanted = maps[table].get(row?.[key]);
        if (!wanted || seen.has(row[key]) || !sameKeys(row, [...columns, ...nullFields[table]]) ||
            columns.some(column => row[column] !== wanted[column]) || nullFields[table].some(column => row[column] !== null)) fail('row_mismatch');
        seen.add(row[key]);
      }
      if (rows.length < 100) break;
    }
    if (seen.size !== maps[table].size) fail('row_mismatch');
  }
  // Use a facade that exposes only the checked SELECT result contract.
  const aggregate = await inspectAuthIdentityReadiness({ prepare: sql => ({ all: async () => ({ success: true, results: await query(sql) }) }) });
  if (!aggregate.identityAndMfaChecksPassed) fail('identity_invariant_failed');
  if ((await query('SELECT * FROM pragma_foreign_key_check')).length) fail('foreign_key_failed');
  await checkEphemeral();
  try { await verifyAuthRuntimeSchema(database); } catch { fail('schema_unconfirmed'); }
  await identity();
  return { version: 1, scope: 'auth-projection-readback', consistency: 'unfenced-readback',
    projectionRowsReconciled: true, omittedSessionStateEmpty: true, identityAndMfaChecksPassed: true,
    totals: aggregate.totals, schemaSha256: schema.schemaSha256,
    productionReady: false, fullMigrationReconciled: false, deployable: false };
}
