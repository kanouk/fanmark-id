import type { BackupReceipt } from "./staging-backup";
import type { BackupAlert } from "./staging-backup-alert";
import { STAGING_BACKUP_CRON } from "./staging-backup-schedule";
export { STAGING_BACKUP_CRON } from "./staging-backup-schedule";
type SchedulerEnv = {
  STAGING_BACKUP_SCHEDULE?: string;
  RECOVERY_DRAIN_SCOPE_DIGEST?: string;
  BACKUP_SERVICE: { run(slot: string): Promise<BackupReceipt>; prune(slot: string): Promise<{ deleted: number }>;
    alert(input: BackupAlert): Promise<unknown> };
};
export default {
  fetch() { return new Response(null, { status: 404 }); },
  async scheduled(event: ScheduledController, env: SchedulerEnv) {
    if (env.STAGING_BACKUP_SCHEDULE !== "daily-v1") throw new Error("staging_backup_schedule_disabled");
    if (event.cron !== STAGING_BACKUP_CRON) throw new Error("staging_backup_cron_invalid");
    const slot = new Date(event.scheduledTime).toISOString().slice(0, 10);
    // Do not return while the source fence is owned. A failure is a failed Cron + durable receipt, never a success log.
    let stage: "backup-failed" | "retention-failed" = "backup-failed";
    try {
      const receipt = await env.BACKUP_SERVICE.run(slot);
      stage = "retention-failed";
      const retained = await env.BACKUP_SERVICE.prune(slot);
      console.log(JSON.stringify({ event: "staging_backup_verified", slot, captureId: receipt.captureId,
        archiveHash: receipt.archiveHash, bytes: receipt.bytes, deleted: retained.deleted }));
    } catch {
      try { await env.BACKUP_SERVICE.alert({ slot, scope: env.RECOVERY_DRAIN_SCOPE_DIGEST ?? "", code: stage }); }
      catch { console.error(JSON.stringify({ event: "staging_backup_alert_requires_inspection", slot, stage })); }
      throw new Error("staging_" + stage.replaceAll("-", "_"));
    }
  },
};
