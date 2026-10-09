/** Staging-only operational adapter. No public routes and no implicit capture admission. */
import type { Env } from "./repository";
import { RECOVERY_SET_STORES, collectRecoverySet, openRecoverySet,
  type RecoverySetArchive, type RecoverySetContext } from "./recovery-set";
import { d1RecoveryDigest } from "./d1-store-recovery";
import { assertRecoveryWriterFence, claimRecoveryWriterFence, inspectRecoveryWriters,
  releaseRecoveryWriterFence } from "./recovery-writer-drain";

export interface StagingBackupEnv extends Env {
  STAGING_BACKUP_BACKEND?: string;
  STAGING_BACKUP_ADMISSION?: string;
  STAGING_BACKUP_SOURCE_IDS?: string;
  STAGING_BACKUP_SCHEMA_HASHES?: string;
  STAGING_BACKUP_KEY_ID?: string;
  STAGING_BACKUP_KEY?: string;
  STAGING_BACKUP_BUCKET?: R2Bucket;
}
export type BackupReceipt = {
  format: "fanmark-staging-backup-receipt-v1"; slot: string; owner: string;
  state: "claimed" | "collecting" | "stored" | "verified" | "failed";
  startedAt: string; finishedAt?: string; runtimeRevision: string; keyId: string;
  sourceIds: RecoverySetContext["sourceIds"]; schemaHashes: RecoverySetContext["schemaHashes"];
  objectKey?: string; archiveHash?: string; bytes?: number; captureId?: string;
  fenceReleased: boolean; error?: "capture_failed" | "release_failed";
};
const PREFIX = "recovery/v1/", DAY = 86_400_000;
const ID = /^[A-Za-z0-9:_-]{1,128}$/u, HASH = /^[a-f0-9]{64}$/u;
function fail(code: string): never { throw new Error("staging_backup_" + code); }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Matches the existing staging census identity format, including account/Worker and binding names. */
export async function stagingBackupScope(ids: RecoverySetContext["sourceIds"]): Promise<string> {
  const names = { AUTH_DB: ids.auth, AVATARS_BUCKET: ids.avatars, COVER_IMAGES_BUCKET: ids.covers,
    FANMARK_DB: ids.business, MASTER_DB: ids.master };
  return d1RecoveryDigest({ account: "bfc2890741f0b3fb236e2d755b6c9adc", worker: "fanmark-app-staging",
    stores: Object.entries(names).map(([binding, value]) => binding.endsWith("_DB")
      ? { type: "d1", binding, id: value } : { type: "r2", binding, name: value }) });
}
async function configuration(env: StagingBackupEnv, capture: boolean) {
  if (env.STAGING_BACKUP_BACKEND !== "recovery-set-v1" || env.D1_TOPOLOGY !== "split" ||
      !env.AUTH_DB || !env.FANMARK_DB || !env.MASTER_DB || !env.AVATARS_BUCKET || !env.COVER_IMAGES_BUCKET ||
      !env.STAGING_BACKUP_BUCKET || !ID.test(env.STAGING_BACKUP_KEY_ID ?? "") ||
      !ID.test(env.CF_VERSION_METADATA?.id ?? "") || !/^[a-f0-9]{64}$/u.test(env.STAGING_BACKUP_KEY ?? "") ||
      !env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.trim().length < 32) fail("configuration_invalid");
  let ids: RecoverySetContext["sourceIds"], schemas: RecoverySetContext["schemaHashes"];
  try { ids = JSON.parse(env.STAGING_BACKUP_SOURCE_IDS!); schemas = JSON.parse(env.STAGING_BACKUP_SCHEMA_HASHES!); }
  catch { fail("configuration_invalid"); }
  if (!ids! || !schemas! || !equal(Object.keys(ids!).sort(), [...RECOVERY_SET_STORES].sort()) ||
      !equal(Object.keys(schemas!).sort(), ["auth", "business", "master"]) ||
      Object.values(ids!).some(id => typeof id !== "string" || !ID.test(id)) || new Set(Object.values(ids!)).size !== 5 ||
      Object.values(schemas!).some(hash => typeof hash !== "string" || !HASH.test(hash)) ||
      await stagingBackupScope(ids!) !== env.RECOVERY_DRAIN_SCOPE_DIGEST) fail("identity_mismatch");
  // Set only after independent binding readback and exclusion of every untracked writer.
  // A fresh set of stores may use a fresh census when retained legacy invocations
  // can only reach the old stores; replacing the census alone is never sufficient.
  // Permission to adopt the policy is not evidence that these technical prerequisites passed.
  if (capture && env.STAGING_BACKUP_ADMISSION !== "writers-verified-v1") fail("admission_required");
  const key = await crypto.subtle.importKey("raw", new Uint8Array(env.STAGING_BACKUP_KEY!.match(/../gu)!.map(x => parseInt(x, 16))),
    "AES-GCM", false, ["encrypt", "decrypt"]);
  const context: RecoverySetContext = { sourceIds: ids!, schemaHashes: schemas!, keyId: env.STAGING_BACKUP_KEY_ID!,
    runtimeRevision: env.CF_VERSION_METADATA!.id, authSecret: env.BETTER_AUTH_SECRET.trim() };
  return { key, context, bucket: env.STAGING_BACKUP_BUCKET!, bindings: { auth: env.AUTH_DB!, business: env.FANMARK_DB!,
    master: env.MASTER_DB!, avatars: env.AVATARS_BUCKET!, covers: env.COVER_IMAGES_BUCKET! } };
}
function validSlot(slot: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(slot) && Number.isFinite(Date.parse(slot + "T00:00:00Z")) &&
    new Date(slot + "T00:00:00Z").toISOString().slice(0, 10) === slot;
}
const receiptKey = (slot: string) => PREFIX + "runs/" + slot + ".json";
async function rawHash(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, "0")).join("");
}
function receiptValid(receipt: BackupReceipt, slot: string): boolean {
  return receipt?.format === "fanmark-staging-backup-receipt-v1" && receipt.slot === slot &&
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(receipt.owner) &&
    ["claimed", "collecting", "stored", "verified", "failed"].includes(receipt.state) &&
    typeof receipt.fenceReleased === "boolean";
}
/** Read-only control-plane status; no source Auth rows, cookies, keys or archives leave RPC. */
export async function stagingBackupStatus(env: StagingBackupEnv, slot: string) {
  if (!validSlot(slot)) fail("slot_invalid");
  const { bucket, context } = await configuration(env, false);
  const object = await bucket.get(receiptKey(slot));
  const receipt = object ? await object.json<BackupReceipt>() : null;
  if (receipt && !receiptValid(receipt, slot)) fail("receipt_invalid");
  return { admission: env.STAGING_BACKUP_ADMISSION === "writers-verified-v1", runtimeRevision: context.runtimeRevision,
    keyId: context.keyId, sourceIds: context.sourceIds, schemaHashes: context.schemaHashes, receipt,
    writers: await inspectRecoveryWriters(env) };
}
/** SDK-key escrow stays encrypted separately from the R2 archive; only an internal operator binding may call this. */
export async function sealStagingBackupAuthKey(env: StagingBackupEnv) {
  const { key, context } = await configuration(env, false);
  const authKeyId = await d1RecoveryDigest(["better-auth-recovery-key-v1", context.authSecret]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const header = { format: "fanmark-staging-auth-key-escrow-v1", keyId: context.keyId, authKeyId };
  const plaintext = new TextEncoder().encode(context.authSecret);
  try { return { ...header, nonce: [...nonce], ciphertext: [...new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(JSON.stringify(header)) }, key, plaintext))] }; }
  finally { plaintext.fill(0); }
}
/** One attempt per UTC slot. Incomplete/lost acknowledgments require operator inspection, never automatic replay. */
export async function runStagingBackup(env: StagingBackupEnv, slot: string, now = new Date()): Promise<BackupReceipt> {
  if (!validSlot(slot) || slot !== now.toISOString().slice(0, 10)) fail("slot_invalid");
  const { key, context, bucket, bindings } = await configuration(env, true);
  const receipt: BackupReceipt = { format: "fanmark-staging-backup-receipt-v1", slot, owner: crypto.randomUUID(),
    state: "claimed", startedAt: now.toISOString(), runtimeRevision: context.runtimeRevision, keyId: context.keyId,
    sourceIds: context.sourceIds, schemaHashes: context.schemaHashes, fenceReleased: false };
  // A strongly consistent conditional object is the attempt lock. Its owner is never reused by another invocation.
  const claim = await bucket.put(receiptKey(slot), JSON.stringify(receipt), {
    onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/json" }, storageClass: "Standard" });
  if (!claim) fail("slot_already_claimed_inspect_status");
  const save = async () => { await bucket.put(receiptKey(slot), JSON.stringify(receipt), { storageClass: "Standard",
    httpMetadata: { contentType: "application/json" } }); };
  let attemptedFence = false;
  try {
    attemptedFence = true;
    await claimRecoveryWriterFence(env, receipt.owner);
    // Poll for at most 20 seconds. Do not detach or race any collection/write against a timeout.
    for (let i = 0; ; i++) {
      const writers = await inspectRecoveryWriters(env);
      if (writers.owner !== receipt.owner) fail("fence_lost");
      if (writers.drained) break;
      if (i >= 20) fail("drain_pending");
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const guard = { id: receipt.owner, async assertHeld(ids: RecoverySetContext["sourceIds"]) {
      if (!equal(ids, context.sourceIds)) fail("identity_mismatch");
      await assertRecoveryWriterFence(env, receipt.owner);
    } };
    receipt.state = "collecting"; await save();
    const archive = await collectRecoverySet(bindings, context, key, guard);
    const bytes = JSON.stringify(archive);
    receipt.objectKey = PREFIX + "archives/" + slot + "/" + receipt.owner + ".json";
    receipt.archiveHash = await rawHash(bytes); receipt.bytes = new TextEncoder().encode(bytes).length;
    if (!await bucket.put(receipt.objectKey, bytes, { onlyIf: { etagDoesNotMatch: "*" }, storageClass: "Standard",
      httpMetadata: { contentType: "application/json" } })) fail("archive_exists");
    receipt.state = "stored"; await save();
    const stored = await bucket.get(receipt.objectKey); if (!stored) fail("readback_missing");
    const readback = await stored.text(); if (await rawHash(readback) !== receipt.archiveHash) fail("readback_mismatch");
    const opened = await openRecoverySet(JSON.parse(readback) as RecoverySetArchive, context, key);
    await guard.assertHeld(context.sourceIds);
    receipt.captureId = opened.manifest.captureId; receipt.state = "verified";
  } catch {
    receipt.state = "failed"; receipt.error = "capture_failed";
  } finally {
    // Every operation above settled first. An isolate crash leaves the owner fence + nonterminal receipt intact.
    // Even an uncertain claim ACK can be inspected/released safely: no unawaited capture task exists here.
    if (attemptedFence) {
      try {
        const writers = await inspectRecoveryWriters(env);
        if (writers.owner === receipt.owner) await releaseRecoveryWriterFence(env, receipt.owner);
        receipt.fenceReleased = (await inspectRecoveryWriters(env)).owner !== receipt.owner;
      } catch { receipt.error = "release_failed"; }
    }
    receipt.finishedAt = new Date().toISOString(); await save();
  }
  if (receipt.state !== "verified" || !receipt.fenceReleased) fail(receipt.error ?? "capture_failed");
  return receipt;
}
/** Retain thirty UTC dates. Only verified/released receipts authorize deletion of their exact owned archive. */
export async function pruneStagingBackups(env: StagingBackupEnv, today: string) {
  if (!validSlot(today)) fail("slot_invalid");
  const { bucket } = await configuration(env, true);
  const current = await bucket.get(receiptKey(today));
  const latest = current ? await current.json<BackupReceipt>() : null;
  if (!latest || !receiptValid(latest, today) || latest.state !== "verified" || !latest.fenceReleased) fail("retention_requires_success");
  if (latest.objectKey !== PREFIX + "archives/" + today + "/" + latest.owner + ".json" || !HASH.test(latest.archiveHash ?? ""))
    fail("retention_requires_success");
  const newest = await bucket.get(latest.objectKey);
  if (!newest || await rawHash(await newest.text()) !== latest.archiveHash) fail("retention_requires_success");
  let cursor: string | undefined, deleted = 0;
  const cutoff = Date.parse(today + "T00:00:00Z") - 29 * DAY;
  do {
    const page = await bucket.list({ prefix: PREFIX + "runs/", cursor, limit: 100 });
    for (const object of page.objects) {
      const slot = object.key.slice((PREFIX + "runs/").length, -5);
      if (object.key !== receiptKey(slot) || !validSlot(slot) || Date.parse(slot + "T00:00:00Z") >= cutoff) continue;
      const body = await bucket.get(object.key); if (!body) continue;
      const old = await body.json<BackupReceipt>();
      if (!receiptValid(old, slot) || old.state !== "verified" || !old.fenceReleased ||
          old.objectKey !== PREFIX + "archives/" + slot + "/" + old.owner + ".json" || !HASH.test(old.archiveHash ?? "")) continue;
      const archive = await bucket.get(old.objectKey);
      if (archive && await rawHash(await archive.text()) !== old.archiveHash) fail("retention_hash_mismatch");
      await bucket.delete(old.objectKey); await bucket.delete(object.key); deleted++;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { deleted, retentionDays: 30 };
}
