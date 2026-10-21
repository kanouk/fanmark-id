import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { BUSINESS_MIGRATION_SEQUENCE } from '../migration/business-migration-ledger.mjs';
import { businessMigrationStatements } from '../migration/business-runtime-import-schema.mjs';
import { stageReferenceMasterRelease, activateReferenceMasterRelease } from '../migration/reference-master-release.mjs';
import { emojiCatalogEntries } from '../../src/data/emojiCatalog.ts';

const require = createRequire(new URL('../../workers/api/package.json', import.meta.url));
const { hashSync } = require('bcryptjs');
export const LOCAL_PASSWORD = 'Local-development-only!2026';
const AUTH_SQL = ['0003_better_auth_core.sql', '0007_auth_signup_command.sql', '0008_auth_user_suspension.sql', '0009_auth_oauth_signup.sql'];
const MASTER_SQL = ['0000_emoji_master.sql', '0001_emoji_master_release_staging.sql', '0002_emoji_master_release_activation.sql',
  '0004_reference_master_releases.sql', '0005_emoji_master_admin_guards.sql', '0006_reference_master_extension_prices.sql',
  '0007_release_audit_timestamps.sql', '0008_emoji_master_change_audits.sql'];

async function apply(database, directory, files) {
  for (const name of files) {
    const sql = await readFile(new URL('../../workers/api/' + directory + '/' + name, import.meta.url), 'utf8');
    const results = await database.batch(businessMigrationStatements(sql).map(statement => database.prepare(statement)));
    if (results.some(result => !result.success)) throw new Error('local_schema_failed:' + name);
  }
}

