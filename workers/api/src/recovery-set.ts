/** Privileged host-side coordinator. No router, scheduler, writer fence or policy defaults. */
import {captureAuthRecoverySnapshot as captureAuth, sealAuthRecoverySnapshot as sealAuth,
  openAuthRecoverySnapshot as openAuth, restoreAuthRecoverySnapshot as restoreAuth, authRecoveryDigest,
  type AuthRecoveryArchive, type AuthRecoverySnapshot, type AuthRecoverySessionPolicy} from "./auth-d1-recovery.ts";
import {captureBusinessRecoverySnapshot as captureBusiness, sealBusinessRecoverySnapshot as sealBusiness,
  openBusinessRecoverySnapshot as openBusiness, restoreBusinessRecoverySnapshot as restoreBusiness,
  type BusinessRecoveryArchive, type BusinessRecoverySnapshot} from "./business-d1-recovery.ts";
import {captureMasterRecoverySnapshot as captureMaster, sealMasterRecoverySnapshot as sealMaster,
  openMasterRecoverySnapshot as openMaster, restoreMasterRecoverySnapshot as restoreMaster,
  type MasterRecoveryArchive, type MasterRecoverySnapshot} from "./master-d1-recovery.ts";
import {captureR2RecoverySnapshot as captureR2, sealR2RecoverySnapshot as sealR2,
  openR2RecoverySnapshot as openR2, restoreR2RecoverySnapshot as restoreR2,
  type R2RecoveryArchive, type R2RecoverySnapshot} from "./r2-recovery.ts";
import {D1_RECOVERY_SCHEMA_SQL, d1RecoveryDigest as digest} from "./d1-store-recovery.ts";

export const RECOVERY_SET_STORES = ["auth", "business", "master", "avatars", "covers"] as const;
export type RecoverySetStore = typeof RECOVERY_SET_STORES[number];
export type RecoverySetBindings = {auth: D1Database; business: D1Database; master: D1Database; avatars: R2Bucket; covers: R2Bucket};
export type RecoverySetContext = {sourceIds: Record<RecoverySetStore, string>; keyId: string; runtimeRevision: string;
  schemaHashes: {auth: string; business: string; master: string}; authSecret: string};
/** Supplied by a trusted adapter that owns the writer pause/drain or isolated target. A boolean is insufficient. */
export type RecoverySetGuard = {id: string; assertHeld: (expectedIds: Record<RecoverySetStore, string>) => Promise<void>};
type Parts = {auth: AuthRecoveryArchive; business: BusinessRecoveryArchive; master: MasterRecoveryArchive;
  avatars: R2RecoveryArchive; covers: R2RecoveryArchive};
type Snapshots = {auth: AuthRecoverySnapshot; business: BusinessRecoverySnapshot; master: MasterRecoverySnapshot;
  avatars: R2RecoverySnapshot; covers: R2RecoverySnapshot};
type Manifest = {format: "fanmark-recovery-set-manifest-v1"; captureId: string; sourceIds: RecoverySetContext["sourceIds"];
  keyId: string; runtimeRevision: string; schemaHashes: RecoverySetContext["schemaHashes"]; guardId: string; consistency: "external-guard-and-recapture";
  startedAt: string; finishedAt: string; parts: Record<RecoverySetStore, {archiveHash: string; snapshotHash: string}>};
