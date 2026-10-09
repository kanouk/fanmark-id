// UTC Crons: daily capture after the lifecycle batch, then an independent hourly check with thirty minutes' grace.
export const STAGING_BACKUP_CRON = "5 0 * * *"; // 09:05 JST.
export const STAGING_BACKUP_MONITOR_CRON = "35 * * * *";
