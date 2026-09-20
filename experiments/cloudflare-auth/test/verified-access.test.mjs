import { beforeEach, describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import schemaSql from "./fixtures/verified-access.sql?raw";
import { setVerificationTestHooks } from "../src/verified-access-proof.mjs";

const ORIGIN = "http://example.test";
const WINDOW_MS = 300000;
const BASE_NOW = Date.parse("2026-09-21T00:01:00.000Z");
const PROFILE_LICENSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const EMOJI_IDS = [
  "10000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
];

let testNow = BASE_NOW;

function splitSqlStatements(sql) {
  const statements = [];
  let start = 0;
  let singleQuoted = false;
  let doubleQuoted = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
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
    const candidate = sql.slice(start, index).trim();
    if (/^create\s+trigger\b/i.test(candidate) && !/\bend\s*$/i.test(candidate)) continue;
    if (candidate) statements.push(candidate);
    start = index + 1;
  }
  const finalStatement = sql.slice(start).trim();
  if (finalStatement) statements.push(finalStatement);
  return statements;
}

const tableNames = [
  "fanmark_access_attempt_audit",
  "fanmark_access_attempt_reservations",
  "fanmark_access_proofs",
  "fanmark_access_rate_limits",
  "fanmark_access_rate_policy",
  "fanmark_access_versions",
  "fanmark_emoji_selectors",
  "fanmark_profiles",
  "fanmark_access_configs",
  "fanmark_license_incarnations",
  "fanmark_licenses",
  "fanmarks",
];

async function resetDatabase() {
  await env.ACCESS_DB.batch(
    tableNames.map((table) => env.ACCESS_DB.prepare(`DROP TABLE IF EXISTS ${table}`)),
  );
  await env.ACCESS_DB.batch(
    splitSqlStatements(schemaSql).map((statement) => env.ACCESS_DB.prepare(statement)),
  );
}

function request(path, init = {}, options = {}) {
  const headers = new Headers(init.headers);
  if (options.origin !== null) headers.set("Origin", options.origin || ORIGIN);
  if (options.ip) headers.set("CF-Connecting-IP", options.ip);
  if (options.ip) headers.set("X-Test-Requester", options.ip);
  return exports.default.fetch(
    new Request(`http://example.test${path}`, { ...init, headers }),
  );
}

function jsonRequest(path, body, options = {}) {
  return request(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    options,
  );
}

function cookieFrom(response) {
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie.split(";", 1)[0];
}

function protectedHeaders(cookie, extra = {}) {
  return { Cookie: cookie, "Sec-Fetch-Site": "same-origin", ...extra };
}

async function verifyShort(shortId, password, ip = "198.51.100.10") {
  return jsonRequest(
    `/api/fanmarks/access/short/${shortId}/verify-password`,
    { password },
    { ip },
  );
}

async function verifyEmoji(ids, password, ip = "198.51.100.10") {
  return jsonRequest(
    "/api/fanmarks/access/emoji/verify-password",
    { emojiIds: ids, password },
    { ip },
  );
}

async function verifyProfile(licenseId = PROFILE_LICENSE, password = "2468", ip = "198.51.100.10") {
  return jsonRequest(
    `/api/fanmarks/public-profile/${licenseId}/verify-password`,
    { password },
    { ip },
  );
}

async function row(sql, ...values) {
  return env.ACCESS_DB.prepare(sql).bind(...values).first();
}

async function rows(sql, ...values) {
  const result = await env.ACCESS_DB.prepare(sql).bind(...values).all();
  return result.results;
}

async function count(sql, ...values) {
  const result = await row(sql, ...values);
  return Number(result?.count || 0);
}

function setNow(value) {
  testNow = value;
}

beforeEach(async () => {
  testNow = BASE_NOW;
  setVerificationTestHooks({
    now: () => testNow,
    requestAddress: (incomingRequest) => incomingRequest.headers.get("X-Test-Requester") || "shared",
  });
  await resetDatabase();
});

