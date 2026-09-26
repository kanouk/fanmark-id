#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID, webcrypto } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import bcrypt from "bcryptjs";

const apiDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = "npx";
const wranglerVersion = "4.139.0";
const configPath = path.join(apiDirectory, "wrangler.app-staging.jsonc");
const expectedBusinessDatabase = "fanmark-business-staging";
const expectedBusinessDatabaseId = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const expectedDatabase = "fanmark-auth-staging";
const expectedDatabaseId = "2116bc43-32ab-4e3e-b762-9378df88b95f";
const expectedMasterDatabase = "fanmark-emoji-master-staging";
const expectedMasterDatabaseId = "160376b0-bde6-4d5f-8969-96deb5ae1183";
const expectedWorker = "fanmark-app-staging";
const expectedOrigin = "https://fanmark-app-staging.fanmark-id.workers.dev";
const userOwnedTables = [
  "user",
  "account",
  "session",
  "verification",
  "twoFactor",
  "adminRole",
  "mfaAssurance",
  "adminUserStatusAudit",
];

function requireExplicitStagingConsent() {
  const args = new Set(process.argv.slice(2));
  const emojiMasterRoundtrip = args.has("--emoji-master-draft-roundtrip");
  const referenceMasterPricingReadback = args.has("--reference-master-pricing-readback");
  const adminUserManagementReadback = args.has("--admin-user-management-readback");
  const adminUserPlanReadback = args.has("--admin-user-plan-readback");
  const adminUserStatusReadback = args.has("--admin-user-status-readback");
  const systemSettingsReadback = args.has("--system-settings-readback");
  if (!args.has("--run-live-staging-write") || !args.has(`--database=${expectedDatabase}`) ||
      (!emojiMasterRoundtrip && !referenceMasterPricingReadback && !adminUserManagementReadback && !adminUserPlanReadback && !adminUserStatusReadback && !systemSettingsReadback)) {
    throw new Error(
      `Refusing remote staging writes. Pass --run-live-staging-write --database=${expectedDatabase} and an explicit smoke flag.`,
    );
  }
  return { emojiMasterRoundtrip, referenceMasterPricingReadback, adminUserManagementReadback, adminUserPlanReadback, adminUserStatusReadback, systemSettingsReadback };
}

async function assertStagingTarget() {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.name, expectedWorker, "unexpected Worker config");
  assert.equal(config.workers_dev, true, "staging Worker must be workers.dev only");
  const binding = config.d1_databases?.find((database) => database.binding === "AUTH_DB");
  assert.equal(binding?.database_name, expectedDatabase, "unexpected Auth D1 name");
  assert.equal(binding?.database_id, expectedDatabaseId, "unexpected Auth D1 id");
  assert.equal(binding?.migrations_pattern, "migrations/000[378]_*.sql", "expected the Auth suspension migration in the active D1 migration set");
  const businessBinding = config.d1_databases?.find((database) => database.binding === "FANMARK_DB");
  assert.equal(businessBinding?.database_name, expectedBusinessDatabase, "unexpected business D1 name");
  assert.equal(businessBinding?.database_id, expectedBusinessDatabaseId, "unexpected business D1 id");
  assert.equal(businessBinding?.remote, true, "business D1 must be the remote staging database");
  assert.equal(config.vars?.AUTH_BACKEND, "better-auth", "unexpected Auth backend");
  assert.equal(config.vars?.INVITATION_ADMIN_BACKEND, "d1", "expected D1-backed invitation admin API");
  assert.equal(config.vars?.AVAILABILITY_RULES_ADMIN_BACKEND, "d1", "expected D1-backed availability rule admin API");
  assert.equal(config.vars?.NOTIFICATION_MASTER_BACKEND, "d1", "expected D1-backed notification admin API");
  assert.equal(config.vars?.EMAIL_TEMPLATE_ADMIN_BACKEND, "d1", "expected D1-backed auth email-template admin API");
  assert.equal(config.vars?.AUTH_EMAIL_TEMPLATE_BACKEND, "d1", "expected D1-backed Better Auth email templates");
  assert.equal(config.vars?.STAGING_NO_INDEX, "true", "expected no-index staging Worker");
  assert.equal(config.vars?.REFERENCE_MASTER_ADMIN_BACKEND, "d1", "expected D1-backed reference-master admin API");
  assert.equal(config.vars?.ADMIN_USER_MANAGEMENT_BACKEND, "d1", "expected D1-backed admin user-management API");
  assert.equal(config.vars?.AUTH_USER_STATUS_BACKEND, "d1", "expected Auth D1 suspension enforcement");
  assert.equal(config.vars?.SYSTEM_SETTINGS_BACKEND, "d1", "expected D1-backed system settings API");
  const masterBinding = config.d1_databases?.find((database) => database.binding === "MASTER_DB");
  assert.equal(masterBinding?.database_name, expectedMasterDatabase, "unexpected Master D1 name");
  assert.equal(masterBinding?.database_id, expectedMasterDatabaseId, "unexpected Master D1 id");
  assert.equal(masterBinding?.migrations_pattern, "migrations/000[0-6]_*.sql", "unexpected Master D1 migration set");
  assert.equal(config.vars?.EMOJI_MASTER_ADMIN_BACKEND, "d1", "expected D1-backed emoji-master admin API");
}

function runWrangler(args) {
  const activeNode = realpathSync(process.execPath);
  const childPath = (process.env.PATH ?? "").split(path.delimiter).filter((directory) => {
    const candidate = path.join(directory, "node");
    if (!existsSync(candidate)) return true;
    try {
      return realpathSync(candidate) !== activeNode;
    } catch {
      return true;
    }
  }).join(path.delimiter);
  const childEnv = { ...process.env, PATH: childPath, CI: process.env.CI ?? "1" };
  for (const key of Object.keys(childEnv)) {
    if (/^npm_config_/iu.test(key) || key === "npm_execpath" || /^npm_lifecycle_/iu.test(key)) delete childEnv[key];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(wrangler, ["--yes", `wrangler@${wranglerVersion}`, ...args, "--config", configPath], {
      cwd: apiDirectory,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let failed = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 100_000) {
        failed = true;
        child.kill("SIGTERM");
      }
    });
    // Wrangler diagnostics may include submitted statements; never relay stderr.
    child.stderr.on("data", () => {});
    child.on("error", () => reject(new Error("Wrangler could not be started")));
    child.on("close", (code) => {
      if (failed || code !== 0) return reject(new Error("Wrangler D1 command failed"));
      resolve(stdout);
    });
  });
}

