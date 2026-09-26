#!/usr/bin/env node

import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const modulePath = path.join(repoRoot, "workers/api/src/extension-coupon-application-d1-api.ts");
const migrationPaths = [
  "workers/api/migrations-business/0000_business_schema_v4_staging.sql",
  "workers/api/migrations-business/0015_extension_coupon_application.sql",
];
const { handleExtensionCouponApplicationD1Request } = await import(pathToFileURL(modulePath).href);

const NOW = new Date("2026-09-26T12:00:00.000Z");
const NOW_SQL = NOW.toISOString();
const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER_OWNER = "00000000-0000-4000-8000-000000000009";
const LICENSE = "00000000-0000-4000-8000-000000000002";
const FANMARK = "00000000-0000-4000-8000-000000000003";
const REQUEST = "00000000-0000-4000-8000-000000000004";
const COUPON = "00000000-0000-4000-8000-000000000005";
const API_URL = "https://app.example.test/api/me/licenses/extend-with-coupon";
const ORIGIN = "https://app.example.test";

function splitSql(sql) {
  const source = sql.replace(/^--.*(?:\r?\n|$)/gmu, "");
  const statements = [];
  let start = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (character === "'" && !doubleQuoted) {
      if (singleQuoted && next === "'") index += 1;
      else singleQuoted = !singleQuoted;
      continue;
    }
    if (character === '"' && !singleQuoted) {
      if (doubleQuoted && next === '"') index += 1;
      else doubleQuoted = !doubleQuoted;
      continue;
    }
    if (character !== ";" || singleQuoted || doubleQuoted) continue;
    const candidate = source.slice(start, index).trim();
    const isTrigger = /^create\s+trigger\b/iu.test(candidate);
    if (isTrigger) {
      const cases = candidate.match(/\bCASE\b/giu)?.length ?? 0;
      const ends = candidate.match(/\bEND\b/giu)?.length ?? 0;
      if (ends < cases + 1) continue;
    }
    if (candidate) statements.push(candidate);
    start = index + 1;
  }
  const remainder = source.slice(start).trim();
  if (remainder) statements.push(remainder);
  return statements;
}

async function createFixture() {
  const { Miniflare } = await import(pathToFileURL(miniflarePath).href);
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: "fanmark-extension-coupon-application-d1-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: { BUSINESS_DB: { type: "d1", name: "fanmark-extension-coupon-business-test" } },
        manifest: {
          mainModule: "index.js",
          modules: { "index.js": { type: "esm", contents: "export default { fetch() { return new Response('ok'); } };" } },
        },
      },
    }],
  });
  const database = await miniflare.getD1Database("BUSINESS_DB");
  try {
    for (const migration of migrationPaths) {
      const sql = await fs.readFile(path.join(repoRoot, migration), "utf8");
      for (const statement of splitSql(sql)) {
        const result = await database.prepare(statement).run();
        assert.equal(result.success, true, `${migration}: ${statement.slice(0, 120)}`);
      }
    }
    return { miniflare, database };
  } catch (error) {
    await miniflare.dispose();
    throw error;
  }
}

let database;
let env;

function isolated(name, run) {
  test(name, async () => {
    const fixture = await createFixture();
    database = fixture.database;
    env = {
      FANMARK_DB: database,
      D1_TOPOLOGY: "legacy",
      EXTENSION_COUPON_BACKEND: "d1",
      CORS_ALLOWED_ORIGINS: ORIGIN,
    };
    try {
      await run();
    } finally {
      await fixture.miniflare.dispose();
    }
  });
}

async function reset() {
  await database.batch([
    database.prepare("DELETE FROM notification_events"),
    database.prepare("DELETE FROM audit_logs"),
    database.prepare("DELETE FROM fanmark_lottery_entries"),
    database.prepare("DELETE FROM extension_coupon_usages"),
    database.prepare("DELETE FROM extension_coupon_application_commands"),
    database.prepare("DELETE FROM fanmark_transfer_requests"),
    database.prepare("DELETE FROM fanmark_transfer_codes"),
    database.prepare("DELETE FROM fanmark_licenses"),
    database.prepare("DELETE FROM fanmarks"),
    database.prepare("DELETE FROM extension_coupons"),
    database.prepare("DELETE FROM user_settings"),
    database.prepare("DELETE FROM system_settings"),
  ]);
}

