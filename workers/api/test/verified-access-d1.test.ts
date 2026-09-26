import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { handleRequest } from "../src/index";
import type { Env as WorkerEnv } from "../src/repository";
import { setVerificationTestHooks } from "../src/verified-access.mjs";
import schemaSql from "./fixtures/verified-access-source-shaped.sql?raw";

const ORIGIN = "http://example.test";
const SECRET = "synthetic-verified-access-secret-32-characters";
const BASE_NOW = Date.parse("2026-09-24T00:01:00.000Z");
const HASH_2468 = "$2b$10$IZQBPqwOQC21SCvJr9r00OSWTg.Zw7roFgAFFiVN51/tpzc7JPLiW";
const PROFILE_FANMARK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_LICENSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const REDIRECT_FANMARK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REDIRECT_LICENSE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01";
const EMOJI_FANMARK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EMOJI_LICENSE = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const EXPIRED_FANMARK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const EXPIRED_LICENSE = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";
const MULTI_FANMARK = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MULTI_OLD_LICENSE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const MULTI_NEW_LICENSE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
const EMOJI_IDS = [
  "10000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
];
const SKIN_TONE_EMOJI_ID = "30000000-0000-4000-8000-000000000003";
type TestWorkerEnv = WorkerEnv & { FANMARK_DB: D1Database; MASTER_DB: D1Database };
const bindings = env as unknown as TestWorkerEnv;
const BASE_ACCESS_DB = bindings.FANMARK_DB;

let testNow = BASE_NOW;

function splitSqlStatements(sql: string): string[] {
  const withoutComments = String(sql).replace(/^\s*--[^\n]*(?:\n|$)/gmu, "");
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < withoutComments.length; index += 1) {
    const character = withoutComments[index];
    const next = withoutComments[index + 1];
    if (quote) {
      if (character === quote && next === quote) index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character !== ";") continue;
    const candidate = withoutComments.slice(start, index).trim();
    if (/^create\s+trigger\b/iu.test(candidate) && !/\bend\s*$/iu.test(candidate)) continue;
    if (candidate) statements.push(candidate);
    start = index + 1;
  }
  const tail = withoutComments.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

async function resetDatabase(database: D1Database, tables: string[]) {
  await database.batch(tables.map((table) => database.prepare(`DROP TABLE IF EXISTS ${table}`)));
  await database.batch(splitSqlStatements(schemaSql).map((statement) => database.prepare(statement)));
}

function appEnv() {
  return {
    ...bindings,
    D1_TOPOLOGY: "split",
    VERIFIED_ACCESS_BACKEND: "d1",
    VERIFIED_ACCESS_SECRET: SECRET,
    VERIFIED_ACCESS_TEST: "1",
    CORS_ALLOWED_ORIGINS: ORIGIN,
  };
}

function request(path: string, init: RequestInit = {}, options: { origin?: string | null; ip?: string } = {}) {
  const headers = new Headers(init.headers);
  if (options.origin !== null) headers.set("Origin", options.origin || ORIGIN);
  if (options.ip) headers.set("CF-Connecting-IP", options.ip);
  return handleRequest(
    new Request(`https://app.example.test${path}`, { ...init, headers }),
    appEnv(),
    fetch,
    () => new Date(testNow),
    () => new Date(testNow),
  );
}

function jsonRequest(path: string, body: unknown, options: { origin?: string | null; ip?: string } = {}) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, options);
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return String(setCookie).split(";", 1)[0];
}

function protectedHeaders(cookie: string) {
  return {
    Cookie: cookie,
    "Sec-Fetch-Site": "same-origin",
  };
}

async function row(sql: string, ...values: unknown[]) {
  return BASE_ACCESS_DB.prepare(sql).bind(...values).first();
}

