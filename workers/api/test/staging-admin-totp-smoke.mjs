#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, webcrypto } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import bcrypt from "bcryptjs";

const apiDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(apiDirectory, "node_modules", ".bin", "wrangler");
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
];

function requireExplicitStagingConsent() {
  const args = new Set(process.argv.slice(2));
  if (!args.has("--run-live-staging-write") || !args.has(`--database=${expectedDatabase}`) ||
      !args.has("--emoji-master-draft-roundtrip")) {
    throw new Error(
      `Refusing remote staging writes. Pass --run-live-staging-write --database=${expectedDatabase} --emoji-master-draft-roundtrip explicitly.`,
    );
  }
}

async function assertStagingTarget() {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.name, expectedWorker, "unexpected Worker config");
  assert.equal(config.workers_dev, true, "staging Worker must be workers.dev only");
  const binding = config.d1_databases?.find((database) => database.binding === "AUTH_DB");
  assert.equal(binding?.database_name, expectedDatabase, "unexpected Auth D1 name");
  assert.equal(binding?.database_id, expectedDatabaseId, "unexpected Auth D1 id");
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
  const masterBinding = config.d1_databases?.find((database) => database.binding === "MASTER_DB");
  assert.equal(masterBinding?.database_name, expectedMasterDatabase, "unexpected Master D1 name");
  assert.equal(masterBinding?.database_id, expectedMasterDatabaseId, "unexpected Master D1 id");
  assert.equal(masterBinding?.migrations_pattern, "migrations/000[0-6]_*.sql", "unexpected Master D1 migration set");
  assert.equal(config.vars?.EMOJI_MASTER_ADMIN_BACKEND, "d1", "expected D1-backed emoji-master admin API");
}

function runWrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(wrangler, [...args, "--config", configPath], {
      cwd: apiDirectory,
      env: process.env,
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
  assert.equal(response.status, status, `${operation} returned an unexpected HTTP status`);
}

async function main() {
  requireExplicitStagingConsent();
  await assertStagingTarget();
  await access(wrangler);
  await readUserOwnedCounts();
  console.log("Staging target and empty Auth tables verified; provisioning one synthetic identity.");

  const userId = randomUUID();
  const accountId = randomUUID();
  const email = `codex-totp-${userId}@example.invalid`;
  const password = `Synthetic-${randomBytes(32).toString("base64url")}!`;
  const passwordHash = await bcrypt.hash(password, 10);
  const timestamp = new Date().toISOString();
  let seedAttempted = false;
  let flowPassed = false;
  let cleanupError = null;
  let cookie = "";

  try {
    seedAttempted = true;
    await executeFile(
      `INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES (${sqlLiteral(userId)}, 'Synthetic staging MFA', ${sqlLiteral(email)}, 1, ${sqlLiteral(timestamp)}, ${sqlLiteral(timestamp)});\n` +
      `INSERT INTO "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt") VALUES (${sqlLiteral(accountId)}, ${sqlLiteral(userId)}, 'credential', ${sqlLiteral(userId)}, ${sqlLiteral(passwordHash)}, ${sqlLiteral(timestamp)}, ${sqlLiteral(timestamp)});\n` +
      `INSERT INTO "adminRole" ("userId", "role") VALUES (${sqlLiteral(userId)}, 'admin');\n`,
      "synthetic identity provision",
    );
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
    await exerciseEmojiMasterDraft(cookie);
    await exerciseNotificationMasters(cookie);
    await exerciseAuthEmailTemplatesAdmin(cookie);
    await exerciseAvailabilityRulesAdmin(cookie);
    await exerciseInvitationAdmin(cookie);
    flowPassed = true;
    console.log("Staging TOTP verification and same-session admin authorization passed.");
  } finally {
    if (seedAttempted) {
      try {
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
  console.log("Staging MFA-protected invitation-code create/list/CAS-edit/disable/delete round-trip passed and returned business D1 to zero invitation rows.");
  console.log("Staging MFA-protected availability-rule list/CAS-edit/stale-write rejection/restore passed; all four rules remain disabled and created_by stays NULL.");
  console.log("Staging MFA-protected notification rules/templates and payload-redacted event/delivery log reads passed without changing notification rows.");
  console.log("Staging MFA-protected auth email-template list returned all 16 type/locale pairs; anonymous access was denied without changing D1 rows.");
  console.log("Synthetic Auth rows were deleted; readback found all user-owned Auth tables empty.");
  console.log("The monotonic MFA generation counter was preserved and may have advanced during the synthetic factor lifecycle.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "staging Auth smoke failed");
  process.exitCode = 1;
});
