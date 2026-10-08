import type { BackupReceipt } from "./staging-backup";
type SchedulerEnv = {
  STAGING_BACKUP_SCHEDULE?: string;
  BACKUP_SERVICE: { run(slot: string): Promise<BackupReceipt>; prune(slot: string): Promise<{ deleted: number }> };
};
export const STAGING_BACKUP_CRON = "15 19 * * *"; // 04:15 JST, once per UTC date.
export default {
  fetch() { return new Response(null, { status: 404 }); },
  async scheduled(event: ScheduledController, env: SchedulerEnv) {
    if (env.STAGING_BACKUP_SCHEDULE !== "daily-v1") throw new Error("staging_backup_schedule_disabled");
    if (event.cron !== STAGING_BACKUP_CRON) throw new Error("staging_backup_cron_invalid");
    const slot = new Date(event.scheduledTime).toISOString().slice(0, 10);
    // Do not return while the source fence is owned. A failure is a failed Cron + durable receipt, never a success log.
    const receipt = await env.BACKUP_SERVICE.run(slot);
    const retained = await env.BACKUP_SERVICE.prune(slot);
    console.log(JSON.stringify({ event: "staging_backup_verified", slot, captureId: receipt.captureId,
      archiveHash: receipt.archiveHash, bytes: receipt.bytes, deleted: retained.deleted }));
  },
};