async function seedCoupon({ code = "TWOMONTHS", id = COUPON, months = 2, maxUses = 10, allowedTiers = null,
  expiresAt = null, usedCount = 0, active = 1 } = {}) {
  await database.prepare(`
    INSERT INTO extension_coupons
      (id, code, months, allowed_tier_levels, max_uses, used_count, expires_at, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, code, months, allowedTiers, maxUses, usedCount, expiresAt, active, NOW_SQL, NOW_SQL).run();
}

async function seedLicense({ userId = OWNER, licenseId = LICENSE, fanmarkId = FANMARK, status = "active",
  licenseEnd = "2026-09-30T12:00:00.000Z", tierLevel = 2, displayFanmark = "🧪", userSettings = false } = {}) {
  const suffix = fanmarkId.slice(-1);
  await database.prepare(`
    INSERT INTO fanmarks
      (id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at,
       normalized_emoji_ids, tier_level)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)
  `).bind(fanmarkId, displayFanmark, displayFanmark, `test-${suffix}01`, NOW_SQL, NOW_SQL, JSON.stringify([`fx-${suffix}`]), tierLevel).run();
  await database.prepare(`
    INSERT INTO fanmark_licenses
      (id, fanmark_id, user_id, license_start, license_end, status, created_at, updated_at, display_fanmark)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(licenseId, fanmarkId, userId, NOW_SQL, licenseEnd, status, NOW_SQL, NOW_SQL, displayFanmark).run();
  if (userSettings) {
    await database.prepare(`
      INSERT INTO user_settings (user_id, username, plan_type, created_at, updated_at)
      VALUES (?, ?, 'free', ?, ?)
    `).bind(userId, `user-${suffix}`, NOW_SQL, NOW_SQL).run();
  }
}

async function seedPendingEntry({ id = "00000000-0000-4000-8000-000000000006", userId = OTHER_OWNER,
  licenseId = LICENSE, fanmarkId = FANMARK } = {}) {
  await database.prepare(`
    INSERT INTO fanmark_lottery_entries
      (id, fanmark_id, user_id, license_id, lottery_probability, entry_status, applied_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, '1.0', 'pending', ?, ?, ?)
  `).bind(id, fanmarkId, userId, licenseId, NOW_SQL, NOW_SQL, NOW_SQL).run();
}

function request({ licenseId = LICENSE, couponCode = "TWOMONTHS", requestId = REQUEST } = {}, userId = OWNER) {
  return new Request(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ license_id: licenseId, coupon_code: couponCode, request_id: requestId }),
  });
}

function call(input, userId = OWNER, createId = () => "00000000-0000-4000-8000-000000000007") {
  return handleExtensionCouponApplicationD1Request(request(input, userId), env, {
    resolveUser: async () => userId,
    createId,
    now: () => new Date(NOW),
  });
}

async function body(response) {
  return await response.json();
}

