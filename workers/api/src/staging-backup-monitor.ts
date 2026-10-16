import type { BackupReceipt } from "./staging-backup";
import type { BackupAlert, BackupAlertCode } from "./staging-backup-alert";
import { stagingBackupScope } from "./staging-backup";
import { STAGING_BACKUP_MONITOR_CRON } from "./staging-backup-schedule";
export { STAGING_BACKUP_MONITOR_CRON } from "./staging-backup-schedule";

export type BackupMonitorEnv = {
  STAGING_BACKUP_MONITOR?: string;
  STAGING_BACKUP_BUCKET: R2Bucket;
  STAGING_BACKUP_SOURCE_IDS: string;
  STAGING_BACKUP_SCHEMA_HASHES: string;
  STAGING_BACKUP_KEY_ID: string;
  RECOVERY_DRAIN_SCOPE_DIGEST: string;
  BACKUP_ALERT_SERVICE: { alert(input: BackupAlert): Promise<unknown> };
};
export function expectedBackupSlot(now: number) {
  // Daily capture is 00:05 UTC. Give it thirty minutes before reporting a missing/incomplete run.
  const date = new Date(now), midnight = Date.parse(date.toISOString().slice(0, 10) + "T00:00:00Z");
  return new Date(now < midnight + 35 * 60_000 ? midnight - 86_400_000 : midnight).toISOString().slice(0, 10);
}
const same = (actual: Record<string, string>, expected: Record<string, string>) => actual && expected &&
  JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(Object.keys(expected).sort()) &&
  Object.keys(expected).every(key => actual[key] === expected[key]);

/** Reads only control receipts and archive HEAD. No source bindings, decryption key, capture or pruning capability. */
export async function inspectStagingBackup(env: BackupMonitorEnv, now = Date.now()): Promise<{ slot: string; code: BackupAlertCode | null }> {
  const slot = expectedBackupSlot(now);
  const ids = JSON.parse(env.STAGING_BACKUP_SOURCE_IDS), schemas = JSON.parse(env.STAGING_BACKUP_SCHEMA_HASHES);
  if (!env.STAGING_BACKUP_BUCKET || !/^[a-f0-9]{64}$/u.test(env.RECOVERY_DRAIN_SCOPE_DIGEST) ||
      await stagingBackupScope(ids) !== env.RECOVERY_DRAIN_SCOPE_DIGEST) throw new Error("staging_backup_monitor_identity_invalid");
  const object = await env.STAGING_BACKUP_BUCKET.get(`recovery/v1/runs/${slot}.json`);
  if (!object) return { slot, code: "backup-missing" };
  if (object.size > 65_536) return { slot, code: "backup-invalid" };
  let receipt: BackupReceipt;
  try { receipt = await object.json<BackupReceipt>(); } catch { return { slot, code: "backup-invalid" }; }
  if (receipt?.format !== "fanmark-staging-backup-receipt-v1" || receipt.slot !== slot ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(receipt.owner) ||
      receipt.keyId !== env.STAGING_BACKUP_KEY_ID || !same(receipt.sourceIds, ids) || !same(receipt.schemaHashes, schemas))
    return { slot, code: "backup-invalid" };
  if (receipt.state === "failed") return { slot, code: "backup-failed" };
  if (["claimed", "collecting", "stored"].includes(receipt.state)) return { slot, code: "backup-incomplete" };
  if (receipt.state !== "verified" || receipt.fenceReleased !== true ||
      receipt.objectKey !== `recovery/v1/archives/${slot}/${receipt.owner}.json` ||
      !/^[a-f0-9]{64}$/u.test(receipt.archiveHash ?? "") || !Number.isSafeInteger(receipt.bytes) || receipt.bytes! <= 0 ||
      !Number.isFinite(Date.parse(receipt.startedAt)) || new Date(receipt.startedAt).toISOString().slice(0, 10) !== slot ||
      !Number.isFinite(Date.parse(receipt.finishedAt ?? "")) || Date.parse(receipt.finishedAt!) < Date.parse(receipt.startedAt) ||
      Date.parse(receipt.finishedAt!) > now + 300_000) return { slot, code: "backup-invalid" };
  if (now - Date.parse(receipt.finishedAt!) > 86_400_000) return { slot, code: "backup-stale" };
  const archive = await env.STAGING_BACKUP_BUCKET.head(receipt.objectKey);
  if (!archive || archive.size !== receipt.bytes) return { slot, code: "archive-missing" };
  if (receipt.retention?.days !== 30 || !Number.isSafeInteger(receipt.retention.deleted) || receipt.retention.deleted < 0 ||
      !Number.isFinite(Date.parse(receipt.retention.finishedAt)) ||
      Date.parse(receipt.retention.finishedAt) < Date.parse(receipt.finishedAt!) ||
      Date.parse(receipt.retention.finishedAt) > now + 300_000) return { slot, code: "retention-failed" };
  return { slot, code: null };
}
export default {
  fetch() { return new Response(null, { status: 404 }); },
  async scheduled(event: ScheduledController, env: BackupMonitorEnv) {
    if (env.STAGING_BACKUP_MONITOR !== "hourly-v1") throw new Error("staging_backup_monitor_disabled");
    if (event.cron !== STAGING_BACKUP_MONITOR_CRON) throw new Error("staging_backup_monitor_cron_invalid");
    let result: Awaited<ReturnType<typeof inspectStagingBackup>>;
    try { result = await inspectStagingBackup(env); }
    catch { result = { slot: expectedBackupSlot(Date.now()), code: "monitor-read-failed" }; }
    if (result.code) {
      await env.BACKUP_ALERT_SERVICE.alert({ ...result, code: result.code, scope: env.RECOVERY_DRAIN_SCOPE_DIGEST });
      throw new Error("staging_backup_monitor_unhealthy");
    }
    console.log(JSON.stringify({ event: "staging_backup_monitor_healthy", slot: result.slot }));
  },
};
