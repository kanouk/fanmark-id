import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isStagingNotificationWakeTarget, stagingNotificationScheduleMode } from "./staging-notification-wake-target.mjs";
const deployed = JSON.parse(readFileSync(new URL("../../workers/api/wrangler.app-staging.jsonc", import.meta.url), "utf8"));
const current = structuredClone(deployed);
// These old rehearsal guards stay pinned to their original stores. Project the
// historical fixture explicitly; never widen them to the new live data scope.
const historicalDatabases = {
  FANMARK_DB: ["fanmark-business-staging", "d4bb0c48-f24a-491f-8693-fa393ab0b873"],
  AUTH_DB: ["fanmark-auth-staging", "2116bc43-32ab-4e3e-b762-9378df88b95f"],
  MASTER_DB: ["fanmark-emoji-master-staging", "160376b0-bde6-4d5f-8969-96deb5ae1183"],
};
current.d1_databases = current.d1_databases.map(database => ({ ...database,
  database_name: historicalDatabases[database.binding][0], database_id: historicalDatabases[database.binding][1],
}));
delete current.vars.LICENSE_EXPIRY_BACKEND;
delete current.vars.NOTIFICATION_ARCHIVE_BACKEND;
delete current.vars.STRIPE_DISPATCH_BACKEND;
delete current.vars.STRIPE_WEBHOOK_BACKEND;
delete current.vars.AUTH_EMAIL_BACKEND;
// Project only the historical notification rehearsal. The live app's recovery
// coordinator must not be inherited by an independently run alarm rehearsal.
delete current.vars.RECOVERY_DRAIN_BACKEND;
delete current.vars.RECOVERY_DRAIN_SCOPE_DIGEST;
delete current.vars.RECOVERY_WRITE_FREEZE;
current.durable_objects.bindings = [{ name: "NOTIFICATION_WAKE", class_name: "NotificationWakeCoordinator" }];
current.migrations = current.migrations.filter(migration => migration.tag === "notification-wake-v1");
current.triggers.crons = ["0 0 * * *"];
const candidate = {
  ...current,
  vars: { ...current.vars, NOTIFICATION_WAKE_BACKEND: "durable-object" },
  triggers: { crons: ["0 0 * * *"] },
  durable_objects: { bindings: [{ name: "NOTIFICATION_WAKE", class_name: "NotificationWakeCoordinator" }] },
  migrations: [{ tag: "notification-wake-v1", new_sqlite_classes: ["NotificationWakeCoordinator"] }],
};
test("only the complete staged SQLite alarm configuration passes", () => {
  assert.equal(isStagingNotificationWakeTarget(deployed), false);
  assert.equal(isStagingNotificationWakeTarget(current), true);
  assert.equal(isStagingNotificationWakeTarget(candidate), true);
  assert.equal(isStagingNotificationWakeTarget({ ...candidate, durable_objects: undefined }), false);
  assert.equal(isStagingNotificationWakeTarget({ ...candidate, triggers: { crons: ["* * * * *", "0 0 * * *"] } }), false);
  assert.equal(isStagingNotificationWakeTarget({ ...candidate, migrations: [{ tag: "notification-wake-v1", new_classes: ["NotificationWakeCoordinator"] }] }), false);
  assert.equal(isStagingNotificationWakeTarget({ ...candidate, durable_objects: { bindings: [{ ...candidate.durable_objects.bindings[0], script_name: "other-worker" }] } }), false);
});
test("legacy Cron and complete alarm configurations remain distinct; partial activation is refused", () => {
  const legacy = structuredClone(current);
  delete legacy.vars.NOTIFICATION_WAKE_BACKEND;
  delete legacy.durable_objects;
  delete legacy.migrations;
  legacy.triggers.crons = ["* * * * *", "0 0 * * *"];
  assert.equal(stagingNotificationScheduleMode(legacy), "cron");
  assert.equal(stagingNotificationScheduleMode(current), "alarm");
  assert.equal(stagingNotificationScheduleMode({ ...current, durable_objects: undefined }), null);
  assert.equal(stagingNotificationScheduleMode({ ...current, vars: { ...current.vars, NOTIFICATION_WAKE_BACKEND: "typo" } }), null);
  assert.equal(stagingNotificationScheduleMode({ ...legacy, durable_objects: current.durable_objects }), null);
  assert.equal(stagingNotificationScheduleMode(null), null);
});
test("local scheduled rehearsals cannot acknowledge an outbox through a local alarm instance", () => {
  for (const file of ["staging-notification-processor-smoke.mjs", "staging-notification-archive-smoke.mjs", "staging-license-expiry-lottery-smoke.mjs"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /"--var", "NOTIFICATION_WAKE_BACKEND:disabled"/u, file);
  }
  // The disposable recovery Worker uses an explicit config/vars allowlist; it
  // must not inherit the app's coordinator or the app's namespace migrations.
  const recovery = readFileSync(new URL("postwrite-cloudflare-recovery-smoke.mjs", import.meta.url), "utf8");
  const configBuilder = recovery.slice(recovery.indexOf("function createTemporaryConfig()"), recovery.indexOf("function createTemporaryConfig()") + 5000);
  assert.doesNotMatch(configBuilder, /durable_objects|NOTIFICATION_WAKE|new_sqlite_classes|\.\.\.appConfig\.vars/u);
});
test("refuses production routes, other targets, malformed bindings and enabled side effects", () => {
  for (const changed of [{ routes: ["fanmark.id/*"] }, { routes: "fanmark.id/*" }, { account_id: "other" },
    { d1_databases: null }, { workers_dev: false }, { migrations: [...candidate.migrations, { tag: "unexpected" }] },
    { d1_databases: candidate.d1_databases.map(database => ({ ...database, database_id: "other" })) }]) {
    assert.equal(isStagingNotificationWakeTarget({ ...candidate, ...changed }), false);
  }
  for (const key of ["STRIPE_DISPATCH_BACKEND", "STRIPE_WEBHOOK_BACKEND", "LICENSE_EXPIRY_BACKEND", "NOTIFICATION_ARCHIVE_BACKEND",
    "BROADCAST_SEND_BACKEND", "BROADCAST_TEST_SEND_BACKEND", "AUTH_EMAIL_BACKEND"]) {
    assert.equal(isStagingNotificationWakeTarget({ ...candidate, vars: { ...candidate.vars, [key]: "d1" } }), false);
  }
  assert.equal(isStagingNotificationWakeTarget({ ...candidate, vars: { ...candidate.vars, CUTOVER_WRITE_FREEZE: "true" } }), false);
});

