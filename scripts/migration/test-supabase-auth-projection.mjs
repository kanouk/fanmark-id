import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import bcrypt from "../../workers/api/node_modules/bcryptjs/index.js";
import { symmetricEncrypt, symmetricDecrypt } from "../../workers/api/node_modules/better-auth/dist/crypto/index.mjs";
import { Miniflare } from "../../workers/api/node_modules/miniflare/dist/src/index.js";
import { createAuth, captureMfaGeneration } from "../../workers/api/src/better-auth.mjs";
import { businessMigrationStatements } from "./business-runtime-import-schema.mjs";
import { inspectAuthIdentityReadiness } from "./auth-identity-preflight.mjs";
import { projectSupabaseAuth } from "./supabase-auth-projection.mjs";

const id = "aaaaaaaa-1111-4111-8111-111111111111", second = "bbbbbbbb-1111-4111-8111-111111111111";
const factor = "cccccccc-1111-4111-8111-111111111111", identity = "dddddddd-1111-4111-8111-111111111111";
const time = "2026-10-16T00:00:00.000Z", key = "synthetic-migration-only-secret-at-least-32-characters";
// RFC 4226's 20-byte ASCII test key, represented as Supabase's Base32 string.
const totpSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const password = "Synthetic-Migration-Only!2026";
const hash = (await bcrypt.hash(password, 10)).replace(/^\$2b/, "$2a");
function source() {
  return { version: 1, observedAt: time,
    users: [{ id, email: "migration@example.invalid", encrypted_password: hash, email_confirmed_at: time, banned_until: null,
      is_anonymous: false, is_sso_user: false, is_super_admin: null, deleted_at: null, created_at: time, updated_at: time }],
    identities: [{ id: identity, user_id: id, provider: "google", provider_id: "fixed-provider-subject", subject: "fixed-provider-subject", created_at: time, updated_at: time }],
    factors: [{ id: factor, user_id: id, factor_type: "totp", status: "verified", secret: totpSecret }],
    settings: [{ user_id: id, display_name: "Synthetic migration user", plan_type: "admin" }], roles: [{ user_id: id, role: "admin" }] };
}
const options = { encrypt: data => symmetricEncrypt({ key, data }) };
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = "";
  for (const ch of secret) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes = Buffer.from(bits.match(/.{8}/g).map(x => parseInt(x, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", bytes).update(counter).digest(), offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
function cookie(response, fragment) {
  return response.headers.getSetCookie().map(x => x.split(";", 1)[0]).find(x => x.includes(fragment));
}

test("projection preserves UUID, bcrypt, provider subject and TOTP without importing session state", async () => {
  const projected = await projectSupabaseAuth(source(), options);
  assert.equal(projected.tables.user[0].id, id);
  assert.equal(projected.tables.account[0].password, hash);
  assert.equal(projected.tables.account[1].accountId, "fixed-provider-subject");
  assert.equal(await symmetricDecrypt({ key, data: projected.tables.twoFactor[0].secret }), "12345678901234567890");
  assert.equal(await symmetricDecrypt({ key, data: projected.tables.twoFactor[0].backupCodes }), "[]");
  assert.deepEqual(Object.keys(projected.tables), ["user", "account", "twoFactor", "adminRole"]);
  assert.equal(projected.productionReady, false);
});

test("ambiguous and unsupported source identities fail before encryption with sanitized errors", async () => {
  const cases = [
    s => s.users.push({ ...s.users[0], id: second, email: "MIGRATION@example.invalid" }),
    s => s.identities[0].subject = "another-subject",
    s => s.identities[0].user_id = second,
    s => s.identities[0].provider = "unreviewed",
    s => s.identities.push({ ...s.identities[0], id: factor }),
    s => s.users[0].encrypted_password = "PRIVATE_UNKNOWN_HASH",
    s => s.users[0].deleted_at = time,
    s => s.users[0].is_anonymous = true,
    s => s.users[0].email_confirmed_at = undefined,
    s => s.factors[0].status = "unverified",
    s => s.factors[0].secret = "PRIVATE_UNSUPPORTED_SECRET",
    s => s.factors[0].secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
    s => s.factors.push({ ...s.factors[0], id: identity }),
    s => s.roles.length = 0,
    s => s.settings[0].plan_type = "free",
    s => s.settings.length = 0,
  ];
  for (const mutate of cases) {
    const s = source(); mutate(s); let called = false;
    await assert.rejects(projectSupabaseAuth(s, { encrypt() { called = true; throw Error("PRIVATE_ERROR"); } }), error => {
      assert.match(error.message, /^source_auth_[a-z_]+$/); return true;
    });
    assert.equal(called, false);
  }
  await assert.rejects(projectSupabaseAuth(source(), { encrypt() { throw Error("PRIVATE_ERROR"); } }), { message: "source_auth_encryption_failed" });
});

test("unverified email and suspension are preserved; email casing follows Better Auth lookup", async () => {
  const s = source();
  s.users[0].email = "Migration@Example.Invalid";
  s.users[0].email_confirmed_at = null;
  s.users[0].banned_until = "2099-01-01T00:00:00+00:00";
  const row = (await projectSupabaseAuth(s, options)).tables.user[0];
  assert.equal(row.email, "migration@example.invalid");
  assert.equal(row.emailVerified, 0);
  assert.equal(row.banned, 1);
  assert.equal(row.banExpires, "2099-01-01T00:00:00.000Z");
});

test("native D1 and pinned Better Auth require the preserved TOTP before issuing an admin session", async () => {
  const mf = new Miniflare({ workers: [{ config: { name: "source-auth-migration-test", type: "worker", compatibilityDate: "2026-09-18",
    env: { AUTH_DB: { type: "d1", name: "source-auth-migration-test" } },
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: "export default {fetch(){return new Response('local')}}" } } } } }] });
  try {
    const db = await mf.getD1Database("AUTH_DB");
    for (const file of ["0003_better_auth_core.sql", "0007_auth_signup_command.sql", "0008_auth_user_suspension.sql", "0009_auth_oauth_signup.sql"]) {
      await db.batch(businessMigrationStatements(await readFile(new URL(`../../workers/api/migrations/${file}`, import.meta.url), "utf8")).map(s => db.prepare(s)));
    }
    const projection = await projectSupabaseAuth(source(), options);
    const inserts = [];
    for (const [table, rows] of Object.entries(projection.tables)) for (const row of rows) {
      inserts.push(db.prepare(`INSERT INTO "${table}" (${Object.keys(row).map(k => `"${k}"`).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).bind(...Object.values(row)));
    }
    await db.batch(inserts);
    assert.equal((await inspectAuthIdentityReadiness(db)).identityAndMfaChecksPassed, true);
    assert.equal((await db.prepare('SELECT count(*) n FROM "session"').first()).n, 0);
    const env = { AUTH_DB: db, BETTER_AUTH_SECRET: key, BETTER_AUTH_URL: "https://auth.example.invalid", AUTH_USER_STATUS_BACKEND: "d1" };
    const request = async (path, body, cookies) => {
      const auth = createAuth(env, [], await captureMfaGeneration(env));
      return auth.handler(new Request(`${env.BETTER_AUTH_URL}/api/auth${path}`, { method: "POST",
        headers: { "content-type": "application/json", origin: env.BETTER_AUTH_URL, ...(cookies ? { cookie: cookies } : {}) }, body: JSON.stringify(body) }));
    };
    const login = await request("/sign-in/email", { email: source().users[0].email, password });
    assert.equal(login.status, 200, await login.clone().text());
    assert.equal((await login.json()).twoFactorRedirect, true);
    const twoFactorCookie = cookie(login, "two_factor"); assert.ok(twoFactorCookie);
    assert.equal((await db.prepare('SELECT count(*) n FROM "mfaAssurance"').first()).n, 0);
    const verified = await request("/two-factor/verify-totp", { code: totp(totpSecret) }, twoFactorCookie);
    assert.equal(verified.status, 200, await verified.clone().text());
    assert.equal((await verified.json()).user.id, id);
    assert.ok(cookie(verified, "session_token"));
    const assurance = await db.prepare('SELECT "userId", "factorId" FROM "mfaAssurance"').all();
    assert.deepEqual(assurance.results, [{ userId: id, factorId: factor }]);
    await db.prepare('UPDATE "user" SET "banned"=1, "banExpires"=NULL WHERE id=?').bind(id).run();
    assert.equal((await request("/sign-in/email", { email: source().users[0].email, password })).status, 403);
    await db.prepare('UPDATE "user" SET "banned"=0, "emailVerified"=0 WHERE id=?').bind(id).run();
    assert.equal((await request("/sign-in/email", { email: source().users[0].email, password })).status, 403);
  } finally { await mf.dispose(); }
});
