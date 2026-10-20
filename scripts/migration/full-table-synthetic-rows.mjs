/** Explicit synthetic source rows; no source database access or runtime side effects. */
import assert from "node:assert/strict";

const id = suffix => `90000000-0000-4000-8000-${suffix.toString(16).padStart(12, "0")}`;
const time = "2026-09-26T12:00:00.123456Z";
const times = { created_at: time, updated_at: time };
const owner = id(13), fanmark = id(1), license = id(2), emoji = id(4);
const json = value => JSON.stringify(value);

export function populateEverySyntheticTable(catalog, rows) {
  // Keys are source column names, not a guessed/default-filled schema. Every
  // column must be explicitly covered and preserve the source catalog shape.
  const values = {
    audit_logs: { id: id(64), user_id: owner, action: "synthetic_import", resource_type: "fanmark", resource_id: fanmark,
      request_id: "synthetic-$&-request", metadata: json({ note: "改行\n🧴", nested: [null, true, "quoted\""] }), created_at: time },
    broadcast_emails: { id: id(65), subject: "合成告知 🧴", body_text: "送信しない\n$&", email_type: "announcement",
      recipient_filter: json({ plan_types: ["free"], synthetic: true }), total_recipients: "0", sent_count: "0", failed_count: "0",
      status: "draft", created_by: owner, scheduled_at: null, started_at: null, completed_at: null, error_details: null, ...times },
    email_templates: { id: id(66), email_type: "synthetic_import", language: "ja", subject: "合成 {{name}}",
      body_text: "本文\n$& 🧴", button_text: "確認", is_active: "f", ...times },
    emoji_master: { id: emoji, emoji: "😀", short_name: "synthetic_grinning", keywords: json(["笑顔", "quote\"", "$&"]),
      category: "Synthetic", subcategory: null, codepoints: json(["1F600"]), sort_order: "0", ...times },
    enterprise_user_settings: { id: id(67), user_id: owner, custom_fanmarks_limit: "17", custom_pricing: "1234",
      notes: "合成・非契約", ...times, created_by: owner },
    extension_coupon_usages: { id: id(68), coupon_id: id(69), user_id: owner, fanmark_id: fanmark, license_id: license, used_at: time },
    extension_coupons: { id: id(69), code: "SYNTHETICIMPORT", months: "3", allowed_tier_levels: json([1, 4]),
      max_uses: "10", used_count: "1", expires_at: null, is_active: "f", created_by: owner, ...times },
    fanmark_access_daily_stats: { id: id(70), fanmark_id: fanmark, license_id: license, stat_date: "2026-09-26",
      access_count: "11", unique_visitors: "7", referrer_direct: "4", referrer_search: "3", referrer_social: "2", referrer_other: "2",
      device_mobile: "6", device_tablet: "1", device_desktop: "4", ...times,
      access_type_profile: "2", access_type_redirect: "3", access_type_text: "4", access_type_inactive: "2" },
    fanmark_access_logs: { id: id(71), fanmark_id: fanmark, license_id: license, accessed_at: time,
      referrer: "https://synthetic.example.invalid/path?q=%24%26", referrer_domain: "synthetic.example.invalid", referrer_category: "other",
      user_agent: "Synthetic/1.0", device_type: "desktop", browser: "Synthetic", os: "Synthetic",
      utm_source: "fixture", utm_medium: null, utm_campaign: "日本語 🧴", visitor_hash: "a".repeat(64), access_type: "text" },
    fanmark_availability_rules: { id: id(72), rule_type: "count_based", priority: "4", rule_config: json({ count: 1 }),
      is_available: "t", price_usd: "12.34", description: "合成ルール", ...times, created_by: owner },
    fanmark_discoveries: { id: id(73), emoji_ids: json([emoji]), normalized_emoji_ids: json([emoji]), fanmark_id: fanmark,
      availability_status: "owned_by_user", first_seen_at: time, last_seen_at: time, search_count: "9007199254740993", favorite_count: "1" },
    fanmark_favorites: { id: id(74), user_id: owner, discovery_id: id(73), fanmark_id: fanmark,
      normalized_emoji_ids: json([emoji]), created_at: time, display_fanmark: "😀" },
    fanmark_lottery_entries: { id: id(75), fanmark_id: fanmark, user_id: owner, license_id: license,
      lottery_probability: "0.12500000000000000001", entry_status: "won", applied_at: time, lottery_executed_at: time,
      won_at: time, cancelled_at: null, cancellation_reason: null, ...times },
    fanmark_lottery_history: { id: id(76), fanmark_id: fanmark, license_id: license, total_entries: "1", winner_user_id: owner,
      winner_entry_id: id(75), probability_distribution: json([{ user_id: owner, probability: "0.12500000000000000001" }]),
      random_seed: "synthetic-only", executed_at: time, execution_method: "manual", created_at: time },
    fanmark_profiles: { id: id(18), license_id: license, display_name: "合成プロフィール", bio: "復旧専用\n$&",
      social_links: json({ website: "https://synthetic.example.invalid/" }), theme_settings: json({ color: "#123456" }), is_public: "f", ...times },
    fanmark_tier_extension_prices: { id: id(77), tier_level: "4", months: "1", price_yen: "123",
      is_active: "f", ...times, stripe_price_id: "price_syntheticImport", stripe_price_id_live: null },
    fanmark_tiers: { id: id(78), tier_level: "4", emoji_count_min: "1", emoji_count_max: "1", monthly_price_usd: "12.34",
      initial_license_days: "7", description: "合成ティア", is_active: "t", ...times, display_name: "S" },
    fanmark_transfer_codes: { id: id(79), license_id: license, fanmark_id: fanmark, issuer_user_id: owner,
      transfer_code: "SYNTHETICIMPORT01", status: "completed", expires_at: time, disclaimer_agreed_at: time, ...times },
    fanmark_transfer_requests: { id: id(80), transfer_code_id: id(79), license_id: license, fanmark_id: fanmark,
      requester_user_id: owner, status: "approved", disclaimer_agreed_at: time, applied_at: time, resolved_at: time,
      rejection_reason: null, ...times, requester_username: "synthetic_import_owner", requester_display_name: "合成申請者" },
    invitation_codes: { id: id(81), code: "SYNTHETIC01", max_uses: "10", used_count: "1", expires_at: null,
      special_perks: json({ note: "合成\n$&", days: 7 }), created_by: owner, is_active: "f", ...times },
    languages: { id: id(82), code: "ja", label: "Japanese", native_label: "日本語", is_active: "t", sort_order: "0", ...times },
    notification_rules: { id: id(83), event_type: "synthetic_migration_probe", channel: "in_app", template_id: id(84),
      template_version: "1", delay_seconds: "0", priority: "5", segment_filter: json({ synthetic: true }),
      cooldown_window_seconds: "60", max_per_user: "1", cancel_condition: null, enabled: "f", valid_from: time, valid_until: null,
      ...times, created_by: owner },
    notification_templates: { id: id(85), template_id: id(84), version: "1", channel: "in_app", language: "ja",
      title: "合成通知", body: "本文\n{{name}} $&", summary: null, payload_schema: json({ type: "object" }), is_active: "f", ...times },
    notifications: { id: id(86), event_id: id(16), rule_id: id(83), user_id: owner, channel: "in_app", template_id: id(84),
      template_version: "1", payload: json({ name: "合成 🧴", values: [null, false, 0] }), status: "delivered", priority: "5",
      triggered_at: time, expires_at: null, delivered_at: time, error_reason: null, retry_count: "0", read_at: time, read_via: "app", ...times },
    notifications_history: { id: id(87), original_data: json({ id: id(86), status: "delivered", note: "合成履歴\n$&" }), archived_at: time },
    reserved_emoji_patterns: { id: id(88), pattern: "🧴🧴", price_yen: "12345", description: "合成予約", is_active: "f", ...times },
    system_settings: { id: id(89), setting_key: "synthetic_import_probe", setting_value: json({ text: "日本語\n$&", enabled: false }),
      description: "テスト用", is_public: "f", ...times },
    user_settings: { id: id(17), user_id: owner, username: "synthetic_import_owner", display_name: "合成利用者", avatar_url: null,
      plan_type: "free", preferred_language: "ja", ...times, invited_by_code: "SYNTHETIC01", requires_password_setup: "f", stripe_customer_id: null },
    user_subscriptions: { id: id(90), user_id: owner, stripe_customer_id: "cus_syntheticImport", stripe_subscription_id: "sub_syntheticImport",
      product_id: "prod_syntheticImport", status: "canceled", current_period_start: time, current_period_end: time,
      cancel_at_period_end: "f", ...times, price_id: "price_syntheticImport", amount: "12345", currency: "jpy", interval: "month",
      interval_count: "1", payment_failure_at: null, next_payment_attempt: null, payment_failure_type: null },
    waitlist: { id: id(91), email: "synthetic-import@example.invalid", referral_source: "合成\n$&", status: "waiting", created_at: time },
  };
  for (const [table, source] of Object.entries(values)) {
    if (rows[table]?.length) continue; // Keep the credential/settings/asset fixture unchanged.
    const columns = catalog.columns.filter(column => column.table_name === table).sort((a, b) => a.ordinal - b.ordinal);
    assert.deepEqual(Object.keys(source).sort(), columns.map(column => column.column_name).sort(), `${table}_explicit_source_shape`);
    const arrayMetadata = Object.fromEntries(columns.filter(column => column.postgres_type.endsWith("[]")).map(column => {
      const entries = JSON.parse(source[column.column_name]);
      return [column.column_name, { isNull: false, ndims: entries.length ? 1 : 0, lowerBound: entries.length ? 1 : null }];
    }));
    rows[table] = [{ schemaVersion: 1, table, columns: columns.map(column => column.column_name), values: source, arrayMetadata }];
  }
  assert.equal(Object.keys(rows).length, 40, "full_fixture_source_table_count");
  assert.equal(Object.values(rows).every(tableRows => tableRows.length > 0), true, "every_source_table_has_a_synthetic_row");
}

