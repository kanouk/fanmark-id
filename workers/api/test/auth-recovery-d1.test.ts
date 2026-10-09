import { env } from "cloudflare:workers";
import bcrypt from "bcryptjs";
import { beforeAll, expect, inject, it } from "vitest";
import { handleRequest } from "../src";
import type { Env } from "../src/repository";
import { checkedInSqlStatements } from "./schema-statements";
import { AUTH_RECOVERY_TABLES, AUTH_RECOVERY_SCHEMA_SQL, captureAuthRecoverySnapshot,
  sealAuthRecoverySnapshot, openAuthRecoverySnapshot, restoreAuthRecoverySnapshot, authRecoveryDigest,
  type AuthRecoverySnapshot as Snapshot, type AuthRecoveryArchive as Archive } from "../src/auth-d1-recovery";

declare module "vitest" {
  export interface ProvidedContext {
    authRecoveryMigrations: Array<{ name: string; sql: string }>;
  }
}

// This is an isolated synthetic rehearsal, not a production backup utility.
// It deliberately keeps saved sessions to prove complete snapshot fidelity.
// Production session revocation/incarnation policy requires separate acceptance.
const runtime = env as unknown as Env & { RECOVERY_AUTH_DB: D1Database; REVOKED_AUTH_DB: D1Database; ACK_AUTH_DB: D1Database };
const source = runtime.AUTH_DB!;
const target = runtime.RECOVERY_AUTH_DB;
const origin = "https://app.example.test";
const apiBase = "https://api.example.test";
const id = "a0000000-0000-4000-8000-000000000001";
const bannedId = "a0000000-0000-4000-8000-000000000002";
const unverifiedId = "a0000000-0000-4000-8000-000000000003";
const email = "synthetic-auth-recovery@example.invalid";
const password = "Synthetic-Auth-Recovery-Only!2026";
const tableNames = AUTH_RECOVERY_TABLES;
const schemaSql = AUTH_RECOVERY_SCHEMA_SQL;
const capture = (database: D1Database) => captureAuthRecoverySnapshot(database, runtime.BETTER_AUTH_SECRET!);
const seal = (snapshot: Snapshot, key: CryptoKey) =>
  sealAuthRecoverySnapshot(snapshot, key, snapshot.schemaHash, runtime.BETTER_AUTH_SECRET!);
const open = (archive: Archive, key: CryptoKey, expectedSchema: string, authSecret = runtime.BETTER_AUTH_SECRET) =>
  openAuthRecoverySnapshot(archive, key, expectedSchema, authSecret!);
const restore = (database: D1Database, snapshot: Snapshot) => restoreAuthRecoverySnapshot(database, snapshot, {
  expectedSchemaHash: snapshot.schemaHash, authSecret: runtime.BETTER_AUTH_SECRET!,
  sessionPolicy: "isolated-preserve", isolatedFidelity: true,
});

function mergeCookies(previous: string, response: Response): string {
  const jar = new Map(previous.split("; ").filter(Boolean).map(x => [x.split("=", 1)[0], x]));
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0]; jar.set(pair.split("=", 1)[0], pair);
  }
  return [...jar.values()].join("; ");
}

async function request(database: D1Database, path: string, cookie = "", body?: unknown): Promise<Response> {
  const headers = new Headers({ origin, cookie });
  if (body !== undefined) headers.set("content-type", "application/json");
  return handleRequest(new Request(apiBase + path, { method: body === undefined ? "GET" : "POST",
    headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { ...runtime, AUTH_DB: database });
}

async function totp(secret: string): Promise<string> {
  let value = 0, bits = 0; const bytes: number[] = [];
  for (const character of secret) {
    const digit = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(character);
    expect(digit).toBeGreaterThanOrEqual(0); value = (value << 5) | digit; bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 255); }
  }
  const key = await crypto.subtle.importKey("raw", new Uint8Array(bytes),
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(Math.floor(Date.now() / 30_000)));
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = hmac[hmac.length - 1] & 15;
  const number = new DataView(hmac.buffer).getUint32(offset) & 0x7fffffff;
  return String(number % 1_000_000).padStart(6, "0");
}

beforeAll(async () => {
  const migrations = inject("authRecoveryMigrations"); expect(migrations).toHaveLength(4);
  for (const migration of migrations) {
    await source.batch(checkedInSqlStatements(migration.sql).map(sql => source.prepare(sql)));
  }
});

