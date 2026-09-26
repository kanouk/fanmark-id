#!/usr/bin/env node

/** Verify the Better Auth profile and both R2 image buckets on isolated workers.dev staging. */

import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";
import {
  businessTablesWithoutStagingBaselines,
  NOTIFICATION_MASTER_COUNTS_SQL,
  notificationMasterBaselineState,
  STAGING_NON_USER_CONFIG_BASELINE_SQL,
  stagingNonUserConfigBaselineState,
} from "./staging-notification-master-baseline.mjs";

const require = createRequire(new URL("../../workers/api/package.json", import.meta.url));
const bcrypt = require("bcryptjs");

const ACCOUNT_ID = "bfc2890741f0b3fb236e2d755b6c9adc";
const ACCOUNT_EMAIL = "fanmark.id@gmail.com";
const WORKER = "fanmark-app-staging";
const APP_ORIGIN = "https://fanmark-app-staging.fanmark-id.workers.dev";
const BUSINESS_DATABASE = "fanmark-business-staging";
const BUSINESS_DATABASE_ID = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const AUTH_DATABASE = "fanmark-auth-staging";
const AUTH_DATABASE_ID = "2116bc43-32ab-4e3e-b762-9378df88b95f";
const AVATAR_BUCKET = "fanmark-avatars-staging";
const COVER_BUCKET = "fanmark-cover-images-staging";
const WRANGLER_VERSION = "4.140.0";
const APP_CONFIG = "workers/api/wrangler.app-staging.jsonc";
const AUTH_CONFIG = "workers/api/wrangler.auth-staging.jsonc";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function runWrangler(args) {
  const result = spawnSync("npx", ["--yes", `wrangler@${WRANGLER_VERSION}`, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) fail("wrangler_failed");
  return result;
}

function runJson(args) {
  try {
    return JSON.parse(runWrangler(args).stdout.trim());
  } catch (error) {
    if (error?.code) throw error;
    fail("wrangler_json_invalid");
  }
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function d1Rows(result) {
  const rows = result[0]?.results;
  if (!Array.isArray(rows)) fail("staging_d1_readback_failed");
  return rows;
}

function runD1(config, database, sql) {
  const result = runJson([
    "d1", "execute", database, "--remote", "--json", "--command", sql, "--config", config,
  ]);
  if (!Array.isArray(result) || result.some((entry) => entry?.success !== true)) {
    fail("staging_d1_command_failed");
  }
  return result;
}

function assertTarget() {
  const config = JSON.parse(readFileSync(APP_CONFIG, "utf8"));
  if (config.name !== WORKER || config.workers_dev !== true || config.routes?.length ||
      config.vars?.D1_TOPOLOGY !== "split" || config.vars?.AUTH_BACKEND !== "better-auth" ||
      config.vars?.PROFILE_BACKEND !== "d1" || config.vars?.STORAGE_BACKEND !== "r2") {
    fail("staging_worker_target_mismatch");
  }
  const business = config.d1_databases?.find((entry) => entry.binding === "FANMARK_DB");
  const auth = config.d1_databases?.find((entry) => entry.binding === "AUTH_DB");
  const avatar = config.r2_buckets?.find((entry) => entry.binding === "AVATARS_BUCKET");
  const cover = config.r2_buckets?.find((entry) => entry.binding === "COVER_IMAGES_BUCKET");
  if (business?.database_id !== BUSINESS_DATABASE_ID || business.database_name !== BUSINESS_DATABASE ||
      auth?.database_id !== AUTH_DATABASE_ID || auth.database_name !== AUTH_DATABASE ||
      avatar?.bucket_name !== AVATAR_BUCKET || cover?.bucket_name !== COVER_BUCKET) fail("staging_binding_mismatch");

  const identity = runJson(["whoami", "--json"]);
  if (!identity.loggedIn || identity.email !== ACCOUNT_EMAIL ||
      !identity.accounts?.some((account) => account.id === ACCOUNT_ID)) fail("cloudflare_account_mismatch");
  const databases = runJson(["d1", "list", "--json"]);
  for (const [id, name] of [[BUSINESS_DATABASE_ID, BUSINESS_DATABASE], [AUTH_DATABASE_ID, AUTH_DATABASE]]) {
    if (!databases.some((databaseEntry) =>
      (databaseEntry.uuid ?? databaseEntry.database_id ?? databaseEntry.id) === id &&
      (databaseEntry.name ?? databaseEntry.database_name) === name)) fail("cloudflare_database_mismatch");
  }
  const buckets = runWrangler(["r2", "bucket", "list"]).stdout;
  if (!buckets.includes(AVATAR_BUCKET) || !buckets.includes(COVER_BUCKET)) fail("cloudflare_image_bucket_missing");

  const migration = readFileSync("workers/api/migrations-business/0000_business_schema_v4_staging.sql", "utf8");
  const sourceTables = [...migration.matchAll(/^CREATE TABLE "([A-Za-z_][A-Za-z0-9_]*)"/gmu)]
    .map((match) => match[1]);
  if (sourceTables.length !== 40) fail("business_table_inventory_mismatch");
  const masters = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, NOTIFICATION_MASTER_COUNTS_SQL))[0];
  const settings = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, STAGING_NON_USER_CONFIG_BASELINE_SQL))[0];
  if (notificationMasterBaselineState(masters) === "invalid") fail("notification_master_baseline_mismatch");
  if (stagingNonUserConfigBaselineState(settings) === "invalid") fail("system_setting_baseline_mismatch");
  const businessDataTables = businessTablesWithoutStagingBaselines(sourceTables);
  const rowTotalSql = `SELECT ${businessDataTables.map((name) => `(SELECT COUNT(*) FROM "${name}")`).join(" + ")} AS total_rows`;
  if (Number(d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, rowTotalSql))[0]?.total_rows) !== 0) {
    fail("business_staging_has_source_rows");
  }
}

