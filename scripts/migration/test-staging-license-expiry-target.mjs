import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isStagingExpiryCronBaseline } from "./staging-expiry-cron-config.mjs";
import { stagingBusinessBaselineRowCount } from "./staging-notification-master-baseline.mjs";

const deployed = JSON.parse(await readFile(new URL("../../workers/api/wrangler.app-staging.jsonc", import.meta.url), "utf8"));
// Rehearsals require an explicitly inert fixture; active staging remains refused.
const config = structuredClone(deployed);
delete config.vars.LICENSE_EXPIRY_BACKEND;
delete config.vars.NOTIFICATION_ARCHIVE_BACKEND;
delete config.vars.STRIPE_DISPATCH_BACKEND;
delete config.vars.STRIPE_WEBHOOK_BACKEND;
delete config.vars.AUTH_EMAIL_BACKEND;
delete config.vars.RECOVERY_DRAIN_BACKEND;
delete config.vars.RECOVERY_DRAIN_SCOPE_DIGEST;
delete config.vars.RECOVERY_WRITE_FREEZE;
config.durable_objects.bindings = config.durable_objects.bindings.filter(binding => binding.name === "NOTIFICATION_WAKE");
config.migrations = config.migrations.filter(migration => migration.tag === "notification-wake-v1");
config.triggers.crons = ["0 0 * * *"];

test("accepts the checked-in staging notification and daily-expiry Cron baseline", () => {
  assert.equal(isStagingExpiryCronBaseline(deployed), false);
  assert.equal(isStagingExpiryCronBaseline(config), true);
});

test("rejects missing, duplicate, or unexpected Cron triggers", () => {
  assert.equal(isStagingExpiryCronBaseline({ ...config, triggers: { crons: [] } }), false);
  assert.equal(isStagingExpiryCronBaseline({ ...config, triggers: { crons: ["* * * * *", "* * * * *"] } }), false);
  assert.equal(isStagingExpiryCronBaseline({ ...config, triggers: { crons: ["* * * * *", "*/5 * * * *"] } }), false);
});

test("keeps the scheduled selector disabled while allowing the independent MFA-protected manual route", () => {
  assert.equal(config.vars.LIFECYCLE_RUN_BACKEND, "d1");
  assert.equal(typeof config.vars.LICENSE_EXPIRY_TARGET_INCARNATION, "string");
  assert.match(config.vars.LICENSE_EXPIRY_SCHEMA_EXTENSION_DIGEST, /^[0-9a-f]{64}$/u);
  assert.equal(config.vars.LICENSE_EXPIRY_BACKEND, undefined);
  assert.equal(isStagingExpiryCronBaseline(config), true);
  assert.equal(isStagingExpiryCronBaseline({
    ...config,
    vars: { ...config.vars, LICENSE_EXPIRY_BACKEND: "d1" },
  }), false);
});

test("rejects a changed lifecycle schedule even when its handler remains disabled", () => {
  assert.equal(isStagingExpiryCronBaseline({
    ...config,
    vars: { ...config.vars, LICENSE_EXPIRY_CRON: "* * * * *" },
  }), false);
});

test("counts every explicitly seeded non-user staging baseline row", () => {
  assert.equal(stagingBusinessBaselineRowCount({
    system_settings: 2,
    availability_rules: 4,
  }, {
    notification_rules: 10,
    notification_templates: 40,
  }), 56);
  assert.equal(stagingBusinessBaselineRowCount({
    system_settings: 20,
    availability_rules: 4,
  }, {
    notification_rules: 10,
    notification_templates: 40,
  }), 74);
  assert.equal(stagingBusinessBaselineRowCount({
    system_settings: 0,
    availability_rules: 0,
  }, {
    notification_rules: 0,
    notification_templates: 0,
  }), 0);
});
