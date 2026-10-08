import { WorkerEntrypoint } from "cloudflare:workers";
import { runStagingBackup, stagingBackupStatus, sealStagingBackupAuthKey, pruneStagingBackups,
  type StagingBackupEnv } from "./staging-backup";

/** Named, binding-only entrypoint. The application's default HTTP router does not dispatch these methods. */
export class StagingBackupService extends WorkerEntrypoint<StagingBackupEnv> {
  run(slot: string) { return runStagingBackup(this.env, slot); }
  status(slot: string) { return stagingBackupStatus(this.env, slot); }
  sealAuthKey() { return sealStagingBackupAuthKey(this.env); }
  prune(slot: string) { return pruneStagingBackups(this.env, slot); }
}
