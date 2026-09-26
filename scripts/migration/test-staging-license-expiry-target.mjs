import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isStagingExpiryCronBaseline } from "./staging-expiry-cron-config.mjs";
import { stagingBusinessBaselineRowCount } from "./staging-notification-master-baseline.mjs";

const config = JSON.parse(await readFile(new URL("../../workers/api/wrangler.app-staging.jsonc", import.meta.url), "utf8"));

test("accepts the checked-in staging notification and daily-expiry Cron baseline", () => {
  assert.equal(isStagingExpiryCronBaseline(config), true);
});

test("rejects missing, duplicate, or unexpected Cron triggers", () => {
  assert.equal(isStagingExpiryCronBaseline({ ...config, triggers: { crons: [] } }), false);
  assert.equal(isStagingExpiryCronBaseline({ ...config, triggers: { crons: ["* * * * *", "* * * * *"] } }), false);
  assert.equal(isStagingExpiryCronBaseline({ ...config, triggers: { crons: ["* * * * *", "*/5 * * * *"] } }), false);
});

test("requires lifecycle execution selector and run bindings to remain disabled", () => {
  for (const name of [
    "LICENSE_EXPIRY_BACKEND",
    "LICENSE_EXPIRY_TARGET_INCARNATION",
    "LICENSE_EXPIRY_SCHEMA_EXTENSION_DIGEST",
  ]) {
    assert.equal(isStagingExpiryCronBaseline({
      ...config,
      vars: { ...config.vars, [name]: "enabled" },
    }), false, name);
  }
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
    system_settings: 0,
    availability_rules: 0,
  }, {
    notification_rules: 0,
    notification_templates: 0,
  }), 0);
});
