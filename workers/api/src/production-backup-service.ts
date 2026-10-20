import { WorkerEntrypoint } from "cloudflare:workers";
import { runStagingBackup, stagingBackupStatus, sealStagingBackupAuthKey, pruneStagingBackups,
  runProductionManualBackup, productionManualBackupStatus, type StagingBackupEnv } from "./staging-backup";
import { sendStagingBackupAlert, type BackupAlert, type BackupAlertEnv } from "./staging-backup-alert";

/** Binding-only production capabilities. Production profile pins the five stores and Worker scope. */
export class ProductionBackupService extends WorkerEntrypoint<StagingBackupEnv & BackupAlertEnv> {
  run(slot: string) { return runStagingBackup(this.env, slot, new Date(), "production"); }
  status(slot: string) { return stagingBackupStatus(this.env, slot, "production"); }
  runManual(operationId: string) { return runProductionManualBackup(this.env, operationId); }
  statusManual(operationId: string) { return productionManualBackupStatus(this.env, operationId); }
  sealAuthKey() { return sealStagingBackupAuthKey(this.env, "production"); }
  prune(slot: string) { return pruneStagingBackups(this.env, slot, "production"); }
  alert(input: BackupAlert) { return sendStagingBackupAlert(this.env, input, fetch, new Date(), "production"); }
}
/** The monitor receives only this capability; it cannot capture, delete or read the Auth key. */
export class ProductionBackupAlertService extends WorkerEntrypoint<BackupAlertEnv> {
  alert(input: BackupAlert) { return sendStagingBackupAlert(this.env, input, fetch, new Date(), "production"); }
}
