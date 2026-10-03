import { env } from "cloudflare:workers";
import bcrypt from "bcryptjs";
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import authSchema from "../migrations/0003_better_auth_core.sql?raw";
import authSignup from "../migrations/0007_auth_signup_command.sql?raw";
import authSuspension from "../migrations/0008_auth_user_suspension.sql?raw";
import authOAuthSignup from "../migrations/0009_auth_oauth_signup.sql?raw";
// @ts-expect-error Runtime-tested release helper has no declaration surface.
import { activateReferenceMasterRelease, stageReferenceMasterRelease } from "../../../scripts/migration/reference-master-release.mjs";
import { handleRequest } from "../src";
import type { Env } from "../src/repository";
import { checkedInSqlStatements } from "./schema-statements";

declare module "vitest" {
  export interface ProvidedContext {
    registrationBusinessMigrations: Array<{ name: string; sql: string }>;
    registrationMasterMigrations: Array<{ name: string; sql: string }>;
  }
}

// These databases are local to the Vitest worker. No source credentials/rows.
const runtime = env as unknown as Env;
const business = runtime.FANMARK_DB!;
const auth = runtime.AUTH_DB!;
const master = runtime.MASTER_DB!;
const ORIGIN = "https://app.example.test";
const API = "https://api.example.test";
const OWNER = "e62ce4d0-8055-4ecb-9e3a-759d70d659e0";
const OTHER = "2a1b9c5f-3c8a-4890-9e04-3768885b6dd8";
const PASSWORD = "Synthetic-Registration-Only!2026";
const CREATED = "2026-09-25T00:00:00.000000Z";
const EMOJI_VERSION = "a".repeat(64);
const REFERENCE_VERSION = "b".repeat(64);
const ROSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const THUMB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TONE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HEART = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const STAR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const emojiRows = [
  [ROSE, "🌹", '["1F339"]'], [THUMB, "👍", '["1F44D"]'],
  [TONE, "👍🏻", '["1F44D","1F3FB"]'], [HEART, "💗", '["1F497"]'],
  [STAR, "⭐", '["2B50"]'],
];

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", ORIGIN);
  return handleRequest(new Request(`${API}${path}`, { ...init, headers }), runtime);
}

