import { WorkerEntrypoint } from "cloudflare:workers";
import { runStagingBackup, stagingBackupStatus, sealStagingBackupAuthKey, pruneStagingBackups,
  type StagingBackupEnv } from "./staging-backup";
import { sendStagingBackupAlert, type BackupAlert, type BackupAlertEnv } from "./staging-backup-alert";

/** Named, binding-only entrypoint. The application's default HTTP router does not dispatch these methods. */
export class StagingBackupService extends WorkerEntrypoint<StagingBackupEnv & BackupAlertEnv> {
  run(slot: string) { return runStagingBackup(this.env, slot); }
  status(slot: string) { return stagingBackupStatus(this.env, slot); }
  sealAuthKey() { return sealStagingBackupAuthKey(this.env); }
  prune(slot: string) { return pruneStagingBackups(this.env, slot); }
  alert(input: BackupAlert) { return sendStagingBackupAlert(this.env, input); }
}

/** Separate capability for the monitor: it cannot invoke capture, retention, status or key escrow. */
export class StagingBackupAlertService extends WorkerEntrypoint<BackupAlertEnv> {
  alert(input: BackupAlert) { return sendStagingBackupAlert(this.env, input); }
}
