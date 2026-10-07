/** Privileged Master-store recovery primitives. No public route or scheduled collector. */
export type MasterRecoveryRow = Record<string, string | number | null>;
export type MasterRecoveryObject = { type: string; name: string; tbl_name: string; sql: string };
export type MasterRecoverySnapshot = { schema: MasterRecoveryObject[]; tables: Record<string, MasterRecoveryRow[]>;
  schemaHash: string; rowsHash: string };
export type MasterRecoveryArchive = { format: "fanmark-master-recovery-v1"; schemaHash: string; rowsHash: string;
  nonce: string; ciphertext: string };

export const MASTER_RECOVERY_TABLES = Object.freeze(["account", "adminRole", "d1_migrations", "emoji_master",
  "fanmark_emoji_master_active_release", "fanmark_emoji_master_change_audits", "fanmark_emoji_master_mutation_context",
  "fanmark_emoji_master_release_activations", "fanmark_emoji_master_release_imports", "fanmark_emoji_master_release_staging",
  "fanmark_extension_price_release_rows", "fanmark_language_release_rows", "fanmark_reference_master_active_release",
  "fanmark_reference_master_extension_price_manifests", "fanmark_reference_master_release_activations",
  "fanmark_reference_master_release_tables", "fanmark_reference_master_releases", "fanmark_reserved_emoji_pattern_release_rows",
  "fanmark_tier_release_rows", "mfaAssurance", "mfaGeneration", "session", "twoFactor", "user", "verification"].sort());
export const MASTER_RECOVERY_SCHEMA_SQL = `SELECT type,name,tbl_name,sql FROM sqlite_master
  WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
    AND type IN ('table','index','view','trigger') ORDER BY type,name`;
const EMPTY_AUTH_TABLES = ["account", "adminRole", "mfaAssurance", "session", "twoFactor", "user", "verification"];
const HASH = /^[0-9a-f]{64}$/u;
const NAME = /^[A-Za-z_]\w{0,127}$/u;
const MAX_ROWS = 20_000;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_INSERT_BYTES = 512 * 1024;
// Reserve the remaining Paid-plan queries for the empty-target check and full readback.
const MAX_RESTORE_STATEMENTS = 950;
const encoder = new TextEncoder();
function fail(code: string): never { throw new Error(`master_recovery_${code}`); }
export async function masterRecoveryDigest(value: unknown): Promise<string> {
  const bytes = encoder.encode(JSON.stringify(value));
  try { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    byte => byte.toString(16).padStart(2, "0")).join(""); }
  finally { bytes.fill(0); }
}
function normalizedRows(rows: MasterRecoveryRow[]): MasterRecoveryRow[] {
  return rows.map(row => Object.fromEntries(Object.keys(row).sort().map(name => [name, row[name]])))
    .sort((a, b) => { const left = JSON.stringify(a), right = JSON.stringify(b); return left < right ? -1 : left > right ? 1 : 0; });
}
function normalizedTables(tables: MasterRecoverySnapshot["tables"]): MasterRecoverySnapshot["tables"] {
  return Object.fromEntries(MASTER_RECOVERY_TABLES.map(name => [name, normalizedRows(tables[name])]));
}
async function validateSchema(snapshot: MasterRecoverySnapshot, expectedSchemaHash: string): Promise<void> {
  if (!snapshot || !HASH.test(expectedSchemaHash) || snapshot.schemaHash !== expectedSchemaHash ||
      !Array.isArray(snapshot.schema) || snapshot.schema.length < MASTER_RECOVERY_TABLES.length || snapshot.schema.length > 200 ||
      snapshot.schema.some(o => !o || !["table", "index", "view", "trigger"].includes(o.type) ||
        !NAME.test(o.name) || !NAME.test(o.tbl_name) || typeof o.sql !== "string" || !o.sql.length || encoder.encode(o.sql).length > 100_000) ||
      new Set(snapshot.schema.map(o => o.name)).size !== snapshot.schema.length ||
      JSON.stringify(snapshot.schema.filter(o => o.type === "table").map(o => o.name).sort()) !== JSON.stringify(MASTER_RECOVERY_TABLES) ||
      await masterRecoveryDigest(snapshot.schema) !== expectedSchemaHash) fail("schema_mismatch");
}
function validateRows(snapshot: MasterRecoverySnapshot): void {
  if (!snapshot.tables || JSON.stringify(Object.keys(snapshot.tables).sort()) !== JSON.stringify(MASTER_RECOVERY_TABLES) ||
      !HASH.test(snapshot.rowsHash)) fail("snapshot_invalid");
  for (const rows of Object.values(snapshot.tables)) {
    if (!Array.isArray(rows) || rows.length > MAX_ROWS) fail("snapshot_invalid");
    let columns: string | undefined;
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row) || !Object.keys(row).length || Object.keys(row).length > 100 ||
          Object.entries(row).some(([name, value]) => !NAME.test(name) || !(value === null || typeof value === "string" ||
            (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)))))) {
        fail("snapshot_invalid");
      }
      const keys = JSON.stringify(Object.keys(row).sort());
      if (columns !== undefined && columns !== keys) fail("snapshot_invalid");
      columns = keys;
    }
  }
  if (EMPTY_AUTH_TABLES.some(name => snapshot.tables[name].length !== 0)) fail("legacy_auth_not_empty");
}
async function validate(snapshot: MasterRecoverySnapshot, expectedSchemaHash: string): Promise<void> {
  await validateSchema(snapshot, expectedSchemaHash); validateRows(snapshot);
  if (await masterRecoveryDigest(normalizedTables(snapshot.tables)) !== snapshot.rowsHash) fail("snapshot_invalid");
}

