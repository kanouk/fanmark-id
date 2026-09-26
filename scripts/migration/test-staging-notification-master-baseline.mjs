import assert from "node:assert/strict";
import test from "node:test";

import { authEmailTemplateBaselineState } from "./staging-auth-email-template-baseline.mjs";
import {
  LEGACY_STAGING_SYSTEM_SETTINGS_MANIFEST,
  STAGING_SYSTEM_SETTINGS_MANIFEST,
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
  const empty = { system_settings: 0, system_settings_key_manifest: null, grace_period_days: 0, max_emoji_characters: 0,
    availability_rules: 0, expected_availability_rules: 0 };
  const seeded = { system_settings: 2, system_settings_key_manifest: LEGACY_STAGING_SYSTEM_SETTINGS_MANIFEST,
    grace_period_days: 1, max_emoji_characters: 1,
    availability_rules: 4, expected_availability_rules: 4 };
  const seededWithPlanSettings = { ...seeded, system_settings: 20,
    system_settings_key_manifest: STAGING_SYSTEM_SETTINGS_MANIFEST };
  assert.equal(stagingNonUserConfigBaselineState(empty), "empty");
  assert.equal(stagingNonUserConfigBaselineState(seeded), "seeded");
  assert.equal(stagingNonUserConfigBaselineState(seededWithPlanSettings), "seeded");
  assert.equal(hasStagingNonUserConfigBaseline(seeded), true);
  assert.equal(hasStagingNonUserConfigBaseline(seededWithPlanSettings), true);
  assert.equal(stagingNonUserConfigBaselineState({ ...seededWithPlanSettings,
    system_settings_key_manifest: STAGING_SYSTEM_SETTINGS_MANIFEST.replace("enterprise_pricing:0", "enterprise_pricing:1") }), "invalid");
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
  assert.deepEqual(
    businessTablesWithoutStagingBaselines(["email_templates", "fanmarks"], { authEmailTemplates: true }),
    ["fanmarks"],
  );
  assert.deepEqual(
    businessTablesWithoutStagingBaselines(["email_templates", "fanmarks"]),
    ["email_templates", "fanmarks"],
  );
});

test("auth email templates count as a baseline only with the exact reviewed content digest", () => {
  assert.equal(authEmailTemplateBaselineState([], 0), "empty");
  assert.equal(authEmailTemplateBaselineState([], 16), "invalid");
  const rows = ["signup", "recovery", "magiclink", "email_change"].flatMap((emailType, typeIndex) =>
    ["en", "id", "ja", "ko"].map((language, languageIndex) => ({
      id: `00000000-0000-4000-8000-${String(typeIndex * 4 + languageIndex + 1).padStart(12, "0")}`,
      email_type: emailType,
      language,
      subject: "Synthetic subject",
      body_text: "Synthetic body",
      button_text: "Continue",
      is_active: 1,
      created_at: "2026-01-02T12:32:58.206Z",
      updated_at: "2026-01-02T21:56:21.064Z",
    })),
  );
  assert.equal(authEmailTemplateBaselineState(rows, 16), "invalid");
  assert.equal(authEmailTemplateBaselineState(rows, 17), "invalid");
});
