import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "../../workers/api/node_modules/miniflare/dist/src/index.js";
import { businessMigrationStatements } from "./business-runtime-import-schema.mjs";
import { inspectAuthIdentityReadiness, AUTH_IDENTITY_PREFLIGHT_SQL } from "./auth-identity-preflight.mjs";

const userA = "aaaaaaaa-1111-4111-8111-111111111111", userB = "bbbbbbbb-1111-4111-8111-111111111111";
async function fixture(run) {
  const mf = new Miniflare({ workers: [{ config: { name: "auth-identity-preflight-test", type: "worker",
    compatibilityDate: "2026-09-18", env: { AUTH_DB: { type: "d1", name: "auth-identity-preflight-test" } },
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm",
      contents: "export default { fetch() { return new Response('local'); } };" } } } } }] });
  try {
    const db = await mf.getD1Database("AUTH_DB");
    for (const file of ["0003_better_auth_core.sql", "0007_auth_signup_command.sql", "0008_auth_user_suspension.sql", "0009_auth_oauth_signup.sql"]) {
      const sql = await readFile(new URL(`../../workers/api/migrations/${file}`, import.meta.url), "utf8");
      await db.batch(businessMigrationStatements(sql).map((s) => db.prepare(s)));
    }
    for (const id of [userA, userB]) await db.prepare('INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES (?,?,?,1,?,?)')
      .bind(id, "Private synthetic name", `${id}@example.invalid`, "2026-10-15", "2026-10-15").run();
    await run(db);
  } finally { await mf.dispose(); }
}
async function account(db, id, userId, providerId, subject) {
  return db.prepare('INSERT INTO "account" (id,"userId","providerId","accountId","createdAt","updatedAt") VALUES (?,?,?,?,?,?)')
    .bind(id, userId, providerId, subject, "2026-10-15", "2026-10-15").run();
}
test("current schema rejects duplicate subjects; preflight detects a missing constraint and duplicates without writes", async () => fixture(async (db) => {
  await account(db, "first", userA, "google", "same-provider-subject");
  await assert.rejects(account(db, "second", userB, "google", "same-provider-subject"));
  assert.equal((await inspectAuthIdentityReadiness(db)).blockers.missingIdentityUniquenessConstraint, 0);
  // Deliberately inject an incomplete/drifted schema, not the current profile.
  await db.prepare('DROP INDEX "account_providerId_accountId_key"').run();
  await account(db, "second", userB, "google", "same-provider-subject");
  const before = await db.prepare('SELECT * FROM "account" ORDER BY id').all();
  const report = await inspectAuthIdentityReadiness(db);
  assert.equal(report.blockers.duplicateIdentityGroups, 1);
  assert.equal(report.blockers.missingIdentityUniquenessConstraint, 1);
  assert.equal(report.identityAndMfaChecksPassed, false);
  assert.equal(report.productionReady, false);
  assert.ok(!JSON.stringify(report).includes(userA));
  assert.ok(!JSON.stringify(report).includes("same-provider-subject"));
  assert.deepEqual(await db.prepare('SELECT * FROM "account" ORDER BY id').all().then((r) => r.results), before.results);
}));

test("preflight distinguishes credential and MFA ambiguities from separate provider namespaces", async () => fixture(async (db) => {
  await account(db, "google", userA, "google", "provider-subject");
  await account(db, "github", userB, "github", "provider-subject");
  await assert.rejects(account(db, "duplicate", userB, "google", "provider-subject"));
  await account(db, "password", userA, "credential", userA);
  await account(db, "other-password", userA, "credential", "another-subject");
  assert.equal((await inspectAuthIdentityReadiness(db)).blockers.duplicateCredentialUsers, 1);
  await db.prepare('DELETE FROM "account" WHERE id = ?').bind("other-password").run();
  await db.prepare('INSERT INTO "twoFactor" (id,secret,"backupCodes","userId",verified) VALUES (?,?,?,?,1)')
    .bind("factor", "SYNTHETIC_SECRET", "SYNTHETIC_BACKUP", userA).run();
  await db.prepare('INSERT INTO "twoFactor" (id,secret,"backupCodes","userId",verified) VALUES (?,?,?,?,1)')
    .bind("duplicate-factor", "SYNTHETIC_SECRET", "SYNTHETIC_BACKUP", userA).run();
  assert.equal((await inspectAuthIdentityReadiness(db)).blockers.duplicateFactorUsers, 1);
  await db.prepare('DELETE FROM "twoFactor" WHERE id = ?').bind("duplicate-factor").run();
  let report = await inspectAuthIdentityReadiness(db);
  assert.equal(report.blockers.verifiedFactorWithoutEnabledMfa, 1);
  await db.prepare('UPDATE "user" SET "twoFactorEnabled" = 1 WHERE id = ?').bind(userA).run();
  await db.prepare('INSERT INTO "adminRole" ("userId",role) VALUES (?,?)').bind(userA, "admin").run();
  report = await inspectAuthIdentityReadiness(db);
  assert.equal(report.identityAndMfaChecksPassed, true);
  assert.equal(report.productionReady, false);
  await db.prepare('DELETE FROM "twoFactor" WHERE "userId" = ?').bind(userA).run();
  report = await inspectAuthIdentityReadiness(db);
  assert.equal(report.blockers.enabledMfaWithoutVerifiedFactor, 1);
  assert.equal(report.blockers.adminsWithoutReadyMfa, 1);
}));

test("unsupported identity namespaces and misplaced credential subjects stop readiness", async () => fixture(async (db) => {
  await account(db, "unknown", userA, "unreviewed", "subject");
  await account(db, "credential", userA, "credential", userB);
  await account(db, "empty", userB, "google", " ");
  const report = await inspectAuthIdentityReadiness(db);
  assert.equal(report.blockers.unsupportedProviderAccounts, 1);
  assert.equal(report.blockers.credentialSubjectMismatches, 1);
  assert.equal(report.blockers.emptyIdentityKeys, 1);
  await db.prepare('UPDATE "user" SET "emailVerified" = 2 WHERE id = ?').bind(userA).run();
  await db.prepare('INSERT INTO "twoFactor" (id,secret,"backupCodes","userId",verified) VALUES (?,?,?,?,2)')
    .bind("invalid-factor", "SYNTHETIC_SECRET", "SYNTHETIC_BACKUP", userB).run();
  const invalidFlags = await inspectAuthIdentityReadiness(db);
  assert.equal(invalidFlags.blockers.invalidUserFlags, 1);
  assert.equal(invalidFlags.blockers.invalidFactorFlags, 1);
}));

test("preflight only issues a fixed SELECT and never exposes provider errors or malformed results", async () => {
  const statements = [];
  const db = { prepare(sql) { statements.push(sql); return { async all() { throw new Error("PRIVATE_TOKEN_AND_EMAIL"); } }; } };
  await assert.rejects(inspectAuthIdentityReadiness(db), { message: "auth_identity_preflight_read_failed" });
  assert.deepEqual(statements, [AUTH_IDENTITY_PREFLIGHT_SQL]);
  assert.match(statements[0], /^SELECT/);
  assert.doesNotMatch(statements[0], /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|PRAGMA)\b/i);
  for (const result of [{ success: false, results: [] }, { success: true }, { success: true, results: [{}] }]) {
    await assert.rejects(inspectAuthIdentityReadiness({ prepare: () => ({ all: async () => result }) }), /result_invalid/);
  }
});
