import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isStagingNotificationArchiveTarget } from "./staging-notification-archive-target.mjs";

const deployed = JSON.parse(await readFile(new URL("../../workers/api/wrangler.app-staging.jsonc", import.meta.url), "utf8"));
// Rehearsals require an explicitly inert fixture; active staging remains refused.
const config = structuredClone(deployed);
// These old rehearsal guards stay pinned to their original stores. Project the
// historical fixture explicitly; never widen them to the new live data scope.
const historicalDatabases = {
  FANMARK_DB: ["fanmark-business-staging", "d4bb0c48-f24a-491f-8693-fa393ab0b873"],
  AUTH_DB: ["fanmark-auth-staging", "2116bc43-32ab-4e3e-b762-9378df88b95f"],
  MASTER_DB: ["fanmark-emoji-master-staging", "160376b0-bde6-4d5f-8969-96deb5ae1183"],
};
config.d1_databases = config.d1_databases.map(database => ({ ...database,
  database_name: historicalDatabases[database.binding][0], database_id: historicalDatabases[database.binding][1],
}));
delete config.vars.LICENSE_EXPIRY_BACKEND;
delete config.vars.NOTIFICATION_ARCHIVE_BACKEND;
delete config.vars.STRIPE_DISPATCH_BACKEND;
delete config.vars.STRIPE_WEBHOOK_BACKEND;
delete config.vars.AUTH_EMAIL_BACKEND;
delete config.vars.RECOVERY_DRAIN_BACKEND;
delete config.vars.RECOVERY_DRAIN_SCOPE_DIGEST;
delete config.vars.RECOVERY_WRITE_FREEZE;
config.durable_objects.bindings = [{ name: "NOTIFICATION_WAKE", class_name: "NotificationWakeCoordinator" }];
config.migrations = config.migrations.filter(migration => migration.tag === "notification-wake-v1");
config.triggers.crons = ["0 0 * * *"];
const identity = {
  loggedIn: true,
  email: "fanmark.id@gmail.com",
  accounts: [{ id: "bfc2890741f0b3fb236e2d755b6c9adc" }],
};

test("accepts only the intended workers.dev staging Worker and split D1 bindings", () => {
  assert.equal(isStagingNotificationArchiveTarget(deployed, identity), false);
  assert.equal(isStagingNotificationArchiveTarget(config, identity), true);
});

test("rejects a live route, altered schedule, or deployed archive selector", () => {
  assert.equal(isStagingNotificationArchiveTarget({ ...config, routes: ["fanmark.id/*"] }, identity), false);
  assert.equal(isStagingNotificationArchiveTarget({
    ...config,
    triggers: { crons: ["* * * * *", "0 1 * * *"] },
  }, identity), false);
  assert.equal(isStagingNotificationArchiveTarget({
    ...config,
    vars: { ...config.vars, NOTIFICATION_ARCHIVE_BACKEND: "d1" },
  }, identity), false);
});

test("rejects changed D1 bindings and an unexpected Cloudflare identity", () => {
  const [business, ...others] = config.d1_databases;
  assert.equal(isStagingNotificationArchiveTarget({
    ...config,
    d1_databases: [{ ...business, database_id: "00000000-0000-0000-0000-000000000000" }, ...others],
  }, identity), false);
  assert.equal(isStagingNotificationArchiveTarget(config, { ...identity, loggedIn: false }), false);
  assert.equal(isStagingNotificationArchiveTarget(config, { ...identity, email: "other@example.com" }), false);
  assert.equal(isStagingNotificationArchiveTarget(config, { ...identity, accounts: [] }), false);
});

test("rejects malformed binding and Cron configuration", () => {
  assert.equal(isStagingNotificationArchiveTarget({
    ...config,
    d1_databases: null,
  }, identity), false);
  assert.equal(isStagingNotificationArchiveTarget({
    ...config,
    triggers: { crons: "* * * * *" },
  }, identity), false);
});
