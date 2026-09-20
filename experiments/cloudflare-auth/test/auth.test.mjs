import { beforeAll, describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import schemaSql from "../migrations/0001_better_auth_core.sql?raw";

const userId = "11111111-1111-4111-8111-111111111111";
const mfaUserId = "33333333-3333-4333-8333-333333333333";
const mfaEmail = "mfa@example.invalid";
const mfaPassword = "synthetic-mfa-password";
const bcrypt2aUserId = "55555555-5555-4555-8555-555555555555";
const adminUserId = "77777777-7777-4777-8777-777777777777";
const adminEmail = "admin@example.invalid";
const adminPassword = "synthetic-admin-password";

async function request(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Origin", "http://example.test");
  return exports.default.fetch(
    new Request(`http://example.test${path}`, { ...init, headers }),
  );
}

async function fixtureRequest(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Origin", "http://example.test");
  return env.AUTH_FIXTURE.fetch(
    new Request(`http://example.test${path}`, { ...init, headers }),
  );
}

function cookieFrom(response) {
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie.split(";")[0];
}

function cookiesFromSetCookie(response) {
  const getSetCookie = response.headers.getSetCookie;
  const entries =
    typeof getSetCookie === "function"
      ? getSetCookie.call(response.headers)
      : (response.headers.get("set-cookie") || "").split(/,(?=\s*[^;,=]+=[^;,]*)/);
  return entries.map((value) => value.trim().split(";", 1)[0]).filter(Boolean);
}

function cookieFromSetCookie(response, name) {
  const cookie = cookiesFromSetCookie(response).find((value) =>
    value.startsWith(`${name}=`),
  );
  expect(cookie).toBeTruthy();
  return cookie;
}

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value) {
  let buffer = 0;
  let bits = 0;
  const bytes = [];

  for (const character of value.replace(/=+$/, "").toUpperCase()) {
    const digit = base32Alphabet.indexOf(character);
    if (digit < 0) throw new Error("invalid base32 fixture");
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

async function totpCode(base32Secret, now = Date.now()) {
  const counter = BigInt(Math.floor(now / 30_000));
  const counterBytes = new ArrayBuffer(8);
  new DataView(counterBytes).setBigUint64(0, counter, false);
  const key = await crypto.subtle.importKey(
    "raw",
    decodeBase32(base32Secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, counterBytes),
  );
  const offset = digest[digest.length - 1] & 0x0f;
  const truncated =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(truncated % 1_000_000).padStart(6, "0");
}

async function guaranteedWrongTotp(base32Secret) {
  const now = Date.now();
  const acceptedNeighborhood = new Set(
    await Promise.all(
      [-2, -1, 0, 1, 2].map((periodOffset) =>
        totpCode(base32Secret, now + periodOffset * 30_000),
      ),
    ),
  );
  for (let candidate = 0; candidate < 1_000_000; candidate += 1) {
    const code = String(candidate).padStart(6, "0");
    if (!acceptedNeighborhood.has(code)) return code;
  }
  throw new Error("could not choose a wrong TOTP fixture");
}

beforeAll(async () => {
  const statements = schemaSql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => env.AUTH_DB.prepare(statement));
  await env.AUTH_DB.batch(statements);
});

describe("Better Auth on a local Workers + D1 runtime", () => {
  it("verifies a synthetic legacy bcrypt hash and preserves the UUID in the session relationship", async () => {
    const response = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "legacy@example.invalid",
        password: "synthetic-correct-password",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user.id).toBe(userId);
    expect(body.user.email).toBe("legacy@example.invalid");

    const sessionRow = await env.AUTH_DB.prepare(
      'select "userId", "token" from "session" where "userId" = ? order by "createdAt" desc limit 1',
    )
      .bind(userId)
      .first();
    expect(sessionRow?.userId).toBe(userId);
    expect(typeof sessionRow?.token).toBe("string");

    const sessionResponse = await request("/api/auth/get-session", {
      headers: { Cookie: cookieFrom(response) },
    });
    expect(sessionResponse.status).toBe(200);
    const sessionBody = await sessionResponse.json();
    expect(sessionBody.user.id).toBe(userId);
  });

  it("rejects the wrong password without creating a session", async () => {
    const before = await env.AUTH_DB.prepare(
      'select count(*) as count from "session" where "userId" = ?',
    )
      .bind(userId)
      .first();

    const response = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "legacy@example.invalid",
        password: "synthetic-wrong-password",
      }),
    });

    expect(response.status).toBe(401);
    const after = await env.AUTH_DB.prepare(
      'select count(*) as count from "session" where "userId" = ?',
    )
      .bind(userId)
      .first();
    expect(after?.count).toBe(before?.count);
  });

  it("keeps the UUID relationship when several sign-ins run concurrently", async () => {
    const before = await env.AUTH_DB.prepare(
      'select count(*) as count from "session" where "userId" = ?',
    )
      .bind(userId)
      .first();
    const started = performance.now();

    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        request("/api/auth/sign-in/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "legacy@example.invalid",
            password: "synthetic-correct-password",
          }),
        }),
      ),
    );
    await Promise.all(responses.map((response) => response.text()));
    const elapsedMs = Math.round(performance.now() - started);
    console.info(`[auth-feasibility] concurrent_sign_ins=4 elapsed_ms=${elapsedMs}`);

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    const after = await env.AUTH_DB.prepare(
      'select count(*) as count from "session" where "userId" = ?',
    )
      .bind(userId)
      .first();
    expect(Number(after?.count) - Number(before?.count)).toBe(4);
  });

  it("enrolls TOTP and requires it for the next password sign-in", async () => {
    const initialSignIn = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: mfaEmail, password: mfaPassword }),
    });
    expect(initialSignIn.status).toBe(200);
    const initialCookie = cookieFrom(initialSignIn);

    const enableResponse = await request("/api/auth/two-factor/enable", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: initialCookie,
      },
      body: JSON.stringify({ password: mfaPassword, method: "totp" }),
    });
    expect(enableResponse.status).toBe(200);
    const enableBody = await enableResponse.json();
    expect(enableBody.method).toBe("totp");
    expect(typeof enableBody.totpURI).toBe("string");
    expect(Array.isArray(enableBody.backupCodes)).toBe(true);
    const enrollmentUri = new URL(enableBody.totpURI);
    const base32Secret = enrollmentUri.searchParams.get("secret");
    expect(base32Secret).toBeTruthy();

    const enrollmentCode = await totpCode(base32Secret);
    const enrollmentVerify = await request("/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: initialCookie,
      },
      body: JSON.stringify({ code: enrollmentCode }),
    });
    expect(enrollmentVerify.status).toBe(200);
    const enrollmentVerifyBody = await enrollmentVerify.json();
    expect(enrollmentVerifyBody.user.id).toBe(mfaUserId);
    const authenticatedCookie = cookieFromSetCookie(
      enrollmentVerify,
      "better-auth.session_token",
    );

    const mfaState = await env.AUTH_DB.prepare(
      'select "twoFactorEnabled" from "user" where "id" = ?',
    )
      .bind(mfaUserId)
      .first();
    expect(mfaState?.twoFactorEnabled).toBe(1);
    const factorState = await env.AUTH_DB.prepare(
      'select "id", "userId", "verified" from "twoFactor" where "userId" = ?',
    )
      .bind(mfaUserId)
      .first();
    expect(factorState?.userId).toBe(mfaUserId);
    expect(typeof factorState?.id).toBe("string");
    expect(factorState?.verified).toBe(1);

    const enrolledSession = await request("/api/auth/get-session", {
      headers: { Cookie: authenticatedCookie },
    });
    expect(enrolledSession.status).toBe(200);
    expect((await enrolledSession.json()).user.id).toBe(mfaUserId);

    const signOut = await request("/api/auth/sign-out", {
      method: "POST",
      headers: { Cookie: authenticatedCookie },
    });
    expect(signOut.status).toBe(200);

    const pendingSignIn = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: mfaEmail, password: mfaPassword }),
    });
    expect(pendingSignIn.status).toBe(200);
    const pendingBody = await pendingSignIn.json();
    expect(pendingBody.twoFactorRedirect).toBe(true);
    expect(pendingBody.twoFactorMethods).toEqual(["totp"]);
    const pendingCookies = cookiesFromSetCookie(pendingSignIn);
    const challengeCookie = pendingCookies.find((value) =>
      value.startsWith("better-auth.two_factor="),
    );
    expect(challengeCookie).toBeTruthy();
    const pendingSessionCookie = pendingCookies.find((value) =>
      value.startsWith("better-auth.session_token="),
    );
    expect(
      pendingSessionCookie === undefined ||
        pendingSessionCookie === "better-auth.session_token=",
    ).toBe(true);

    const challengeSession = await request("/api/auth/get-session", {
      headers: { Cookie: pendingCookies.join("; ") },
    });
    expect(challengeSession.status).toBe(200);
    expect(await challengeSession.json()).toBeNull();

    const wrongCode = await guaranteedWrongTotp(base32Secret);
    const wrongVerify = await request("/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: challengeCookie,
      },
      body: JSON.stringify({ code: wrongCode }),
    });
    expect(wrongVerify.status).toBe(401);

    const correctCode = await totpCode(base32Secret);
    const correctVerify = await request("/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: challengeCookie,
      },
      body: JSON.stringify({ code: correctCode }),
    });
    expect(correctVerify.status).toBe(200);
    const correctBody = await correctVerify.json();
    expect(correctBody.user.id).toBe(mfaUserId);
    const finalCookie = cookieFromSetCookie(
      correctVerify,
      "better-auth.session_token",
    );
    const finalSession = await request("/api/auth/get-session", {
      headers: { Cookie: finalCookie },
    });
    expect(finalSession.status).toBe(200);
    expect((await finalSession.json()).user.id).toBe(mfaUserId);
  });

  it("verifies a synthetic legacy bcrypt $2a$10$ hash", async () => {
    const response = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "legacy-2a@example.invalid",
        password: "synthetic-2a-password",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user.id).toBe(bcrypt2aUserId);
    expect(body.user.email).toBe("legacy-2a@example.invalid");

    const wrongPassword = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "legacy-2a@example.invalid",
        password: "synthetic-2a-wrong-password",
      }),
    });
    expect(wrongPassword.status).toBe(401);
  });

  it("requires session-bound TOTP assurance for a local administrator route", async () => {
    const unavailableFixture = await request(
      "/api/auth/__fixture/oauth-equivalent-session",
      { method: "POST" },
    );
    expect(unavailableFixture.status).toBe(404);

    const unauthenticated = await request("/admin/protected");
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("cache-control")).toBe("no-store");

    const nonAdminSignIn = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "legacy@example.invalid",
        password: "synthetic-correct-password",
      }),
    });
    expect(nonAdminSignIn.status).toBe(200);
    const nonAdminCookie = cookieFrom(nonAdminSignIn);
    const nonAdminAdminRoute = await request("/admin/protected", {
      headers: { Cookie: nonAdminCookie },
    });
    expect(nonAdminAdminRoute.status).toBe(403);
    const nonAdminSignOut = await request("/api/auth/sign-out", {
      method: "POST",
      headers: { Cookie: nonAdminCookie },
    });
    expect(nonAdminSignOut.status).toBe(200);

    const initialAdminSignIn = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    expect(initialAdminSignIn.status).toBe(200);
    const initialAdminCookie = cookieFrom(initialAdminSignIn);
    const unverifiedAdminRoute = await request("/admin/protected", {
      headers: { Cookie: initialAdminCookie },
    });
    expect(unverifiedAdminRoute.status).toBe(403);

    const enableResponse = await request("/api/auth/two-factor/enable", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: initialAdminCookie,
      },
      body: JSON.stringify({ password: adminPassword, method: "totp" }),
    });
    expect(enableResponse.status).toBe(200);
    const enableBody = await enableResponse.json();
    const adminSecret = new URL(enableBody.totpURI).searchParams.get("secret");
    expect(adminSecret).toBeTruthy();

    const enrollmentVerify = await request("/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: initialAdminCookie,
      },
      body: JSON.stringify({ code: await totpCode(adminSecret) }),
    });
    expect(enrollmentVerify.status).toBe(200);
    const enrolledAdminCookie = cookieFromSetCookie(
      enrollmentVerify,
      "better-auth.session_token",
    );
    const enrolledAdminRoute = await request("/admin/protected", {
      headers: { Cookie: enrolledAdminCookie },
    });
    expect(enrolledAdminRoute.status).toBe(200);
    expect(enrolledAdminRoute.headers.get("cache-control")).toBe("no-store");
    expect((await enrolledAdminRoute.json()).userId).toBe(adminUserId);
    const adminFactor = await env.AUTH_DB.prepare(
      'select "id", "verified" from "twoFactor" where "userId" = ? limit 1',
    )
      .bind(adminUserId)
      .first();
    expect(typeof adminFactor?.id).toBe("string");
    expect(adminFactor?.verified).toBe(1);
    const adminAssurance = await env.AUTH_DB.prepare(
      'select "sessionId", "factorId" from "mfaAssurance" where "userId" = ? limit 1',
    )
      .bind(adminUserId)
      .first();
    const enrolledAdminSession = await request("/api/auth/get-session", {
      headers: { Cookie: enrolledAdminCookie },
    });
    expect(enrolledAdminSession.status).toBe(200);
    const enrolledAdminSessionBody = await enrolledAdminSession.json();
    expect(adminAssurance?.sessionId).toBe(enrolledAdminSessionBody.session.id);
    expect(adminAssurance?.factorId).toBe(adminFactor.id);

    const adminSignOut = await request("/api/auth/sign-out", {
      method: "POST",
      headers: { Cookie: enrolledAdminCookie },
    });
    expect(adminSignOut.status).toBe(200);
    const signedOutAdminRoute = await request("/admin/protected", {
      headers: { Cookie: enrolledAdminCookie },
    });
    expect(signedOutAdminRoute.status).toBe(401);
    const signOutAssuranceRows = await env.AUTH_DB.prepare(
      'select count(*) as count from "mfaAssurance" where "userId" = ?',
    )
      .bind(adminUserId)
      .first();
    expect(Number(signOutAssuranceRows?.count)).toBe(0);

    const pendingAdminSignIn = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    expect(pendingAdminSignIn.status).toBe(200);
    const pendingAdminBody = await pendingAdminSignIn.json();
    expect(pendingAdminBody.twoFactorRedirect).toBe(true);
    const pendingAdminCookies = cookiesFromSetCookie(pendingAdminSignIn);
    const pendingAdminRoute = await request("/admin/protected", {
      headers: { Cookie: pendingAdminCookies.join("; ") },
    });
    expect(pendingAdminRoute.status).toBe(401);

    const oauthEquivalent = await fixtureRequest(
      "/api/auth/__fixture/oauth-equivalent-session",
      { method: "POST" },
    );
    expect(oauthEquivalent.status).toBe(200);
    expect((await oauthEquivalent.json()).mode).toBe("oauth-equivalent");
    const oauthEquivalentCookie = cookieFromSetCookie(
      oauthEquivalent,
      "better-auth.session_token",
    );
    const bypassedOAuthRoute = await request("/admin/protected", {
      headers: { Cookie: oauthEquivalentCookie },
    });
    expect(bypassedOAuthRoute.status).toBe(403);

    const oauthTOTPVerify = await request("/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: oauthEquivalentCookie,
      },
      body: JSON.stringify({ code: await totpCode(adminSecret) }),
    });
    expect(oauthTOTPVerify.status).toBe(200);
    const assuredOAuthRoute = await request("/admin/protected", {
      headers: { Cookie: oauthEquivalentCookie },
    });
    expect(assuredOAuthRoute.status).toBe(200);
    expect((await assuredOAuthRoute.json()).userId).toBe(adminUserId);

    const changedSession = await fixtureRequest(
      "/api/auth/__fixture/oauth-equivalent-session",
      { method: "POST" },
    );
    expect(changedSession.status).toBe(200);
    const changedSessionCookie = cookieFromSetCookie(
      changedSession,
      "better-auth.session_token",
    );
    const changedSessionAdminRoute = await request("/admin/protected", {
      headers: { Cookie: changedSessionCookie },
    });
    expect(changedSessionAdminRoute.status).toBe(403);

    const disableTwoFactor = await request("/api/auth/two-factor/disable", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: oauthEquivalentCookie,
      },
      body: JSON.stringify({ password: adminPassword }),
    });
    expect(disableTwoFactor.status).toBe(200);
    const disabledAdminCookie = cookieFromSetCookie(
      disableTwoFactor,
      "better-auth.session_token",
    );
    const disabledFactorAdminRoute = await request("/admin/protected", {
      headers: { Cookie: disabledAdminCookie },
    });
    expect(disabledFactorAdminRoute.status).toBe(403);
    const assuranceRows = await env.AUTH_DB.prepare(
      'select count(*) as count from "mfaAssurance" where "userId" = ?',
    )
      .bind(adminUserId)
      .first();
    expect(Number(assuranceRows?.count)).toBe(0);

    const oauthSignOut = await request("/api/auth/sign-out", {
      method: "POST",
      headers: { Cookie: oauthEquivalentCookie },
    });
    expect(oauthSignOut.status).toBe(200);
    const revokedOAuthRoute = await request("/admin/protected", {
      headers: { Cookie: oauthEquivalentCookie },
    });
    expect(revokedOAuthRoute.status).toBe(401);
    await request("/api/auth/sign-out", {
      method: "POST",
      headers: { Cookie: changedSessionCookie },
    });
    await request("/api/auth/sign-out", {
      method: "POST",
      headers: { Cookie: disabledAdminCookie },
    });
  });
});