function parseWranglerJson(stdout) {
  try {
    const normalized = stdout.replace(/\u001b\[[0-9;]*m/gu, "").trim();
    const start = normalized.search(/\[\s*\{\s*"results"\s*:/u);
    const end = normalized.lastIndexOf("]");
    if (start < 0 || end < start) throw new Error("missing JSON array");
    return JSON.parse(normalized.slice(start, end + 1));
  } catch {
    throw new Error("Wrangler returned an invalid JSON result");
  }
}

async function query(sql) {
  const output = await runWrangler([
    "d1", "execute", expectedDatabase, "--remote", "--command", sql, "--json",
  ]);
  const result = parseWranglerJson(output);
  if (!Array.isArray(result) || result[0]?.success !== true) {
    throw new Error("Remote Auth D1 read failed");
  }
  return result[0].results ?? [];
}

async function queryMaster(sql) {
  const output = await runWrangler([
    "d1", "execute", expectedMasterDatabase, "--remote", "--command", sql, "--json",
  ]);
  const result = parseWranglerJson(output);
  if (!Array.isArray(result) || result[0]?.success !== true) {
    throw new Error("Remote Master D1 read failed");
  }
  return result[0].results ?? [];
}

async function queryBusiness(sql) {
  const output = await runWrangler([
    "d1", "execute", expectedBusinessDatabase, "--remote", "--command", sql, "--json",
  ]);
  const result = parseWranglerJson(output);
  if (!Array.isArray(result) || result[0]?.success !== true) {
    throw new Error("Remote business D1 read failed");
  }
  return result[0].results ?? [];
}

async function executeFile(sql, label) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fanmark-auth-staging-"));
  try {
    await writeFile(path.join(temporaryDirectory, "operation.sql"), sql, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    const output = await runWrangler([
      "d1", "execute", expectedDatabase, "--remote", "--file",
      path.join(temporaryDirectory, "operation.sql"), "--yes", "--json",
    ]);
    const result = parseWranglerJson(output);
    if (!Array.isArray(result) || result.some((item) => item.success !== true)) {
      throw new Error(`Remote Auth D1 ${label} failed`);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function executeBusiness(sql, label) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fanmark-business-staging-"));
  try {
    await writeFile(path.join(temporaryDirectory, "operation.sql"), sql, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    const output = await runWrangler([
      "d1", "execute", expectedBusinessDatabase, "--remote", "--file",
      path.join(temporaryDirectory, "operation.sql"), "--yes", "--json",
    ]);
    const result = parseWranglerJson(output);
    if (!Array.isArray(result) || result.some((item) => item.success !== true)) {
      throw new Error(`Remote business D1 ${label} failed`);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function readUserOwnedCounts() {
  const expressions = userOwnedTables.map(
    (table) => `(SELECT count(*) FROM "${table}") AS "${table}"`,
  );
  const rows = await query(`SELECT ${expressions.join(", ")}`);
  const counts = rows[0];
  assert.ok(counts && typeof counts === "object", "Auth D1 count row is missing");
  for (const table of userOwnedTables) {
    assert.equal(Number(counts[table]), 0, `expected empty staging Auth table: ${table}`);
  }
  return counts;
}

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const character of value.toUpperCase().replace(/=+$/u, "")) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("TOTP enrollment returned an invalid secret");
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

async function createTotpCode(secret, now = Date.now()) {
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(Math.floor(now / 30_000)));
  const key = await webcrypto.subtle.importKey(
    "raw",
    decodeBase32(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await webcrypto.subtle.sign("HMAC", key, counter));
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  ) % 1_000_000;
  return String(value).padStart(6, "0");
}

function sessionCookie(response, fallback = "") {
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  const pairs = cookies.map((value) => value.split(";", 1)[0]).filter(Boolean);
  const session = pairs.find((value) => value.includes("session_token="));
  return session ?? fallback;
}

async function request(path, init = {}) {
  return fetch(`${expectedOrigin}${path}`, {
    ...init,
    headers: {
      Origin: expectedOrigin,
      accept: "application/json",
      ...(init.headers ?? {}),
    },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
}

async function readActiveCatalogItem(id) {
  let offset = 0;
  let version = null;
  let total = null;
  while (total === null || offset < total) {
    const response = await request(`/api/emoji/catalog?offset=${offset}&limit=500`);
    assertStatus(response, 200, "active emoji catalog read");
    const page = await response.json();
    assert.equal(typeof page.version, "string");
    assert.ok(Array.isArray(page.items));
    if (version === null) {
      version = page.version;
      total = page.total;
    } else {
      assert.equal(page.version, version, "active release changed during catalog read");
      assert.equal(page.total, total, "active catalog row count changed during read");
    }
    const item = page.items.find((candidate) => candidate.id === id);
    if (item) return { version, total, item };
    if (page.nextOffset === null || page.nextOffset === undefined) break;
    assert.ok(Number.isSafeInteger(page.nextOffset) && page.nextOffset > offset);
    offset = page.nextOffset;
  }
  throw new Error("protected emoji was not found in the active release");
}

async function exerciseEmojiMasterDraft(cookie) {
  const list = await request("/api/admin/emoji-master?page=1&pageSize=50", { headers: { cookie } });
  assertStatus(list, 200, "MFA-protected emoji-master list");
  const page = await list.json();
  assert.equal(page.schemaVersion, 1);
  assert.match(page.activeReleaseVersion, /^[0-9a-f]{64}$/u);
  const record = page.items.find((item) => item.releaseProtected === true);
  assert.ok(record, "staging Master D1 has no release-protected record for round-trip verification");
  const publicBefore = await readActiveCatalogItem(record.id);
  assert.equal(publicBefore.version, page.activeReleaseVersion);

  const draftUpdate = {
    updatedAt: record.updatedAt,
    emoji: record.emoji,
    shortName: `Staging smoke ${record.shortName}`.slice(0, 256),
    keywords: ["staging-smoke"],
    category: record.category,
    subcategory: record.subcategory,
    codepoints: record.codepoints,
    sortOrder: record.sortOrder,
  };
  let changedRecord = null;
  try {
    const update = await request(`/api/admin/emoji-master/${encodeURIComponent(record.id)}`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(draftUpdate),
    });
    assertStatus(update, 200, "emoji-master draft edit");
    changedRecord = await update.json();
    assert.equal(changedRecord.id, record.id, "draft edit changed the stable UUID");
    assert.equal(changedRecord.shortName, draftUpdate.shortName);
    assert.equal(changedRecord.releaseProtected, true);

    const deletion = await request(`/api/admin/emoji-master/${encodeURIComponent(record.id)}`, {
      method: "DELETE",
      headers: { cookie },
    });
    assertStatus(deletion, 409, "protected emoji deletion guard");
    assert.equal((await deletion.json()).error, "emoji_deletion_requires_release_review");
  } finally {
    if (changedRecord?.updatedAt) {
      const restore = await request(`/api/admin/emoji-master/${encodeURIComponent(record.id)}`, {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          updatedAt: changedRecord.updatedAt,
          emoji: record.emoji,
          shortName: record.shortName,
          keywords: record.keywords,
          category: record.category,
          subcategory: record.subcategory,
          codepoints: record.codepoints,
          sortOrder: record.sortOrder,
        }),
      });
      assertStatus(restore, 200, "emoji-master draft restoration");
    }
  }

  const [publicAfter, draftReadback, activeVersionRows] = await Promise.all([
    readActiveCatalogItem(record.id),
    request(`/api/admin/emoji-master/${encodeURIComponent(record.id)}`, { headers: { cookie } }),
    queryMaster("SELECT release_version FROM fanmark_emoji_master_active_release WHERE singleton_id = 1"),
  ]);
  assert.deepEqual(publicAfter, publicBefore, "active public catalog changed during draft-only edit");
  assertStatus(draftReadback, 200, "restored emoji-master draft readback");
  const restored = await draftReadback.json();
  assert.equal(restored.id, record.id);
  assert.equal(restored.shortName, record.shortName);
  assert.equal(activeVersionRows.length, 1);
  assert.equal(activeVersionRows[0].release_version, page.activeReleaseVersion);
}

async function exerciseNotificationMasters(cookie) {
  const [rulesResponse, templatesResponse, eventsResponse, notificationsResponse, beforeCounts] = await Promise.all([
    request("/api/admin/notification-masters/rules", { headers: { cookie } }),
    request("/api/admin/notification-masters/templates", { headers: { cookie } }),
    request("/api/admin/notification-masters/events", { headers: { cookie } }),
    request("/api/admin/notification-masters/notifications", { headers: { cookie } }),
    queryBusiness(`SELECT (SELECT count(*) FROM notification_events) AS events,
      (SELECT count(*) FROM notifications) AS notifications`),
  ]);
  assertStatus(rulesResponse, 200, "MFA-protected notification rules read");
  assertStatus(templatesResponse, 200, "MFA-protected notification templates read");
  assertStatus(eventsResponse, 200, "MFA-protected notification event log read");
  assertStatus(notificationsResponse, 200, "MFA-protected notification delivery log read");
  const rulesBody = await rulesResponse.json();
  const templatesBody = await templatesResponse.json();
  const eventsBody = await eventsResponse.json();
  const notificationsBody = await notificationsResponse.json();
  assert.equal(rulesBody.schemaVersion, 1);
  assert.equal(templatesBody.schemaVersion, 1);
  assert.ok(Array.isArray(rulesBody.rules));
  assert.ok(Array.isArray(templatesBody.templates));
  assert.equal(rulesBody.rules.length, 10);
  assert.equal(templatesBody.templates.length, 40);
  assert.ok(rulesBody.rules.every((rule) => !Object.hasOwn(rule, "created_by")));
  assert.ok(templatesBody.templates.every((template) => !Object.hasOwn(template, "payload_schema")));
  assert.equal(eventsBody.schemaVersion, 1);
  assert.equal(notificationsBody.schemaVersion, 1);
  assert.ok(Array.isArray(eventsBody.events) && eventsBody.events.length <= 100);
  assert.ok(Array.isArray(notificationsBody.notifications) && notificationsBody.notifications.length <= 100);
  assert.ok(eventsBody.events.every((event) => !Object.hasOwn(event, "payload")));
  assert.ok(notificationsBody.notifications.every((notification) =>
    !Object.hasOwn(notification, "payload") && /^[0-9a-f]{8}\.\.\.$/iu.test(notification.user_id)));
  const afterCounts = await queryBusiness(`SELECT (SELECT count(*) FROM notification_events) AS events,
    (SELECT count(*) FROM notifications) AS notifications`);
  assert.deepEqual(afterCounts, beforeCounts, "notification log reads changed D1 rows");
}

async function exerciseAuthEmailTemplatesAdmin(cookie) {
  const route = "/api/admin/email-templates";
  const rowsSql = `SELECT id, email_type, language, subject, body_text, button_text,
      is_active, created_at, updated_at
    FROM email_templates
    WHERE email_type IN ('signup', 'recovery', 'magiclink', 'email_change')
    ORDER BY email_type, language`;
  const beforeRows = await queryBusiness(rowsSql);
  assert.equal(beforeRows.length, 16, "expected all 16 allowlisted auth email templates before admin read");
  const anonymous = await request(route);
  assertStatus(anonymous, 401, "unauthenticated auth email-template admin read");

  const response = await request(route, { headers: { cookie } });
  assertStatus(response, 200, "MFA-protected auth email-template list");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/iu);
  const body = await response.json();
  assert.ok(Array.isArray(body.templates));
  assert.equal(body.templates.length, 16);
  const expected = new Set(
    ["signup", "recovery", "magiclink", "email_change"]
      .flatMap((type) => ["en", "ja", "ko", "id"].map((language) => `${type}/${language}`)),
  );
  const actual = body.templates.map((template) => `${template.email_type}/${template.language}`);
  assert.equal(new Set(actual).size, 16, "auth email-template identities must be unique");
  assert.deepEqual([...actual].sort(), [...expected].sort());
  assert.ok(body.templates.every((template) => template.is_active === true));
  assert.deepEqual(
    body.templates,
    beforeRows.map((row) => ({ ...row, is_active: Number(row.is_active) === 1 })),
    "MFA-protected auth email-template response differed from the full D1 readback",
  );

  const afterRows = await queryBusiness(rowsSql);
  assert.deepEqual(afterRows, beforeRows, "auth email-template admin read changed D1 data");
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function exerciseReferenceMasterPricingReadback(cookie) {
  const route = "/api/admin/reference-masters/pricing";
  const before = await queryMaster(`SELECT a.release_version, a.generation
    FROM fanmark_reference_master_active_release AS a
    JOIN fanmark_reference_master_releases AS r
      ON r.release_version = a.release_version AND r.status = 'ready'
    WHERE a.singleton_id = 1`);
  assert.equal(before.length, 1, "active reference-master release is missing");
  const version = before[0].release_version;
  const generation = Number(before[0].generation);
  const expectedTiers = await queryMaster(`SELECT id, tier_level, display_name, description,
      initial_license_days, is_active
    FROM fanmark_tier_release_rows
    WHERE release_version = ${sqlLiteral(version)}
    ORDER BY tier_level, id`);
  const expectedPrices = await queryMaster(`SELECT id, tier_level, months, price_yen,
      is_active, stripe_price_id, stripe_price_id_live
    FROM fanmark_extension_price_release_rows
    WHERE release_version = ${sqlLiteral(version)}
    ORDER BY tier_level, months`);
  assert.equal(expectedTiers.length, 4, "expected four tier rows in the active release");
  assert.equal(expectedPrices.length, 16, "expected sixteen extension-price rows in the active release");

  const anonymous = await request(route);
  assertStatus(anonymous, 401, "unauthenticated reference-master pricing admin read");
  const response = await request(route, { headers: { cookie } });
  assertStatus(response, 200, "MFA-protected reference-master pricing read");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/iu);
  const body = await response.json();
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.releaseVersion, version);
  assert.equal(body.generation, generation);
  assert.equal(body.tiers.length, 4);
  assert.equal(body.extensionPrices.length, 16);

  const normalizedTiers = (rows) => rows.map((row) => ({
    id: row.id,
    tier_level: Number(row.tier_level),
    display_name: row.display_name,
    description: row.description,
    initial_license_days: row.initial_license_days === null ? null : Number(row.initial_license_days),
    is_active: typeof row.is_active === "boolean" ? row.is_active : Number(row.is_active) === 1,
  }));
  const normalizedPrices = (rows) => rows.map((row) => ({
    id: row.id,
    tier_level: Number(row.tier_level),
    months: Number(row.months),
    price_yen: Number(row.price_yen),
    is_active: typeof row.is_active === "boolean" ? row.is_active : Number(row.is_active) === 1,
    stripe_price_id: row.stripe_price_id,
    stripe_price_id_live: row.stripe_price_id_live,
  }));
  assert.equal(digest(normalizedTiers(body.tiers)), digest(normalizedTiers(expectedTiers)),
    "MFA-protected tier DTO differs from active Master D1");
  assert.equal(digest(normalizedPrices(body.extensionPrices)), digest(normalizedPrices(expectedPrices)),
    "MFA-protected extension-price DTO differs from active Master D1");

  const publicResponse = await request("/api/reference-masters/fanmark_tier_extension_prices");
  assertStatus(publicResponse, 200, "public extension-price release read");
  assert.match(publicResponse.headers.get("cache-control") ?? "", /no-store/iu);
  const publicBody = await publicResponse.json();
  assert.equal(publicBody.releaseVersion, version);
  assert.equal(publicBody.items.length, 16);
  assert.ok(publicBody.items.every((item) => !Object.keys(item).some((key) => key.toLowerCase().includes("stripe"))));

  const after = await queryMaster(`SELECT release_version, generation
    FROM fanmark_reference_master_active_release WHERE singleton_id = 1`);
  assert.deepEqual(after, before, "reference-master admin read changed the active release pointer");
}

async function exerciseAdminUserManagementReadback(cookie, target) {
  const route = "/api/admin/users";
  const listBody = { search: target.email, page: 1, pageSize: 20 };
  const unfiltered = await request(route, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ page: 1, pageSize: 20 }),
  });
  assertStatus(unfiltered, 200, "MFA-protected unfiltered admin user list");
  assert.match(unfiltered.headers.get("cache-control") ?? "", /no-store/iu);
  const unfilteredBody = await unfiltered.json();
  assert.ok(unfilteredBody.data.some((user) => user.userId === target.userId),
    "unfiltered user list omitted the synthetic target");

  const usernameMatch = await request(route, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ search: target.username, page: 1, pageSize: 20 }),
  });
  assertStatus(usernameMatch, 200, "MFA-protected profile-field admin user search");
  const usernameMatchBody = await usernameMatch.json();
  assert.equal(usernameMatchBody.data.length, 1);
  assert.equal(usernameMatchBody.data[0].userId, target.userId);

  const anonymousList = await request(route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(listBody),
  });
  assertStatus(anonymousList, 401, "anonymous admin user list");

  const listed = await request(route, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(listBody),
  });
  if (listed.status !== 200) {
    const failure = await listed.json().catch(() => null);
    throw new Error(`MFA-protected synthetic user list returned HTTP ${listed.status} (${failure?.error ?? "no error code"})`);
  }
  assert.match(listed.headers.get("cache-control") ?? "", /no-store/iu);
  const list = await listed.json();
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].userId, target.userId);
  assert.equal(list.data[0].email, target.email);
  assert.equal(list.data[0].username, target.username);
  assert.equal(list.data[0].planType, "free");
  assert.deepEqual(list.data[0].licenseCounts, { active: 0, grace: 0, expired: 0 });
  assert.deepEqual(list.filters, { search: target.email, plans: null, status: null });

  const anonymousDetail = await request(`${route}/${encodeURIComponent(target.userId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: target.userId }),
  });
  assertStatus(anonymousDetail, 401, "anonymous admin user detail");

  const detailResponse = await request(`${route}/${encodeURIComponent(target.userId)}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ userId: target.userId }),
  });
  assertStatus(detailResponse, 200, "MFA-protected synthetic user detail");
  assert.match(detailResponse.headers.get("cache-control") ?? "", /no-store/iu);
  const detail = await detailResponse.json();
  assert.equal(detail.auth.email, target.email);
  assert.equal(detail.profile.userId, target.userId);
  assert.equal(detail.profile.username, target.username);
  assert.equal(detail.profile.planType, "free");
  assert.deepEqual(detail.licenseSummary, { active: 0, grace: 0, expired: 0, total: 0 });
  assert.deepEqual(detail.recentFanmarks, []);
  assert.ok(!/password|credential|secret|token/iu.test(JSON.stringify(detail)));
}