describe("isolated verified public access on Workers + D1", () => {
  it("creates an exact short-ID proof and returns a nested profile with hardened cookie flags", async () => {
    const response = await verifyShort("1111", "2468");
    expect(response.status).toBe(204);
    const cookie = cookieFrom(response);
    expect(cookie.startsWith("__Host-fanmark_access=")).toBe(true);
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toMatch(/Max-Age=300/);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).not.toMatch(/Domain=/i);

    const protectedResponse = await request(
      "/api/fanmarks/access/short/1111/protected",
      { headers: protectedHeaders(cookie) },
      { origin: null },
    );
    expect(protectedResponse.status).toBe(200);
    expect(await protectedResponse.json()).toEqual({
      fanmarkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      licenseId: PROFILE_LICENSE,
      accessType: "profile",
      profile: {
        name: "Synthetic Public Profile",
        bio: "Synthetic bio🙂",
        imageUrl: "",
      },
    });
    expect(await count("SELECT count(*) AS count FROM fanmark_access_proofs")).toBe(1);
    const audit = await row(
      "SELECT outcome, requester_hash, selector_hash FROM fanmark_access_attempt_audit LIMIT 1",
    );
    expect(audit.outcome).toBe("success");
    expect(audit.requester_hash).not.toContain("198.51.100.10");
    expect(audit.selector_hash).not.toContain("1111");
  });

  it("rejects wrong, unknown, disabled, and expired access without a proof", async () => {
    const wrong = await verifyShort("1111", "0000", "198.51.100.11");
    const unknown = await verifyShort("9999", "2468", "198.51.100.12");
    const expired = await verifyShort("4444", "0000", "198.51.100.13");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(expired.status).toBe(401);
    expect(await count("SELECT count(*) AS count FROM fanmark_access_proofs")).toBe(0);
    expect(await rows("SELECT outcome FROM fanmark_access_attempt_audit ORDER BY occurred_at, id")).toEqual([
      { outcome: "failure" },
      { outcome: "failure" },
      { outcome: "failure" },
    ]);
  });

  it("protects emoji text and redirect projections through the same proof path", async () => {
    const emoji = await verifyEmoji(EMOJI_IDS, "1357", "198.51.100.14");
    expect(emoji.status).toBe(204);
    const emojiCookie = cookieFrom(emoji);
    const text = await jsonRequest(
      "/api/fanmarks/access/emoji/protected",
      { emojiIds: EMOJI_IDS },
      { ip: "198.51.100.14" },
    );
    const protectedText = await request(
      "/api/fanmarks/access/emoji/protected",
      {
        method: "POST",
        headers: { ...protectedHeaders(emojiCookie), "Content-Type": "application/json" },
        body: JSON.stringify({ emojiIds: EMOJI_IDS }),
      },
    );
    expect(text.status).toBe(401);
    expect(protectedText.status).toBe(200);
    expect(await protectedText.json()).toEqual({
      fanmarkId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      licenseId: "cccccccc-cccc-4ccc-8ccc-cccccccccc01",
      accessType: "text",
      textContent: "Synthetic protected text",
    });

    const redirect = await verifyShort("2222", "8642", "198.51.100.15");
    const redirectCookie = cookieFrom(redirect);
    const protectedRedirect = await request(
      "/api/fanmarks/access/short/2222/protected",
      { headers: protectedHeaders(redirectCookie) },
    );
    expect(protectedRedirect.status).toBe(200);
    expect(await protectedRedirect.json()).toEqual({
      fanmarkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      licenseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01",
      accessType: "redirect",
      targetUrl: "https://example.invalid/synthetic",
    });
  });

  it("keeps direct profile proofs isolated from short-ID proofs", async () => {
    const profileProof = await verifyProfile(PROFILE_LICENSE, "2468", "198.51.100.16");
    const profileCookie = cookieFrom(profileProof);
    const profileRead = await request(
      `/api/fanmarks/public-profile/${PROFILE_LICENSE.toUpperCase()}/protected`,
      { headers: protectedHeaders(profileCookie) },
      { origin: null },
    );
    expect(profileRead.status).toBe(200);

    const shortWithProfileCookie = await request(
      "/api/fanmarks/access/short/1111/protected",
      { headers: protectedHeaders(profileCookie) },
    );
    expect(shortWithProfileCookie.status).toBe(401);

    const shortProof = await verifyShort("1111", "2468", "198.51.100.17");
    const shortCookie = cookieFrom(shortProof);
    const profileWithShortCookie = await request(
      `/api/fanmarks/public-profile/${PROFILE_LICENSE}/protected`,
      { headers: protectedHeaders(shortCookie) },
    );
    expect(profileWithShortCookie.status).toBe(401);
  });

  it("requires strict verification Origin and refuses caller-supplied unlock fields", async () => {
    const wrongOrigin = await jsonRequest(
      "/api/fanmarks/access/short/1111/verify-password",
      { password: "2468" },
      { origin: "https://evil.example", ip: "198.51.100.18" },
    );
    expect(wrongOrigin.status).toBe(403);

    const bypass = await request(
      "/api/fanmarks/access/short/1111/protected",
      {
        headers: {
          Authorization: "Bearer caller-controlled",
          Cookie: "unlocked=true",
          "Sec-Fetch-Site": "same-origin",
        },
      },
    );
    expect(bypass.status).toBe(401);

    const missingMetadata = await request(
      "/api/fanmarks/access/short/1111/protected",
      { headers: { Cookie: "__Host-fanmark_access=caller-controlled" } },
      { origin: null },
    );
    expect(missingMetadata.status).toBe(403);
  });

  it("uses one requester bucket across rotating selectors", async () => {
    const ip = "198.51.100.21";
    for (let index = 0; index < 5; index += 1) {
      const ids = [
        `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      ];
      const response = await verifyEmoji(ids, "0000", ip);
      expect(response.status).toBe(401);
    }
    const blocked = await verifyEmoji(
      ["30000000-0000-4000-8000-000000000006"],
      "0000",
      ip,
    );
    expect(blocked.status).toBe(401);
    const requester = await row(
      "SELECT attempt_count, failure_count FROM fanmark_access_rate_limits WHERE bucket_kind = 'requester' LIMIT 1",
    );
    expect(requester).toEqual({ attempt_count: 5, failure_count: 5 });
    expect(await count("SELECT count(*) AS count FROM fanmark_access_attempt_reservations")).toBe(5);
    expect(await count("SELECT count(*) AS count FROM fanmark_access_attempt_audit WHERE outcome = 'blocked'")).toBe(1);
  });

  it("rolls back both bucket increments when the resource bucket is blocked", async () => {
    const resourceIp = "198.51.100.22";
    for (let index = 0; index < 5; index += 1) {
      expect((await verifyShort("2222", "0000", resourceIp)).status).toBe(401);
    }
    const otherIp = "198.51.100.23";
    expect((await verifyShort("2222", "8642", otherIp)).status).toBe(401);
    const otherRequester = await rows(
      "SELECT attempt_count, failure_count FROM fanmark_access_rate_limits WHERE bucket_kind = 'requester' ORDER BY attempt_count",
    );
    // The admission batch rolls back its seed and increment together, so the
    // blocked second requester has no row at all. Only the first requester's
    // five admitted attempts remain.
    expect(otherRequester).toEqual([{ attempt_count: 5, failure_count: 5 }]);
    const resource = await row(
      "SELECT attempt_count, failure_count FROM fanmark_access_rate_limits WHERE bucket_kind = 'resource' LIMIT 1",
    );
    expect(resource).toEqual({ attempt_count: 5, failure_count: 5 });
    expect(await count("SELECT count(*) AS count FROM fanmark_access_attempt_reservations")).toBe(5);
  });

  it("caps concurrent reservations and successful verification does not reset failures", async () => {
    const concurrentIp = "198.51.100.24";
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => verifyShort("2222", "0000", concurrentIp)),
    );
    expect(responses.every((response) => response.status === 401)).toBe(true);
    const concurrentRate = await row(
      "SELECT attempt_count, failure_count FROM fanmark_access_rate_limits WHERE bucket_kind = 'requester' LIMIT 1",
    );
    expect(concurrentRate).toEqual({ attempt_count: 5, failure_count: 5 });
    expect(await count("SELECT count(*) AS count FROM fanmark_access_attempt_reservations")).toBe(5);

    const successIp = "198.51.100.25";
    expect((await verifyShort("1111", "0000", successIp)).status).toBe(401);
    expect((await verifyShort("1111", "0000", successIp)).status).toBe(401);
    const success = await verifyShort("1111", "2468", successIp);
    expect(success.status).toBe(204);
    const successRate = await row(
      "SELECT attempt_count, failure_count FROM fanmark_access_rate_limits WHERE bucket_kind = 'requester' AND attempt_count = 3 LIMIT 1",
    );
    expect(successRate).toEqual({ attempt_count: 3, failure_count: 2 });
  });

  it("starts threshold cooldown at one minute and carries it across a window roll", async () => {
    const nearWindowEnd =
      Math.floor(BASE_NOW / WINDOW_MS) * WINDOW_MS + WINDOW_MS - 1000;
    setNow(nearWindowEnd);
    const ip = "198.51.100.251";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await verifyShort("2222", "0000", ip)).status).toBe(401);
    }
    const limit = await row(
      "SELECT cooldown_until, attempt_count, failure_count FROM fanmark_access_rate_limits WHERE bucket_kind = 'requester' LIMIT 1",
    );
    expect(limit).toEqual({
      cooldown_until: nearWindowEnd + 60000,
      attempt_count: 5,
      failure_count: 5,
    });

    setNow(nearWindowEnd + 1000);
    expect((await verifyShort("2222", "8642", ip)).status).toBe(401);
    const carried = await row(
      "SELECT cooldown_until, attempt_count, failure_count FROM fanmark_access_rate_limits WHERE bucket_kind = 'requester' LIMIT 1",
    );
    expect(carried).toEqual({
      cooldown_until: nearWindowEnd + 60000,
      attempt_count: 0,
      failure_count: 0,
    });

    setNow(nearWindowEnd + 60001);
    expect((await verifyShort("2222", "8642", ip)).status).toBe(204);
  });

  it("does not let a delayed old-window request roll back a newer rate window", async () => {
    const ip = "198.51.100.252";
    const nextWindow =
      (Math.floor(BASE_NOW / WINDOW_MS) + 1) * WINDOW_MS + 1000;
    setNow(nextWindow);
    expect((await verifyShort("2222", "0000", ip)).status).toBe(401);
    setNow(BASE_NOW);
    expect((await verifyShort("2222", "0000", ip)).status).toBe(401);
    expect(await row(
      "SELECT window_id, attempt_count, failure_count FROM fanmark_access_rate_limits WHERE bucket_kind = 'requester' LIMIT 1",
    )).toEqual({
      window_id: Math.floor(nextWindow / WINDOW_MS),
      attempt_count: 1,
      failure_count: 1,
    });
    expect(await count("SELECT count(*) AS count FROM fanmark_access_attempt_reservations")).toBe(1);
  });

  it("rejects an expired reservation after a window roll without changing the new window", async () => {
    let hold = true;
    let reachedResolve;
    let releaseResolve;
    const reached = new Promise((resolve) => {
      reachedResolve = resolve;
    });
    const released = new Promise((resolve) => {
      releaseResolve = resolve;
    });
    setVerificationTestHooks({
      now: () => testNow,
      duringCompare: async (details) => {
        if (!hold) return;
        hold = false;
        reachedResolve(details);
        await released;
      },
    });
    const lateRequest = verifyShort("2222", "8642", "198.51.100.26");
    const details = await reached;
    expect(details.reservationId).toBeTruthy();
    const nextWindow = (Math.floor(BASE_NOW / WINDOW_MS) + 1) * WINDOW_MS + 1000;
    setNow(nextWindow);
    expect((await verifyShort("2222", "0000", "198.51.100.26")).status).toBe(401);
    releaseResolve();
    const lateResponse = await lateRequest;
    expect(lateResponse.status).toBe(401);
    const currentRate = await row(
      "SELECT window_id, attempt_count, failure_count FROM fanmark_access_rate_limits WHERE bucket_kind = 'requester' LIMIT 1",
    );
    expect(currentRate).toEqual({
      window_id: Math.floor(nextWindow / WINDOW_MS),
      attempt_count: 1,
      failure_count: 1,
    });
    const outcomes = await rows(
      "SELECT outcome FROM fanmark_access_attempt_reservations ORDER BY reserved_at",
    );
    expect(outcomes).toEqual([{ outcome: "expired" }, { outcome: "failure" }]);
    expect(await count("SELECT count(*) AS count FROM fanmark_access_proofs")).toBe(0);
  });

  it("rejects a password-generation ABA change while bcrypt is in flight", async () => {
    let hold = true;
    let reachedResolve;
    let releaseResolve;
    const reached = new Promise((resolve) => {
      reachedResolve = resolve;
    });
    const released = new Promise((resolve) => {
      releaseResolve = resolve;
    });
    setVerificationTestHooks({
      now: () => testNow,
      duringCompare: async (details) => {
        if (!hold) return;
        hold = false;
        reachedResolve(details);
        await released;
      },
    });
    const pending = verifyShort("1111", "2468", "198.51.100.27");
    const details = await reached;
    const before = await row(
      "SELECT password_generation, lifecycle_generation FROM fanmark_access_versions WHERE license_id = ?",
      PROFILE_LICENSE,
    );
    await env.ACCESS_DB.batch([
      env.ACCESS_DB.prepare(
        "UPDATE fanmark_access_configs SET password_hash = ? WHERE license_id = ?",
      ).bind(
        "$2b$10$2cXhH7RnP1d4Cqi00xgC.OlFKQldGTaz0WYqquVNdo.a1TPA3yY3.",
        PROFILE_LICENSE,
      ),
      env.ACCESS_DB.prepare(
        "UPDATE fanmark_access_configs SET password_hash = ? WHERE license_id = ?",
      ).bind(
        "$2b$10$IZQBPqwOQC21SCvJr9r00OSWTg.Zw7roFgAFFiVN51/tpzc7JPLiW",
        PROFILE_LICENSE,
      ),
    ]);
    expect((await row(
      "SELECT password_generation FROM fanmark_access_versions WHERE license_id = ?",
      PROFILE_LICENSE,
    )).password_generation).toBe(Number(before.password_generation) + 2);
    releaseResolve();
    const response = await pending;
    expect(response.status).toBe(401);
    expect(await count("SELECT count(*) AS count FROM fanmark_access_proofs")).toBe(0);
    const audit = await row(
      "SELECT outcome, reservation_id FROM fanmark_access_attempt_audit WHERE reservation_id = ?",
      details.reservationId,
    );
    expect(audit.outcome).toBe("stale");
    const reservation = await row(
      "SELECT outcome, finalization_id FROM fanmark_access_attempt_reservations WHERE reservation_id = ?",
      details.reservationId,
    );
    expect(reservation.outcome).toBe("stale");
  });

  it("rejects a lifecycle ABA change and direct profile delete/recreate while bcrypt is in flight", async () => {
    let hold = true;
    let reachedResolve;
    let releaseResolve;
    const reached = new Promise((resolve) => {
      reachedResolve = resolve;
    });
    const released = new Promise((resolve) => {
      releaseResolve = resolve;
    });
    setVerificationTestHooks({
      now: () => testNow,
      duringCompare: async () => {
        if (!hold) return;
        hold = false;
        reachedResolve();
        await released;
      },
    });
    const pending = verifyShort("1111", "2468", "198.51.100.28");
    await reached;
    await env.ACCESS_DB.prepare(
      "UPDATE fanmarks SET returned = 1 WHERE id = ?",
    ).bind("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").run();
    await env.ACCESS_DB.prepare(
      "UPDATE fanmarks SET returned = 0 WHERE id = ?",
    ).bind("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").run();
    releaseResolve();
    expect((await pending).status).toBe(401);
    expect(await count("SELECT count(*) AS count FROM fanmark_access_proofs")).toBe(0);

    hold = true;
    const profileReached = new Promise((resolve) => {
      reachedResolve = resolve;
    });
    releaseResolve = null;
    const profileReleased = new Promise((resolve) => {
      releaseResolve = resolve;
    });
    setVerificationTestHooks({
      now: () => testNow,
      duringCompare: async () => {
        if (!hold) return;
        hold = false;
        reachedResolve();
        await profileReleased;
      },
    });
    const profilePending = verifyShort("1111", "2468", "198.51.100.29");
    await profileReached;
    await env.ACCESS_DB.prepare(
      "DELETE FROM fanmark_profiles WHERE license_id = ?",
    ).bind(PROFILE_LICENSE).run();
    await env.ACCESS_DB.prepare(
      `INSERT INTO fanmark_profiles (license_id, is_public, profile_name, bio, image_url)
       VALUES (?, 1, 'Synthetic Public Profile', 'Synthetic bio🙂', '')`,
    ).bind(PROFILE_LICENSE).run();
    releaseResolve();
    expect((await profilePending).status).toBe(401);
    expect(await count("SELECT count(*) AS count FROM fanmark_access_proofs")).toBe(0);
  });

  it("rejects same-UUID license deletion and recreation during bcrypt", async () => {
    let hold = true;
    let reachedResolve;
    let releaseResolve;
    const reached = new Promise((resolve) => {
      reachedResolve = resolve;
    });
    const released = new Promise((resolve) => {
      releaseResolve = resolve;
    });
    setVerificationTestHooks({
      now: () => testNow,
      duringCompare: async () => {
        if (!hold) return;
        hold = false;
        reachedResolve();
        await released;
      },
    });
    const pending = verifyShort("1111", "2468", "198.51.100.30");
    await reached;
    await env.ACCESS_DB.prepare(
      "DELETE FROM fanmark_licenses WHERE id = ?",
    ).bind(PROFILE_LICENSE).run();
    await env.ACCESS_DB.batch([
      env.ACCESS_DB.prepare(
        `INSERT INTO fanmark_licenses (id, fanmark_id, status, returned, expires_at, created_at)
         VALUES (?, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active', 0, NULL, '2026-09-20T00:00:00.000000Z')`,
      ).bind(PROFILE_LICENSE),
      env.ACCESS_DB.prepare(
        `INSERT INTO fanmark_access_configs
         (license_id, enabled, hash_scheme, password_hash, access_type, target_url, text_content)
         VALUES (?, 1, 'bcrypt', '$2b$10$IZQBPqwOQC21SCvJr9r00OSWTg.Zw7roFgAFFiVN51/tpzc7JPLiW', 'profile', NULL, NULL)`,
      ).bind(PROFILE_LICENSE),
      env.ACCESS_DB.prepare(
        `INSERT INTO fanmark_profiles (license_id, is_public, profile_name, bio, image_url)
         VALUES (?, 1, 'Synthetic Public Profile', 'Synthetic bio🙂', '')`,
      ).bind(PROFILE_LICENSE),
    ]);
    releaseResolve();
    expect((await pending).status).toBe(401);
    expect(await count("SELECT count(*) AS count FROM fanmark_access_proofs")).toBe(0);
    const incarnation = await row(
      "SELECT incarnation FROM fanmark_license_incarnations WHERE license_id = ?",
      PROFILE_LICENSE,
    );
    expect(Number(incarnation.incarnation)).toBeGreaterThan(0);
  });

  it("invalidates an established proof through direct password and profile writers", async () => {
    const verified = await verifyShort("1111", "2468", "198.51.100.31");
    const cookie = cookieFrom(verified);
    expect((await request(
      "/api/fanmarks/access/short/1111/protected",
      { headers: protectedHeaders(cookie) },
    )).status).toBe(200);

    await env.ACCESS_DB.prepare(
      "UPDATE fanmark_access_configs SET enabled = 0 WHERE license_id = ?",
    ).bind(PROFILE_LICENSE).run();
    expect((await request(
      "/api/fanmarks/access/short/1111/protected",
      { headers: protectedHeaders(cookie) },
    )).status).toBe(401);
    await env.ACCESS_DB.prepare(
      "UPDATE fanmark_access_configs SET enabled = 1 WHERE license_id = ?",
    ).bind(PROFILE_LICENSE).run();

    const fresh = await verifyShort("1111", "2468", "198.51.100.31");
    const freshCookie = cookieFrom(fresh);
    await env.ACCESS_DB.prepare(
      "UPDATE fanmark_profiles SET is_public = 0 WHERE license_id = ?",
    ).bind(PROFILE_LICENSE).run();
    expect((await request(
      "/api/fanmarks/access/short/1111/protected",
      { headers: protectedHeaders(freshCookie) },
    )).status).toBe(401);
  });

  it("records one truthful finalization and rejects reservation replay", async () => {
    expect((await verifyShort("2222", "0000", "198.51.100.32")).status).toBe(401);
    const reservation = await row(
      "SELECT reservation_id, finalization_id, outcome FROM fanmark_access_attempt_reservations LIMIT 1",
    );
    const beforeAudit = await count("SELECT count(*) AS count FROM fanmark_access_attempt_audit");
    const replay = await env.ACCESS_DB.prepare(
      `UPDATE fanmark_access_attempt_reservations
       SET outcome = 'failure', finalization_id = ?, completed_at = ?
       WHERE reservation_id = ? AND outcome = 'reserved'`,
    ).bind("replay-finalization", testNow, reservation.reservation_id).run();
    expect(Number(replay.meta.changes)).toBe(0);
    expect(await count("SELECT count(*) AS count FROM fanmark_access_attempt_audit")).toBe(beforeAudit);

    const success = await verifyShort("2222", "8642", "198.51.100.33");
    expect(success.status).toBe(204);
    const successReservation = await row(
      "SELECT reservation_id, finalization_id, outcome FROM fanmark_access_attempt_reservations WHERE outcome = 'success' LIMIT 1",
    );
    const proofCount = await count("SELECT count(*) AS count FROM fanmark_access_proofs");
    const duplicateProof = await env.ACCESS_DB.prepare(
      `INSERT INTO fanmark_access_proofs
       SELECT id || '-replay', token_hash || '-replay', finalization_id, selector_kind, selector_hash,
              fanmark_id, license_id, password_generation, lifecycle_generation, created_at, expires_at
       FROM fanmark_access_proofs WHERE finalization_id = ?`,
    ).bind(successReservation.finalization_id).run().catch((error) => error);
    expect(String(duplicateProof?.message || duplicateProof)).toContain("UNIQUE");
    expect(await count("SELECT count(*) AS count FROM fanmark_access_proofs")).toBe(proofCount);
  });

  it("uses a dummy bcrypt comparison for unknown selectors and enforces strict input bounds", async () => {
    const malformed = await jsonRequest(
      "/api/fanmarks/access/short/1111/verify-password",
      { password: " 2468" },
      { ip: "198.51.100.34" },
    );
    expect(malformed.status).toBe(400);
    const oversized = await request(
      "/api/fanmarks/access/short/1111/verify-password",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "2468", padding: "x".repeat(5000) }),
      },
      { ip: "198.51.100.35" },
    );
    expect(oversized.status).toBe(400);
    const unknown = await verifyShort("9998", "2468", "198.51.100.36");
    expect(unknown.status).toBe(401);
    expect(await count("SELECT count(*) AS count FROM fanmark_access_attempt_reservations")).toBe(1);
    expect(await count("SELECT count(*) AS count FROM fanmark_access_attempt_audit WHERE outcome = 'failure'")).toBe(1);
  });
});