it("restores an encrypted complete Auth snapshot and proves password, factor, sessions, linked identity and suspension behavior", async () => {
  const now = new Date().toISOString(); const passwordHash = await bcrypt.hash(password, 10);
  for (const [userId, userEmail, verified, banned] of [
    [id, email, 1, 0], [bannedId, "suspended-recovery@example.invalid", 1, 1],
    [unverifiedId, "unverified-recovery@example.invalid", 0, 0],
  ] as const) {
    await source.batch([
      source.prepare('INSERT INTO "user" (id,name,email,emailVerified,banned,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)')
        .bind(userId, "Synthetic recovery", userEmail, verified, banned, now, now),
      source.prepare('INSERT INTO "account" (id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (?,?,\'credential\',?,?,?,?)')
        .bind(userId + "-credential", userId, userId, passwordHash, now, now),
    ]);
  }
  await source.batch([
    source.prepare('INSERT INTO "adminRole" (userId,role) VALUES (?,\'admin\')').bind(id),
    source.prepare('INSERT INTO "account" (id,accountId,providerId,userId,accessToken,refreshToken,idToken,scope,createdAt,updatedAt) VALUES (?,?,\'google\',?,?,?,?,?,?,?)')
      .bind(id + "-google", "synthetic-google-subject", id, "synthetic-access", "synthetic-refresh", "synthetic-id-token", "openid email profile", now, now),
    source.prepare('INSERT INTO "adminUserStatusAudit" (id,actorUserId,targetUserId,action,reason,createdAt) VALUES (?,?,?,\'ADMIN_SUSPEND_USER\',?,?)')
      .bind(crypto.randomUUID(), id, bannedId, "Synthetic suspension", now),
    source.prepare('INSERT INTO "verification" (id,identifier,value,expiresAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), "synthetic-recovery-marker", "synthetic-verification-value",
        new Date(Date.now() + 3_600_000).toISOString(), now, now),
  ]);
  const initial = await request(source, "/api/auth/sign-in/email", "", { email, password });
  expect(initial.status).toBe(200); let cookie = mergeCookies("", initial);
  const enrollment = await request(source, "/api/auth/two-factor/enable", cookie, { method: "totp", password });
  expect(enrollment.status).toBe(200);
  const enrolled = await enrollment.json() as { totpURI: string; backupCodes: string[] };
  const secret = new URL(enrolled.totpURI).searchParams.get("secret")!;
  const verified = await request(source, "/api/auth/two-factor/verify-totp", cookie, { code: await totp(secret) });
  expect(verified.status).toBe(200); cookie = mergeCookies(cookie, verified);
  expect((await request(source, "/api/admin/session", cookie)).status).toBe(200);

  const snapshot = await capture(source);
  expect(snapshot.tables.account).toHaveLength(4);
  expect(snapshot.tables.user).toHaveLength(3);
  expect(snapshot.tables.twoFactor).toHaveLength(1);
  expect(snapshot.tables.session).toHaveLength(1);
  expect(snapshot.tables.mfaAssurance).toHaveLength(1);
  expect(snapshot.tables.verification).toHaveLength(1);
  expect(Object.values(snapshot.tables).every(rows => rows.length > 0)).toBe(true);
  expect(snapshot.tables.twoFactor[0].secret).not.toBe(secret);
  expect(String(snapshot.tables.twoFactor[0].backupCodes)).not.toContain(enrolled.backupCodes[0]);
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const weakKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, false, ["encrypt", "decrypt"]);
  await expect(seal(snapshot, weakKey)).rejects.toThrow("auth_recovery_archive_key_invalid");
  const archive = await seal(snapshot, key);
  expect(JSON.stringify(archive)).not.toContain(passwordHash);
  const serialized = JSON.stringify(archive);
  const recovered = await open(JSON.parse(serialized) as Archive, key, snapshot.schemaHash);

  // These refusals happen before any target SQL, and leave its schema empty.
  const wrongKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await expect(open(archive, wrongKey, snapshot.schemaHash)).rejects.toThrow("auth_recovery_decryption_failed");
  await expect(open(archive, key, "wrong-schema")).rejects.toThrow("auth_recovery_schema_mismatch");
  await expect(open(archive, key, snapshot.schemaHash, "different-server-secret-for-synthetic-recovery-only")).rejects.toThrow("auth_recovery_server_key_mismatch");
  const tampered = structuredClone(archive); tampered.ciphertext[10] ^= 1;
  await expect(open(tampered, key, snapshot.schemaHash)).rejects.toThrow("auth_recovery_decryption_failed");
  expect((await target.prepare(schemaSql).all()).results).toEqual([]);

  await restore(target, recovered);
  await expect(restore(target, recovered)).rejects.toThrow("auth_recovery_target_not_empty");
  expect(await capture(target)).toEqual(snapshot);
  // Exact snapshot fidelity includes the old isolated session and assurance.
  expect((await request(target, "/api/auth/get-session", cookie)).status).toBe(200);
  expect((await request(target, "/api/admin/session", cookie)).status).toBe(200);
  expect((await request(target, "/api/auth/sign-out", cookie, {})).status).toBe(200);
  expect(await target.prepare('SELECT count(*) AS count FROM "session"').first("count")).toBe(0);
  expect(await target.prepare('SELECT count(*) AS count FROM "mfaAssurance"').first("count")).toBe(0);
  const stale = await request(target, "/api/auth/get-session", cookie);
  expect(await stale.json()).toBeNull();

  expect((await request(target, "/api/auth/sign-in/email", "", { email, password: password + "-wrong" })).status).toBe(401);
  expect((await request(target, "/api/auth/sign-in/email", "", { email: "unverified-recovery@example.invalid", password })).status).toBe(403);
  const suspended = await request(target, "/api/auth/sign-in/email", "", { email: "suspended-recovery@example.invalid", password });
  expect(suspended.status).toBe(403); expect((await suspended.json() as { code: string }).code).toBe("BANNED_USER");

  const relogin = await request(target, "/api/auth/sign-in/email", "", { email, password });
  expect(relogin.status).toBe(200); expect((await relogin.clone().json() as { twoFactorRedirect: boolean }).twoFactorRedirect).toBe(true);
  let challenge = mergeCookies("", relogin);
  expect(await target.prepare('SELECT count(*) AS count FROM "session"').first("count")).toBe(0);
  const checked = await request(target, "/api/auth/two-factor/verify-totp", challenge, { code: await totp(secret) });
  expect(checked.status).toBe(200); challenge = mergeCookies(challenge, checked);
  expect((await request(target, "/api/admin/session", challenge)).status).toBe(200);
  expect((await request(target, "/api/auth/sign-out", challenge, {})).status).toBe(200);

  const backupLogin = await request(target, "/api/auth/sign-in/email", "", { email, password });
  expect(backupLogin.status).toBe(200); let backupCookie = mergeCookies("", backupLogin);
  const backup = await request(target, "/api/auth/two-factor/verify-backup-code", backupCookie, { code: enrolled.backupCodes[0] });
  expect(backup.status).toBe(200); backupCookie = mergeCookies(backupCookie, backup);
  expect((await request(target, "/api/auth/get-session", backupCookie)).status).toBe(200);
  // The current admin assurance plugin is specifically TOTP-bound.
  expect((await request(target, "/api/admin/session", backupCookie)).status).toBe(403);
  expect((await request(target, "/api/auth/sign-out", backupCookie, {})).status).toBe(200);
  const retryLogin = await request(target, "/api/auth/sign-in/email", "", { email, password });
  const replay = await request(target, "/api/auth/two-factor/verify-backup-code", mergeCookies("", retryLogin), { code: enrolled.backupCodes[0] });
  expect(replay.status).toBe(401);
  const revoked = runtime.REVOKED_AUTH_DB;
  // Refuse missing policy or preservation outside isolated fidelity before target SQL.
  await expect(restoreAuthRecoverySnapshot(revoked, recovered, {
    expectedSchemaHash: snapshot.schemaHash, authSecret: runtime.BETTER_AUTH_SECRET!,
    // @ts-expect-error unconfigured JavaScript caller must not adopt a default policy.
    sessionPolicy: undefined,
  })).rejects.toThrow("auth_recovery_session_policy_required");
  await expect(restoreAuthRecoverySnapshot(revoked, recovered, {
    expectedSchemaHash: snapshot.schemaHash, authSecret: runtime.BETTER_AUTH_SECRET!, sessionPolicy: "isolated-preserve",
  })).rejects.toThrow("auth_recovery_session_policy_required");
  expect((await revoked.prepare(schemaSql).all()).results).toEqual([]);

  // A bad inserted column exercises real transaction rollback of tables and rows.
  const invalid = structuredClone(recovered);
  invalid.tables.user[0].nonexistent_recovery_column = "synthetic";
  invalid.rowsHash = await authRecoveryDigest(invalid.tables);
  await expect(restoreAuthRecoverySnapshot(revoked, invalid, {
    expectedSchemaHash: snapshot.schemaHash, authSecret: runtime.BETTER_AUTH_SECRET!,
    sessionPolicy: "revoke-local-sessions-and-challenges",
  })).rejects.toThrow("auth_recovery_restore_failed");
  expect((await revoked.prepare(schemaSql).all()).results).toEqual([]);

  const revokedSnapshot = await restoreAuthRecoverySnapshot(revoked, recovered, {
    expectedSchemaHash: snapshot.schemaHash, authSecret: runtime.BETTER_AUTH_SECRET!,
    sessionPolicy: "revoke-local-sessions-and-challenges",
  });
  for (const table of ["session", "mfaAssurance", "verification"]) expect(revokedSnapshot.tables[table]).toEqual([]);
  for (const table of tableNames.filter(name => !["session", "mfaAssurance", "verification"].includes(name))) {
    expect(revokedSnapshot.tables[table]).toEqual(snapshot.tables[table]);
  }
  expect(await (await request(revoked, "/api/auth/get-session", cookie)).json()).toBeNull();
  expect((await request(revoked, "/api/admin/session", cookie)).status).toBe(401);
  const fresh = await request(revoked, "/api/auth/sign-in/email", "", { email, password });
  expect(fresh.status).toBe(200);
  expect((await fresh.clone().json() as { twoFactorRedirect: boolean }).twoFactorRedirect).toBe(true);
  const freshTotp = await request(revoked, "/api/auth/two-factor/verify-totp", mergeCookies("", fresh), { code: await totp(secret) });
  expect(freshTotp.status).toBe(200);
  const freshCookie = mergeCookies(mergeCookies("", fresh), freshTotp);
  expect((await request(revoked, "/api/admin/session", freshCookie)).status).toBe(200);
  expect((await request(revoked, "/api/auth/sign-out", freshCookie, {})).status).toBe(200);
  expect((await revoked.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  // Lost acknowledgement: commit once, then throw; preserve the written target and refuse blind replay.
  const ackTarget = runtime.ACK_AUTH_DB;
  await ackTarget.prepare("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT)").run();
  const ackOptions = { expectedSchemaHash: snapshot.schemaHash, authSecret: runtime.BETTER_AUTH_SECRET!,
    sessionPolicy: "revoke-local-sessions-and-challenges" as const };
  await expect(restoreAuthRecoverySnapshot(ackTarget, recovered, ackOptions)).rejects.toThrow("auth_recovery_target_not_empty");
  expect((await ackTarget.prepare("SELECT name FROM sqlite_master WHERE name='d1_migrations'").all()).results).toHaveLength(1);
  await ackTarget.prepare("DROP TABLE d1_migrations").run();
  let committedBatches = 0;
  const lostAckTarget = new Proxy(ackTarget, {
    get(database, property) {
      if (property === "batch") return async (statements: D1PreparedStatement[]) => {
        await database.batch(statements); committedBatches += 1;
        throw new Error("synthetic-lost-ack-after-real-commit");
      };
      const value = Reflect.get(database, property);
      return typeof value === "function" ? value.bind(database) : value;
    },
  });
  await expect(restoreAuthRecoverySnapshot(lostAckTarget, recovered, ackOptions)).rejects.toThrow("auth_recovery_restore_failed");
  expect(committedBatches).toBe(1);
  expect(await capture(ackTarget)).toEqual(revokedSnapshot);
  await expect(restoreAuthRecoverySnapshot(ackTarget, recovered, ackOptions)).rejects.toThrow("auth_recovery_target_not_empty");
  expect(await capture(ackTarget)).toEqual(revokedSnapshot);
  expect(snapshot.tables.session).toHaveLength(1);
  expect(snapshot.tables.mfaAssurance).toHaveLength(1);
  expect(snapshot.tables.verification).toHaveLength(1);
  expect(await capture(source)).toEqual(snapshot);
  expect((await target.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  console.info(JSON.stringify({ proof: "synthetic-auth-encrypted-recovery",
    tables: tableNames.length, schemaObjects: snapshot.schema.length,
    rows: Object.values(snapshot.tables).reduce((total, rows) => total + rows.length, 0),
    tableCounts: Object.fromEntries(tableNames.map(name => [name, snapshot.tables[name].length])),
    schemaHash: snapshot.schemaHash, sourceRowsHash: snapshot.rowsHash,
    exactSnapshotRestored: true, passwordAndTotpRelogin: true,
    backupCodeLoginAndReplayRefusal: true, wrongKeysAndTamperRefused: true,
    existingTargetRefused: true, originalSourceUnchanged: true, remoteWrites: 0,
    explicitSessionPolicyRequired: true, restoredLocalSessionsAndChallengesRevoked: true,
    preservedCredentialsAfterRevocationPermitFreshTotp: true, actualD1RestoreRollback: true, lostAckPreservedAndBlindReplayRefused: true,
  }));
}, 60_000);