async function exerciseAdminUserPlanReadback(cookie, target) {
  const route = `/api/admin/users/${encodeURIComponent(target.userId)}/plan`;
  const anonymous = await request(route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: target.userId, newPlanType: "enterprise" }),
  });
  assertStatus(anonymous, 401, "anonymous admin plan update");

  const enterprise = await request(route, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      userId: target.userId,
      newPlanType: "enterprise",
      enterpriseOverrides: { customFanmarksLimit: 250, customPricing: 55000, notes: "synthetic staging verification" },
      reason: "synthetic staging verification",
    }),
  });
  assertStatus(enterprise, 200, "MFA-protected Enterprise plan update");
  const enterpriseBody = await enterprise.json();
  assert.equal(enterpriseBody.success, true);
  assert.equal(enterpriseBody.previousPlanType, "free");
  assert.equal(enterpriseBody.newPlanType, "enterprise");
  assert.deepEqual(enterpriseBody.enterpriseSettings, {
    customFanmarksLimit: 250,
    customPricing: 55000,
    notes: "synthetic staging verification",
  });
  assert.ok(Number.isFinite(Date.parse(enterpriseBody.updatedAt)), "plan response did not contain an update timestamp");

  const rows = await queryBusiness(`SELECT id, custom_fanmarks_limit, custom_pricing, notes, created_by
    FROM enterprise_user_settings WHERE user_id = ${sqlLiteral(target.userId)}`);
  assert.equal(rows.length, 1, "Enterprise settings row was not written exactly once");
  assert.equal(Number(rows[0].custom_fanmarks_limit), 250);
  assert.equal(Number(rows[0].custom_pricing), 55000);
  assert.equal(rows[0].notes, "synthetic staging verification");
  assert.equal(rows[0].created_by, target.adminUserId);

  const max = await request(route, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ userId: target.userId, newPlanType: "max" }),
  });
  assertStatus(max, 200, "MFA-protected Max plan update and Enterprise cleanup");
  assert.equal((await max.json()).newPlanType, "max");
  const deletedSettings = await queryBusiness(`SELECT COUNT(*) AS count FROM enterprise_user_settings
    WHERE user_id = ${sqlLiteral(target.userId)}`);
  assert.equal(Number(deletedSettings[0]?.count), 0, "Enterprise settings remained after leaving Enterprise");

  const restore = await request(route, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ userId: target.userId, newPlanType: "free" }),
  });
  assertStatus(restore, 200, "synthetic plan baseline restoration");
  assert.equal((await restore.json()).newPlanType, "free");
  const finalProfile = await queryBusiness(`SELECT plan_type FROM user_settings WHERE user_id = ${sqlLiteral(target.userId)}`);
  assert.equal(finalProfile[0]?.plan_type, "free", "synthetic plan baseline was not restored");
}

