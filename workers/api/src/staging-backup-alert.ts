import type { StagingBackupEnv } from "./staging-backup";
import { stagingBackupScope } from "./staging-backup";

export const BACKUP_ALERT_CODES = ["backup-failed", "retention-failed", "backup-missing", "backup-incomplete",
  "backup-invalid", "archive-missing", "backup-stale", "monitor-read-failed", "delivery-test"] as const;
export type BackupAlertCode = typeof BACKUP_ALERT_CODES[number];
export type BackupAlert = { slot: string; scope: string; code: BackupAlertCode };
export interface BackupAlertEnv extends StagingBackupEnv {
  STAGING_BACKUP_ALERT_BACKEND?: string;
  STAGING_BACKUP_ALERT_TO?: string;
}
const safeSlot = (slot: string) => /^\d{4}-\d{2}-\d{2}$/u.test(slot) && Number.isFinite(Date.parse(slot + "T00:00:00Z")) &&
  new Date(slot + "T00:00:00Z").toISOString().slice(0, 10) === slot;

/** Binding-only transport. Neither caller-controlled addresses nor exception text enter the message. */
export async function sendStagingBackupAlert(env: BackupAlertEnv, alert: BackupAlert, fetchImpl = fetch, now = new Date()) {
  if (env.STAGING_BACKUP_ALERT_BACKEND !== "resend-v1" || !env.STAGING_BACKUP_BUCKET ||
      !/^fanmark\.id\+staging-test\d{2}@gmail\.com$/u.test(env.STAGING_BACKUP_ALERT_TO ?? "") ||
      (env.RESEND_API_KEY?.trim().length ?? 0) < 16 || !env.RESEND_FROM_EMAIL?.trim() ||
      /[\r\n]/u.test(env.RESEND_FROM_EMAIL)) throw new Error("staging_backup_alert_configuration_invalid");
  if (!alert || !safeSlot(alert.slot) || Date.parse(alert.slot + "T00:00:00Z") > now.getTime() ||
      !BACKUP_ALERT_CODES.includes(alert.code) || !/^[a-f0-9]{64}$/u.test(alert.scope) ||
      alert.scope !== env.RECOVERY_DRAIN_SCOPE_DIGEST ||
      await stagingBackupScope(JSON.parse(env.STAGING_BACKUP_SOURCE_IDS!)) !== alert.scope)
    throw new Error("staging_backup_alert_identity_invalid");
  const bucket = env.STAGING_BACKUP_BUCKET;
  const key = `recovery/v1/alerts/${alert.scope}/${alert.slot}/${alert.code}.json`;
  const receipt = { format: "fanmark-staging-backup-alert-v1", ...alert, owner: crypto.randomUUID(),
    state: "claimed", startedAt: now.toISOString(), providerId: "" };
  let claim: R2Object | null;
  try { claim = await bucket.put(key, JSON.stringify(receipt), { onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json" }, storageClass: "Standard" }); }
  catch { throw new Error("staging_backup_alert_claim_unknown"); }
  if (!claim) {
    let prior: typeof receipt | null;
    try { const body = await bucket.get(key); prior = body ? await body.json<typeof receipt>() : null; }
    catch { throw new Error("staging_backup_alert_requires_inspection"); }
    if (prior?.format !== receipt.format || prior.scope !== alert.scope || prior.slot !== alert.slot || prior.code !== alert.code ||
        prior.state !== "provider-accepted" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(prior.providerId))
      throw new Error("staging_backup_alert_requires_inspection");
    return { state: "provider-accepted" as const, duplicate: true, providerId: prior.providerId };
  }
  // At most one provider request. A lost ACK remains claimed/failed for inspection, never automatic resend.
  let accepted = false;
  try {
    const response = await fetchImpl("https://api.resend.com/emails", { method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.RESEND_FROM_EMAIL!.trim(), to: [env.STAGING_BACKUP_ALERT_TO],
        subject: `[fanmark.id staging] バックアップ ${alert.code} (${alert.slot})`,
        text: `ステージングのバックアップ監視通知です。\nUTC日付: ${alert.slot}\n状態: ${alert.code}\n` +
          "recovery/v1 の当日receiptとownerを確認してください。保存や停止解除を自動で再実行しないでください。\n" +
          "delivery-testは通知経路の検証であり、バックアップの障害を意味しません。" }) });
    if (!response.ok) throw new Error("provider_failed");
    const result = await response.json<{ id?: string }>();
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(result.id ?? "")) throw new Error("provider_ack_invalid");
    receipt.providerId = result.id!; receipt.state = "provider-accepted"; accepted = true;
  } catch { receipt.state = "provider-unknown-or-failed"; }
  try { await bucket.put(key, JSON.stringify(receipt), { httpMetadata: { contentType: "application/json" }, storageClass: "Standard" }); }
  catch { throw new Error("staging_backup_alert_receipt_unknown"); }
  if (!accepted) throw new Error("staging_backup_alert_provider_unknown_or_failed");
  return { state: "provider-accepted" as const, duplicate: false, providerId: receipt.providerId };
}
