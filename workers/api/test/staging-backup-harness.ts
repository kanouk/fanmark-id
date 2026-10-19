/** Local-only fixture router. Never deploy this test module or bind retained staging stores. */
export { RecoveryWriterCoordinator } from "../src/recovery-writer-drain";
export { ProductionBackupService } from "../src/production-backup-service";
export { StagingBackupService } from "../src/staging-backup-service";
import { runStagingBackup as runBackupCore, runProductionManualBackup, type StagingBackupEnv } from "../src/staging-backup";
import { withRecoveryWriter, inspectRecoveryWriters, claimRecoveryWriterFence, releaseRecoveryWriterFence } from "../src/recovery-writer-drain";
import scheduler, { STAGING_BACKUP_CRON } from "../src/staging-backup-scheduler";

type HarnessEnv = StagingBackupEnv & { FIXTURE_BACKUP_PROFILE?: "production" | "staging"; BACKUP_SERVICE: {
  run(slot: string): Promise<unknown>; status(slot: string): Promise<unknown>;
  runManual(operationId: string): Promise<unknown>; statusManual(operationId: string): Promise<unknown>;
  sealAuthKey(): Promise<unknown>; prune(slot: string): Promise<unknown>;
} };
function runStagingBackup(env: HarnessEnv, slot: string, operationId?: string) {
  if (operationId !== undefined) return runProductionManualBackup(env, operationId);
  return runBackupCore(env, slot, new Date(), env.FIXTURE_BACKUP_PROFILE ?? "staging");
}
export default {
  async fetch(request: Request, env: HarnessEnv) {
    const { path, slot, owner, admission, mode, operationId } = await request.json<{ path: string; slot: string; owner?: string; admission?: string; mode?: string; operationId?: string }>();
    try {
      switch (path) {
        case "wrong-identity": return Response.json(await runStagingBackup({ ...env,
          STAGING_BACKUP_SOURCE_IDS: env.STAGING_BACKUP_SOURCE_IDS!.replace("dc43ffd7-0ca8-45d6-805c-ae1e6f2b58a6", "different-auth") }, slot, operationId));
        case "manual-run": return Response.json(await env.BACKUP_SERVICE.runManual(operationId!));
        case "manual-status": return Response.json(await env.BACKUP_SERVICE.statusManual(operationId!));
        case "wrong-manual-schema": return Response.json(await runProductionManualBackup({ ...env,
          STAGING_BACKUP_SCHEMA_HASHES: env.STAGING_BACKUP_SCHEMA_HASHES!.replace(/[a-f0-9]{64}/, "f".repeat(64)) }, operationId!));
        case "rpc-run": return Response.json(await env.BACKUP_SERVICE.run(slot));
        case "rpc-status": return Response.json(await env.BACKUP_SERVICE.status(slot));
        case "escrow": return Response.json(await env.BACKUP_SERVICE.sealAuthKey());
        case "prune": return Response.json(await env.BACKUP_SERVICE.prune(slot));
        case "writers": return Response.json(await inspectRecoveryWriters(env));
        case "claim": return Response.json(await claimRecoveryWriterFence(env, owner!));
        case "release": await releaseRecoveryWriterFence(env, owner!); return Response.json({ released: true });
        case "writer": await withRecoveryWriter(env, async () => {
          await env.FANMARK_DB!.prepare("UPDATE user_settings SET display_name='native-writer'").run();
        }); return Response.json({ written: true });
        case "slow-writer": await withRecoveryWriter(env, async () => {
          await new Promise(resolve => setTimeout(resolve, 1200));
          await env.FANMARK_DB!.prepare("UPDATE user_settings SET display_name='settled-native-writer'").run();
        }); return Response.json({ written: true });
        case "pending-writer": await withRecoveryWriter(env, async () => {
          await new Promise(resolve => setTimeout(resolve, 25_000));
        }); return Response.json({ settled: true });
        case "blocked": return Response.json(await runStagingBackup({ ...env, STAGING_BACKUP_ADMISSION: admission }, slot, operationId));
        case "failure": {
          // Fault only at the source binding; the real fence/R2 journal still execute in workerd.
          const source = env.AUTH_DB!;
          const broken = new Proxy(source, { get(target, prop) {
            if (prop === "batch") return async () => { throw new Error("PII-never-log:fixture-email-password"); };
            const value = Reflect.get(target, prop); return typeof value === "function" ? value.bind(target) : value;
          } });
          return Response.json(await runStagingBackup({ ...env, AUTH_DB: broken }, slot, operationId));
        }
        case "claim-ack-loss": {
          const bucket = env.STAGING_BACKUP_BUCKET!;
          const unknown = new Proxy(bucket, { get(target, prop) {
            if (prop === "put") return async (...args: Parameters<R2Bucket["put"]>) => {
              await target.put(...args); throw new Error("synthetic-lost-put-ack");
            };
            const value = Reflect.get(target, prop); return typeof value === "function" ? value.bind(target) : value;
          } });
          return Response.json(await runStagingBackup({ ...env, STAGING_BACKUP_BUCKET: unknown }, slot, operationId));
        }
        case "scheduler": {
          let calls = 0;
          let alerts = 0;
          const service = { async run() { calls++; throw new Error("synthetic-rpc-failure"); },
            async prune() { calls++; return { deleted: 0 }; }, async alert() { alerts++; return {}; } };
          try { await scheduler.scheduled({ cron: mode === "bad-cron" ? "* * * * *" : STAGING_BACKUP_CRON,
            scheduledTime: Date.now() } as ScheduledController, { STAGING_BACKUP_SCHEDULE: mode === "disabled" ? "disabled" : "daily-v1", BACKUP_SERVICE: service }); }
          catch (error) { return Response.json({ calls, alerts, error: (error as Error).message }); }
          return Response.json({ calls });
        }
        default: return new Response(null, { status: 404 });
      }
    } catch (error) { return Response.json({ error: (error as Error).message }, { status: 409 }); }
  },
};