async function addTarget({
  fanmarkId,
  licenseId,
  shortId,
  name,
  accessType,
  licenseEnd = "2026-10-01T00:00:00.000000Z",
  emojiIds = [],
  targetUrl = null,
  textContent = null,
  profile = false,
}: {
  fanmarkId: string;
  licenseId: string;
  shortId: string;
  name: string;
  accessType: "profile" | "redirect" | "text";
  licenseEnd?: string | null;
  emojiIds?: string[];
  targetUrl?: string | null;
  textContent?: string | null;
  profile?: boolean;
}) {
  const db = BASE_ACCESS_DB;
  await db.prepare(`
    INSERT INTO fanmarks(id, short_id, user_input_fanmark, normalized_emoji, emoji_ids,
      normalized_emoji_ids, status, tier_level)
    VALUES (?, ?, ?, ?, ?, ?, 'active', 1)
  `).bind(fanmarkId, shortId, "🌿", "🌿", JSON.stringify(emojiIds), JSON.stringify(emojiIds)).run();
  await db.prepare(`
    INSERT INTO fanmark_licenses(id, fanmark_id, status, license_end, grace_expires_at, is_returned)
    VALUES (?, ?, 'active', ?, NULL, 0)
  `).bind(licenseId, fanmarkId, licenseEnd).run();
  await db.prepare(`
    INSERT INTO fanmark_basic_configs(id, license_id, fanmark_name, access_type)
    VALUES (?, ?, ?, ?)
  `).bind(crypto.randomUUID(), licenseId, name, accessType).run();
  await db.prepare(`
    INSERT INTO fanmark_password_configs(id, license_id, access_password, is_enabled)
    VALUES (?, ?, ?, 1)
  `).bind(crypto.randomUUID(), licenseId, HASH_2468).run();
  if (accessType === "redirect") {
    await db.prepare(`INSERT INTO fanmark_redirect_configs(id, license_id, target_url) VALUES (?, ?, ?)`)
      .bind(crypto.randomUUID(), licenseId, targetUrl).run();
  }
  if (accessType === "text") {
    await db.prepare(`INSERT INTO fanmark_messageboard_configs(id, license_id, content) VALUES (?, ?, ?)`)
      .bind(crypto.randomUUID(), licenseId, textContent).run();
  }
  if (profile) {
    await db.prepare(`
      INSERT INTO fanmark_profiles(id, license_id, display_name, bio, social_links, theme_settings, is_public)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).bind(
      crypto.randomUUID(),
      licenseId,
      "Synthetic Public Profile",
      "Synthetic bio🙂",
      JSON.stringify({ website: "https://example.test/profile" }),
      JSON.stringify({ theme_color: "#123abc", profile_image_url: "https://example.test/avatar.png" }),
    ).run();
  }
  await db.prepare(`
    INSERT INTO credential_transform_artifacts
      (artifact_id, destination_license_id, destination_relation, destination_column,
       license_incarnation, enabled, codec_id, destination_hash, state)
    VALUES (?, ?, 'fanmark_password_configs', 'access_password', 0, 1, 'bcryptjs@3.0.3', ?, 'reconciled')
  `).bind(crypto.randomUUID(), licenseId, HASH_2468).run();
  await db.prepare(`
    INSERT OR IGNORE INTO fanmark_access_versions
      (license_id, license_incarnation, password_generation, access_generation, updated_at)
    VALUES (?, 0, 0, 0, 'synthetic-seed')
  `).bind(licenseId).run();
}

async function addAdditionalLicense({
  fanmarkId,
  licenseId,
  licenseEnd,
  name,
  textContent,
}: {
  fanmarkId: string;
  licenseId: string;
  licenseEnd: string | null;
  name: string;
  textContent: string;
}) {
  const db = BASE_ACCESS_DB;
  await db.prepare(`
    INSERT INTO fanmark_licenses(id, fanmark_id, status, license_end, grace_expires_at, is_returned)
    VALUES (?, ?, 'active', ?, NULL, 0)
  `).bind(licenseId, fanmarkId, licenseEnd).run();
  await db.prepare(`
    INSERT INTO fanmark_basic_configs(id, license_id, fanmark_name, access_type)
    VALUES (?, ?, ?, 'text')
  `).bind(crypto.randomUUID(), licenseId, name).run();
  await db.prepare(`
    INSERT INTO fanmark_password_configs(id, license_id, access_password, is_enabled)
    VALUES (?, ?, ?, 1)
  `).bind(crypto.randomUUID(), licenseId, HASH_2468).run();
  await db.prepare(`
    INSERT INTO fanmark_messageboard_configs(id, license_id, content)
    VALUES (?, ?, ?)
  `).bind(crypto.randomUUID(), licenseId, textContent).run();
  await db.prepare(`
    INSERT INTO credential_transform_artifacts
      (artifact_id, destination_license_id, destination_relation, destination_column,
       license_incarnation, enabled, codec_id, destination_hash, state)
    VALUES (?, ?, 'fanmark_password_configs', 'access_password', 0, 1, 'bcryptjs@3.0.3', ?, 'reconciled')
  `).bind(crypto.randomUUID(), licenseId, HASH_2468).run();
}

beforeEach(async () => {
  testNow = BASE_NOW;
  setVerificationTestHooks({
    now: () => testNow,
    requestAddress: (incomingRequest: Request) => incomingRequest.headers.get("X-Test-Requester") || "shared",
  });
  await resetDatabase(BASE_ACCESS_DB, [
    "fanmark_access_attempt_audit",
    "fanmark_access_attempt_reservations",
    "fanmark_access_rate_limits",
    "fanmark_access_rate_policy",
    "fanmark_access_proofs",
    "fanmark_password_runtime_evidence",
    "credential_transform_artifacts",
    "fanmark_access_versions",
    "fanmark_license_incarnations",
    "fanmark_profiles",
    "fanmark_password_configs",
    "fanmark_messageboard_configs",
    "fanmark_redirect_configs",
    "fanmark_basic_configs",
    "fanmark_licenses",
    "fanmarks",
    "emoji_master",
  ]);
  await resetDatabase(bindings.MASTER_DB, [
    "fanmark_access_attempt_audit",
    "fanmark_access_attempt_reservations",
    "fanmark_access_rate_limits",
    "fanmark_access_rate_policy",
    "fanmark_access_proofs",
    "fanmark_password_runtime_evidence",
    "credential_transform_artifacts",
    "fanmark_access_versions",
    "fanmark_license_incarnations",
    "fanmark_profiles",
    "fanmark_password_configs",
    "fanmark_messageboard_configs",
    "fanmark_redirect_configs",
    "fanmark_basic_configs",
    "fanmark_licenses",
    "fanmarks",
    "emoji_master",
  ]);
  await bindings.MASTER_DB.prepare("INSERT INTO emoji_master(id, codepoints) VALUES (?, ?), (?, ?), (?, ?)")
    .bind(
      EMOJI_IDS[0], JSON.stringify(["1F44B"]),
      EMOJI_IDS[1], JSON.stringify(["1F9F4"]),
      SKIN_TONE_EMOJI_ID, JSON.stringify(["1F44B", "1F3FB"]),
    ).run();
  await addTarget({ fanmarkId: PROFILE_FANMARK, licenseId: PROFILE_LICENSE, shortId: "1111", name: "Profile", accessType: "profile", licenseEnd: null, profile: true });
  await addTarget({ fanmarkId: REDIRECT_FANMARK, licenseId: REDIRECT_LICENSE, shortId: "2222", name: "Redirect", accessType: "redirect", targetUrl: "https://example.test/synthetic" });
  await addTarget({ fanmarkId: EMOJI_FANMARK, licenseId: EMOJI_LICENSE, shortId: "3333", name: "Text", accessType: "text", emojiIds: EMOJI_IDS, textContent: "Synthetic protected text" });
  await addTarget({ fanmarkId: EXPIRED_FANMARK, licenseId: EXPIRED_LICENSE, shortId: "4444", name: "Expired", accessType: "text", licenseEnd: "2026-09-20T00:00:00.000000Z", textContent: "Expired protected text" });
});

describe("source-shaped protected public access through the app Worker", () => {
  it("issues a selector-bound proof and returns an allowlisted profile projection", async () => {
    const verification = await jsonRequest("/api/fanmarks/access/short/1111/verify-password", { password: "2468" });
    expect(verification.status).toBe(204);
    const cookie = cookieFrom(verification);
    expect(verification.headers.get("cache-control")).toBe("no-store");
    expect(verification.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(verification.headers.get("access-control-allow-credentials")).toBe("true");
    expect(verification.headers.get("set-cookie")).toMatch(/HttpOnly/u);
    expect(verification.headers.get("set-cookie")).toMatch(/Secure/u);
    expect(verification.headers.get("set-cookie")).toMatch(/SameSite=Lax/u);
    expect(verification.headers.get("set-cookie")).not.toMatch(/Domain=/iu);

    const protectedResponse = await request(
      "/api/fanmarks/access/short/1111/protected",
      { headers: protectedHeaders(cookie) },
    );
    expect(protectedResponse.status).toBe(200);
    expect(await protectedResponse.json()).toEqual({
      fanmarkId: PROFILE_FANMARK,
      licenseId: PROFILE_LICENSE,
      accessType: "profile",
      profile: {
        name: "Synthetic Public Profile",
        bio: "Synthetic bio🙂",
        socialLinks: { website: "https://example.test/profile" },
        themeSettings: { theme_color: "#123abc", profile_image_url: "https://example.test/avatar.png" },
      },
    });
    const proof = await row("SELECT selector_kind, password_generation, access_generation, license_incarnation FROM fanmark_access_proofs");
    expect(proof).toEqual({ selector_kind: "short", password_generation: 0, access_generation: 0, license_incarnation: 0 });
  });

  it("normalizes skin-tone selectors against the separate master D1 and blocks proof replay across selectors", async () => {
    const verification = await jsonRequest("/api/fanmarks/access/emoji/verify-password", {
      emojiIds: [SKIN_TONE_EMOJI_ID, EMOJI_IDS[1]],
      password: "2468",
    });
    expect(verification.status).toBe(204);
    const cookie = cookieFrom(verification);
    const allowed = await jsonRequest(
      "/api/fanmarks/access/emoji/protected",
      { emojiIds: EMOJI_IDS },
      { ip: "198.51.100.21" },
    );
    expect(allowed.status).toBe(401);
    const protectedResponse = await request(
      "/api/fanmarks/access/emoji/protected",
      {
        method: "POST",
        headers: { ...protectedHeaders(cookie), "Content-Type": "application/json" },
        body: JSON.stringify({ emojiIds: [SKIN_TONE_EMOJI_ID, EMOJI_IDS[1]] }),
      },
    );
    expect(protectedResponse.status).toBe(200);
    expect(await protectedResponse.json()).toEqual({
      fanmarkId: EMOJI_FANMARK,
      licenseId: EMOJI_LICENSE,
      accessType: "text",
      textContent: "Synthetic protected text",
    });
  });

  it("uses neutral denial for wrong passwords, expired licenses, and unproven hash formats", async () => {
    const wrong = await jsonRequest("/api/fanmarks/access/short/1111/verify-password", { password: "0000" }, { ip: "198.51.100.31" });
    const expired = await jsonRequest("/api/fanmarks/access/short/4444/verify-password", { password: "2468" }, { ip: "198.51.100.32" });
    await BASE_ACCESS_DB.prepare("UPDATE credential_transform_artifacts SET codec_id = 'unknown-codec' WHERE destination_license_id = ?")
      .bind(REDIRECT_LICENSE).run();
    const unsupported = await jsonRequest("/api/fanmarks/access/short/2222/verify-password", { password: "2468" }, { ip: "198.51.100.33" });
    await BASE_ACCESS_DB.prepare("UPDATE credential_transform_artifacts SET enabled = 0 WHERE destination_license_id = ?")
      .bind(PROFILE_LICENSE).run();
    const disabledArtifact = await jsonRequest("/api/fanmarks/access/short/1111/verify-password", { password: "2468" }, { ip: "198.51.100.34" });
    expect([wrong.status, expired.status, unsupported.status, disabledArtifact.status]).toEqual([401, 401, 401, 401]);
    expect(wrong.headers.get("set-cookie")).toBeNull();
    expect(await row("SELECT count(*) AS count FROM fanmark_access_proofs")).toEqual({ count: 0 });
    const audit = await BASE_ACCESS_DB.prepare("SELECT outcome FROM fanmark_access_attempt_audit ORDER BY occurred_at").all();
    expect((audit.results as Array<{ outcome?: unknown }>).map((item) => item.outcome)).toEqual(["failure", "failure", "failure", "failure"]);
  });

  it("accepts Worker-authored password evidence only for its exact license incarnation and generation", async () => {
    await BASE_ACCESS_DB.prepare("DELETE FROM credential_transform_artifacts WHERE destination_license_id = ?")
      .bind(PROFILE_LICENSE).run();
    await BASE_ACCESS_DB.prepare(`
      INSERT INTO fanmark_password_runtime_evidence
        (license_id, license_incarnation, password_generation, enabled, codec_id, created_at, updated_at)
      SELECT li.license_id, li.incarnation, av.password_generation, 1, 'bcryptjs@3.0.3', 'synthetic-now', 'synthetic-now'
      FROM fanmark_license_incarnations AS li
      JOIN fanmark_access_versions AS av ON av.license_id = li.license_id
      WHERE li.license_id = ? AND li.incarnation = av.license_incarnation
    `).bind(PROFILE_LICENSE).run();

    const valid = await jsonRequest("/api/fanmarks/access/short/1111/verify-password", { password: "2468" });
    expect(valid.status).toBe(204);
    await BASE_ACCESS_DB.prepare(`
      UPDATE fanmark_password_runtime_evidence
      SET password_generation = password_generation + 1
      WHERE license_id = ?
    `).bind(PROFILE_LICENSE).run();
    const stale = await jsonRequest("/api/fanmarks/access/short/1111/verify-password", { password: "2468" }, { ip: "198.51.100.77" });
    expect(stale.status).toBe(401);
  });

  it("uses the current latest short-ID license and denies equal-expiry ties", async () => {
    await addTarget({
      fanmarkId: MULTI_FANMARK,
      licenseId: MULTI_OLD_LICENSE,
      shortId: "5555",
      name: "Older config",
      accessType: "text",
      licenseEnd: "2026-10-01T00:00:00.000000Z",
      textContent: "Older protected text",
    });
    await addAdditionalLicense({
      fanmarkId: MULTI_FANMARK,
      licenseId: MULTI_NEW_LICENSE,
      licenseEnd: "2026-10-02T00:00:00.000000Z",
      name: "Current config",
      textContent: "Current protected text",
    });

    const verification = await jsonRequest("/api/fanmarks/access/short/5555/verify-password", { password: "2468" });
    expect(verification.status).toBe(204);
    const protectedResponse = await request(
      "/api/fanmarks/access/short/5555/protected",
      { headers: protectedHeaders(cookieFrom(verification)) },
    );
    expect(protectedResponse.status).toBe(200);
    expect(await protectedResponse.json()).toMatchObject({
      licenseId: MULTI_NEW_LICENSE,
      textContent: "Current protected text",
    });

    const tieFanmark = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const tieLicense1 = "ffffffff-ffff-4fff-8fff-ffffffffff01";
    const tieLicense2 = "ffffffff-ffff-4fff-8fff-ffffffffff02";
    await addTarget({
      fanmarkId: tieFanmark,
      licenseId: tieLicense1,
      shortId: "6666",
      name: "Tied config one",
      accessType: "text",
      licenseEnd: "2026-10-03T00:00:00.000000Z",
      textContent: "Tied protected text one",
    });
    await addAdditionalLicense({
      fanmarkId: tieFanmark,
      licenseId: tieLicense2,
      licenseEnd: "2026-10-03T00:00:00.000000Z",
      name: "Tied config two",
      textContent: "Tied protected text two",
    });
    const tied = await jsonRequest("/api/fanmarks/access/short/6666/verify-password", { password: "2468" });
    expect(tied.status).toBe(401);
    expect(tied.headers.get("set-cookie")).toBeNull();
  });

  it("does not issue a proof if a newer short-ID license appears during password comparison", async () => {
    await addTarget({
      fanmarkId: MULTI_FANMARK,
      licenseId: MULTI_OLD_LICENSE,
      shortId: "5555",
      name: "Older config",
      accessType: "text",
      licenseEnd: "2026-10-01T00:00:00.000000Z",
      textContent: "Older protected text",
    });
    setVerificationTestHooks({
      now: () => testNow,
      requestAddress: () => "shared",
      duringCompare: async () => {
        await addAdditionalLicense({
          fanmarkId: MULTI_FANMARK,
          licenseId: MULTI_NEW_LICENSE,
          licenseEnd: "2026-10-02T00:00:00.000000Z",
          name: "New config",
          textContent: "New protected text",
        });
      },
    });

    const verification = await jsonRequest("/api/fanmarks/access/short/5555/verify-password", { password: "2468" });
    expect(verification.status).toBe(401);
    expect(verification.headers.get("set-cookie")).toBeNull();
    expect(await row("SELECT count(*) AS count FROM fanmark_access_proofs WHERE license_id = ?", MULTI_OLD_LICENSE)).toEqual({ count: 0 });
  });

  it("invalidates proofs after current password or profile generations change", async () => {
    const verification = await jsonRequest("/api/fanmarks/access/short/1111/verify-password", { password: "2468" });
    const cookie = cookieFrom(verification);
    await BASE_ACCESS_DB.prepare("UPDATE fanmark_profiles SET bio = 'changed' WHERE license_id = ?").bind(PROFILE_LICENSE).run();
    const response = await request(
      "/api/fanmarks/access/short/1111/protected",
      { headers: protectedHeaders(cookie) },
    );
    expect(response.status).toBe(401);
  });

  it("requires the exact configured origin and a same-origin signal for cookie reads", async () => {
    const deniedOrigin = await jsonRequest(
      "/api/fanmarks/access/short/1111/verify-password",
      { password: "2468" },
      { origin: "https://attacker.example" },
    );
    expect(deniedOrigin.status).toBe(403);
    const verification = await jsonRequest("/api/fanmarks/access/short/1111/verify-password", { password: "2468" });
    const cookie = cookieFrom(verification);
    const noFetchMetadata = await request(
      "/api/fanmarks/access/short/1111/protected",
      { headers: { Cookie: cookie } },
      { origin: null },
    );
    expect(noFetchMetadata.status).toBe(403);
  });

  it("rejects a profile URL proof unless it selects a public profile", async () => {
    const verification = await jsonRequest(
      `/api/fanmarks/public-profile/${REDIRECT_LICENSE}/verify-password`,
      { password: "2468" },
    );
    expect(verification.status).toBe(401);
    expect(verification.headers.get("set-cookie")).toBeNull();
  });

  it("fails closed while the Worker feature flag is off", async () => {
    const disabled = handleRequest(
      new Request("https://app.example.test/api/fanmarks/access/short/1111/verify-password", {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ password: "2468" }),
      }),
      { ...appEnv(), VERIFIED_ACCESS_BACKEND: undefined },
    );
    expect((await disabled).status).toBe(503);
  });
});
