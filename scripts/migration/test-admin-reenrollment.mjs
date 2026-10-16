import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHmac } from "node:crypto";
import bcrypt from "../../workers/api/node_modules/bcryptjs/index.js";
import { symmetricEncrypt, symmetricDecrypt } from "../../workers/api/node_modules/better-auth/dist/crypto/index.mjs";
import { createReenrollmentSession } from "./admin-reenrollment-session.mjs";
import { openAdminReenrollment, SOURCE_PROJECT } from "./admin-reenrollment-capsule.mjs";
import { projectSupabaseAuth } from "./supabase-auth-projection.mjs";

const id = "aaaaaaaa-1111-4111-8111-111111111111", factorId = "bbbbbbbb-1111-4111-8111-111111111111";
const password = "Synthetic-enrollment-only!2026", hash = await bcrypt.hash(password, 10);
function fixture() {
  const time = new Date().toISOString();
  return { version: 1, observedAt: time,
    users: [{ id, email: "admin@example.invalid", encrypted_password: hash, email_confirmed_at: time, banned_until: null,
      is_anonymous: false, is_sso_user: false, is_super_admin: null, deleted_at: null, created_at: time, updated_at: time }],
    identities: [{ id: "cccccccc-1111-4111-8111-111111111111", user_id: id, provider: "google", provider_id: "synthetic-subject", subject: "synthetic-subject", created_at: time, updated_at: time }],
    factors: [{ id: factorId, user_id: id, factor_type: "totp", status: "verified", secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" }],
    settings: [{ user_id: id, display_name: "Synthetic", plan_type: "admin" }], roles: [{ user_id: id, role: "admin" }] };
}
function sourceClient({ aal = "aal2", userId = id } = {}) {
  const user = { id: userId, factors: [{ id: factorId, status: "verified", factor_type: "totp" }] };
  const token = () => `synthetic.${Buffer.from(JSON.stringify({ sub: userId, aal, iss: `https://${SOURCE_PROJECT}.supabase.co/auth/v1`, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+300 })).toString("base64url")}.synthetic`;
  return { auth: {
    signInWithPassword: async input => input.password === password ? { data: { user, session: { access_token: token() } } } : { error: true },
    getUser: async () => ({ data: { user } }), signOut: async () => ({}),
    mfa: { challenge: async () => ({ data: { id: "synthetic-challenge" } }),
      verify: async input => input.code === "123456" ? { data: { access_token: token() } } : { error: true } },
  } };
}
function totp(uri) {
  const secret = new URL(uri).searchParams.get("secret"), alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret].map(c => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const bytes = Buffer.from(bits.match(/.{8}/g).map(x => parseInt(x, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest = createHmac("sha1", bytes).update(counter).digest(), offset = digest[19]&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}

test("source password plus old MFA gates native enrollment; fresh target MFA proof seals source-bound replacement", async () => {
  const source = fixture(), key = randomBytes(32); let capsule = null, reads = 0;
  const session = createReenrollmentSession({ source, key, sourceClient: sourceClient(), readFreshSource: async () => { reads++; return source; }, saveCapsule: async c => { capsule = c; } });
  try {
    await assert.rejects(session.step({ code: "123456" }));
    assert.equal(reads, 0); assert.equal(capsule, null);
    assert.equal((await session.step({ password })).stage, "old-totp");
    await assert.rejects(session.step({ code: "000000" }));
    assert.equal(capsule, null); assert.equal(reads, 0);
    const enabled = await session.step({ code: "123456" });
    assert.equal(enabled.stage, "new-totp"); assert.equal(capsule, null);
    const code = totp(enabled.totpURI);
    await assert.rejects(session.step({ code: code === "000000" ? "000001" : "000000" }));
    assert.equal(capsule, null);
    assert.equal((await session.step({ code: totp(enabled.totpURI) })).stage, "done");
    assert.equal(reads, 2);
    const opened = openAdminReenrollment(source, { capsule, key });
    assert.equal(opened.userId, id); assert.equal(opened.targetFreshSessionVerified, true);
    assert.notEqual(opened.factorId, factorId);
    assert.deepEqual(opened.backupCodes, enabled.backupCodes);
    const targetKey = randomBytes(32).toString("hex");
    const projected = await projectSupabaseAuth(source, { reenrollment: { capsule, key }, encrypt: data => symmetricEncrypt({ key: targetKey, data }) });
    assert.equal(projected.tables.user[0].twoFactorEnabled, 1);
    assert.equal(projected.tables.twoFactor[0].id, opened.factorId);
    assert.equal(await symmetricDecrypt({ key: targetKey, data: projected.tables.twoFactor[0].secret }), opened.rawSecret);
    assert.equal(projected.productionReady, false);
    assert.deepEqual(Object.keys(projected.tables), ["user", "account", "twoFactor", "adminRole"]);
    for (const mutate of [s => s.users[0].encrypted_password = hash.replace(/.$/, "Z"), s => s.factors[0].id = "dddddddd-1111-4111-8111-111111111111", s => s.roles.length = 0, s => s.identities[0].provider_id = "changed", s => s.users[0].banned_until = new Date().toISOString()]) {
      const changed = structuredClone(source); mutate(changed);
      assert.throws(() => openAdminReenrollment(changed, { capsule, key }), /invalid_or_stale/);
    }
    const harmless = structuredClone(source); harmless.users[0].updated_at = new Date().toISOString(); harmless.settings[0].display_name = "Renamed";
    assert.equal(openAdminReenrollment(harmless, { capsule, key }).userId, id);
    assert.throws(() => openAdminReenrollment(source, { capsule, key: randomBytes(32) }), /invalid_or_stale/);
    assert.throws(() => openAdminReenrollment(source, { capsule: { ...capsule, tag: randomBytes(16).toString("base64") }, key }), /invalid_or_stale/);
    assert.throws(() => openAdminReenrollment(source, { capsule, key }, Date.now()+25*3600000), /invalid_or_stale/);
    await assert.rejects(session.step({ code: "123456" }));
  } finally { await session.close(); }
});

test("source user mismatch or AAL1 cannot enroll, and failed attempts close the session", async () => {
  for (const config of [{ userId: "someone-else" }, { aal: "aal1" }]) {
    let saved = false, reads = 0;
    const source = fixture(); const session = createReenrollmentSession({ source, key: randomBytes(32), sourceClient: sourceClient(config), readFreshSource: async () => { reads++; return source; }, saveCapsule: async () => { saved = true; } });
    try {
      if (config.aal) await session.step({ password });
      for (let i = 0; i < 5; i++) await assert.rejects(session.step(config.aal ? { code: "123456" } : { password }));
      assert.equal(session.status().stage, "closed"); assert.equal(saved, false); assert.equal(reads, 0);
    } finally { await session.close(); }
  }
});

test("source drift and expiration cannot produce an artifact", async () => {
  let time = Date.now(), saved = false;
  const source = fixture(), changed = structuredClone(source); changed.identities[0].provider = "github";
  const session = createReenrollmentSession({ source, key: randomBytes(32), sourceClient: sourceClient(), readFreshSource: async () => changed, saveCapsule: async () => { saved = true; }, now: () => time });
  try {
    await session.step({ password }); await assert.rejects(session.step({ code: "123456" }));
    assert.equal(session.status().stage, "old-totp"); assert.equal(saved, false);
    time += 21 * 60000; await assert.rejects(session.step({ code: "123456" })); assert.equal(saved, false);
  } finally { await session.close(); }
});

test("each old-code retry gets a fresh challenge; persisted diagnostics exclude credentials and provider errors", async () => {
  const source = fixture(), client = sourceClient(); let created = 0, saved = false; const seen = [], statuses = [];
  client.auth.mfa.challenge = async () => ({ data: { id: `challenge-${++created}` } });
  client.auth.mfa.verify = async input => { seen.push(input.challengeId); throw Error(`PRIVATE_PROVIDER_ERROR ${password} ${input.code}`); };
  const session = createReenrollmentSession({ source, key: randomBytes(32), sourceClient: client, readFreshSource: async () => source,
    saveCapsule: async () => { saved = true; }, recordStatus: async s => statuses.push(structuredClone(s)) });
  try {
    await session.step({ password }); assert.equal(created, 0);
    for (let i = 0; i < 2; i++) await assert.rejects(session.step({ code: "123456" }), { message: "reenrollment_step_failed" });
    assert.deepEqual(seen, ["challenge-1", "challenge-2"]);
    assert.equal(session.status().lastFailure, "source-totp"); assert.equal(saved, false);
    const json = JSON.stringify(statuses);
    for (const secret of [password, "123456", "PRIVATE_PROVIDER_ERROR", source.users[0].email, source.factors[0].secret]) assert.equal(json.includes(secret), false);
    await session.close(); assert.equal(statuses.at(-1).stage, "closed");
    assert.equal(statuses.at(-1).lastFailure, "source-totp");
  } finally { await session.close(); }
});