async function signIn(userId = OWNER): Promise<string> {
  const response = await request("/api/auth/sign-in/email", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${userId}@example.invalid`, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Synthetic registration sign-in issued no cookie");
  return cookie;
}

async function register(cookie: string | undefined, display = "🌹", ids = [ROSE], extra = {}): Promise<Response> {
  return request("/api/fanmarks/register", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ user_input_fanmark: display, emoji_ids: ids, accessType: "profile", createProfile: true, ...extra }),
  });
}

async function apply(db: D1Database, sql: string): Promise<void> {
  await db.batch(checkedInSqlStatements(sql).map(statement => db.prepare(statement)));
}

async function adminCookie(): Promise<string> {
  await auth.prepare('INSERT INTO "adminRole" (userId, role) VALUES (?, \'admin\')').bind(OWNER).run();
  await business.prepare("UPDATE user_settings SET plan_type='admin' WHERE user_id=?").bind(OWNER).run();
  const cookie = await signIn();
  const enrollment = await request("/api/auth/two-factor/enable", {
    method: "POST", headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify({ method: "totp", password: PASSWORD }),
  });
  expect(enrollment.status).toBe(200);
  const body = await enrollment.json() as { totpURI: string };
  const secret = new URL(body.totpURI).searchParams.get("secret");
  if (!secret) throw new Error("Synthetic TOTP enrollment issued no secret");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let buffer = 0, bits = 0;
  for (const character of secret.toUpperCase().replace(/=+$/u, "")) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error("Invalid synthetic TOTP secret");
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 0xff); }
  }
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(Math.floor(Date.now() / 30_000)));
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(bytes), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = digest[digest.length - 1] & 0x0f;
  const value = new DataView(digest.buffer).getUint32(offset) & 0x7fffffff;
  const code = String(value % 1_000_000).padStart(6, "0");
  const verification = await request("/api/auth/two-factor/verify-totp", {
    method: "POST", headers: { Cookie: cookie, "content-type": "application/json" }, body: JSON.stringify({ code }),
  });
  expect(verification.status).toBe(200);
  const verifiedCookie = verification.headers.get("set-cookie")?.split(";")[0];
  if (!verifiedCookie) throw new Error("Synthetic TOTP verification issued no session cookie");
  return verifiedCookie;
}

beforeAll(async () => {
  if (!business || !auth || !master) throw new Error("Registration split D1 bindings unavailable");
  const businessMigrations = inject("registrationBusinessMigrations");
  const masterMigrations = inject("registrationMasterMigrations");
  expect(businessMigrations).toHaveLength(25);
  expect(masterMigrations).toHaveLength(8);
  for (const migration of businessMigrations) await apply(business, migration.sql);
  for (const sql of [authSchema, authSignup, authSuspension, authOAuthSignup]) await apply(auth, sql);
  for (const migration of masterMigrations) await apply(master, migration.sql);
  // Staging retains canonical identities separately from the active catalog.
  // Public emoji lookup normalizes against those stable canonical IDs.
  await master.batch(emojiRows.map(([id, emoji, codepoints], i) => master.prepare(`
    INSERT INTO emoji_master (id, emoji, short_name, codepoints, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, emoji, `synthetic-${i}`, codepoints, i)));
  // Use the real immutable ready-release tables and activation triggers.
  await master.batch([
    master.prepare(`INSERT INTO fanmark_emoji_master_release_imports
      (release_version, manifest_json, row_count, status) VALUES (?, '{}', ?, 'loading')`)
      .bind(EMOJI_VERSION, emojiRows.length),
    ...emojiRows.map(([id, emoji, codepoints], i) => master.prepare(`INSERT INTO fanmark_emoji_master_release_staging
      (release_version, ordinal, id, emoji, short_name, keywords_json, codepoints_json, sort_order)
      VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`).bind(EMOJI_VERSION, i + 1, id, emoji, `synthetic-${i}`, codepoints, i)),
    master.prepare("UPDATE fanmark_emoji_master_release_imports SET status='ready', verified_at=? WHERE release_version=?")
      .bind(CREATED, EMOJI_VERSION),
    master.prepare(`INSERT INTO fanmark_emoji_master_active_release
      (singleton_id, release_version, activation_id, action, generation, updated_at)
      VALUES (1, ?, ?, 'promotion', 1, ?)`)
      .bind(EMOJI_VERSION, "50000000-0000-4000-8000-000000000001", CREATED),
  ]);
  const tiers = [[1, "C", 4, 5, null], [2, "B", 3, 3, 30], [3, "A", 2, 5, 14], [4, "S", 1, 1, 7]];
  await stageReferenceMasterRelease({
    database: master, snapshotSha256: REFERENCE_VERSION,
    snapshot: [
      { table_name: "fanmark_tiers", row_count: 4, source_sha256: "1".repeat(64), records: tiers.map(
        ([tier_level, display_name, emoji_count_min, emoji_count_max, initial_license_days]) => ({
          id: `10000000-0000-4000-8000-00000000000${tier_level}`, tier_level, display_name,
          emoji_count_min, emoji_count_max, initial_license_days, is_active: true,
          description: "Synthetic registration tier", monthly_price_usd: "0.00", created_at: CREATED, updated_at: CREATED,
        }),
      ) },
      { table_name: "languages", row_count: 0, source_sha256: "2".repeat(64), records: [] },
      { table_name: "reserved_emoji_patterns", row_count: 0, source_sha256: "3".repeat(64), records: [] },
      { table_name: "fanmark_tier_extension_prices", row_count: 0, source_sha256: "4".repeat(64), records: [] },
    ],
  });
  await activateReferenceMasterRelease({ database: master, releaseVersion: REFERENCE_VERSION, expectedActiveVersion: null });
});

