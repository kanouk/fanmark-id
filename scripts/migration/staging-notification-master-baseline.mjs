export const NOTIFICATION_MASTER_COUNTS_SQL = `SELECT
  (SELECT COUNT(*) FROM "notification_rules") AS notification_rules,
  (SELECT COUNT(*) FROM "notification_templates") AS notification_templates`;
export const STAGING_NON_USER_CONFIG_BASELINE_SQL = `SELECT
  (SELECT COUNT(*) FROM "system_settings") AS system_settings,
  (SELECT group_concat(setting_key || ':' || is_public, ',') FROM
    (SELECT setting_key, is_public FROM "system_settings" ORDER BY setting_key)) AS system_settings_key_manifest,
  (SELECT COUNT(*) FROM "system_settings"
    WHERE "setting_key" = 'grace_period_days' AND "setting_value" = '1' AND "is_public" = 1) AS grace_period_days,
  (SELECT COUNT(*) FROM "system_settings"
    WHERE "setting_key" = 'max_emoji_characters' AND "setting_value" = '5' AND "is_public" = 1) AS max_emoji_characters,
  (SELECT COUNT(*) FROM "fanmark_availability_rules") AS availability_rules,
  (SELECT COUNT(*) FROM "fanmark_availability_rules" WHERE "created_by" IS NULL AND (
    ("rule_type" = 'specific_pattern' AND "priority" = 1) OR
    ("rule_type" = 'duplicate_pattern' AND "priority" = 2) OR
    ("rule_type" = 'prefix_pattern' AND "priority" = 3) OR
    ("rule_type" = 'count_based' AND "priority" = 4)
  )) AS expected_availability_rules`;

const STAGING_BASELINE_TABLES = new Set([
  "notification_rules",
  "notification_templates",
  "system_settings",
  "fanmark_availability_rules",
]);

export const LEGACY_STAGING_SYSTEM_SETTINGS_MANIFEST = "grace_period_days:1,max_emoji_characters:1";
export const STAGING_SYSTEM_SETTINGS_MANIFEST = [
  "business_fanmarks_limit:1",
  "business_pricing:1",
  "business_stripe_price_id:1",
  "business_stripe_price_id_live:1",
  "creator_fanmarks_limit:1",
  "creator_stripe_price_id:1",
  "creator_stripe_price_id_live:1",
  "enterprise_fanmarks_limit:0",
  "enterprise_pricing:0",
  "free_fanmarks_limit:1",
  "grace_period_days:1",
  "invitation_mode:1",
  "max_emoji_characters:1",
  "max_fanmarks_limit:1",
  "max_pricing:1",
  "max_stripe_price_id:1",
  "max_stripe_price_id_live:1",
  "premium_pricing:1",
  "social_login_enabled:1",
  "stripe_mode:1",
].join(",");

export function businessTablesWithoutStagingBaselines(tables, { authEmailTemplates = false } = {}) {
  return tables.filter((table) => !STAGING_BASELINE_TABLES.has(table) &&
    !(authEmailTemplates && table === "email_templates"));
}

export function notificationMasterBaselineState(row) {
  const rules = Number(row?.notification_rules);
  const templates = Number(row?.notification_templates);
  if (rules === 0 && templates === 0) return "empty";
  if (rules === 10 && templates === 40) return "seeded";
  return "invalid";
}

export function hasStagingNotificationMasterBaseline(row) {
  return notificationMasterBaselineState(row) === "seeded";
}

export function hasStagingNonUserConfigBaseline(row) {
  return stagingNonUserConfigBaselineState(row) === "seeded";
}

export function stagingNonUserConfigBaselineState(row) {
  const settings = Number(row?.system_settings);
  const settingManifest = row?.system_settings_key_manifest;
  const grace = Number(row?.grace_period_days);
  const maxEmoji = Number(row?.max_emoji_characters);
  const rules = Number(row?.availability_rules);
  const expectedRules = Number(row?.expected_availability_rules);
  if (settings === 0 && settingManifest == null && grace === 0 && maxEmoji === 0 && rules === 0 && expectedRules === 0) return "empty";
  const stableMasters = rules === 4 && expectedRules === 4 && grace === 1 && maxEmoji === 1;
  const legacySettings = settings === 2 && settingManifest === LEGACY_STAGING_SYSTEM_SETTINGS_MANIFEST;
  const planSettings = settings === 20 && settingManifest === STAGING_SYSTEM_SETTINGS_MANIFEST;
  if (stableMasters && (legacySettings || planSettings)) return "seeded";
  return "invalid";
}

export function stagingBusinessBaselineRowCount(settings, masters) {
  return Number(settings?.system_settings) + Number(settings?.availability_rules) +
    Number(masters?.notification_rules) + Number(masters?.notification_templates);
}
