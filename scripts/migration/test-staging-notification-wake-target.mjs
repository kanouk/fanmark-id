import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isStagingNotificationWakeTarget } from "./staging-notification-wake-target.mjs";
const current = JSON.parse(readFileSync(new URL("../../workers/api/wrangler.app-staging.jsonc", import.meta.url), "utf8"));
const candidate = {
  ...current,
  vars: { ...current.vars, NOTIFICATION_WAKE_BACKEND: "durable-object" },
  triggers: { crons: ["0 0 * * *"] },
  durable_objects: { bindings: [{ name: "NOTIFICATION_WAKE", class_name: "NotificationWakeCoordinator" }] },
  migrations: [{ tag: "notification-wake-v1", new_sqlite_classes: ["NotificationWakeCoordinator"] }],
};
test("only the complete staged SQLite alarm configuration passes", () => {
  assert.equal(isStagingNotificationWakeTarget(candidate), true);
  assert.equal(isStagingNotificationWakeTarget({ ...candidate, durable_objects: undefined }), false);
  assert.equal(isStagingNotificationWakeTarget({ ...candidate, triggers: { crons: ["* * * * *", "0 0 * * *"] } }), false);
  assert.equal(isStagingNotificationWakeTarget({ ...candidate, migrations: [{ tag: "notification-wake-v1", new_classes: ["NotificationWakeCoordinator"] }] }), false);
  assert.equal(isStagingNotificationWakeTarget({ ...candidate, durable_objects: { bindings: [{ ...candidate.durable_objects.bindings[0], script_name: "other-worker" }] } }), false);
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