export async function verifyFullSyntheticReadback(database, tableNames) {
  // Independent expectations for the risky source codecs; do not obtain
  // expected values from the importer's converter or its saved report.
  assert.deepEqual(await database.prepare(`SELECT CAST(search_count AS TEXT) AS search_count,
    typeof(search_count) AS storage_type, emoji_ids, normalized_emoji_ids FROM fanmark_discoveries WHERE id = ?`)
    .bind(id(73)).first(), { search_count: "9007199254740993", storage_type: "integer",
    emoji_ids: json([emoji]), normalized_emoji_ids: json([emoji]) });
  assert.deepEqual(await database.prepare(`SELECT lottery_probability, typeof(lottery_probability) AS storage_type,
    applied_at FROM fanmark_lottery_entries WHERE id = ?`).bind(id(75)).first(), {
    lottery_probability: "0.12500000000000000001", storage_type: "text", applied_at: time,
  });
  assert.deepEqual(await database.prepare("SELECT price_usd, is_available, created_at FROM fanmark_availability_rules WHERE id = ?")
    .bind(id(72)).first(), { price_usd: 1234, is_available: 1, created_at: time });
  assert.deepEqual(await database.prepare("SELECT monthly_price_usd FROM fanmark_tiers WHERE id = ?")
    .bind(id(78)).first(), { monthly_price_usd: 1234 });
  assert.deepEqual(await database.prepare("SELECT keywords, codepoints FROM emoji_master WHERE id = ?").bind(emoji).first(), {
    keywords: json(["笑顔", "quote\"", "$&"]), codepoints: json(["1F600"]),
  });
  assert.deepEqual(await database.prepare("SELECT allowed_tier_levels, is_active FROM extension_coupons WHERE id = ?")
    .bind(id(69)).first(), { allowed_tier_levels: "[1,4]", is_active: 0 });
  const audit = await database.prepare("SELECT metadata FROM audit_logs WHERE id = ?").bind(id(64)).first();
  assert.deepEqual(JSON.parse(audit.metadata), { note: "改行\n🧴", nested: [null, true, "quoted\""] });
  const notification = await database.prepare("SELECT payload, read_at, read_via FROM notifications WHERE id = ?").bind(id(86)).first();
  assert.deepEqual(JSON.parse(notification.payload), { name: "合成 🧴", values: [null, false, 0] });
  assert.equal(notification.read_at, time);
  assert.equal(notification.read_via, "app");
  assert.deepEqual(await database.prepare(`SELECT COUNT(*) AS nonempty, SUM(rows_imported) AS source_rows
    FROM __fanmark_d1_import_checkpoints WHERE status = 'complete' AND rows_imported > 0`).first(), { nonempty: 40, source_rows: 46 });
  assert.equal(tableNames.length, 40);
  for (const table of tableNames) assert.match(table, /^[a-z_]+$/u);
  // D1 bounds compound SELECT terms; use one ordinary statement per table.
  const results = await database.batch(tableNames.map(table =>
    database.prepare(`SELECT '${table}' AS table_name, COUNT(*) AS row_count FROM "${table}"`)));
  assert.equal(results.every(result => result.success === true && result.results.length === 1), true);
  const counts = results.map(result => result.results[0]);
  assert.deepEqual(counts, tableNames.map(table_name => ({ table_name,
    row_count: table_name === "fanmarks" || table_name === "fanmark_licenses" ? 3 : table_name === "fanmark_password_configs" ? 2 : 1 })));
  return true;
}
