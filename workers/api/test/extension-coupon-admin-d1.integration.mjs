#!/usr/bin/env node

import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const modulePath = path.join(repoRoot, "workers/api/src/extension-coupon-admin-d1-api.ts");
const migrations = [
  "workers/api/migrations-business/0000_business_schema_v4_staging.sql",
  "workers/api/migrations-business/0015_extension_coupon_application.sql",
];
const { handleExtensionCouponAdminRequest } = await import(pathToFileURL(modulePath).href);
const NOW = "2026-09-26T12:00:00.000Z";
const ADMIN = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000002";
const LICENSE = "00000000-0000-4000-8000-000000000003";
const FANMARK = "00000000-0000-4000-8000-000000000004";
const COUPON = "00000000-0000-4000-8000-000000000005";
const ORIGIN = "https://app.example.test";
const URL = "https://app.example.test/api/admin/extension-coupons";

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
    if (/^create\s+trigger\b/iu.test(candidate)) {
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
        name: "fanmark-extension-coupon-admin-d1-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: { BUSINESS_DB: { type: "d1", name: "fanmark-extension-coupon-admin-business-test" } },
        manifest: {
          mainModule: "index.js",
          modules: { "index.js": { type: "esm", contents: "export default { fetch() { return new Response('ok'); } };" } },
        },
      },
    }],
  });
  const database = await miniflare.getD1Database("BUSINESS_DB");
  try {
    for (const migration of migrations) {
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

function request(path = "", method = "GET", body = undefined) {
  return new Request(`${URL}${path}`, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function world(run) {
  const fixture = await createFixture();
  const env = {
    FANMARK_DB: fixture.database,
    D1_TOPOLOGY: "split",
    AUTH_BACKEND: "better-auth",
    EXTENSION_COUPON_ADMIN_BACKEND: "d1",
    CORS_ALLOWED_ORIGINS: ORIGIN,
  };
  const authorize = async () => ({ userId: ADMIN, sessionId: "synthetic-admin-session" });
  const call = (path = "", method = "GET", body = undefined, overrides = {}) => handleExtensionCouponAdminRequest(
    request(path, method, body), { ...env, ...overrides }, authorize, {
      createId: () => COUPON,
      createCode: () => "EXTABC234",
      now: () => new Date(NOW),
    },
  );
  try { await run(fixture.database, call, env); }
  finally { await fixture.miniflare.dispose(); }
}

async function body(response) { return await response.json(); }

 test("creates and lists coupon master rows with server generated codes", async () => world(async (database, call) => {
  const created = await call("", "POST", {
    code: null,
    months: 3,
    allowed_tier_levels: [1, 2],
    max_uses: 5,
    expires_at: null,
  });
  assert.equal(created.status, 201);
  const payload = await body(created);
  assert.equal(payload.coupon.code, "EXTABC234");
  assert.deepEqual(payload.coupon.allowed_tier_levels, [1, 2]);
  assert.equal(payload.coupon.created_by, ADMIN);
  assert.equal(payload.coupon.used_count, 0);

  const listing = await call();
  assert.equal(listing.status, 200);
  const list = await body(listing);
  assert.equal(list.schemaVersion, 1);
  assert.deepEqual(list.coupons, [payload.coupon]);
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM extension_coupons").first()).count, 1);
}));

test("updates coupon active state with an optimistic revision and preserves redemption history", async () => world(async (database, call) => {
  await database.prepare(`
    INSERT INTO extension_coupons
      (id, code, months, allowed_tier_levels, max_uses, used_count, expires_at, is_active, created_at, updated_at)
    VALUES (?, 'KEEP2', 2, NULL, 3, 0, NULL, 1, ?, ?)
  `).bind(COUPON, NOW, NOW).run();
  const updated = await call(`/${COUPON}`, "PATCH", { is_active: false, expected_updated_at: NOW });
  assert.equal(updated.status, 200);
  const payload = await body(updated);
  assert.equal(payload.coupon.is_active, false);
  assert.notEqual(payload.coupon.updated_at, NOW);

  const stale = await call(`/${COUPON}`, "PATCH", { is_active: true, expected_updated_at: NOW });
  assert.equal(stale.status, 409);
  assert.deepEqual(await body(stale), { error: "stale_revision" });
}));

test("reads usage details through one joined admin response and prevents deleting redeemed coupons", async () => world(async (database, call) => {
  await database.prepare(`
    INSERT INTO fanmarks
      (id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at,
       normalized_emoji_ids, tier_level)
    VALUES (?, '🧪', '🧪', 'coupon1', 'active', ?, ?, '["coupon-test"]', 2)
  `).bind(FANMARK, NOW, NOW).run();
  await database.prepare(`
    INSERT INTO fanmark_licenses
      (id, fanmark_id, user_id, license_start, license_end, status, created_at, updated_at, display_fanmark)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, '🧪')
  `).bind(LICENSE, FANMARK, USER, NOW, "2026-12-01T00:00:00.000Z", NOW, NOW).run();
  await database.prepare(`
    INSERT INTO user_settings (user_id, username, display_name, created_at, updated_at)
    VALUES (?, 'synthetic-user', 'Synthetic Person', ?, ?)
  `).bind(USER, NOW, NOW).run();
  await database.prepare(`
    INSERT INTO extension_coupons
      (id, code, months, allowed_tier_levels, max_uses, used_count, expires_at, is_active, created_at, updated_at)
    VALUES (?, 'USED2', 2, NULL, 3, 1, NULL, 1, ?, ?)
  `).bind(COUPON, NOW, NOW).run();
  await database.prepare(`
    INSERT INTO extension_coupon_usages (id, coupon_id, user_id, fanmark_id, license_id, used_at)
    VALUES ('00000000-0000-4000-8000-000000000006', ?, ?, ?, ?, ?)
  `).bind(COUPON, USER, FANMARK, LICENSE, NOW).run();

  const usagesResponse = await call(`/${COUPON}/usages`);
  assert.equal(usagesResponse.status, 200);
  const usages = await body(usagesResponse);
  assert.equal(usages.usages.length, 1);
  assert.equal(usages.usages[0].fanmark_emoji, "🧪");
  assert.equal(usages.usages[0].user_display_name, "Synthetic Person");

  const deleted = await call(`/${COUPON}`, "DELETE");
  assert.equal(deleted.status, 409);
  assert.deepEqual(await body(deleted), { error: "coupon_in_use" });
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM extension_coupon_usages").first()).count, 1);
}));

test("deletes only unused coupons and fails closed when selector or origin is missing", async () => world(async (database, call) => {
  await database.prepare(`
    INSERT INTO extension_coupons
      (id, code, months, allowed_tier_levels, max_uses, used_count, expires_at, is_active, created_at, updated_at)
    VALUES (?, 'UNUSED2', 1, NULL, 1, 0, NULL, 1, ?, ?)
  `).bind(COUPON, NOW, NOW).run();
  const deleted = await call(`/${COUPON}`, "DELETE");
  assert.equal(deleted.status, 200);
  assert.deepEqual(await body(deleted), { schemaVersion: 1, deleted: true });
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM extension_coupons").first()).count, 0);

  const selectorOff = await call("", "GET", undefined, { EXTENSION_COUPON_ADMIN_BACKEND: undefined });
  assert.equal(selectorOff.status, 503);
  const wrongOrigin = await handleExtensionCouponAdminRequest(
    new Request(URL, { headers: { Origin: "https://evil.example" } }),
    { FANMARK_DB: database, D1_TOPOLOGY: "split", AUTH_BACKEND: "better-auth", EXTENSION_COUPON_ADMIN_BACKEND: "d1", CORS_ALLOWED_ORIGINS: ORIGIN },
    async () => ({ userId: ADMIN, sessionId: "synthetic-admin-session" }),
  );
  assert.equal(wrongOrigin.status, 403);
}));
