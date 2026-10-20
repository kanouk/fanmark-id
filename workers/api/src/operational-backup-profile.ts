import { d1RecoveryDigest } from "./d1-store-recovery";
import type { RecoverySetContext } from "./recovery-set";
import { PRODUCTION_RUNTIME, PRODUCTION_STORE_IDS } from "./production-runtime-identity";

export type BackupProfile = "staging" | "production";
export function backupReceiptFormat(profile: BackupProfile) {
  return profile === "production" ? "fanmark-production-backup-receipt-v1" as const : "fanmark-staging-backup-receipt-v1" as const;
}
export async function operationalBackupScope(ids: RecoverySetContext["sourceIds"], profile: BackupProfile): Promise<string> {
  if (profile !== "staging" && profile !== "production") throw new Error("backup_profile_invalid");
  if (profile === "production" && (!ids || Object.keys(ids).sort().join(",") !== Object.keys(PRODUCTION_STORE_IDS).sort().join(",") ||
      Object.entries(PRODUCTION_STORE_IDS).some(([key,value]) => ids[key as keyof typeof ids] !== value)))
    throw new Error("production_backup_identity_mismatch");
  const names = { AUTH_DB: ids.auth, AVATARS_BUCKET: ids.avatars, COVER_IMAGES_BUCKET: ids.covers,
    FANMARK_DB: ids.business, MASTER_DB: ids.master };
  return d1RecoveryDigest({ account: PRODUCTION_RUNTIME.accountId,
    worker: profile === "production" ? PRODUCTION_RUNTIME.worker : "fanmark-app-staging",
    stores: Object.entries(names).map(([binding, value]) => binding.endsWith("_DB")
      ? { type: "d1", binding, id: value } : { type: "r2", binding, name: value }) });
}