async function request(path, init = {}) {
  return fetch(`${APP_ORIGIN}${path}`, {
    ...init,
    headers: { Origin: APP_ORIGIN, ...(init.headers ?? {}) },
  });
}

function responseCookie(response) {
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  const pair = cookies.map((cookie) => cookie.split(";", 1)[0])
    .find((cookie) => /session_token=/u.test(cookie));
  if (!pair) fail("response_cookie_missing");
  return pair;
}

function assertStatus(response, status, code) {
  if (response.status !== status) fail(`${code}_${response.status}`);
}

async function cleanup({ userId, email, cookie, objectPath, publicUrl, coverObjectPath, coverPublicUrl }) {
  const cleanupErrors = [];
  for (const [bucket, key] of [["avatars", objectPath], ["cover-images", coverObjectPath]]) {
    if (!key || !cookie) continue;
    try {
      const deleted = await request(`/api/storage/object/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`, {
        method: "DELETE",
        headers: { cookie },
      });
      if (deleted.status !== 204 && deleted.status !== 404) cleanupErrors.push(`${bucket.replaceAll("-", "_")}_owner_delete_failed`);
    } catch {
      cleanupErrors.push(`${bucket.replaceAll("-", "_")}_owner_delete_failed`);
    }
  }
  for (const [bucketName, key, errorCode] of [
    [AVATAR_BUCKET, objectPath, "avatars_owner_delete_failed"],
    [COVER_BUCKET, coverObjectPath, "cover_images_owner_delete_failed"],
  ]) {
    if (!key || !cleanupErrors.includes(errorCode)) continue;
    try {
      runWrangler(["r2", "object", "delete", `${bucketName}/${key}`, "--remote", "--config", APP_CONFIG, "--force"]);
      cleanupErrors.splice(cleanupErrors.indexOf(errorCode), 1);
    } catch {
      // The exact synthetic key is retained in the final failure code only.
    }
  }

  runD1(APP_CONFIG, BUSINESS_DATABASE, `DELETE FROM user_settings WHERE user_id = ${sqlLiteral(userId)};`);
  runD1(AUTH_CONFIG, AUTH_DATABASE, `
    DELETE FROM session WHERE userId = ${sqlLiteral(userId)};
    DELETE FROM account WHERE userId = ${sqlLiteral(userId)};
    DELETE FROM "user" WHERE id = ${sqlLiteral(userId)} AND email = ${sqlLiteral(email)};
  `);

  const business = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
    SELECT
      (SELECT COUNT(*) FROM user_settings WHERE user_id = ${sqlLiteral(userId)}) AS profiles
  `))[0];
  const auth = d1Rows(runD1(AUTH_CONFIG, AUTH_DATABASE, `
    SELECT
      (SELECT COUNT(*) FROM "user" WHERE id = ${sqlLiteral(userId)}) AS users,
      (SELECT COUNT(*) FROM account WHERE userId = ${sqlLiteral(userId)}) AS accounts,
      (SELECT COUNT(*) FROM session WHERE userId = ${sqlLiteral(userId)}) AS sessions
  `))[0];
  if ([...Object.values(business), ...Object.values(auth)].some((count) => Number(count) !== 0)) {
    cleanupErrors.push("d1_canary_cleanup_failed");
  }
  for (const [bucket, url] of [["avatars", publicUrl], ["cover-images", coverPublicUrl]]) {
    if (!url) continue;
    try {
      const missing = await request(new URL(url).pathname);
      if (missing.status !== 404) cleanupErrors.push(`${bucket.replaceAll("-", "_")}_r2_cleanup_failed`);
    } catch {
      cleanupErrors.push(`${bucket.replaceAll("-", "_")}_r2_readback_failed`);
    }
  }
  if (cleanupErrors.length) fail(cleanupErrors.join("+"));
  return {
    business,
    auth,
    r2Objects: {
      avatars: publicUrl ? "404 after cleanup" : "no object created",
      coverImages: coverPublicUrl ? "404 after cleanup" : "no object created",
    },
  };
}

async function main() {
  assertTarget();
  const userId = randomUUID();
  const profileId = randomUUID();
  const nonce = randomBytes(10).toString("hex");
  const email = `codex-r2-profile-${nonce}@example.invalid`;
  const username = `codexr2${nonce}`;
  const password = `Staging-${randomBytes(24).toString("base64url")}a9!`;
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date().toISOString();
  const pngBytes = Uint8Array.from(
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64"),
  );
  let cookie;
  let objectPath;
  let publicUrl;
  let coverObjectPath;
  let coverPublicUrl;
  let cleanupNeeded = false;

  try {
    cleanupNeeded = true;
    runD1(AUTH_CONFIG, AUTH_DATABASE, `
      INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (${sqlLiteral(userId)}, 'Synthetic R2 profile smoke', ${sqlLiteral(email)}, 1, ${sqlLiteral(now)}, ${sqlLiteral(now)});
      INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
      VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(userId)}, 'credential', ${sqlLiteral(userId)}, ${sqlLiteral(passwordHash)}, ${sqlLiteral(now)}, ${sqlLiteral(now)});
    `);
    runD1(APP_CONFIG, BUSINESS_DATABASE, `
      INSERT INTO user_settings (id, user_id, username, display_name, avatar_url, plan_type, preferred_language, created_at, updated_at, requires_password_setup)
      VALUES (${sqlLiteral(profileId)}, ${sqlLiteral(userId)}, ${sqlLiteral(username)}, 'Synthetic R2 profile', NULL, 'free', 'ja', ${sqlLiteral(now)}, ${sqlLiteral(now)}, 0);
    `);

    const signIn = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assertStatus(signIn, 200, "better_auth_sign_in_failed");
    cookie = responseCookie(signIn);

    const anonymousProfile = await request("/api/me/profile");
    assertStatus(anonymousProfile, 401, "profile_auth_guard_failed");
    const before = await request("/api/me/profile", { headers: { cookie } });
    assertStatus(before, 200, "profile_get_failed");
    const initial = await before.json();
    assert.equal(initial.profile.user_id, userId);
    assert.equal(initial.profile.avatar_url, null);

    const unauthenticatedUpload = await request("/api/storage/object/avatars", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: pngBytes,
    });
    assertStatus(unauthenticatedUpload, 401, "storage_auth_guard_failed");

    const uploaded = await request("/api/storage/object/avatars", {
      method: "POST",
      headers: { cookie, "content-type": "image/png" },
      body: pngBytes,
    });
    assertStatus(uploaded, 201, "r2_upload_failed");
    const uploadResult = await uploaded.json();
    objectPath = uploadResult.path;
    publicUrl = uploadResult.publicUrl;
    assert.match(objectPath, new RegExp(`^${userId}/[0-9a-f-]+\\.png$`, "iu"));
    assert.equal(new URL(publicUrl).origin, APP_ORIGIN);

    const publicRead = await request(new URL(publicUrl).pathname);
    assertStatus(publicRead, 200, "r2_public_read_failed");
    assert.equal(publicRead.headers.get("x-content-type-options"), "nosniff");
    const readBytes = new Uint8Array(await publicRead.arrayBuffer());
    assert.deepEqual(readBytes, pngBytes);
    const contentSHA256 = createHash("sha256").update(readBytes).digest("hex");

    const coverUploaded = await request("/api/storage/object/cover-images", {
      method: "POST",
      headers: { cookie, "content-type": "image/png" },
      body: pngBytes,
    });
    assertStatus(coverUploaded, 201, "r2_cover_upload_failed");
    const coverResult = await coverUploaded.json();
    coverObjectPath = coverResult.path;
    coverPublicUrl = coverResult.publicUrl;
    assert.match(coverObjectPath, new RegExp(`^${userId}/[0-9a-f-]+\\.png$`, "iu"));
    assert.equal(new URL(coverPublicUrl).origin, APP_ORIGIN);
    const coverPublicRead = await request(new URL(coverPublicUrl).pathname);
    assertStatus(coverPublicRead, 200, "r2_cover_public_read_failed");
    const coverReadBytes = new Uint8Array(await coverPublicRead.arrayBuffer());
    assert.deepEqual(coverReadBytes, pngBytes);
    const coverSHA256 = createHash("sha256").update(coverReadBytes).digest("hex");

    const saved = await request("/api/me/profile", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ avatar_url: publicUrl }),
    });
    assertStatus(saved, 200, "profile_avatar_save_failed");
    assert.equal((await saved.json()).profile.avatar_url, publicUrl);
    const profileReadback = await request("/api/me/profile", { headers: { cookie } });
    assertStatus(profileReadback, 200, "profile_avatar_readback_failed");
    assert.equal((await profileReadback.json()).profile.avatar_url, publicUrl);

    const otherOwnerUrl = `${APP_ORIGIN}/api/storage/public/avatars/${randomUUID()}/${objectPath.split("/")[1]}`;
    const deniedProfilePatch = await request("/api/me/profile", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ avatar_url: otherOwnerUrl }),
    });
    assertStatus(deniedProfilePatch, 400, "profile_other_owner_guard_failed");
    const ownerDelete = await request(`/api/storage/object/avatars/${objectPath.split("/").map(encodeURIComponent).join("/")}`, {
      method: "DELETE",
      headers: { cookie },
    });
    assertStatus(ownerDelete, 204, "profile_owner_delete_failed");
    objectPath = undefined;
    const coverOwnerDelete = await request(`/api/storage/object/cover-images/${coverObjectPath.split("/").map(encodeURIComponent).join("/")}`, {
      method: "DELETE",
      headers: { cookie },
    });
    assertStatus(coverOwnerDelete, 204, "cover_owner_delete_failed");
    coverObjectPath = undefined;

    const cleared = await request("/api/me/profile", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ avatar_url: null }),
    });
    assertStatus(cleared, 200, "profile_avatar_clear_failed");
    assert.equal((await cleared.json()).profile.avatar_url, null);
    const stored = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
      SELECT avatar_url FROM user_settings WHERE user_id = ${sqlLiteral(userId)}
    `));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].avatar_url, null);

    const cleaned = await cleanup({ userId, email, cookie, objectPath, publicUrl, coverObjectPath, coverPublicUrl });
    cleanupNeeded = false;
    return {
      worker: WORKER,
      profile: { anonymousStatus: 401, authenticatedRead: 200, avatarSave: 200, crossOwnerUrlStatus: 400, cleared: true },
      storage: {
        anonymousUploadStatus: 401,
        avatars: { ownerUpload: 201, publicRead: 200, ownerDelete: ownerDelete.status, sha256: contentSHA256 },
        coverImages: { ownerUpload: 201, publicRead: 200, ownerDelete: coverOwnerDelete.status, sha256: coverSHA256 },
      },
      cleanup: cleaned,
    };
  } finally {
    if (cleanupNeeded) {
      const cleaned = await cleanup({ userId, email, cookie, objectPath, publicUrl, coverObjectPath, coverPublicUrl });
      process.stdout.write(`${JSON.stringify({ cleanup: cleaned })}\n`);
    }
  }
}

main().then((result) => {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}).catch((error) => {
  process.stderr.write(`${error?.code ?? "staging_r2_profile_smoke_failed"}\n`);
  process.exitCode = 1;
});