async function readSystemSettingValue(key) {
  const rows = await queryBusiness(`SELECT setting_value FROM system_settings WHERE setting_key = ${sqlLiteral(key)} AND is_public = 1`);
  assert.equal(rows.length, 1, "the allowlisted public system setting is missing or duplicated");
  assert.equal(typeof rows[0].setting_value, "string");
  return rows[0].setting_value;
}

async function restoreSystemSetting(cookie, state) {
  if (!state.key || state.originalValue === null || state.temporaryValue === null) return;
  const current = await readSystemSettingValue(state.key);
  if (current === state.originalValue) return;
  assert.equal(current, state.temporaryValue, "system setting changed to an unexpected value during canary");
  const response = await request("/api/admin/system-settings", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ key: state.key, value: state.originalValue, expectedValue: state.temporaryValue }),
  });
  assertStatus(response, 200, "system setting baseline restoration");
  assert.deepEqual(await response.json(), { schemaVersion: 1, updatedSetting: state.key });
  assert.equal(await readSystemSettingValue(state.key), state.originalValue, "system setting baseline was not restored");
}

async function exerciseSystemSettingsReadback(cookie, adminUserId, state) {
  const route = "/api/admin/system-settings";
  const anonymous = await request(route);
  assertStatus(anonymous, 401, "anonymous admin system settings read");

  const admin = await request(route, { headers: { cookie } });
  assertStatus(admin, 200, "MFA-protected admin system settings read");
  const adminPayload = await admin.json();
  const expectedAdminKeys = [
    "invitation_mode", "social_login_enabled", "free_fanmarks_limit", "creator_fanmarks_limit",
    "max_fanmarks_limit", "business_fanmarks_limit", "premium_pricing", "max_pricing",
    "business_pricing", "max_emoji_characters", "creator_stripe_price_id", "max_stripe_price_id",
    "business_stripe_price_id", "creator_stripe_price_id_live", "max_stripe_price_id_live",
    "business_stripe_price_id_live", "stripe_mode", "enterprise_fanmarks_limit", "enterprise_pricing",
  ].sort();
  assert.equal(adminPayload.schemaVersion, 1);
  assert.deepEqual(Object.keys(adminPayload.settings ?? {}).sort(), expectedAdminKeys);
  assert.ok(Object.values(adminPayload.settings).every((value) => typeof value === "string"));

  state.key = "free_fanmarks_limit";
  state.originalValue = await readSystemSettingValue(state.key);
  assert.match(state.originalValue, /^(?:0|[1-9]\d*)$/u);
  const originalNumber = Number(state.originalValue);
  assert.ok(Number.isSafeInteger(originalNumber) && originalNumber >= 1 && originalNumber <= 1_000_000);
  state.temporaryValue = String(originalNumber === 1_000_000 ? originalNumber - 1 : originalNumber + 1);

  try {
    const update = await request(route, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ key: state.key, value: state.temporaryValue, expectedValue: state.originalValue }),
    });
    assertStatus(update, 200, "MFA-protected system setting update");
    assert.deepEqual(await update.json(), { schemaVersion: 1, updatedSetting: state.key });
    assert.equal(await readSystemSettingValue(state.key), state.temporaryValue, "system setting update did not reach D1");

    const stale = await request(route, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ key: state.key, value: state.originalValue, expectedValue: state.originalValue }),
    });
    assertStatus(stale, 409, "stale system setting update");
    assert.equal(await readSystemSettingValue(state.key), state.temporaryValue, "stale update changed the setting");
  } finally {
    await restoreSystemSetting(cookie, state);
  }

  const auditRows = await queryBusiness(`SELECT action, resource_type, resource_id, metadata FROM audit_logs
    WHERE user_id = ${sqlLiteral(adminUserId)} AND action = 'ADMIN_UPDATE_SYSTEM_SETTING'
      AND resource_type = 'system_setting' AND resource_id = ${sqlLiteral(state.key)} ORDER BY created_at, id`);
  assert.equal(auditRows.length, 2, "expected the update and restoration audit rows");
  for (const row of auditRows) {
    assert.deepEqual(JSON.parse(row.metadata), { settingKey: state.key });
  }
}

