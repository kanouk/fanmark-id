/** Privileged recovery building blocks; no router or automatic backup entrypoint. */
export type AuthRecoveryRow = Record<string, string | number | null>;
export type AuthRecoverySchemaObject = { type: string; name: string; tbl_name: string; sql: string };
export type AuthRecoverySnapshot = { schema: AuthRecoverySchemaObject[]; tables: Record<string, AuthRecoveryRow[]>;
  schemaHash: string; rowsHash: string; authKeyId: string };
export type AuthRecoveryArchive = { nonce: number[]; ciphertext: number[]; schemaHash: string; authKeyId: string };
export type AuthRecoverySessionPolicy = "isolated-preserve" | "revoke-local-sessions-and-challenges";
export const AUTH_RECOVERY_TABLES = Object.freeze(["account", "adminRole", "adminUserStatusAudit", "mfaAssurance",
  "mfaGeneration", "session", "twoFactor", "user", "verification"].sort());
export const AUTH_RECOVERY_SCHEMA_SQL = `SELECT type,name,tbl_name,sql FROM sqlite_master
  WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'
    AND type IN ('table','index','view','trigger') ORDER BY type,name`;
const HASH = /^[0-9a-f]{64}$/u;
const MAX_ROWS_PER_TABLE = 20_000;
const MAX_CIPHERTEXT_BYTES = 32 * 1024 * 1024;
const GCM_TAG_BYTES = 16;
const TARGET_SCHEMA_SQL = AUTH_RECOVERY_SCHEMA_SQL.replace(" AND name <> 'd1_migrations'", "");

function fail(code: string): never { throw new Error(`auth_recovery_${code}`); }
function secret(value: string): string {
  if (typeof value !== "string" || value.length < 32) fail("server_key_invalid");
  return value;
}
function archiveKey(key: CryptoKey, usage: "encrypt" | "decrypt"): void {
  if (!key || key.type !== "secret" || key.algorithm?.name !== "AES-GCM" ||
      (key.algorithm as AesKeyAlgorithm).length !== 256 || !key.usages.includes(usage)) fail("archive_key_invalid");
}
export async function authRecoveryDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  try {
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      byte => byte.toString(16).padStart(2, "0")).join("");
  } finally { bytes.fill(0); }
}
function schemaValid(schema: AuthRecoverySchemaObject[]): boolean {
  return Array.isArray(schema) && schema.length > 0 && schema.length <= 200 &&
    schema.every(o => o && ["table", "index", "view", "trigger"].includes(o.type) &&
      /^\w+$/u.test(o.name) && /^\w+$/u.test(o.tbl_name) && typeof o.sql === "string" && o.sql.length > 0) &&
    new Set(schema.map(o => o.name)).size === schema.length &&
    JSON.stringify(schema.filter(o => o.type === "table").map(o => o.name).sort()) === JSON.stringify(AUTH_RECOVERY_TABLES);
}
async function validateSnapshot(snapshot: AuthRecoverySnapshot, expectedSchemaHash: string, authSecret: string): Promise<void> {
  if (!HASH.test(expectedSchemaHash) || snapshot?.schemaHash !== expectedSchemaHash || !schemaValid(snapshot.schema) ||
      await authRecoveryDigest(snapshot.schema) !== expectedSchemaHash) fail("schema_mismatch");
  if (snapshot.authKeyId !== await authRecoveryDigest(["better-auth-recovery-key-v1", secret(authSecret)])) {
    fail("server_key_mismatch");
  }
  if (!snapshot.tables || JSON.stringify(Object.keys(snapshot.tables).sort()) !== JSON.stringify(AUTH_RECOVERY_TABLES) ||
      !HASH.test(snapshot.rowsHash)) fail("snapshot_invalid");
  for (const rows of Object.values(snapshot.tables)) {
    if (!Array.isArray(rows) || rows.length > MAX_ROWS_PER_TABLE) fail("snapshot_invalid");
    for (const row of rows) {
      if (!row || Array.isArray(row) || typeof row !== "object" || Object.keys(row).length === 0 ||
          Object.entries(row).some(([name, value]) => !/^\w+$/u.test(name) ||
            !(value === null || typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value))))) {
        fail("snapshot_invalid");
      }
    }
  }
  if (await authRecoveryDigest(snapshot.tables) !== snapshot.rowsHash) fail("snapshot_invalid");
}