export async function seedLocalStack(runtime) {
  const auth = await runtime.getD1Database('AUTH_DB');
  const business = await runtime.getD1Database('FANMARK_DB');
  const master = await runtime.getD1Database('MASTER_DB');
  await apply(business, 'migrations-business', BUSINESS_MIGRATION_SEQUENCE);
  await apply(auth, 'migrations', AUTH_SQL);
  await apply(master, 'migrations', MASTER_SQL);
  console.log('[local] Local Auth/Business/Master schemas ready');
  const now = new Date().toISOString().replace(/\.(\d{3})Z$/u, (_, fraction) => '.' + fraction + '000Z');
  const users = ['owner', 'other', 'admin'].map(name => ({
    id: randomUUID(), name: 'Local ' + name, email: name + '@example.invalid',
    password: LOCAL_PASSWORD, admin: name === 'admin',
    fanmarkId: randomUUID(), licenseId: randomUUID(), shortId: 'local-' + name,
  }));
  for (const user of users) {
    await auth.batch([
      auth.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)')
        .bind(user.id, user.name, user.email, now, now),
      auth.prepare("INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,'credential',?,?,?,?)")
        .bind(randomUUID(), user.id, user.id, hashSync(LOCAL_PASSWORD, 10), now, now),
    ]);
    if (user.admin) await auth.prepare("INSERT INTO adminRole(userId,role) VALUES(?,'admin')").bind(user.id).run();
    await business.prepare("INSERT INTO user_settings(id,user_id,username,display_name,plan_type,preferred_language,requires_password_setup,created_at,updated_at) VALUES(?,?,?,?,?,'ja',0,?,?)")
      .bind(randomUUID(), user.id, 'local-' + (user.admin ? 'administrator' : user.email.split('@')[0]), user.name,
        user.admin ? 'admin' : 'free', now, now).run();
  }
  const settings = {
    maintenance_mode: 'false', invitation_mode: 'false', social_login_enabled: 'false',
    free_fanmarks_limit: '3', creator_fanmarks_limit: '10', max_fanmarks_limit: '10',
    business_fanmarks_limit: '50', enterprise_fanmarks_limit: '100',
    premium_pricing: '500', max_pricing: '500', business_pricing: '2000', enterprise_pricing: '10000',
    stripe_mode: 'test', max_emoji_characters: '5', grace_period_days: '1',
    creator_stripe_price_id: 'price_localCreator', max_stripe_price_id: 'price_localCreator', business_stripe_price_id: 'price_localBusiness',
    creator_stripe_price_id_live: 'price_localDisabled', max_stripe_price_id_live: 'price_localDisabled', business_stripe_price_id_live: 'price_localDisabled',
  };
  await business.batch(Object.entries(settings).map(([key, value]) =>
    business.prepare('INSERT INTO system_settings(id,setting_key,setting_value,is_public,created_at,updated_at) VALUES(?,?,?,1,?,?)')
      .bind(randomUUID(), key, value, now, now)));

  const catalogVersion = createHash('sha256').update(JSON.stringify(emojiCatalogEntries)).digest('hex');
  await master.prepare("INSERT INTO fanmark_emoji_master_release_imports(release_version,manifest_json,row_count,status) VALUES(?,'{}',?,'loading')")
    .bind(catalogVersion, emojiCatalogEntries.length).run();
  for (let index = 0; index < emojiCatalogEntries.length; index += 50) {
    await master.batch(emojiCatalogEntries.slice(index, index + 50).map((item, offset) =>
      master.prepare('INSERT INTO fanmark_emoji_master_release_staging(release_version,ordinal,id,emoji,short_name,keywords_json,category,subcategory,codepoints_json,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .bind(catalogVersion, index + offset + 1, item.id, item.emoji, item.shortName, JSON.stringify(item.keywords),
          item.category, item.subcategory, JSON.stringify(item.codepoints), index + offset + 1)));
  }
  await master.prepare("UPDATE fanmark_emoji_master_release_imports SET status='ready' WHERE release_version=?").bind(catalogVersion).run();
  console.log('[local] Public emoji catalog ready (' + emojiCatalogEntries.length + ' records)');
  await master.prepare("INSERT INTO fanmark_emoji_master_active_release(singleton_id,release_version,activation_id,action,generation) VALUES(1,?,?,'promotion',1)")
    .bind(catalogVersion, randomUUID()).run();

  const entries = {
    fanmark_tiers: [[1, 'C', 4, 5, null], [2, 'B', 3, 3, 30], [3, 'A', 2, 5, 14], [4, 'S', 1, 1, 7]]
      .map(([tier_level, display_name, emoji_count_min, emoji_count_max, initial_license_days]) => ({
        id: randomUUID(), tier_level, display_name, emoji_count_min, emoji_count_max, initial_license_days,
        is_active: true, description: 'Local development', monthly_price_usd: '0.00', created_at: now, updated_at: now,
      })),
    languages: [['ja', 'Japanese', '日本語'], ['en', 'English', 'English'], ['ko', 'Korean', '한국어'], ['id', 'Indonesian', 'Bahasa Indonesia']]
      .map(([code, label, native_label], sort_order) => ({
        id: randomUUID(), code, label, native_label, sort_order, is_active: true, created_at: now, updated_at: now,
      })),
    reserved_emoji_patterns: [],
    fanmark_tier_extension_prices: [1, 2, 3, 4].map(tier_level => ({
      id: randomUUID(), tier_level, months: 1, price_yen: 100, stripe_price_id: 'price_localDisabled',
      stripe_price_id_live: null, is_active: true, created_at: now, updated_at: now,
    })),
  };
  const snapshot = Object.entries(entries).map(([table_name, records]) => ({
    table_name, records, row_count: records.length, source_sha256: createHash('sha256').update(JSON.stringify(records)).digest('hex'),
  }));
  const snapshotSha256 = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  const staged = await stageReferenceMasterRelease({ database: master, snapshot, snapshotSha256 });
  await activateReferenceMasterRelease({ database: master, releaseVersion: staged.releaseVersion });
  console.log('[local] Reference masters and synthetic accounts ready');
  // Give each owner a distinct perpetual, non-contiguous four-emoji fanmark.
  const combinations = [['🌸', '🚀', '💡', '🌙'], ['🌹', '🐱', '🎸', '🍋'], ['🧪', '🦊', '🎨', '🍀']];
  for (const [index, user] of users.entries()) {
    const items = combinations[index].map(emoji => emojiCatalogEntries.find(item => item.emoji === emoji));
    if (items.some(item => !item)) throw new Error('local_catalog_fixture_missing');
    user.emojiIds = items.map(item => item.id);
    user.displayFanmark = items.map(item => item.emoji).join('');
    const ids = JSON.stringify(user.emojiIds);
    await business.batch([
      business.prepare("INSERT INTO fanmarks(id,short_id,user_input_fanmark,normalized_emoji,emoji_ids,normalized_emoji_ids,status,tier_level,created_at,updated_at) VALUES(?,?,?,?,?,?,'active',1,?,?)")
        .bind(user.fanmarkId, user.shortId, user.displayFanmark, user.displayFanmark, ids, ids, now, now),
      business.prepare("INSERT INTO fanmark_licenses(id,fanmark_id,user_id,status,license_start,license_end,display_fanmark,created_at,updated_at) VALUES(?,?,?,'active',?,NULL,?,?,?)")
        .bind(user.licenseId, user.fanmarkId, user.id, now, user.displayFanmark, now, now),
      business.prepare("INSERT INTO fanmark_basic_configs(id,license_id,fanmark_name,access_type,created_at,updated_at) VALUES(?,?,?,'profile',?,?)")
        .bind(randomUUID(), user.licenseId, user.name, now, now),
      business.prepare("INSERT INTO fanmark_profiles(id,license_id,display_name,bio,social_links,theme_settings,is_public,created_at,updated_at) VALUES(?,?,?,?,'{}','{}',1,?,?)")
        .bind(randomUUID(), user.licenseId, user.name, 'Synthetic local profile', now, now),
    ]);
  }
  return { users, catalogCount: emojiCatalogEntries.length, businessMigrations: BUSINESS_MIGRATION_SEQUENCE.length, catalogVersion };
}