/** Caller must pin a schema hash from independently trusted DDL. This batch captures Master only. */
export async function captureMasterRecoverySnapshot(database: D1Database, expectedSchemaHash: string): Promise<MasterRecoverySnapshot> {
  if (!HASH.test(expectedSchemaHash)) fail("schema_mismatch");
  const reads = [database.prepare(MASTER_RECOVERY_SCHEMA_SQL), ...MASTER_RECOVERY_TABLES.map(name =>
    database.prepare(`SELECT * FROM "${name}" LIMIT ${MAX_ROWS + 1}`)),
    database.prepare("PRAGMA foreign_key_check"), database.prepare(MASTER_RECOVERY_SCHEMA_SQL)];
  let result: D1Result[];
  try { result = await database.batch(reads); } catch { fail("capture_failed"); }
  if (result.length !== reads.length || result.some(r => !r.success)) fail("capture_failed");
  if (JSON.stringify(result[0].results) !== JSON.stringify(result[result.length - 1].results)) fail("schema_mismatch");
  if (result[result.length - 2].results.length !== 0) fail("foreign_key_violation");
  const schema = result[0].results as MasterRecoveryObject[];
  const tables = Object.fromEntries(MASTER_RECOVERY_TABLES.map((name, index) => [name, result[index + 1].results as MasterRecoveryRow[]]));
  const snapshot = { schema, tables, schemaHash: await masterRecoveryDigest(schema), rowsHash: "0".repeat(64) };
  await validateSchema(snapshot, expectedSchemaHash); validateRows(snapshot);
  snapshot.tables = normalizedTables(tables);
  snapshot.rowsHash = await masterRecoveryDigest(snapshot.tables);
  return snapshot;
}
function checkKey(key: CryptoKey, usage: "encrypt" | "decrypt"): void {
  if (!key || key.type !== "secret" || key.algorithm?.name !== "AES-GCM" ||
      (key.algorithm as AesKeyAlgorithm).length !== 256 || !key.usages.includes(usage)) fail("archive_key_invalid");
}
function base64(bytes: Uint8Array): string {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}
function decode(value: string, max: number): Uint8Array {
  if (typeof value !== "string" || value.length > 4 * Math.ceil(max / 3) ||
      value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) fail("archive_invalid");
  const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
  if (bytes.length > max || base64(bytes) !== value) fail("archive_invalid");
  return bytes;
}
function aad(archive: Pick<MasterRecoveryArchive, "format" | "schemaHash" | "rowsHash">): Uint8Array {
  return encoder.encode(JSON.stringify({ format: archive.format, schemaHash: archive.schemaHash, rowsHash: archive.rowsHash }));
}
export async function sealMasterRecoverySnapshot(snapshot: MasterRecoverySnapshot, key: CryptoKey,
  expectedSchemaHash: string): Promise<MasterRecoveryArchive> {
  checkKey(key, "encrypt"); snapshot = structuredClone(snapshot); await validate(snapshot, expectedSchemaHash);
  const plaintext = encoder.encode(JSON.stringify(snapshot));
  if (plaintext.byteLength + 16 > MAX_BYTES) { plaintext.fill(0); fail("archive_too_large"); }
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const archive: MasterRecoveryArchive = { format: "fanmark-master-recovery-v1", schemaHash: snapshot.schemaHash,
    rowsHash: snapshot.rowsHash, nonce: base64(nonce), ciphertext: "" };
  try { archive.ciphertext = base64(new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad(archive) }, key, plaintext))); }
  catch { fail("encryption_failed"); } finally { plaintext.fill(0); }
  return archive;
}
export async function openMasterRecoverySnapshot(archive: MasterRecoveryArchive, key: CryptoKey,
  expectedSchemaHash: string): Promise<MasterRecoverySnapshot> {
  checkKey(key, "decrypt"); archive = structuredClone(archive);
  if (!archive || archive.format !== "fanmark-master-recovery-v1" || !HASH.test(expectedSchemaHash) ||
      archive.schemaHash !== expectedSchemaHash || !HASH.test(archive.rowsHash)) fail("schema_mismatch");
  const nonce = decode(archive.nonce, 12), ciphertext = decode(archive.ciphertext, MAX_BYTES);
  if (nonce.length !== 12 || ciphertext.length < 16) fail("archive_invalid");
  let plaintext: ArrayBuffer;
  try { plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(archive) }, key, ciphertext); }
  catch { fail("decryption_failed"); }
  let snapshot: MasterRecoverySnapshot;
  try { snapshot = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)) as MasterRecoverySnapshot; }
  catch { fail("snapshot_invalid"); } finally { new Uint8Array(plaintext).fill(0); }
  if (!snapshot || snapshot.rowsHash !== archive.rowsHash) fail("snapshot_invalid");
  await validate(snapshot, expectedSchemaHash); return snapshot;
}