async function exerciseAdminUserStatusReadback(cookie, target) {
  const route = `/api/admin/users/${encodeURIComponent(target.userId)}/status`;
  const now = new Date();
  const until = new Date(now.getTime() + 5 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const sessionId = randomUUID();
  const sessionToken = randomBytes(32).toString("hex");
  await executeFile(
    `INSERT INTO "session" ("id", "expiresAt", "token", "createdAt", "updatedAt", "userId") VALUES (${sqlLiteral(sessionId)}, ${sqlLiteral(new Date(now.getTime() + 60_000).toISOString())}, ${sqlLiteral(sessionToken)}, ${sqlLiteral(now.toISOString())}, ${sqlLiteral(now.toISOString())}, ${sqlLiteral(target.userId)});`,
    "synthetic target session provision",
  );

  const anonymous = await request(route, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: target.userId, suspend: true, reason: "synthetic staging verification" }),
  });
  assertStatus(anonymous, 401, "anonymous admin user-status update");

  const suspended = await request(route, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ userId: target.userId, suspend: true, reason: "synthetic staging verification", bannedUntil: until }),
  });
  assertStatus(suspended, 200, "MFA-protected synthetic user suspension");
  const suspendedBody = await suspended.json();
  assert.equal(suspendedBody.status, "suspended");
  assert.equal(suspendedBody.bannedUntil, until);
  const [suspendedUser, remainingSessions, suspendedAudit] = await Promise.all([
    query(`SELECT banned, banReason, banExpires FROM "user" WHERE id = ${sqlLiteral(target.userId)}`),
    query(`SELECT COUNT(*) AS count FROM "session" WHERE "userId" = ${sqlLiteral(target.userId)}`),
    query(`SELECT actorUserId, action, reason, banExpires FROM "adminUserStatusAudit" WHERE targetUserId = ${sqlLiteral(target.userId)}`),
  ]);
  assert.deepEqual(suspendedUser, [{ banned: 1, banReason: "synthetic staging verification", banExpires: until }]);
  assert.equal(Number(remainingSessions[0]?.count), 0, "suspension left a target session active");
  assert.deepEqual(suspendedAudit, [{ actorUserId: target.adminUserId, action: "ADMIN_SUSPEND_USER", reason: "synthetic staging verification", banExpires: until }]);

  const suspendedList = await request("/api/admin/users", {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ search: target.email, status: "suspended", page: 1, pageSize: 10 }),
  });
  assertStatus(suspendedList, 200, "MFA-protected suspended-user filter");
  const suspendedListBody = await suspendedList.json();
  assert.equal(suspendedListBody.data.length, 1);
  assert.equal(suspendedListBody.data[0].userId, target.userId);
  assert.equal(suspendedListBody.data[0].status, "suspended");

  const suspendedDetail = await request(`/api/admin/users/${encodeURIComponent(target.userId)}`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ userId: target.userId }),
  });
  assertStatus(suspendedDetail, 200, "MFA-protected suspended-user detail");
  const detailBody = await suspendedDetail.json();
  assert.equal(detailBody.auth.status, "suspended");
  assert.equal(detailBody.auth.bannedUntil, until);
  assert.ok(detailBody.recentAuditLogs.some((entry) => entry.action === "ADMIN_SUSPEND_USER"));

  const restored = await request(route, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ userId: target.userId, suspend: false, reason: "synthetic baseline restore" }),
  });
  assertStatus(restored, 200, "MFA-protected synthetic user restoration");
  assert.equal((await restored.json()).status, "active");
  const [restoredUser, auditCount] = await Promise.all([
    query(`SELECT banned, banReason, banExpires FROM "user" WHERE id = ${sqlLiteral(target.userId)}`),
    query(`SELECT COUNT(*) AS count FROM "adminUserStatusAudit" WHERE targetUserId = ${sqlLiteral(target.userId)}`),
  ]);
  assert.deepEqual(restoredUser, [{ banned: 0, banReason: null, banExpires: null }]);
  assert.equal(Number(auditCount[0]?.count), 2, "suspension and restoration were not both audited");

  const createdAt = new Date().toISOString();
  await executeBusiness(`
    INSERT INTO fanmarks (id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at, emoji_ids, normalized_emoji_ids, tier_level)
    VALUES (${sqlLiteral(target.expiryFanmarkId)}, ${sqlLiteral(target.expiryFanmark)}, ${sqlLiteral(target.expiryFanmark)}, ${sqlLiteral(target.expiryShortId)}, 'active', ${sqlLiteral(createdAt)}, ${sqlLiteral(createdAt)}, ${sqlLiteral(JSON.stringify([target.expiryFanmarkId]))}, ${sqlLiteral(JSON.stringify([target.expiryFanmarkId]))}, 1);
    INSERT INTO fanmark_licenses (id, fanmark_id, user_id, license_start, license_end, status, is_initial_license, created_at, updated_at, display_fanmark)
    VALUES (${sqlLiteral(target.expiryLicenseId)}, ${sqlLiteral(target.expiryFanmarkId)}, ${sqlLiteral(target.userId)}, ${sqlLiteral(createdAt)}, '2999-12-31T23:59:59.000Z', 'active', 1, ${sqlLiteral(createdAt)}, ${sqlLiteral(createdAt)}, ${sqlLiteral(target.expiryFanmark)});
    INSERT INTO fanmark_basic_configs (license_id, fanmark_name, access_type, created_at, updated_at)
    VALUES (${sqlLiteral(target.expiryLicenseId)}, ${sqlLiteral(target.expiryFanmark)}, 'profile', ${sqlLiteral(createdAt)}, ${sqlLiteral(createdAt)});
    INSERT INTO fanmark_redirect_configs (license_id, target_url, created_at, updated_at)
    VALUES (${sqlLiteral(target.expiryLicenseId)}, 'https://example.invalid/synthetic', ${sqlLiteral(createdAt)}, ${sqlLiteral(createdAt)});
    INSERT INTO fanmark_messageboard_configs (license_id, content, created_at, updated_at)
    VALUES (${sqlLiteral(target.expiryLicenseId)}, 'synthetic expiry test', ${sqlLiteral(createdAt)}, ${sqlLiteral(createdAt)});
    INSERT INTO fanmark_password_configs (license_id, access_password, is_enabled, created_at, updated_at)
    VALUES (${sqlLiteral(target.expiryLicenseId)}, 'synthetic-only-placeholder', 1, ${sqlLiteral(createdAt)}, ${sqlLiteral(createdAt)});
  `, "synthetic immediate-expiry license and configs provision");

  const expirePath = `/api/admin/users/${encodeURIComponent(target.userId)}/licenses/${encodeURIComponent(target.expiryLicenseId)}/expire`;
  const anonymousExpire = await request(expirePath, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: target.userId, licenseId: target.expiryLicenseId, reason: "synthetic staging verification" }),
  });
  assertStatus(anonymousExpire, 401, "anonymous admin license expiry");

  const expired = await request(expirePath, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ userId: target.userId, licenseId: target.expiryLicenseId, reason: "synthetic staging verification" }),
  });
  assertStatus(expired, 200, "MFA-protected synthetic immediate license expiry");
  const expiredBody = await expired.json();
  assert.equal(expiredBody.success, true);
  assert.equal(expiredBody.licenseId, target.expiryLicenseId);
  assert.equal(expiredBody.alreadyExpired, false);
  assert.ok(Number.isFinite(Date.parse(expiredBody.updatedAt)), "expiry response did not contain a valid timestamp");
  const eventKey = `admin_expired_${target.expiryLicenseId}_${new Date(expiredBody.updatedAt).getTime()}`;
  const [expiredLicense, configCounts, expiryAudit, expiryEvent] = await Promise.all([
    queryBusiness(`SELECT status, license_end, grace_expires_at, excluded_at FROM fanmark_licenses WHERE id = ${sqlLiteral(target.expiryLicenseId)}`),
    queryBusiness(`SELECT
      (SELECT COUNT(*) FROM fanmark_basic_configs WHERE license_id = ${sqlLiteral(target.expiryLicenseId)}) AS basic,
      (SELECT COUNT(*) FROM fanmark_redirect_configs WHERE license_id = ${sqlLiteral(target.expiryLicenseId)}) AS redirect,
      (SELECT COUNT(*) FROM fanmark_messageboard_configs WHERE license_id = ${sqlLiteral(target.expiryLicenseId)}) AS messageboard,
      (SELECT COUNT(*) FROM fanmark_password_configs WHERE license_id = ${sqlLiteral(target.expiryLicenseId)}) AS password`),
    queryBusiness(`SELECT user_id, action, metadata FROM audit_logs WHERE action = 'license_expired' AND resource_id = ${sqlLiteral(target.expiryLicenseId)}`),
    queryBusiness(`SELECT event_type, source, payload_schema, status, payload FROM notification_events WHERE dedupe_key = ${sqlLiteral(eventKey)}`),
  ]);
  assert.deepEqual(expiredLicense, [{
    status: "expired", license_end: expiredBody.updatedAt,
    grace_expires_at: expiredBody.updatedAt, excluded_at: expiredBody.updatedAt,
  }]);
  assert.deepEqual(configCounts, [{ basic: 0, redirect: 0, messageboard: 0, password: 0 }]);
  assert.equal(expiryAudit.length, 1);
  assert.equal(expiryAudit[0].user_id, target.userId);
  assert.equal(expiryAudit[0].action, "license_expired");
  assert.equal(JSON.parse(expiryAudit[0].metadata).admin_user_id, target.adminUserId);
  assert.equal(expiryEvent.length, 1, "license expiry notification event was not queued exactly once");
  assert.equal(expiryEvent[0].event_type, "license_expired");
  assert.equal(expiryEvent[0].source, "admin_ui");
  assert.equal(expiryEvent[0].payload_schema, "license_expired.v1");
  assert.ok(["pending", "processing", "processed"].includes(expiryEvent[0].status));
  assert.deepEqual(JSON.parse(expiryEvent[0].payload), {
    user_id: target.userId, fanmark_id: target.expiryFanmarkId, fanmark_name: target.expiryFanmark,
    expired_at: expiredBody.updatedAt, license_end: "2999-12-31T23:59:59.000Z",
  });
  const repeated = await request(expirePath, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ userId: target.userId, licenseId: target.expiryLicenseId }),
  });
  assertStatus(repeated, 200, "repeat immediate license expiry");
  assert.equal((await repeated.json()).alreadyExpired, true);
  const [eventCount, expiryAuditCount] = await Promise.all([
    queryBusiness(`SELECT COUNT(*) AS count FROM notification_events WHERE dedupe_key = ${sqlLiteral(eventKey)}`),
    queryBusiness(`SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'license_expired' AND resource_id = ${sqlLiteral(target.expiryLicenseId)}`),
  ]);
  assert.equal(Number(eventCount[0]?.count), 1, "repeat expiry duplicated notification event");
  assert.equal(Number(expiryAuditCount[0]?.count), 1, "repeat expiry duplicated lifecycle audit");
}