beforeEach(async () => {
  await business.batch([
    "fanmark_favorites", "fanmark_discoveries", "fanmark_profiles", "fanmark_basic_configs",
    "audit_logs", "fanmark_licenses", "fanmarks", "user_settings",
  ].map(table => business.prepare(`DELETE FROM ${table}`)));
  await auth.batch(['DELETE FROM "mfaAssurance"', 'DELETE FROM "twoFactor"', 'DELETE FROM "adminRole"',
    'DELETE FROM "session"', 'DELETE FROM "account"', 'DELETE FROM "user"'].map(sql => auth.prepare(sql)));
  for (const id of [OWNER, OTHER]) {
    await auth.batch([
      auth.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
        VALUES (?, 'Synthetic registration', ?, 1, ?, ?)`).bind(id, `${id}@example.invalid`, CREATED, CREATED),
      auth.prepare(`INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt)
        VALUES (?, ?, 'credential', ?, ?, ?, ?)`).bind(`${id}-credential`, id, id, bcrypt.hashSync(PASSWORD, 10), CREATED, CREATED),
    ]);
    await business.prepare(`INSERT INTO user_settings
      (id, user_id, username, plan_type, preferred_language, requires_password_setup, created_at, updated_at)
      VALUES (?, ?, ?, 'creator', 'ja', 0, ?, ?)`).bind(crypto.randomUUID(), id, `synthetic-${id}`, CREATED, CREATED).run();
  }
});

afterEach(async () => {
  for (const db of [business, auth, master]) {
    expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  }
});

describe("registration through real Better Auth and all current D1 migrations", () => {
  it("canonicalizes UUID case, keeps tone display/order, links favorites, and enforces identity ownership", async () => {
    const discoveryId = crypto.randomUUID();
    const normalized = JSON.stringify([ROSE, THUMB]);
    await business.prepare(`INSERT INTO fanmark_discoveries
      (id, emoji_ids, normalized_emoji_ids, first_seen_at, last_seen_at, search_count, favorite_count)
      VALUES (?, ?, ?, ?, ?, 9, 2)`).bind(discoveryId, normalized, normalized, CREATED, CREATED).run();
    for (const id of [OWNER, OTHER]) {
      await business.prepare(`INSERT INTO fanmark_favorites
        (id, user_id, discovery_id, normalized_emoji_ids, created_at, display_fanmark)
        VALUES (?, ?, ?, ?, ?, '🌹👍🏻')`).bind(crypto.randomUUID(), id, discoveryId, normalized, CREATED).run();
    }
    // An untrusted body actor cannot override the actual signed-in owner.
    const response = await register(await signIn(), "🌹👍🏻", [ROSE.toUpperCase(), TONE.toUpperCase()], { user_id: OTHER });
    expect(response.status).toBe(201);
    const payload = await response.json() as { fanmark: { id: string } };
    const id = payload.fanmark.id;
    expect(await business.prepare("SELECT emoji_ids, normalized_emoji_ids, user_input_fanmark FROM fanmarks WHERE id=?").bind(id).first())
      .toEqual({ emoji_ids: JSON.stringify([ROSE, TONE]), normalized_emoji_ids: normalized, user_input_fanmark: "🌹👍🏻" });
    expect(await business.prepare("SELECT user_id FROM fanmark_licenses WHERE fanmark_id=?").bind(id).first()).toEqual({ user_id: OWNER });
    expect(await business.prepare("SELECT fanmark_id, search_count, favorite_count, first_seen_at, last_seen_at FROM fanmark_discoveries WHERE id=?").bind(discoveryId).first())
      .toEqual({ fanmark_id: id, search_count: 9, favorite_count: 2, first_seen_at: CREATED, last_seen_at: CREATED });
    expect((await business.prepare("SELECT fanmark_id, display_fanmark, created_at FROM fanmark_favorites").all()).results)
      .toEqual(Array.from({ length: 2 }, () => ({ fanmark_id: id, display_fanmark: "🌹👍🏻", created_at: CREATED })));
    const otherCookie = await signIn(OTHER);
    expect((await register(otherCookie, "🌹👍", [ROSE, THUMB])).status).toBe(409);
    expect((await register(otherCookie, "👍🌹", [THUMB, ROSE])).status).toBe(201);
    expect((await business.prepare("SELECT COUNT(*) AS count FROM fanmarks").first())).toEqual({ count: 2 });
  });

  it.each([
    { display: "🌹", ids: [ROSE], level: 4, days: 7 },
    { display: "🌹🌹🌹🌹", ids: [ROSE, ROSE, ROSE, ROSE], level: 3, days: 14 },
    { display: "🌹👍💗⭐", ids: [ROSE, THUMB, HEART, STAR], level: 1, days: null },
  ])("reads the activated Tier for $display and writes its real finite/unlimited license", async ({ display, ids, level, days }) => {
    const response = await register(await signIn(), display, ids);
    expect(response.status).toBe(201);
    const payload = await response.json() as { fanmark: Record<string, unknown> };
    expect(payload.fanmark).toMatchObject({ tier_level: level, initial_license_days: days, normalized_emoji_ids: ids });
    const license = await business.prepare("SELECT user_id, license_start, license_end FROM fanmark_licenses").first<{
      user_id: string; license_start: string; license_end: string | null;
    }>();
    expect(license?.user_id).toBe(OWNER);
    if (days === null) expect(license?.license_end).toBeNull();
    else {
      const end = new Date(license!.license_start);
      end.setUTCDate(end.getUTCDate() + days + 1);
      end.setUTCHours(0, 0, 0, 0);
      expect(license?.license_end).toBe(end.toISOString().replace(".000Z", ".000000Z"));
    }
    for (const table of ["fanmarks", "fanmark_licenses", "fanmark_basic_configs", "fanmark_profiles", "audit_logs"]) {
      expect(await business.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).toEqual({ count: 1 });
    }
    // Prove the newly acquired finite/unlimited license is usable through the
    // actual public projection, rather than only checking its stored expiry.
    const publicRuntime = { ...runtime, PUBLIC_ACCESS_BACKEND: "d1" };
    const shortId = payload.fanmark.short_id as string;
    const byShort = await handleRequest(new Request(`${API}/api/fanmarks/access/short/${shortId}`), publicRuntime);
    const byEmoji = await handleRequest(new Request(`${API}/api/fanmarks/access/emoji`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ emojiIds: ids }),
    }), publicRuntime);
    expect(byShort.status).toBe(200);
    expect(byEmoji.status).toBe(200);
    const shortProjection = await byShort.json() as { licenseId: string | null };
    expect(shortProjection.licenseId).not.toBeNull();
    expect(await byEmoji.json()).toEqual(shortProjection);
  });

  it("rejects absent, revoked, and suspended real sessions before any business mutation", async () => {
    expect((await register(undefined)).status).toBe(401);
    const revoked = await signIn();
    await auth.prepare('DELETE FROM "session" WHERE userId=?').bind(OWNER).run();
    expect((await register(revoked)).status).toBe(401);
    const suspended = await signIn(OTHER);
    // Exercise the actual suspension transaction, including session revocation.
    // A bare SQL banned flag is not the application's suspension operation.
    const admin = await adminCookie();
    const suspension = await request(`/api/admin/users/${OTHER}/status`, {
      method: "POST", headers: { Cookie: admin, "content-type": "application/json" },
      body: JSON.stringify({ userId: OTHER, suspend: true, reason: "Synthetic registration guard" }),
    });
    expect(suspension.status).toBe(200);
    expect(await auth.prepare('SELECT COUNT(*) AS count FROM "session" WHERE userId=?').bind(OTHER).first()).toEqual({ count: 0 });
    expect((await register(suspended)).status).toBe(401);
    for (const table of ["fanmarks", "fanmark_licenses", "fanmark_basic_configs", "fanmark_profiles", "audit_logs"]) {
      expect(await business.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).toEqual({ count: 0 });
    }
  });
});