/** One D1 batch captures this store. It is not an atomic Business/Auth/Master/R2 snapshot. */
export async function captureAuthRecoverySnapshot(database: D1Database, authSecret: string): Promise<AuthRecoverySnapshot> {
  secret(authSecret);
  const reads = [database.prepare(AUTH_RECOVERY_SCHEMA_SQL), ...AUTH_RECOVERY_TABLES.map(name =>
    database.prepare(`SELECT * FROM "${name}" LIMIT ${MAX_ROWS_PER_TABLE + 1}`)),
    database.prepare("PRAGMA foreign_key_check"), database.prepare(AUTH_RECOVERY_SCHEMA_SQL)];
  let results: D1Result[];
  try { results = await database.batch(reads); } catch { fail("capture_failed"); }
  if (results.length !== reads.length || results.some(r => !r.success)) fail("capture_failed");
  const schema = results[0].results as AuthRecoverySchemaObject[];
  if (!schemaValid(schema) || JSON.stringify(schema) !== JSON.stringify(results[results.length - 1].results)) fail("schema_mismatch");
  if (results[results.length - 2].results.length !== 0) fail("foreign_key_violation");
  const tables = Object.fromEntries(AUTH_RECOVERY_TABLES.map((name, index) => [name, results[index + 1].results as AuthRecoveryRow[]]));
  const snapshot = { schema, tables, schemaHash: await authRecoveryDigest(schema), rowsHash: await authRecoveryDigest(tables),
    authKeyId: await authRecoveryDigest(["better-auth-recovery-key-v1", authSecret]) };
  await validateSnapshot(snapshot, snapshot.schemaHash, authSecret);
  return snapshot;
}
function associatedData(archive: Pick<AuthRecoveryArchive, "schemaHash" | "authKeyId">): Uint8Array {
  // Keep the accepted isolated archive format readable; this is not the combined bundle format.
  return new TextEncoder().encode(JSON.stringify({ format: "synthetic-auth-recovery-v1",
    schemaHash: archive.schemaHash, authKeyId: archive.authKeyId }));
}
export async function sealAuthRecoverySnapshot(snapshot: AuthRecoverySnapshot, key: CryptoKey,
  expectedSchemaHash: string, authSecret: string): Promise<AuthRecoveryArchive> {
  archiveKey(key, "encrypt");
  snapshot = structuredClone(snapshot);
  await validateSnapshot(snapshot, expectedSchemaHash, authSecret);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const archive = { nonce: [...nonce], ciphertext: [] as number[], schemaHash: snapshot.schemaHash, authKeyId: snapshot.authKeyId };
  const plaintext = new TextEncoder().encode(JSON.stringify(snapshot));
  // Refuse an archive the reader cannot open, before encryption or expansion into a JSON byte array.
  if (plaintext.byteLength + GCM_TAG_BYTES > MAX_CIPHERTEXT_BYTES) {
    plaintext.fill(0);
    fail("archive_too_large");
  }
  try { archive.ciphertext = [...new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: associatedData(archive) }, key, plaintext))]; }
  catch { fail("encryption_failed"); }
  finally { plaintext.fill(0); }
  return archive;
}
export async function openAuthRecoverySnapshot(archive: AuthRecoveryArchive, key: CryptoKey,
  expectedSchemaHash: string, authSecret: string): Promise<AuthRecoverySnapshot> {
  archiveKey(key, "decrypt");
  archive = structuredClone(archive);
  if (!archive || archive.schemaHash !== expectedSchemaHash || !HASH.test(expectedSchemaHash)) fail("schema_mismatch");
  if (archive.authKeyId !== await authRecoveryDigest(["better-auth-recovery-key-v1", secret(authSecret)])) fail("server_key_mismatch");
  if (!Array.isArray(archive.nonce) || archive.nonce.length !== 12 || !Array.isArray(archive.ciphertext) ||
      archive.ciphertext.length < GCM_TAG_BYTES || archive.ciphertext.length > MAX_CIPHERTEXT_BYTES ||
      archive.nonce.some(v => !Number.isInteger(v) || v < 0 || v > 255) ||
      archive.ciphertext.some(v => !Number.isInteger(v) || v < 0 || v > 255)) fail("archive_invalid");
  let plaintext: ArrayBuffer;
  try { plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(archive.nonce),
    additionalData: associatedData(archive) }, key, new Uint8Array(archive.ciphertext)); }
  catch { fail("decryption_failed"); }
  let snapshot: AuthRecoverySnapshot;
  try { snapshot = JSON.parse(new TextDecoder().decode(plaintext)) as AuthRecoverySnapshot; }
  catch { fail("snapshot_invalid"); }
  finally { new Uint8Array(plaintext).fill(0); }
  await validateSnapshot(snapshot, expectedSchemaHash, authSecret);
  return snapshot;
}

/** Explicit operator policy required; existing target refused. No default revocation policy is adopted here. */
export async function restoreAuthRecoverySnapshot(database: D1Database, snapshot: AuthRecoverySnapshot,
  options: { expectedSchemaHash: string; authSecret: string; sessionPolicy: AuthRecoverySessionPolicy;
    isolatedFidelity?: boolean }): Promise<AuthRecoverySnapshot> {
  if (!options || !["isolated-preserve", "revoke-local-sessions-and-challenges"].includes(options.sessionPolicy) ||
      (options.sessionPolicy === "isolated-preserve" && options.isolatedFidelity !== true)) fail("session_policy_required");
  options = { ...options };
  const desired = structuredClone(snapshot);
  await validateSnapshot(desired, options.expectedSchemaHash, options.authSecret);
  let current: D1Result;
  try { current = await database.prepare(TARGET_SCHEMA_SQL).all(); } catch { fail("target_read_failed"); }
  if (!current.success || current.results.length !== 0) fail("target_not_empty");
  if (options.sessionPolicy === "revoke-local-sessions-and-challenges") {
    for (const table of ["session", "mfaAssurance", "verification"]) desired.tables[table] = [];
    desired.rowsHash = await authRecoveryDigest(desired.tables);
  }
  const statements = [database.prepare("PRAGMA defer_foreign_keys=ON")];
  for (const object of desired.schema.filter(o => o.type === "table")) statements.push(database.prepare(object.sql));
  for (const name of AUTH_RECOVERY_TABLES) for (const row of desired.tables[name]) {
    const columns = Object.keys(row);
    statements.push(database.prepare(`INSERT INTO "${name}" (${columns.map(c => `"${c}"`).join(",")})
      VALUES (${columns.map(() => "?").join(",")})`).bind(...columns.map(c => row[c])));
  }
  // Factor mutation triggers must not run during history import. All data and definitions commit in one batch.
  for (const object of desired.schema.filter(o => o.type !== "table")) statements.push(database.prepare(object.sql));
  try { const result = await database.batch(statements); if (result.some(r => !r.success)) fail("restore_failed"); }
  catch { fail("restore_failed"); }
  const restored = await captureAuthRecoverySnapshot(database, options.authSecret);
  if (JSON.stringify(restored) !== JSON.stringify(desired)) fail("restore_verification_failed");
  return restored;
}