async function exerciseAvailabilityRulesAdmin(cookie) {
  const route = "/api/admin/availability-rules";
  const initialRows = await queryBusiness(`SELECT id, rule_type, priority, is_available, rule_config
    FROM fanmark_availability_rules ORDER BY priority ASC, id ASC`);
  assert.equal(initialRows.length, 4, "expected the four non-user availability rules in staging D1");
  assert.ok(initialRows.every((row) => Number(row.is_available) === 0), "availability rules must start disabled in the source snapshot");

  const anonymous = await request(route);
  assertStatus(anonymous, 401, "unauthenticated availability rule admin read");
  const response = await request(route, { headers: { cookie } });
  assertStatus(response, 200, "MFA-protected availability rule list");
  const body = await response.json();
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.rules.length, 4);
  assert.ok(body.rules.every((rule) => !Object.hasOwn(rule, "created_by") && !Object.hasOwn(rule, "user_id")));
  const target = body.rules.find((rule) => rule.rule_type === "specific_pattern");
  assert.ok(target, "specific-pattern rule is missing from staging");
  assert.equal(target.is_available, false);

  let changed = null;
  let restored = false;
  try {
    const update = await request(`${route}/${encodeURIComponent(target.id)}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ isAvailable: true, expectedUpdatedAt: target.updated_at }),
    });
    assertStatus(update, 200, "MFA-protected availability rule edit");
    changed = (await update.json()).rule;
    assert.equal(changed.is_available, true);
    assert.equal(changed.id, target.id);

    const stale = await request(`${route}/${encodeURIComponent(target.id)}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ isAvailable: false, expectedUpdatedAt: target.updated_at }),
    });
    assertStatus(stale, 409, "stale availability rule edit guard");
    assert.equal((await stale.json()).error, "availability_rule_conflict");

    const restore = await request(`${route}/${encodeURIComponent(target.id)}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ isAvailable: false, expectedUpdatedAt: changed.updated_at }),
    });
    assertStatus(restore, 200, "availability rule restoration");
    restored = true;
    assert.equal((await restore.json()).rule.is_available, false);
  } finally {
    if (changed && !restored) {
      const current = await request(route, { headers: { cookie } });
      assertStatus(current, 200, "availability rule cleanup read");
      const row = (await current.json()).rules.find((item) => item.id === target.id);
      if (row?.is_available === true) {
        const cleanup = await request(`${route}/${encodeURIComponent(target.id)}`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ isAvailable: false, expectedUpdatedAt: row.updated_at }),
        });
        assertStatus(cleanup, 200, "availability rule cleanup restore");
      }
    }
  }

  const finalRows = await queryBusiness(`SELECT id, is_available, created_by FROM fanmark_availability_rules ORDER BY priority ASC, id ASC`);
  assert.equal(finalRows.length, 4);
  assert.ok(finalRows.every((row) => Number(row.is_available) === 0), "availability rule state was not restored");
  assert.ok(finalRows.every((row) => row.created_by === null), "source administrator IDs must not be copied into D1");
}

async function exerciseInvitationAdmin(cookie) {
  const route = "/api/admin/invitation-codes";
  const baseline = await queryBusiness("SELECT COUNT(*) AS count FROM invitation_codes");
  assert.equal(Number(baseline[0]?.count), 0, "staging invitation table must be empty before the synthetic round-trip");
  const anonymous = await request(route);
  assertStatus(anonymous, 401, "unauthenticated invitation admin read");

  const code = `MIGRATION-SMOKE-${randomBytes(6).toString("hex").toUpperCase()}`;
  let invitationId = null;
  try {
    const createdResponse = await request(route, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        code,
        max_uses: 2,
        expires_at: null,
        special_perks: { migration_smoke: true },
      }),
    });
    assertStatus(createdResponse, 201, "MFA-protected invitation creation");
    const createdBody = await createdResponse.json();
    assert.equal(createdBody.schemaVersion, 1);
    const created = createdBody.code;
    invitationId = created?.id;
    assert.equal(created?.code, code);
    assert.equal(created?.max_uses, 2);
    assert.equal(created?.used_count, 0);
    assert.equal(created?.is_active, true);
    assert.deepEqual(created?.special_perks, { migration_smoke: true });
    assert.equal(Object.hasOwn(created ?? {}, "created_by"), false);

    const listResponse = await request(route, { headers: { cookie } });
    assertStatus(listResponse, 200, "MFA-protected invitation list");
    const listed = await listResponse.json();
    const listedCode = listed.codes.find((candidate) => candidate.id === invitationId);
    assert.deepEqual(listedCode, created);

    const updateResponse = await request(`${route}/${encodeURIComponent(invitationId)}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        max_uses: 3,
        special_perks: { migration_smoke: true, updated: true },
        expectedUpdatedAt: created.updated_at,
      }),
    });
    assertStatus(updateResponse, 200, "invitation compare-and-set edit");
    const updatedBody = await updateResponse.json();
    const updated = updatedBody.code;
    assert.equal(updated.max_uses, 3);
    assert.deepEqual(updated.special_perks, { migration_smoke: true, updated: true });

    const staleResponse = await request(`${route}/${encodeURIComponent(invitationId)}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ max_uses: 4, expectedUpdatedAt: created.updated_at }),
    });
    assertStatus(staleResponse, 409, "stale invitation edit guard");
    assert.equal((await staleResponse.json()).error, "stale_revision");

    const disableResponse = await request(`${route}/${encodeURIComponent(invitationId)}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ is_active: false, expectedUpdatedAt: updated.updated_at }),
    });
    assertStatus(disableResponse, 200, "invitation disable");
    const disabled = (await disableResponse.json()).code;
    assert.equal(disabled.is_active, false);
    assert.equal(disabled.max_uses, 3);

    const deleteResponse = await request(`${route}/${encodeURIComponent(invitationId)}`, {
      method: "DELETE",
      headers: { cookie },
    });
    assertStatus(deleteResponse, 200, "synthetic invitation deletion");
    assert.deepEqual(await deleteResponse.json(), { schemaVersion: 1, deleted: true });
    invitationId = null;
  } finally {
    if (!invitationId) {
      const orphaned = await queryBusiness(`SELECT id FROM invitation_codes WHERE code = ${sqlLiteral(code)} LIMIT 2`);
      assert.ok(orphaned.length <= 1, "synthetic invitation code was duplicated");
      invitationId = orphaned[0]?.id ?? null;
    }
    if (invitationId) {
      const cleanup = await request(`${route}/${encodeURIComponent(invitationId)}`, {
        method: "DELETE",
        headers: { cookie },
      });
      if (![200, 404].includes(cleanup.status)) {
        const cleanupSql = `DELETE FROM invitation_codes WHERE id = ${sqlLiteral(invitationId)} AND code = ${sqlLiteral(code)}`;
        const output = await runWrangler([
          "d1", "execute", expectedBusinessDatabase, "--remote", "--command", cleanupSql, "--yes", "--json",
        ]);
        const results = parseWranglerJson(output);
        assert.ok(Array.isArray(results) && results.every((result) => result.success === true), "synthetic invitation cleanup failed");
      }
    }
  }

  const [remainingByCode, remainingTotal] = await Promise.all([
    queryBusiness(`SELECT COUNT(*) AS count FROM invitation_codes WHERE code = ${sqlLiteral(code)}`),
    queryBusiness("SELECT COUNT(*) AS count FROM invitation_codes"),
  ]);
  assert.equal(Number(remainingByCode[0]?.count), 0, "synthetic invitation remained in business D1");
  assert.equal(Number(remainingTotal[0]?.count), 0, "invitation table did not return to its staging baseline");
}

