/** Guard the opt-in alarm rehearsal; the existing Cron config is deliberately refused. */
export function isStagingNotificationWakeTarget(config) {
  if (!config || config.name !== "fanmark-app-staging" ||
      config.account_id !== "bfc2890741f0b3fb236e2d755b6c9adc" || config.workers_dev !== true ||
      (config.routes !== undefined && (!Array.isArray(config.routes) || config.routes.length !== 0))) return false;
  const vars = config.vars ?? {};
  if (vars.NOTIFICATION_WAKE_BACKEND !== "durable-object" || vars.NOTIFICATION_PROCESSOR_BACKEND !== "d1" ||
      vars.AUTH_BACKEND !== "better-auth" || vars.CUTOVER_WRITE_FREEZE !== "false" ||
      vars.STAGING_NO_INDEX !== "true" || vars.CORS_ALLOWED_ORIGINS !== "https://fanmark-app-staging.fanmark-id.workers.dev" ||
      ["LICENSE_EXPIRY_BACKEND", "NOTIFICATION_ARCHIVE_BACKEND", "STRIPE_DISPATCH_BACKEND", "STRIPE_WEBHOOK_BACKEND",
        "BROADCAST_SEND_BACKEND", "BROADCAST_TEST_SEND_BACKEND", "AUTH_EMAIL_BACKEND"].some(key => vars[key] !== undefined)) return false;
  const crons = config.triggers?.crons;
  if (!Array.isArray(crons) || crons.length !== 1 || crons[0] !== "0 0 * * *") return false;
  const expected = {
    FANMARK_DB: ["fanmark-business-staging", "d4bb0c48-f24a-491f-8693-fa393ab0b873"],
    AUTH_DB: ["fanmark-auth-staging", "2116bc43-32ab-4e3e-b762-9378df88b95f"],
    MASTER_DB: ["fanmark-emoji-master-staging", "160376b0-bde6-4d5f-8969-96deb5ae1183"],
  };
  const databases = config.d1_databases;
  if (!Array.isArray(databases) || databases.length !== 3 || Object.entries(expected).some(([binding, [name, id]]) => {
    const matches = databases.filter(database => database.binding === binding);
    return matches.length !== 1 || matches[0].database_name !== name || matches[0].database_id !== id || matches[0].remote !== true;
  })) return false;
  const bindings = config.durable_objects?.bindings;
  const migrations = config.migrations;
  return Array.isArray(bindings) && bindings.length === 1 && bindings[0].name === "NOTIFICATION_WAKE" &&
    bindings[0].class_name === "NotificationWakeCoordinator" && bindings[0].script_name === undefined &&
    Array.isArray(migrations) && migrations.length === 1 && migrations[0].tag === "notification-wake-v1" &&
    JSON.stringify(migrations[0].new_sqlite_classes) === JSON.stringify(["NotificationWakeCoordinator"]) &&
    migrations[0].new_classes === undefined && migrations[0].deleted_classes === undefined &&
    migrations[0].renamed_classes === undefined && migrations[0].transferred_classes === undefined;
}

/** Accept either the legacy staged Cron or the complete opt-in alarm baseline. */
export function stagingNotificationScheduleMode(config) {
  if (isStagingNotificationWakeTarget(config)) return "alarm";
  if (config?.vars?.NOTIFICATION_WAKE_BACKEND !== undefined || config?.vars?.NOTIFICATION_PROCESSOR_BACKEND !== "d1" ||
      config?.durable_objects !== undefined || config?.migrations !== undefined) return null;
  const crons = config?.triggers?.crons;
  return Array.isArray(crons) && crons.length === 2 && new Set(crons).size === 2 &&
    crons.includes("* * * * *") && crons.includes("0 0 * * *") ? "cron" : null;
}