isolated("applies coupon, cancels lottery entries, records notices/audits, and replays safely", async () => {
  await reset();
  await seedCoupon();
  await seedLicense();
  await seedPendingEntry({ id: "00000000-0000-4000-8000-000000000006" });
  await seedPendingEntry({ id: "00000000-0000-4000-8000-000000000008", userId: "00000000-0000-4000-8000-000000000010" });

  const first = await call({});
  assert.equal(first.status, 200);
  const result = await body(first);
  assert.deepEqual(result, {
    success: true,
    license: {
      id: LICENSE,
      license_end: "2026-12-01T00:00:00.000Z",
      grace_expires_at: null,
      status: "active",
    },
    months: 2,
    tier_level: 2,
    cancelled_lottery_entries: 2,
  });
  const replay = await call({}, OWNER, () => "00000000-0000-4000-8000-000000000011");
  assert.deepEqual(await body(replay), result);

  const coupon = await database.prepare("SELECT used_count FROM extension_coupons WHERE id = ?").bind(COUPON).first();
  const license = await database.prepare("SELECT status, license_end, grace_expires_at, excluded_at, excluded_from_plan FROM fanmark_licenses WHERE id = ?").bind(LICENSE).first();
  const usages = await database.prepare("SELECT COUNT(*) AS count FROM extension_coupon_usages").first();
  const cancelled = await database.prepare("SELECT COUNT(*) AS count FROM fanmark_lottery_entries WHERE coupon_extension_command_id IS NOT NULL AND entry_status = 'cancelled_by_extension' AND cancellation_reason = 'license_extended'").first();
  const notices = await database.prepare("SELECT event_type, source, payload, dedupe_key FROM notification_events ORDER BY dedupe_key").all();
  const audits = await database.prepare("SELECT action FROM audit_logs ORDER BY action").all();
  assert.equal(coupon.used_count, 1);
  assert.deepEqual(license, {
    status: "active",
    license_end: "2026-12-01T00:00:00.000Z",
    grace_expires_at: null,
    excluded_at: null,
    excluded_from_plan: null,
  });
  assert.equal(usages.count, 1);
  assert.equal(cancelled.count, 2);
  assert.equal(notices.results.length, 2);
  assert.ok(notices.results.every((notice) => notice.event_type === "lottery_cancelled_by_extension" && notice.source === "edge_function"));
  assert.equal((await database.prepare("SELECT json_extract(payload, '$.fanmark_name') AS name FROM notification_events LIMIT 1").first()).name, "🧪");
  assert.deepEqual(audits.results.map((row) => row.action).sort(), [
    "COUPON_EXTENSION_LOTTERY_CANCELLED",
    "extend_fanmark_license_by_coupon",
  ].sort());
});

isolated("serializes competing claims against the coupon cap", async () => {
  await reset();
  await seedCoupon({ maxUses: 1 });
  const secondOwner = "00000000-0000-4000-8000-000000000012";
  const secondLicense = "00000000-0000-4000-8000-000000000013";
  const secondFanmark = "00000000-0000-4000-8000-000000000014";
  await seedLicense();
  await seedLicense({ userId: secondOwner, licenseId: secondLicense, fanmarkId: secondFanmark, displayFanmark: "🌸" });
  const secondRequest = "00000000-0000-4000-8000-000000000015";
  const responses = await Promise.all([
    call({}),
    call({ licenseId: secondLicense, requestId: secondRequest }, secondOwner),
  ]);
  const payloads = await Promise.all(responses.map(body));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
  assert.equal(payloads.filter((value) => value.success === true).length, 1);
  assert.equal(payloads.filter((value) => value.error === "coupon_usage_exceeded").length, 1);
  assert.equal((await database.prepare("SELECT used_count FROM extension_coupons WHERE id = ?").bind(COUPON).first()).used_count, 1);
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM extension_coupon_usages").first()).count, 1);
});

isolated("converges concurrent retries of the same command on one stored result", async () => {
  await reset();
  await seedCoupon();
  await seedLicense();
  const responses = await Promise.all([call({}), call({})]);
  const payloads = await Promise.all(responses.map(body));

  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.deepEqual(payloads[0], payloads[1]);
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM extension_coupon_application_commands").first()).count, 1);
  assert.equal((await database.prepare("SELECT used_count FROM extension_coupons WHERE id = ?")
    .bind(COUPON).first()).used_count, 1);
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM extension_coupon_usages").first()).count, 1);
});

isolated("rejects request ID reuse with a different command and blocks duplicate coupon use", async () => {
  await reset();
  await seedCoupon({ maxUses: 5 });
  await seedLicense();
  const first = await call({});
  assert.equal(first.status, 200);
  const conflict = await call({ couponCode: "OTHER" });
  assert.equal(conflict.status, 409);
  assert.equal((await body(conflict)).error, "request_id_conflict");

  const retryId = "00000000-0000-4000-8000-000000000016";
  const duplicate = await call({ requestId: retryId });
  assert.equal(duplicate.status, 400);
  assert.equal((await body(duplicate)).error, "coupon_already_used_on_fanmark");
  assert.equal((await database.prepare("SELECT used_count FROM extension_coupons WHERE id = ?").bind(COUPON).first()).used_count, 1);
});