test("notification-only rehearsals reject inherited recovery tracking or freeze settings", () => {
  const legacy = structuredClone(candidate);
  delete legacy.vars.NOTIFICATION_WAKE_BACKEND;
  delete legacy.durable_objects;
  delete legacy.migrations;
  legacy.triggers.crons = ["* * * * *", "0 0 * * *"];
  for (const [key, value] of [
    ["RECOVERY_DRAIN_BACKEND", "durable-object"],
    ["RECOVERY_DRAIN_SCOPE_DIGEST", "a".repeat(64)],
    ["RECOVERY_WRITE_FREEZE", "false"],
  ]) {
    const mixed = { ...candidate, vars: { ...candidate.vars, [key]: value } };
    assert.equal(isStagingNotificationWakeTarget(mixed), false);
    assert.equal(stagingNotificationScheduleMode(mixed), null);
    assert.equal(stagingNotificationScheduleMode({ ...legacy, vars: { ...legacy.vars, [key]: value } }), null);
  }
  const extraBinding = { ...candidate, durable_objects: { bindings: [
    ...candidate.durable_objects.bindings,
    { name: "RECOVERY_DRAIN", class_name: "RecoveryWriterCoordinator" },
  ] } };
  assert.equal(isStagingNotificationWakeTarget(extraBinding), false);
});
