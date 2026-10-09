/** Local-only monitor/alert fixture. Never deploy or bind actual staging resources. */
export { StagingBackupService, StagingBackupAlertService } from "../src/staging-backup-service";
import monitor, { inspectStagingBackup, type BackupMonitorEnv } from "../src/staging-backup-monitor";
import { sendStagingBackupAlert, type BackupAlert, type BackupAlertEnv } from "../src/staging-backup-alert";
import scheduler from "../src/staging-backup-scheduler";
import { STAGING_BACKUP_CRON, STAGING_BACKUP_MONITOR_CRON } from "../src/staging-backup-schedule";

type FixtureEnv = BackupMonitorEnv & BackupAlertEnv & { SERVICE: { alert(input: BackupAlert): Promise<unknown> } };
export default {
  async fetch(request: Request, env: FixtureEnv) {
    const input = await request.json<{ path: string; now?: number; alert?: BackupAlert; mode?: string }>();
    try {
      if (input.path === "inspect") return Response.json(await inspectStagingBackup(env, input.now));
      if (input.path === "alert") return Response.json(await env.SERVICE.alert(input.alert!));
      if (input.path === "forbidden-monitor-rpc") {
        const service = env.BACKUP_ALERT_SERVICE as unknown as {
          run(slot: string): Promise<unknown>; status(slot: string): Promise<unknown>; sealAuthKey(): Promise<unknown>; prune(slot: string): Promise<unknown> };
        const denied: Record<string, string> = {};
        for (const method of ["run", "status", "sealAuthKey", "prune"] as const) {
          try { await service[method](new Date().toISOString().slice(0, 10)); }
          catch (error) { denied[method] = (error as Error).message; }
        }
        return Response.json({ denied });
      }
      if (input.path === "claim-ack-loss") {
        const bucket = env.STAGING_BACKUP_BUCKET!;
        const uncertain = new Proxy(bucket, { get(target, property) {
          if (property === "put") return async (...args: Parameters<R2Bucket["put"]>) => {
            await target.put(...args); throw new Error("fixture-private-claim-error");
          };
          const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
        } });
        return Response.json(await sendStagingBackupAlert({ ...env, STAGING_BACKUP_BUCKET: uncertain }, input.alert!));
      }
      if (input.path === "monitor") {
        await monitor.scheduled({ cron: input.mode === "wrong-cron" ? "* * * * *" : STAGING_BACKUP_MONITOR_CRON } as ScheduledController,
          { ...env, STAGING_BACKUP_MONITOR: input.mode === "disabled" ? "disabled" : "hourly-v1" });
        return Response.json({ healthy: true });
      }
      if (input.path === "scheduler") {
        const calls: string[] = [];
        const service = { async run() { calls.push("run"); return {} as never; },
          async prune() { calls.push("prune"); throw new Error("fixture-private-source-rows"); },
          async alert(alert: BackupAlert) { calls.push(alert.code); throw new Error("fixture-private-provider-response"); } };
        try { await scheduler.scheduled({ cron: STAGING_BACKUP_CRON, scheduledTime: Date.now() } as ScheduledController,
          { STAGING_BACKUP_SCHEDULE: "daily-v1", RECOVERY_DRAIN_SCOPE_DIGEST: env.RECOVERY_DRAIN_SCOPE_DIGEST, BACKUP_SERVICE: service }); }
        catch (error) { return Response.json({ calls, error: (error as Error).message }); }
      }
      return new Response(null, { status: 404 });
    } catch (error) { return Response.json({ error: (error as Error).message }, { status: 409 }); }
  },
};