/** Restore into a new empty target in one batch. Never clear a target after an uncertain write acknowledgement. */
export async function restoreMasterRecoverySnapshot(database: D1Database, snapshot: MasterRecoverySnapshot,
  expectedSchemaHash: string): Promise<MasterRecoverySnapshot> {
  const desired = structuredClone(snapshot); await validate(desired, expectedSchemaHash);
  const statements = [database.prepare("PRAGMA defer_foreign_keys=ON")];
  for (const object of desired.schema.filter(o => o.type === "table")) statements.push(database.prepare(object.sql));
  // One bound JSON array per small chunk avoids thousands of individual INSERT queries.
  for (const name of MASTER_RECOVERY_TABLES) {
    const rows = desired.tables[name]; if (!rows.length) continue;
    const columns = Object.keys(rows[0]).sort();
    const sql = `INSERT INTO "${name}" (${columns.map(c => `"${c}"`).join(",")})
      SELECT ${columns.map(c => `json_extract(value, '$.${c}')`).join(",")} FROM json_each(?)`;
    let chunk: MasterRecoveryRow[] = [], bytes = 2;
    const flush = () => { if (chunk.length) statements.push(database.prepare(sql).bind(JSON.stringify(chunk))); chunk = []; bytes = 2; };
    for (const row of rows) {
      const size = encoder.encode(JSON.stringify(row)).length + 1;
      if (size + 2 > MAX_INSERT_BYTES) fail("row_too_large");
      if (chunk.length >= 100 || bytes + size > MAX_INSERT_BYTES) flush();
      chunk.push(row); bytes += size;
    }
    flush();
  }
  // Import history before installing mutation/audit triggers.
  for (const object of desired.schema.filter(o => o.type !== "table")) statements.push(database.prepare(object.sql));
  if (statements.length > MAX_RESTORE_STATEMENTS) fail("restore_capacity_exceeded");
  let current: D1Result;
  try { current = await database.prepare(MASTER_RECOVERY_SCHEMA_SQL).all(); } catch { fail("target_read_failed"); }
  if (!current.success || current.results.length !== 0) fail("target_not_empty");
  try { const result = await database.batch(statements);
    if (result.length !== statements.length || result.some(r => !r.success)) fail("restore_failed"); }
  catch { fail("restore_failed"); }
  const restored = await captureMasterRecoverySnapshot(database, expectedSchemaHash);
  if (restored.rowsHash !== desired.rowsHash || restored.schemaHash !== desired.schemaHash) fail("restore_verification_failed");
  return restored;
}