isolated("checks tier, transfer, grace plan limit, and perpetual-license rules", async () => {
  await reset();
  await seedCoupon({ allowedTiers: "[1]" });
  await seedLicense();
  let response = await call({});
  assert.equal((await body(response)).error, "tier_not_allowed");

  await reset();
  await seedCoupon();
  await seedLicense();
  await database.prepare(`
    INSERT INTO fanmark_transfer_codes
      (id, license_id, fanmark_id, issuer_user_id, transfer_code, status, expires_at, disclaimer_agreed_at, created_at, updated_at)
    VALUES ('00000000-0000-4000-8000-000000000020', ?, ?, ?, 'TRANSFER', 'active', ?, ?, ?, ?)
  `).bind(LICENSE, FANMARK, OWNER, "2026-09-28T12:00:00.000Z", NOW_SQL, NOW_SQL, NOW_SQL).run();
  response = await call({});
  assert.equal((await body(response)).error, "transfer_in_progress");

  await reset();
  await seedCoupon();
  await seedLicense({ status: "grace", userSettings: true });
  const extra = [
    ["00000000-0000-4000-8000-000000000021", "00000000-0000-4000-8000-000000000022", "🌹"],
    ["00000000-0000-4000-8000-000000000023", "00000000-0000-4000-8000-000000000024", "🌼"],
    ["00000000-0000-4000-8000-000000000025", "00000000-0000-4000-8000-000000000026", "🌷"],
  ];
  for (const [licenseId, fanmarkId, displayFanmark] of extra) {
    await seedLicense({ userId: OWNER, licenseId, fanmarkId, displayFanmark, userSettings: false });
  }
  response = await call({});
  assert.equal((await body(response)).error, "fanmark_limit_exceeded");

  await reset();
  await seedCoupon();
  await seedLicense({ licenseEnd: null });
  response = await call({});
  assert.equal((await body(response)).error, "perpetual_license");
});

isolated("rejects a stale grace plan-limit snapshot at the atomic insert", async () => {
  await reset();
  await seedCoupon();
  await seedLicense({ status: "grace", userSettings: true });
  await database.prepare(`
    INSERT INTO system_settings (setting_key, setting_value, created_at, updated_at)
    VALUES ('free_fanmarks_limit', '4', ?, ?)
  `).bind(NOW_SQL, NOW_SQL).run();

  await assert.rejects(database.prepare(`
    INSERT INTO extension_coupon_application_commands (
      id, request_id, user_id, license_id, coupon_id, coupon_code, fanmark_id,
      tier_level, months, previous_status, previous_license_end,
      grace_plan_type, grace_plan_limit_key, grace_plan_setting_value, grace_plan_limit,
      new_license_end, applied_at, status, cancelled_lottery_entries
    ) VALUES (
      '00000000-0000-4000-8000-000000000030', ?, ?, ?, ?, 'TWOMONTHS', ?,
      2, 2, 'grace', '2026-09-30T12:00:00.000Z',
      'free', 'free_fanmarks_limit', NULL, 3,
      '2026-12-01T00:00:00.000Z', ?, 'processing', 0
    )
  `).bind(REQUEST, OWNER, LICENSE, COUPON, FANMARK, NOW_SQL).run(), /plan_limit_changed/u);

  assert.equal((await database.prepare("SELECT used_count FROM extension_coupons WHERE id = ?")
    .bind(COUPON).first()).used_count, 0);
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM extension_coupon_usages").first()).count, 0);
  assert.equal((await database.prepare("SELECT status FROM fanmark_licenses WHERE id = ?")
    .bind(LICENSE).first()).status, "grace");
});

isolated("expires coupon before claim and returns unauthorized without resolver identity", async () => {
  await reset();
  await seedCoupon({ expiresAt: "2026-09-26T11:59:59.000Z" });
  await seedLicense();
  const expired = await call({});
  assert.equal((await body(expired)).error, "coupon_expired");

  const unauthorized = await handleExtensionCouponApplicationD1Request(request({}), env, {
    resolveUser: async () => null,
    now: () => new Date(NOW),
  });
  assert.equal(unauthorized.status, 401);
  assert.equal((await body(unauthorized)).error, "authentication_required");
});