export type RecoverySetArchive = {format: "fanmark-recovery-set-v1"; nonce: number[]; ciphertext: number[]; parts: Parts};
const FORMAT = "fanmark-recovery-set-v1", HASH = /^[a-f0-9]{64}$/u, ID = /^[A-Za-z0-9:_-]{1,128}$/u;
const encoder = new TextEncoder(), aad = encoder.encode(FORMAT);
const MAX_PART_JSON_BYTES = 128 * 1024 * 1024, MAX_SET_JSON_BYTES = 256 * 1024 * 1024;
function fail(code: string): never {throw new Error("recovery_set_" + code);}
function exactKeys(value: object, keys: readonly string[]): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function contextValid(context: RecoverySetContext): void {
  if (!context || !exactKeys(context.sourceIds, RECOVERY_SET_STORES) || Object.values(context.sourceIds).some(v => typeof v !== "string" || !ID.test(v)) ||
      new Set(Object.values(context.sourceIds)).size !== 5 || typeof context.keyId !== "string" || !ID.test(context.keyId) ||
      typeof context.runtimeRevision !== "string" || !ID.test(context.runtimeRevision) ||
      !exactKeys(context.schemaHashes, ["auth", "business", "master"]) || Object.values(context.schemaHashes).some(v => !HASH.test(v)) ||
      typeof context.authSecret !== "string" || context.authSecret.length < 32) fail("context_invalid");
}
function guardValid(guard: RecoverySetGuard): void {
  if (!guard || typeof guard.id !== "string" || !ID.test(guard.id) || typeof guard.assertHeld !== "function") fail("guard_required");
}
function boundGuard(guard: RecoverySetGuard): RecoverySetGuard {
  guardValid(guard); const id = guard.id, check = guard.assertHeld.bind(guard);
  return {id, async assertHeld(expectedIds) {
    if (guard.id !== id) fail("guard_lost");
    await check(expectedIds);
    if (guard.id !== id) fail("guard_lost");
  }};
}
async function held(guard: RecoverySetGuard, expectedIds: Record<RecoverySetStore, string>): Promise<void> {
  try {await guard.assertHeld({...expectedIds});} catch {fail("guard_lost");}
}
function cryptoKey(key: CryptoKey, usage: "encrypt" | "decrypt"): void {
  if (!key || key.type !== "secret" || key.algorithm?.name !== "AES-GCM" || (key.algorithm as AesKeyAlgorithm).length !== 256 ||
      !key.usages.includes(usage)) fail("archive_key_invalid");
}
async function partHashes(parts: Parts): Promise<Record<RecoverySetStore, string>> {
  if (!exactKeys(parts, RECOVERY_SET_STORES)) fail("parts_invalid");
  let total = 0; const hashes = {} as Record<RecoverySetStore, string>;
  for (const store of RECOVERY_SET_STORES) {
    const bytes = encoder.encode(JSON.stringify(parts[store]));
    try {
      if (bytes.length > MAX_PART_JSON_BYTES || (total += bytes.length) > MAX_SET_JSON_BYTES) fail("archive_too_large");
      hashes[store] = await digest(parts[store]);
    } finally {bytes.fill(0);}
  }
  return hashes;
}
function crossStoreValid(snapshots: Snapshots): void {
  const users = new Set(snapshots.auth.tables.user.map(row => row.id));
  if (snapshots.business.tables.user_settings.some(row => !users.has(row.user_id))) fail("profile_auth_mismatch");
}
async function captureAll(bindings: RecoverySetBindings, context: RecoverySetContext, guard: RecoverySetGuard): Promise<Snapshots> {
  await held(guard, context.sourceIds); const auth = await captureAuth(bindings.auth, context.authSecret);
  if (auth.schemaHash !== context.schemaHashes.auth) fail("auth_schema_mismatch");
  await held(guard, context.sourceIds); const business = await captureBusiness(bindings.business, context.schemaHashes.business);
  await held(guard, context.sourceIds); const master = await captureMaster(bindings.master, context.schemaHashes.master);
  await held(guard, context.sourceIds); const avatars = await captureR2(bindings.avatars, "avatars");
  await held(guard, context.sourceIds); const covers = await captureR2(bindings.covers, "cover-images");
  await held(guard, context.sourceIds); const snapshots = {auth, business, master, avatars, covers};
  crossStoreValid(snapshots); return snapshots;
}
async function snapshotHashes(snapshots: Snapshots): Promise<Record<RecoverySetStore, string>> {
  const result = {} as Record<RecoverySetStore, string>;
  for (const store of RECOVERY_SET_STORES) result[store] = await digest(snapshots[store]);
  return result;
}
/** Capture all five stores twice under a caller-owned guard. Recapture alone does not establish quiescence. */
export async function collectRecoverySet(bindings: RecoverySetBindings, context: RecoverySetContext,
  key: CryptoKey, guard: RecoverySetGuard): Promise<RecoverySetArchive> {
  context = structuredClone(context); contextValid(context); guardValid(guard); cryptoKey(key, "encrypt");
  guard = boundGuard(guard); const startedAt = new Date().toISOString();
  const snapshots = await captureAll(bindings, context, guard), hashes = await snapshotHashes(snapshots);
  const parts: Parts = {auth: await sealAuth(snapshots.auth, key, context.schemaHashes.auth, context.authSecret),
    business: await sealBusiness(snapshots.business, key, context.schemaHashes.business),
    master: await sealMaster(snapshots.master, key, context.schemaHashes.master),
    avatars: await sealR2(snapshots.avatars, key, "avatars"), covers: await sealR2(snapshots.covers, key, "cover-images")};
  const after = await captureAll(bindings, context, guard);
  if (JSON.stringify(await snapshotHashes(after)) !== JSON.stringify(hashes)) fail("source_changed");
  await held(guard, context.sourceIds); const archives = await partHashes(parts);
  const manifest: Manifest = {format: "fanmark-recovery-set-manifest-v1", captureId: crypto.randomUUID(),
    sourceIds: context.sourceIds, keyId: context.keyId, runtimeRevision: context.runtimeRevision, schemaHashes: context.schemaHashes, guardId: guard.id,
    consistency: "external-guard-and-recapture", startedAt, finishedAt: new Date().toISOString(),
    parts: Object.fromEntries(RECOVERY_SET_STORES.map(store => [store, {archiveHash: archives[store], snapshotHash: hashes[store]}])) as Manifest["parts"]};
  const nonce = crypto.getRandomValues(new Uint8Array(12)), plaintext = encoder.encode(JSON.stringify(manifest));
  try {return {format: FORMAT, nonce: [...nonce], ciphertext: [...new Uint8Array(await crypto.subtle.encrypt(
    {name: "AES-GCM", iv: nonce, additionalData: aad}, key, plaintext))], parts};}
  finally {plaintext.fill(0);}
}
/** Authenticate the manifest and every part, decrypting all stores before any destination write. */
export async function openRecoverySet(archive: RecoverySetArchive, context: RecoverySetContext,
  key: CryptoKey): Promise<{manifest: Manifest; snapshots: Snapshots}> {
  context = structuredClone(context); contextValid(context); cryptoKey(key, "decrypt");
  if (!archive || !exactKeys(archive, ["format", "nonce", "ciphertext", "parts"]) || archive.format !== FORMAT ||
      !Array.isArray(archive.nonce) || archive.nonce.length !== 12 || !Array.isArray(archive.ciphertext) ||
      archive.ciphertext.length < 16 || archive.ciphertext.length > 65_536 ||
      [...archive.nonce, ...archive.ciphertext].some(v => !Number.isInteger(v) || v < 0 || v > 255)) fail("archive_invalid");
  // Caller objects cannot be changed between manifest verification and component decrypts.
  archive = structuredClone(archive); const hashes = await partHashes(archive.parts);
  let plaintext: ArrayBuffer;
  try {plaintext = await crypto.subtle.decrypt({name: "AES-GCM", iv: new Uint8Array(archive.nonce), additionalData: aad},
    key, new Uint8Array(archive.ciphertext));} catch {fail("manifest_invalid");}
  let manifest: Manifest;
  try {manifest = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(plaintext));}
  catch {fail("manifest_invalid");} finally {new Uint8Array(plaintext).fill(0);}
  if (!manifest || manifest.format !== "fanmark-recovery-set-manifest-v1" || manifest.consistency !== "external-guard-and-recapture" ||
      !ID.test(manifest.guardId) || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(manifest.captureId) || !ID.test(manifest.keyId) ||
      manifest.keyId !== context.keyId || manifest.runtimeRevision !== context.runtimeRevision || !exactKeys(manifest.sourceIds, RECOVERY_SET_STORES) ||
      RECOVERY_SET_STORES.some(store => manifest.sourceIds[store] !== context.sourceIds[store]) ||
      !exactKeys(manifest.schemaHashes, ["auth", "business", "master"]) ||
      (["auth", "business", "master"] as const).some(store => manifest.schemaHashes[store] !== context.schemaHashes[store]) ||
      !exactKeys(manifest.parts, RECOVERY_SET_STORES) || RECOVERY_SET_STORES.some(store =>
        manifest.parts[store]?.archiveHash !== hashes[store] || !HASH.test(manifest.parts[store]?.snapshotHash))) fail("manifest_mismatch");
  const snapshots: Snapshots = {auth: await openAuth(archive.parts.auth, key, context.schemaHashes.auth, context.authSecret),
    business: await openBusiness(archive.parts.business, key, context.schemaHashes.business),
    master: await openMaster(archive.parts.master, key, context.schemaHashes.master),
    avatars: await openR2(archive.parts.avatars, key, "avatars"), covers: await openR2(archive.parts.covers, key, "cover-images")};
  const actual = await snapshotHashes(snapshots);
  if (RECOVERY_SET_STORES.some(store => actual[store] !== manifest.parts[store].snapshotHash)) fail("snapshot_mismatch");
  crossStoreValid(snapshots); return {manifest, snapshots};
}
/** All targets must remain isolated/closed until this returns. Separate D1/R2 commits are never rolled back across stores. */
export async function restoreRecoverySet(bindings: RecoverySetBindings, archive: RecoverySetArchive, context: RecoverySetContext,
  key: CryptoKey, options: {mode: "new-empty" | "resume-exact"; sessionPolicy: AuthRecoverySessionPolicy;
    isolatedFidelity?: boolean; targetIds: Record<RecoverySetStore, string>; targetGuard: RecoverySetGuard;
    progress: (receipt: {store: RecoverySetStore; state: "started" | "verified"}) => Promise<void>}): Promise<{
      captureId: string; sessionPolicy: AuthRecoverySessionPolicy; restoredHashes: Record<RecoverySetStore, string>; verified: true}> {
  if (!options || !["new-empty", "resume-exact"].includes(options.mode) ||
      !["isolated-preserve", "revoke-local-sessions-and-challenges"].includes(options.sessionPolicy) ||
      (options.sessionPolicy === "isolated-preserve" && options.isolatedFidelity !== true) || typeof options.progress !== "function") fail("restore_policy_required");
  context = structuredClone(context); contextValid(context);
  options = {...options, targetIds: {...options.targetIds}, targetGuard: boundGuard(options.targetGuard)};
  if (!exactKeys(options.targetIds, RECOVERY_SET_STORES) || Object.values(options.targetIds).some(id =>
      typeof id !== "string" || !ID.test(id) || Object.values(context.sourceIds).includes(id)) ||
      new Set(Object.values(options.targetIds)).size !== 5) fail("target_identity_invalid");
  const {manifest, snapshots} = await openRecoverySet(archive, context, key);
  context = structuredClone(context);
  if (options.sessionPolicy === "revoke-local-sessions-and-challenges") {
    for (const table of ["session", "mfaAssurance", "verification"]) snapshots.auth.tables[table] = [];
    snapshots.auth.rowsHash = await authRecoveryDigest(snapshots.auth.tables);
  }
  const wantedHashes = await snapshotHashes(snapshots), existing = new Set<RecoverySetStore>();
  await held(options.targetGuard, options.targetIds);
  // Validate every destination before the first write, including exact committed D1s after an unknown ACK.
  for (const store of ["auth", "business", "master"] as const) {
    const schema = await bindings[store].prepare(D1_RECOVERY_SCHEMA_SQL).all();
    if (!schema.success) fail("target_read_failed");
    if (!schema.results.length) continue;
    if (options.mode !== "resume-exact") fail("target_not_empty");
    const current = store === "auth" ? await captureAuth(bindings.auth, context.authSecret) : store === "business"
      ? await captureBusiness(bindings.business, context.schemaHashes.business) : await captureMaster(bindings.master, context.schemaHashes.master);
    if (await digest(current) !== wantedHashes[store]) fail("target_mismatch"); existing.add(store);
  }
  for (const store of ["avatars", "covers"] as const) {
    const current = await captureR2(bindings[store], store === "avatars" ? "avatars" : "cover-images");
    if (options.mode === "new-empty" && current.objects.length) fail("target_not_empty");
    const wanted = new Map(snapshots[store].objects.map(o => [o.key, o]));
    if (current.objects.some(o => JSON.stringify(o) !== JSON.stringify(wanted.get(o.key)))) fail("target_mismatch");
  }
  for (const store of ["master", "business", "auth", "avatars", "covers"] as const) {
    await held(options.targetGuard, options.targetIds); await options.progress({store, state: "started"});
    await held(options.targetGuard, options.targetIds);
    if (!existing.has(store)) {
      if (store === "master") await restoreMaster(bindings.master, snapshots.master, context.schemaHashes.master);
      else if (store === "business") await restoreBusiness(bindings.business, snapshots.business, context.schemaHashes.business);
      else if (store === "auth") await restoreAuth(bindings.auth, snapshots.auth, {expectedSchemaHash: context.schemaHashes.auth,
        authSecret: context.authSecret, sessionPolicy: options.sessionPolicy, isolatedFidelity: options.isolatedFidelity});
      else await restoreR2(bindings[store], snapshots[store], {expectedKind: store === "avatars" ? "avatars" : "cover-images", mode: options.mode});
    }
    await held(options.targetGuard, options.targetIds); await options.progress({store, state: "verified"});
  }
  const actual = await captureAll(bindings, {...context, sourceIds: options.targetIds}, options.targetGuard);
  if (JSON.stringify(await snapshotHashes(actual)) !== JSON.stringify(wantedHashes)) fail("restore_verification_failed");
  await held(options.targetGuard, options.targetIds); return {captureId: manifest.captureId,
    sessionPolicy: options.sessionPolicy, restoredHashes: wantedHashes, verified: true};
}