function assertStatus(response, status, operation) {
  assert.equal(response.status, status, `${operation} returned HTTP ${response.status}; expected ${status}`);
}

async function main() {
  const actions = requireExplicitStagingConsent();
  await assertStagingTarget();
  await readUserOwnedCounts();
  console.log("Staging target and empty Auth tables verified; provisioning one synthetic identity.");

  const userId = randomUUID();
  const targetUserId = randomUUID();
  const targetEmail = `codex-admin-target-${targetUserId}@example.invalid`;
  const targetUsername = `codex-${targetUserId.slice(0, 8)}`;
  const expiryLicenseId = randomUUID();
  const expiryFanmarkId = randomUUID();
  const expiryFanmark = `synthetic-${randomBytes(8).toString("hex")}`;
  const expiryShortId = `c${randomBytes(12).toString("hex")}`;
  const accountId = randomUUID();
  const email = `codex-totp-${userId}@example.invalid`;
  const password = `Synthetic-${randomBytes(32).toString("base64url")}!`;
  const passwordHash = await bcrypt.hash(password, 10);
  const timestamp = new Date().toISOString();
  let seedAttempted = false;
  let flowPassed = false;
  let cleanupError = null;
  let cookie = "";
  const systemSettingState = { key: "", originalValue: null, temporaryValue: null };

  try {
    seedAttempted = true;
    await executeFile(
      `INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES (${sqlLiteral(userId)}, 'Synthetic staging MFA', ${sqlLiteral(email)}, 1, ${sqlLiteral(timestamp)}, ${sqlLiteral(timestamp)});\n` +
      `INSERT INTO "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt") VALUES (${sqlLiteral(accountId)}, ${sqlLiteral(userId)}, 'credential', ${sqlLiteral(userId)}, ${sqlLiteral(passwordHash)}, ${sqlLiteral(timestamp)}, ${sqlLiteral(timestamp)});\n` +
      `INSERT INTO "adminRole" ("userId", "role") VALUES (${sqlLiteral(userId)}, 'admin');\n` +
      `INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES (${sqlLiteral(targetUserId)}, 'Synthetic admin target', ${sqlLiteral(targetEmail)}, 1, ${sqlLiteral(timestamp)}, ${sqlLiteral(timestamp)});\n`,
      "synthetic identity provision",
    );
    await executeBusiness(`INSERT INTO user_settings (user_id, username, display_name, avatar_url, plan_type, preferred_language, created_at, updated_at)
      VALUES (${sqlLiteral(targetUserId)}, ${sqlLiteral(targetUsername)}, ${sqlLiteral(targetEmail)}, NULL, 'free', 'ja', ${sqlLiteral(timestamp)}, ${sqlLiteral(timestamp)});`,
    "synthetic admin target profile provision");
    console.log("Synthetic account provisioned; exercising the deployed sign-in and TOTP routes.");

    const signIn = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assertStatus(signIn, 200, "staging sign-in");
    cookie = sessionCookie(signIn);
    assert.ok(cookie, "sign-in did not issue the expected session cookie");

    const enrollmentRequired = await request("/api/admin/session", {
      headers: { cookie },
    });
    assertStatus(enrollmentRequired, 403, "admin MFA enrollment gate");
    assert.equal((await enrollmentRequired.json()).error, "mfa_enrollment_required");

    const enrollment = await request("/api/auth/two-factor/enable", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ method: "totp", password }),
    });
    assertStatus(enrollment, 200, "TOTP enrollment");
    const enrollmentBody = await enrollment.json();
    assert.equal(enrollmentBody.method, "totp");
    assert.ok(Array.isArray(enrollmentBody.backupCodes));
    const secret = new URL(enrollmentBody.totpURI).searchParams.get("secret");
    assert.ok(secret, "TOTP enrollment did not return a secret");

    const verification = await request("/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ code: await createTotpCode(secret) }),
    });
    assertStatus(verification, 200, "TOTP verification");
    const verificationBody = await verification.json();
    assert.equal(verificationBody.user?.id, userId);
    assert.equal(typeof verificationBody.token, "string");
    cookie = sessionCookie(verification);
    assert.ok(cookie, "TOTP verification did not rotate the Better Auth session cookie");

    const sessionResponse = await request("/api/auth/get-session", { headers: { cookie } });
    assertStatus(sessionResponse, 200, "refreshed Better Auth session");
    const sessionBody = await sessionResponse.json();
    assert.equal(sessionBody.user?.id, userId);
    assert.equal(typeof sessionBody.session?.id, "string");

    const adminResponse = await request("/api/admin/session", { headers: { cookie } });
    assertStatus(adminResponse, 200, "MFA-protected admin session");
    assert.deepEqual(await adminResponse.json(), { authorized: true });
    const assuranceRows = await query(
      `SELECT count(*) AS "count" FROM "mfaAssurance" WHERE "userId" = ${sqlLiteral(userId)} AND "sessionId" = ${sqlLiteral(sessionBody.session.id)}`,
    );
    assert.equal(Number(assuranceRows[0]?.count), 1, "MFA assurance was not persisted for this session");
    if (actions.emojiMasterRoundtrip) {
      await exerciseEmojiMasterDraft(cookie);
      await exerciseNotificationMasters(cookie);
      await exerciseAuthEmailTemplatesAdmin(cookie);
      await exerciseAvailabilityRulesAdmin(cookie);
      await exerciseInvitationAdmin(cookie);
    }
    if (actions.referenceMasterPricingReadback) {
      await exerciseReferenceMasterPricingReadback(cookie);
    }
    if (actions.adminUserManagementReadback) {
      await exerciseAdminUserManagementReadback(cookie, {
        userId: targetUserId,
        email: targetEmail,
        username: targetUsername,
      });
    }
    if (actions.adminUserPlanReadback) {
      await exerciseAdminUserPlanReadback(cookie, { userId: targetUserId, adminUserId: userId });
    }
    if (actions.adminUserStatusReadback) {
      await exerciseAdminUserStatusReadback(cookie, {
        userId: targetUserId, email: targetEmail, adminUserId: userId,
        expiryLicenseId, expiryFanmarkId, expiryFanmark, expiryShortId,
      });
    }
    if (actions.systemSettingsReadback) {
      await exerciseSystemSettingsReadback(cookie, userId, systemSettingState);
    }
    flowPassed = true;
    console.log("Staging TOTP verification and same-session admin authorization passed.");
  } finally {
    if (seedAttempted) {
      try {
        if (actions.systemSettingsReadback) await restoreSystemSetting(cookie, systemSettingState);
        await executeFile(
          `DELETE FROM "mfaAssurance" WHERE "userId" = ${sqlLiteral(userId)};\n` +
          `DELETE FROM "adminRole" WHERE "userId" = ${sqlLiteral(userId)};\n` +
          `DELETE FROM "twoFactor" WHERE "userId" = ${sqlLiteral(userId)};\n` +
          `DELETE FROM "session" WHERE "userId" = ${sqlLiteral(userId)};\n` +
          `DELETE FROM "verification" WHERE "identifier" = ${sqlLiteral(email)};\n` +
          `DELETE FROM "account" WHERE "userId" = ${sqlLiteral(userId)};\n` +
          `DELETE FROM "user" WHERE "id" = ${sqlLiteral(userId)};`,
          "synthetic identity cleanup",
        );
        if (actions.adminUserManagementReadback || actions.adminUserPlanReadback || actions.adminUserStatusReadback || actions.systemSettingsReadback) {
          if (actions.adminUserStatusReadback) {
            await executeBusiness(
              `DELETE FROM notifications WHERE user_id = ${sqlLiteral(targetUserId)};\n` +
              `DELETE FROM notification_events WHERE event_type = 'license_expired' AND json_extract(payload, '$.fanmark_id') = ${sqlLiteral(expiryFanmarkId)};\n` +
              `DELETE FROM audit_logs WHERE resource_id = ${sqlLiteral(expiryLicenseId)} AND action IN ('license_expired', 'admin_expire_license');\n` +
              `DELETE FROM fanmark_basic_configs WHERE license_id = ${sqlLiteral(expiryLicenseId)};\n` +
              `DELETE FROM fanmark_redirect_configs WHERE license_id = ${sqlLiteral(expiryLicenseId)};\n` +
              `DELETE FROM fanmark_messageboard_configs WHERE license_id = ${sqlLiteral(expiryLicenseId)};\n` +
              `DELETE FROM fanmark_password_configs WHERE license_id = ${sqlLiteral(expiryLicenseId)};\n` +
              `DELETE FROM fanmark_licenses WHERE id = ${sqlLiteral(expiryLicenseId)} AND user_id = ${sqlLiteral(targetUserId)};\n` +
              `DELETE FROM fanmarks WHERE id = ${sqlLiteral(expiryFanmarkId)};`,
              "synthetic immediate-expiry cleanup",
            );
          }
          await executeBusiness(
            `DELETE FROM enterprise_user_settings WHERE user_id = ${sqlLiteral(targetUserId)};\n` +
            `DELETE FROM audit_logs WHERE (user_id = ${sqlLiteral(userId)} AND action IN ('ADMIN_LIST_USERS', 'ADMIN_VIEW_USER_DETAIL', 'ADMIN_UPDATE_PLAN', 'admin_expire_license') AND (resource_id IS NULL OR resource_id IN (${sqlLiteral(targetUserId)}, ${sqlLiteral(expiryLicenseId)}))) OR (resource_id = ${sqlLiteral(expiryLicenseId)} AND action = 'license_expired');\n` +
            (actions.systemSettingsReadback ? `DELETE FROM audit_logs WHERE user_id = ${sqlLiteral(userId)} AND action = 'ADMIN_UPDATE_SYSTEM_SETTING' AND resource_type = 'system_setting' AND resource_id = ${sqlLiteral(systemSettingState.key)};\n` : "") +
            `DELETE FROM user_settings WHERE user_id = ${sqlLiteral(targetUserId)};`,
            "synthetic admin user-management cleanup",
          );
          await executeFile(
            `DELETE FROM "adminUserStatusAudit" WHERE "actorUserId" = ${sqlLiteral(userId)} OR "targetUserId" = ${sqlLiteral(targetUserId)};\n` +
            `DELETE FROM "user" WHERE "id" = ${sqlLiteral(targetUserId)} AND "email" = ${sqlLiteral(targetEmail)};`,
            "synthetic admin target Auth cleanup",
          );
          const [profileRows, auditRows, authRows, statusAuditRows, settingsAuditRows] = await Promise.all([
            queryBusiness(`SELECT COUNT(*) AS count FROM user_settings WHERE user_id = ${sqlLiteral(targetUserId)}`),
            queryBusiness(`SELECT COUNT(*) AS count FROM audit_logs WHERE (user_id = ${sqlLiteral(userId)} AND action IN ('ADMIN_LIST_USERS', 'ADMIN_VIEW_USER_DETAIL', 'ADMIN_UPDATE_PLAN', 'admin_expire_license') AND (resource_id IS NULL OR resource_id IN (${sqlLiteral(targetUserId)}, ${sqlLiteral(expiryLicenseId)}))) OR (resource_id = ${sqlLiteral(expiryLicenseId)} AND action = 'license_expired')`),
            query(`SELECT COUNT(*) AS count FROM "user" WHERE id = ${sqlLiteral(targetUserId)} AND email = ${sqlLiteral(targetEmail)}`),
            query(`SELECT COUNT(*) AS count FROM "adminUserStatusAudit" WHERE "actorUserId" = ${sqlLiteral(userId)} OR "targetUserId" = ${sqlLiteral(targetUserId)}`),
            queryBusiness(actions.systemSettingsReadback
              ? `SELECT COUNT(*) AS count FROM audit_logs WHERE user_id = ${sqlLiteral(userId)} AND action = 'ADMIN_UPDATE_SYSTEM_SETTING' AND resource_type = 'system_setting' AND resource_id = ${sqlLiteral(systemSettingState.key)}`
              : "SELECT 0 AS count"),
          ]);
          assert.equal(Number(profileRows[0]?.count), 0, "synthetic target profile remained in business D1");
          assert.equal(Number(auditRows[0]?.count), 0, "synthetic admin audit rows remained in business D1");
          assert.equal(Number(authRows[0]?.count), 0, "synthetic target identity remained in Auth D1");
          assert.equal(Number(statusAuditRows[0]?.count), 0, "synthetic user status audit remained in Auth D1");
          assert.equal(Number(settingsAuditRows[0]?.count), 0, "synthetic system setting audit rows remained in business D1");
        }
        await readUserOwnedCounts();
        if (cookie) {
          const invalidatedSession = await request("/api/auth/get-session", { headers: { cookie } });
          assertStatus(invalidatedSession, 200, "deleted synthetic session readback");
          assert.equal(await invalidatedSession.json(), null);
        }
      } catch {
        cleanupError = new Error(`cleanup/readback failed for synthetic user ${userId}`);
      }
    }
  }

  if (cleanupError) throw cleanupError;
  assert.ok(flowPassed, "the staging TOTP flow did not complete");
  console.log("Staging Better Auth sign-in, first-time TOTP enrollment, session rotation, and admin MFA authorization passed.");
  if (actions.emojiMasterRoundtrip) {
    console.log("Staging MFA-protected invitation-code create/list/CAS-edit/disable/delete round-trip passed and returned business D1 to zero invitation rows.");
    console.log("Staging MFA-protected availability-rule list/CAS-edit/stale-write rejection/restore passed; all four rules remain disabled and created_by stays NULL.");
    console.log("Staging MFA-protected notification rules/templates and payload-redacted event/delivery log reads passed without changing notification rows.");
    console.log("Staging MFA-protected auth email-template list returned all 16 type/locale pairs; anonymous access was denied without changing D1 rows.");
  }
  if (actions.referenceMasterPricingReadback) {
    console.log("Staging MFA-protected reference-master pricing read matched the active D1 release; anonymous access was denied and both reads left the release pointer unchanged.");
  }
  if (actions.adminUserManagementReadback) {
    console.log("Staging MFA-protected admin user list/detail read the synthetic cross-D1 user; anonymous access was denied and cleanup returned Auth, profile, and audit canary rows to zero.");
  }
  if (actions.adminUserPlanReadback) {
    console.log("Staging MFA-protected plan mutation changed a synthetic profile to Enterprise, verified exact override D1 fields, changed it to Max and back to Free, then cleaned its audit and D1 rows.");
  }
  if (actions.adminUserStatusReadback) {
    console.log("Staging MFA-protected suspension/restoration and immediate license expiry passed. Session revocation, license/config changes, lifecycle/admin audits, notification event, repeat safety, and cleanup were verified.");
  }
  if (actions.systemSettingsReadback) {
    console.log("Staging MFA-protected system settings read/update passed. The API exposed the exact admin projection, rejected anonymous access and a stale write, restored the original value, and cleaned the synthetic audit rows.");
  }
  console.log("Synthetic Auth rows were deleted; readback found all user-owned Auth tables empty.");
  console.log("The monotonic MFA generation counter was preserved and may have advanced during the synthetic factor lifecycle.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "staging Auth smoke failed");
  process.exitCode = 1;
});
