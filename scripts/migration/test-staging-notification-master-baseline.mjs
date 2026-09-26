import assert from "node:assert/strict";
import test from "node:test";

import {
  businessTablesWithoutStagingBaselines,
  hasStagingNotificationMasterBaseline,
  hasStagingNonUserConfigBaseline,
  notificationMasterBaselineState,
  stagingNonUserConfigBaselineState,
} from "./staging-notification-master-baseline.mjs";

test("staging notification seed baseline accepts only the reviewed counts", () => {
  assert.equal(notificationMasterBaselineState({ notification_rules: 0, notification_templates: 0 }), "empty");
  assert.equal(notificationMasterBaselineState({ notification_rules: 10, notification_templates: 40 }), "seeded");
  assert.equal(notificationMasterBaselineState({ notification_rules: 10, notification_templates: 39 }), "invalid");
  assert.equal(notificationMasterBaselineState({ notification_rules: 11, notification_templates: 40 }), "invalid");
  assert.equal(hasStagingNotificationMasterBaseline({ notification_rules: 10, notification_templates: 40 }), true);
  assert.equal(hasStagingNotificationMasterBaseline({ notification_rules: 0, notification_templates: 0 }), false);
  const empty = { system_settings: 0, grace_period_days: 0, max_emoji_characters: 0,
    availability_rules: 0, expected_availability_rules: 0 };
  const seeded = { system_settings: 2, grace_period_days: 1, max_emoji_characters: 1,
    availability_rules: 4, expected_availability_rules: 4 };
  assert.equal(stagingNonUserConfigBaselineState(empty), "empty");
  assert.equal(stagingNonUserConfigBaselineState(seeded), "seeded");
  assert.equal(hasStagingNonUserConfigBaseline(seeded), true);
  assert.equal(stagingNonUserConfigBaselineState({ ...seeded, expected_availability_rules: 3 }), "invalid");
  assert.equal(stagingNonUserConfigBaselineState({ ...seeded, max_emoji_characters: 0 }), "invalid");
});

test("business row-empty checks exclude only reviewed staging baseline tables", () => {
  assert.deepEqual(
    businessTablesWithoutStagingBaselines([
      "fanmarks", "notification_rules", "notification_templates", "system_settings",
      "fanmark_availability_rules", "notifications",
    ]),
    ["fanmarks", "notifications"],
  );
});
