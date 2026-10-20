import { env } from "cloudflare:workers";
import bcrypt from "bcryptjs";
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import authSchemaSql from "../migrations/0003_better_auth_core.sql?raw";
import businessSeedSql from "./fixtures/d1-account-deletion-seed.sql?raw";
import signupSchema from "../migrations/0007_auth_signup_command.sql?raw";
import suspensionSchema from "../migrations/0008_auth_user_suspension.sql?raw";
import oauthSchema from "../migrations/0009_auth_oauth_signup.sql?raw";
import { checkedInSqlStatements } from "./schema-statements";

declare module "vitest" {
  export interface ProvidedContext {
    businessAccountDeletionMigrations: Array<{ name: string; sql: string }>;
  }
}
import { handleRequest } from "../src";
import { deleteAuthenticatedAccount } from "../src/account-deletion-auth";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const authDatabase = runtimeEnv.AUTH_DB;
const businessDatabase = runtimeEnv.FANMARK_DB;
const apiBase = "https://api.example.test";
const appOrigin = "https://app.example.test";
const ownerId = "e6194522-507c-4707-86e5-485e31088776";
const otherId = "ac09131e-692a-4f3a-b0d9-4df3ab477e30";
const fanmarkId = "61000000-0000-4000-8000-000000000001";
const licenseId = "61000000-0000-4000-8000-000000000002";
const ownerEmail = "account-delete-owner@example.invalid";
const password = "Synthetic-Account-Deletion!2026";
const now = "2026-09-27T12:00:00.000000Z";
const passwordHash = bcrypt.hashSync(password, 10);

async function request(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", appOrigin);
  return handleRequest(
    new Request(`${apiBase}${path}`, { ...init, headers }),
    { ...runtimeEnv, ...overrides },
  );
}

function jsonRequest(body: unknown, cookie?: string): RequestInit {
  const headers = new Headers({ "content-type": "application/json" });
  if (cookie) headers.set("cookie", cookie);
  return { method: "POST", headers, body: JSON.stringify(body) };
}

async function signIn(): Promise<string> {
  const response = await request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ownerEmail, password }),
  });
  if (response.status !== 200) throw new Error(`synthetic sign-in failed: ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("synthetic session cookie missing");
  return cookie;
}

const cleanupTables = ["fanmarks", "fanmark_licenses", "fanmark_lottery_entries", "fanmark_lottery_history", "user_settings", "enterprise_user_settings",
  "user_roles", "notification_rules", "fanmark_availability_rules", "fanmark_discoveries", "fanmark_favorites", "notifications", "notification_preferences", "notification_events", "audit_logs", "notification_worker_wake_state"];
const authTables = ["user", "account", "session", "twoFactor", "adminRole", "mfaAssurance", "mfaGeneration"];
async function businessSnapshot() {
  return Promise.all(cleanupTables.map(async table => ({ table,
    rows: (await businessDatabase!.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results })));
}
async function authSnapshot() {
  return Promise.all(authTables.map(async table => ({ table,
    rows: (await authDatabase!.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()).results })));
}
async function useReturnedLicense(): Promise<void> {
  await businessDatabase!.prepare("UPDATE fanmark_licenses SET status = 'grace', is_returned = 1, license_end = ?, grace_expires_at = '2099-01-01T00:00:00.000000Z' WHERE id = ?")
    .bind(now, licenseId).run();
}

async function seedAccount(): Promise<void> {
  if (!authDatabase || !businessDatabase) throw new Error("split D1 bindings unavailable");
  await authDatabase.prepare('DELETE FROM "user" WHERE id IN (?, ?)').bind(ownerId, otherId).run();
  for (const id of [ownerId, otherId]) {
    await authDatabase.prepare('INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt,banned) VALUES (?, ?, ?, 1, ?, ?, 0)')
      .bind(id, "Account deletion synthetic", id === ownerId ? ownerEmail : "account-delete-other@example.invalid", now, now).run();
    await authDatabase.prepare('INSERT INTO account (id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, id, "credential", id, passwordHash, now, now).run();
  }
  for (const table of ["user_subscriptions", "user_settings", "enterprise_user_settings", "user_roles", "notifications", "notification_preferences",
    "notification_events", "audit_logs", "notification_rules", "fanmark_availability_rules", "broadcast_emails", "fanmark_lottery_history",
    "fanmark_lottery_entries", "fanmark_transfer_requests", "fanmark_transfer_codes", "fanmark_favorites", "fanmark_discoveries", "fanmark_licenses", "fanmarks", "system_settings"]) {
    await businessDatabase.prepare(`DELETE FROM ${table}`).run();
  }
  await businessDatabase.batch(checkedInSqlStatements(businessSeedSql).map(sql => businessDatabase.prepare(sql)));
}

beforeAll(async () => {
  if (!authDatabase || !businessDatabase) throw new Error("split D1 bindings unavailable");
  for (const sql of [authSchemaSql, signupSchema, suspensionSchema, oauthSchema]) {
    await authDatabase.batch(checkedInSqlStatements(sql).map(statement => authDatabase.prepare(statement)));
  }
  const migrations = inject("businessAccountDeletionMigrations");
  expect(migrations.length).toBeGreaterThanOrEqual(25);
  for (const migration of migrations) {
    const parts = checkedInSqlStatements(migration.sql);
    for (let offset = 0; offset < parts.length; offset += 50) {
      await businessDatabase.batch(parts.slice(offset, offset + 50).map(statement => businessDatabase.prepare(statement)));
    }
  }
});

beforeEach(async () => {
  await seedAccount();
});

afterEach(async () => {
  for (const database of [businessDatabase, authDatabase]) {
    expect((await database!.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  }
  expect(await authDatabase!.prepare('SELECT id FROM "user" WHERE id = ?').bind(otherId).first()).toEqual({ id: otherId });
});

describe("Better Auth account deletion coordinator", () => {
  it("verifies password, returns indefinite Tier C, cleans business rows, and deletes only the owner", async () => {
    const cookie = await signIn();
    const response = await request("/api/me/account/delete", jsonRequest({ confirmation: "DELETE", password }, cookie));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("better-auth.session_token");
    expect(await response.json()).toEqual({ success: true, message: "Account deleted successfully" });

    const authUser = await authDatabase?.prepare('SELECT "id" FROM "user" WHERE "id" = ?').bind(ownerId).first();
    const authSession = await authDatabase?.prepare('SELECT "id" FROM "session" WHERE "userId" = ?').bind(ownerId).first();
    expect(authUser).toBeNull();
    expect(authSession).toBeNull();

    const license = await businessDatabase?.prepare("SELECT user_id, status, license_end, grace_expires_at, is_returned, updated_at FROM fanmark_licenses WHERE id = ?")
      .bind(licenseId).first<Record<string, unknown>>();
    expect(license).toMatchObject({ user_id: null, status: "grace", is_returned: 1 });
    expect(typeof license?.license_end).toBe("string");
    expect(typeof license?.grace_expires_at).toBe("string");
    expect(license?.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);

    const [settings, favorites, notifications, preferences, subscriptions, enterpriseSettings, lottery, history, otherRole, rules, availabilityRule] = await Promise.all([
      businessDatabase?.prepare("SELECT COUNT(*) AS total FROM user_settings WHERE user_id = ?").bind(ownerId).first<{ total: number }>(),
      businessDatabase?.prepare("SELECT COUNT(*) AS total FROM fanmark_favorites WHERE user_id = ?").bind(ownerId).first<{ total: number }>(),
      businessDatabase?.prepare("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?").bind(ownerId).first<{ total: number }>(),
      businessDatabase?.prepare("SELECT COUNT(*) AS total FROM notification_preferences WHERE user_id = ?").bind(ownerId).first<{ total: number }>(),
      businessDatabase?.prepare("SELECT COUNT(*) AS total FROM user_subscriptions WHERE user_id = ?").bind(ownerId).first<{ total: number }>(),
      businessDatabase?.prepare("SELECT COUNT(*) AS total FROM enterprise_user_settings WHERE user_id = ?").bind(ownerId).first<{ total: number }>(),
      businessDatabase?.prepare("SELECT entry_status, cancellation_reason FROM fanmark_lottery_entries WHERE user_id = ?").bind(ownerId).first<Record<string, unknown>>(),
      businessDatabase?.prepare("SELECT winner_user_id FROM fanmark_lottery_history WHERE id = '62000000-0000-4000-8000-000000000012'").first<Record<string, unknown>>(),
      businessDatabase?.prepare("SELECT created_by FROM user_roles WHERE user_id = ?").bind(otherId).first<Record<string, unknown>>(),
      businessDatabase?.prepare("SELECT created_by FROM notification_rules WHERE id = '62000000-0000-4000-8000-000000000003'").first<Record<string, unknown>>(),
      businessDatabase?.prepare("SELECT created_by, created_at, updated_at FROM fanmark_availability_rules WHERE id = '62000000-0000-4000-8000-000000000004'")
        .first<Record<string, unknown>>(),
    ]);
    expect(settings?.total).toBe(0);
    expect(favorites?.total).toBe(0);
    expect(notifications?.total).toBe(0);
    expect(preferences?.total).toBe(0);
    expect(subscriptions?.total).toBe(0);
    expect(enterpriseSettings?.total).toBe(0);
    expect(lottery).toEqual({ entry_status: "cancelled", cancellation_reason: "user_request" });
    const cancelledLottery = await businessDatabase?.prepare(
      "SELECT cancelled_at, updated_at FROM fanmark_lottery_entries WHERE user_id = ?",
    ).bind(ownerId).first<{ cancelled_at: string; updated_at: string }>();
    expect(cancelledLottery?.cancelled_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
    expect(cancelledLottery?.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
    const lotteryAudit = await businessDatabase?.prepare(
      "SELECT user_id, resource_type, resource_id, metadata, created_at FROM audit_logs WHERE action = 'LOTTERY_ENTRY_STATUS_CHANGED'",
    ).first<Record<string, unknown>>();
    expect(lotteryAudit).toMatchObject({ user_id: ownerId, resource_type: "fanmark_lottery_entry",
      resource_id: "62000000-0000-4000-8000-000000000011", created_at: cancelledLottery?.updated_at });
    expect(JSON.parse(String(lotteryAudit?.metadata))).toEqual({
      old_status: "pending", new_status: "cancelled", cancellation_reason: "user_request",
    });
    expect(history).toEqual({ winner_user_id: null });
    expect(otherRole).toEqual({ created_by: null });
    expect(rules).toEqual({ created_by: null });
    expect(availabilityRule?.created_by).toBeNull();
    expect(availabilityRule?.created_at).toBe("2026-09-01T00:00:00.000000Z");
    expect(availabilityRule?.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
    expect(availabilityRule?.updated_at).not.toBe(now);

    const events = await businessDatabase?.prepare("SELECT event_type, payload FROM notification_events ORDER BY event_type").all<Record<string, unknown>>();
    expect(events?.results).toHaveLength(1);
    expect(events?.results[0]?.event_type).toBe("favorite_fanmark_available");
    expect(String(events?.results[0]?.payload)).toContain(otherId);
    const audits = await businessDatabase?.prepare("SELECT action, metadata FROM audit_logs WHERE user_id = ? ORDER BY action").bind(ownerId).all<Record<string, unknown>>();
    expect(audits?.results.map((row) => row.action)).toContain("FANMARK_RETURNED_ON_ACCOUNT_DELETE");
    expect(audits?.results.map((row) => row.action)).toContain("DELETE_ACCOUNT");
    expect(JSON.stringify(audits?.results)).not.toContain(ownerEmail);
  });

  it("retains Auth and rolls back business cleanup on cancellation-audit failure, then resumes deletion", async () => {
    const cookie = await signIn();
    await businessDatabase?.prepare(`CREATE TRIGGER reject_deletion_lottery_audit BEFORE INSERT ON audit_logs
      WHEN NEW.action = 'LOTTERY_ENTRY_STATUS_CHANGED'
      BEGIN SELECT RAISE(ABORT, 'synthetic deletion lottery audit failure'); END`).run();
    try {
      const failed = await request("/api/me/account/delete", jsonRequest({ confirmation: "DELETE", password }, cookie));
      expect(failed.status).toBeGreaterThanOrEqual(500);
      expect(await authDatabase?.prepare('SELECT "id" FROM "user" WHERE "id" = ?').bind(ownerId).first())
        .toEqual({ id: ownerId });
      expect(await businessDatabase?.prepare("SELECT user_id FROM user_settings WHERE user_id = ?").bind(ownerId).first())
        .toEqual({ user_id: ownerId });
      expect(await businessDatabase?.prepare("SELECT entry_status FROM fanmark_lottery_entries WHERE user_id = ?")
        .bind(ownerId).first()).toEqual({ entry_status: "pending" });
      // Per-license returns precede business cleanup across the two D1 databases.
      // A failed cleanup preserves that committed grace transition for retry.
      expect(await businessDatabase?.prepare("SELECT user_id, status FROM fanmark_licenses WHERE id = ?")
        .bind(licenseId).first()).toEqual({ user_id: ownerId, status: "grace" });
      expect(await businessDatabase?.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'LOTTERY_ENTRY_STATUS_CHANGED'")
        .first()).toEqual({ count: 0 });
      expect(await businessDatabase?.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'DELETE_ACCOUNT'")
        .first()).toEqual({ count: 0 });
    } finally {
      await businessDatabase?.prepare("DROP TRIGGER reject_deletion_lottery_audit").run();
    }
    const resumed = await request("/api/me/account/delete", jsonRequest({ confirmation: "DELETE", password }, cookie));
    expect(resumed.status).toBe(200);
    expect(await authDatabase?.prepare('SELECT "id" FROM "user" WHERE "id" = ?').bind(ownerId).first()).toBeNull();
    const audits = await businessDatabase?.prepare("SELECT action, COUNT(*) AS count FROM audit_logs WHERE user_id = ? GROUP BY action")
      .bind(ownerId).all<{ action: string; count: number }>();
    expect(audits?.results).toEqual(expect.arrayContaining([
      { action: "FANMARK_RETURNED_ON_ACCOUNT_DELETE", count: 1 },
      { action: "LOTTERY_ENTRY_STATUS_CHANGED", count: 1 },
      { action: "DELETE_ACCOUNT", count: 1 },
    ]));
  });

  const auditFaults = [
    ["ignored", "BEFORE", "SELECT RAISE(IGNORE);"],
    ["metadata", "AFTER", "UPDATE audit_logs SET metadata = '{}' WHERE id = NEW.id;"],
    ["deleted", "AFTER", "DELETE FROM audit_logs WHERE id = NEW.id;"],
    ["id", "AFTER", "UPDATE audit_logs SET id = '62000000-0000-4000-8000-000000000099' WHERE id = NEW.id;"],
    ["actor", "AFTER", `UPDATE audit_logs SET user_id = '${otherId}' WHERE id = NEW.id;`],
    ["action", "AFTER", "UPDATE audit_logs SET action = 'SYNTHETIC_WRONG_ACTION' WHERE id = NEW.id;"],
    ["type", "AFTER", "UPDATE audit_logs SET resource_type = 'wrong_type' WHERE id = NEW.id;"],
    ["resource", "AFTER", `UPDATE audit_logs SET resource_id = '${otherId}' WHERE id = NEW.id;`],
    ["time", "AFTER", "UPDATE audit_logs SET created_at = '2000-01-01T00:00:00.000000Z' WHERE id = NEW.id;"],
    ["request", "AFTER", "UPDATE audit_logs SET request_id = '62000000-0000-4000-8000-000000000099' WHERE id = NEW.id;"],
  ];
  it.each(["LOTTERY_ENTRY_STATUS_CHANGED", "DELETE_ACCOUNT"].flatMap(action => auditFaults.map(([name,timing,sql]) => ({action,name,timing,sql}))))(
    "rolls back $action audit $name and retries once", async ({action,timing,sql}) => {
      await useReturnedLicense();
      const cookie = await signIn();
      const before = await businessSnapshot();
      const authBefore = await authSnapshot();
      await businessDatabase!.prepare(`CREATE TRIGGER fault_deletion_audit ${timing} INSERT ON audit_logs WHEN NEW.action = '${action}' BEGIN ${sql} END`).run();
      try {
        expect((await request("/api/me/account/delete", jsonRequest({ confirmation: "DELETE", password }, cookie))).status).toBe(503);
        expect(await businessSnapshot()).toEqual(before);
        expect(await authSnapshot()).toEqual(authBefore);
      } finally { await businessDatabase!.prepare("DROP TRIGGER fault_deletion_audit").run(); }
      expect((await request("/api/me/account/delete", jsonRequest({ confirmation: "DELETE", password }, cookie))).status).toBe(200);
      expect((await businessDatabase!.prepare("SELECT action,count(*) AS n FROM audit_logs WHERE action IN ('LOTTERY_ENTRY_STATUS_CHANGED','DELETE_ACCOUNT') GROUP BY action ORDER BY action").all()).results)
        .toEqual([{ action: "DELETE_ACCOUNT", n: 1 }, { action: "LOTTERY_ENTRY_STATUS_CHANGED", n: 1 }]);
    },
  );

  it.each(["IGNORE", "ABORT"])("preserves all Auth credentials/session on native user-delete %s and resumes once", async fault => {
    const cookie = await signIn();
    const before = await authSnapshot();
    await authDatabase!.prepare(`CREATE TRIGGER fault_auth_user_delete BEFORE DELETE ON "user" WHEN OLD.id = '${ownerId}' BEGIN SELECT RAISE(${fault}${fault === "ABORT" ? ", 'synthetic auth deletion failure'" : ""}); END`).run();
    try {
      expect((await request("/api/me/account/delete", jsonRequest({ confirmation: "DELETE", password }, cookie))).status).toBe(503);
      expect(await authSnapshot()).toEqual(before);
    } finally {
      await authDatabase!.prepare("DROP TRIGGER fault_auth_user_delete").run();
    }
    expect((await request("/api/me/account/delete", jsonRequest({ confirmation: "DELETE", password }, cookie))).status).toBe(200);
    expect(await businessDatabase!.prepare("SELECT action,count(*) AS n FROM audit_logs WHERE user_id = ? GROUP BY action").bind(ownerId).all()).toMatchObject({ results: expect.arrayContaining([{ action: "DELETE_ACCOUNT", n: 1 }, { action: "LOTTERY_ENTRY_STATUS_CHANGED", n: 1 }, { action: "FANMARK_RETURNED_ON_ACCOUNT_DELETE", n: 1 }]) });
    expect(await authDatabase!.prepare('SELECT id FROM "user" WHERE id = ?').bind(ownerId).first()).toBeNull();
  });

  it.each([
    ["settings", "DELETE", "user_settings", `OLD.user_id = '${ownerId}'`],
    ["enterprise", "DELETE", "enterprise_user_settings", `OLD.user_id = '${ownerId}'`],
    ["favorites", "DELETE", "fanmark_favorites", `OLD.user_id = '${ownerId}'`],
    ["inbox", "DELETE", "notifications", `OLD.user_id = '${ownerId}'`],
    ["preferences", "DELETE", "notification_preferences", `OLD.user_id = '${ownerId}'`],
    ["pending event", "DELETE", "notification_events", `OLD.id = '62000000-0000-4000-8000-000000000010'`],
    ["own roles", "DELETE", "user_roles", `OLD.user_id = '${ownerId}'`],
    ["role creator", "UPDATE", "user_roles", `OLD.user_id = '${otherId}'`],
    ["availability creator", "UPDATE", "fanmark_availability_rules", `OLD.created_by = '${ownerId}'`],
    ["rule creator", "UPDATE", "notification_rules", `OLD.created_by = '${ownerId}'`],
    ["history winner", "UPDATE", "fanmark_lottery_history", `OLD.winner_user_id = '${ownerId}'`],
    ["license owner", "UPDATE", "fanmark_licenses", `NEW.user_id IS NULL AND OLD.user_id = '${ownerId}'`],
    ["lottery cancellation", "UPDATE", "fanmark_lottery_entries", `OLD.user_id = '${ownerId}' AND NEW.entry_status = 'cancelled'`],
  ])("rolls back when %s is suppressed", async (_name,operation,table,condition) => {
    await useReturnedLicense();
    const cookie = await signIn();
    const before = await businessSnapshot();
    const authBefore = await authSnapshot();
    await businessDatabase!.prepare(`CREATE TRIGGER fault_cleanup_effect BEFORE ${operation} ON ${table} WHEN ${condition} BEGIN SELECT RAISE(IGNORE); END`).run();
    try {
      expect((await request("/api/me/account/delete", jsonRequest({confirmation:"DELETE",password},cookie))).status).toBe(503);
      expect(await businessSnapshot()).toEqual(before);
      expect(await authSnapshot()).toEqual(authBefore);
    } finally { await businessDatabase!.prepare("DROP TRIGGER fault_cleanup_effect").run(); }
    expect((await request("/api/me/account/delete", jsonRequest({confirmation:"DELETE",password},cookie))).status).toBe(200);
  });

  it.each(["fanmark_availability_rules", "notification_rules", "fanmark_lottery_history", "user_roles"])(
    "preserves retained %s when a trigger deletes its row instead of clearing the reference", async table => {
      await useReturnedLicense();
      const cookie = await signIn();
      const before = await businessSnapshot();
      const column = table === "fanmark_lottery_history" ? "winner_user_id" : "created_by";
      const otherRole = table === "user_roles" ? `AND OLD.user_id = '${otherId}'` : "";
      await businessDatabase!.prepare(`CREATE TRIGGER fault_retained_row AFTER UPDATE ON ${table}
        WHEN OLD.${column} = '${ownerId}' AND NEW.${column} IS NULL ${otherRole}
        BEGIN DELETE FROM ${table} WHERE id = NEW.id; END`).run();
      try {
        expect((await request("/api/me/account/delete", jsonRequest({confirmation:"DELETE",password},cookie))).status).toBe(503);
        expect(await businessSnapshot()).toEqual(before);
      } finally { await businessDatabase!.prepare("DROP TRIGGER fault_retained_row").run(); }
      expect((await request("/api/me/account/delete", jsonRequest({confirmation:"DELETE",password},cookie))).status).toBe(200);
    },
  );

  it.each(["session", "account", "twoFactor", "adminRole", "mfaAssurance"])(
    "rolls back all Auth state if the %s cascade is suppressed", async table => {
      const cookie = await signIn();
      const session = await authDatabase!.prepare('SELECT id FROM session WHERE userId = ?').bind(ownerId).first<{id:string}>();
      const factorId = "62000000-0000-4000-8000-000000000080";
      await authDatabase!.prepare('INSERT INTO "twoFactor" (id,secret,backupCodes,userId,verified) VALUES (?, ?, ?, ?, 1)')
        .bind(factorId,"synthetic-factor","synthetic-backup",ownerId).run();
      await authDatabase!.prepare('INSERT INTO "adminRole" (userId,role) VALUES (?, ?)').bind(ownerId,"admin").run();
      await authDatabase!.prepare('INSERT INTO "mfaAssurance" (id,userId,sessionId,factorId,generation,verifiedAt,expiresAt) VALUES (?, ?, ?, ?, 0, ?, ?)')
        .bind("62000000-0000-4000-8000-000000000081",ownerId,session!.id,factorId,now,"2099-01-01T00:00:00.000Z").run();
      const before = await authSnapshot();
      await authDatabase!.prepare(`CREATE TRIGGER fault_auth_cascade BEFORE DELETE ON "${table}" WHEN OLD.userId = '${ownerId}' BEGIN SELECT RAISE(IGNORE); END`).run();
      try {
        expect((await request("/api/me/account/delete", jsonRequest({confirmation:"DELETE",password},cookie))).status).toBe(503);
        expect(await authSnapshot()).toEqual(before);
      } finally { await authDatabase!.prepare("DROP TRIGGER fault_auth_cascade").run(); }
      expect((await request("/api/me/account/delete", jsonRequest({confirmation:"DELETE",password},cookie))).status).toBe(200);
      for (const child of ["account", "session", "twoFactor", "adminRole", "mfaAssurance"]) {
        expect((await authDatabase!.prepare(`SELECT userId FROM "${child}" WHERE userId = ?`).bind(ownerId).all()).results).toEqual([]);
      }
    },
  );

  it("revokes every warmed session and credential while retaining another user's login", async () => {
    const cookies = [await signIn(), await signIn()];
    for (const cookie of cookies) expect(await (await request("/api/auth/get-session", {headers:{cookie}})).json()).toMatchObject({user:{id:ownerId}});
    const otherLogin = await request("/api/auth/sign-in/email", jsonRequest({email:"account-delete-other@example.invalid",password}));
    expect(otherLogin.status).toBe(200);
    const otherCookie = otherLogin.headers.get("set-cookie")!.split(";",1)[0];
    const otherBefore = await authDatabase!.prepare('SELECT * FROM account WHERE userId = ?').bind(otherId).all();
    await authDatabase!.prepare('INSERT INTO account(id,accountId,providerId,userId,createdAt,updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .bind("62000000-0000-4000-8000-000000000085","synthetic-subject","google",ownerId,now,now).run();
    const deleted = await request("/api/me/account/delete", jsonRequest({confirmation:"DELETE",password},cookies[0]));
    expect(deleted.status).toBe(200);
    expect(deleted.headers.getSetCookie().some(value => value.includes("session_token=") && value.includes("Max-Age=0"))).toBe(true);
    for (const cookie of cookies) {
      expect(await (await request("/api/auth/get-session", {headers:{cookie}})).json()).toBeNull();
      expect((await request("/api/me/account/delete", jsonRequest({confirmation:"DELETE",password},cookie))).status).toBe(401);
    }
    expect(await (await request("/api/auth/get-session", {headers:{cookie:otherCookie}})).json()).toMatchObject({user:{id:otherId}});
    expect((await authDatabase!.prepare('SELECT * FROM account WHERE userId = ?').bind(otherId).all()).results).toEqual(otherBefore.results);
    expect((await request("/api/auth/sign-in/email",jsonRequest({email:ownerEmail,password}))).status).toBe(401);
  });

  it("allows deletion with no pending entries and no duplicate cancellation audit", async () => {
    await businessDatabase!.prepare("UPDATE fanmark_lottery_entries SET entry_status = 'cancelled', cancellation_reason = 'user_request', cancelled_at = ?").bind(now).run();
    const cookie = await signIn();
    expect((await request("/api/me/account/delete",jsonRequest({confirmation:"DELETE",password},cookie))).status).toBe(200);
    expect((await businessDatabase!.prepare("SELECT count(*) AS n FROM audit_logs WHERE action = 'LOTTERY_ENTRY_STATUS_CHANGED'").first())).toEqual({n:0});
  });

  it("requires every pending applicant audit across different licenses while retaining another owner's license", async () => {
    await useReturnedLicense();
    const secondFan = "61000000-0000-4000-8000-000000000091";
    const secondLicense = "61000000-0000-4000-8000-000000000092";
    const secondEntry = "62000000-0000-4000-8000-000000000093";
    await businessDatabase!.prepare(`INSERT INTO fanmarks(id,user_input_fanmark,normalized_emoji,short_id,status,tier_level,emoji_ids,normalized_emoji_ids,created_at,updated_at)
      SELECT ?, '🌹🌹', '🌹🌹', 'delete-second', status, 2, json_array(json_extract(emoji_ids,'$[0]'),json_extract(emoji_ids,'$[0]')),
        json_array(json_extract(normalized_emoji_ids,'$[0]'),json_extract(normalized_emoji_ids,'$[0]')),created_at,updated_at FROM fanmarks WHERE id = ?`).bind(secondFan,fanmarkId).run();
    await businessDatabase!.prepare(`INSERT INTO fanmark_licenses(id,fanmark_id,user_id,display_fanmark,status,license_start,license_end,grace_expires_at,created_at,updated_at)
      SELECT ?, ?, ?, '🌹🌹', status,license_start,license_end,grace_expires_at,created_at,updated_at FROM fanmark_licenses WHERE id = ?`).bind(secondLicense,secondFan,otherId,licenseId).run();
    await businessDatabase!.prepare(`INSERT INTO fanmark_lottery_entries(id,user_id,fanmark_id,license_id,entry_status,applied_at,created_at,updated_at)
      SELECT ?, user_id, ?, ?, entry_status,applied_at,created_at,updated_at FROM fanmark_lottery_entries WHERE user_id = ?`).bind(secondEntry,secondFan,secondLicense,ownerId).run();
    const cookie = await signIn();
    const before = await businessSnapshot();
    await businessDatabase!.prepare(`CREATE TRIGGER fault_second_applicant AFTER INSERT ON audit_logs
      WHEN NEW.action = 'LOTTERY_ENTRY_STATUS_CHANGED' AND NEW.resource_id = '${secondEntry}'
      BEGIN DELETE FROM audit_logs WHERE id = NEW.id; END`).run();
    try {
      expect((await request("/api/me/account/delete",jsonRequest({confirmation:"DELETE",password},cookie))).status).toBe(503);
      expect(await businessSnapshot()).toEqual(before);
    } finally { await businessDatabase!.prepare("DROP TRIGGER fault_second_applicant").run(); }
    expect((await request("/api/me/account/delete",jsonRequest({confirmation:"DELETE",password},cookie))).status).toBe(200);
    const audits = (await businessDatabase!.prepare("SELECT resource_id,created_at,metadata FROM audit_logs WHERE action = 'LOTTERY_ENTRY_STATUS_CHANGED' ORDER BY resource_id").all<{resource_id:string;created_at:string;metadata:string}>()).results;
    expect(audits.map(row=>row.resource_id)).toEqual(["62000000-0000-4000-8000-000000000011",secondEntry]);
    expect(audits[0].created_at).toBe(audits[1].created_at);
    for (const row of audits) expect(JSON.parse(row.metadata)).toEqual({old_status:"pending",new_status:"cancelled",cancellation_reason:"user_request"});
    expect(await businessDatabase!.prepare("SELECT user_id,status FROM fanmark_licenses WHERE id = ?").bind(secondLicense).first()).toEqual({user_id:otherId,status:"grace"});
  });

  it.each(["expired session", "revoked session", "changed password", "suspended user", "ambiguous credential"])(
    "fences an Auth identity changed before batch: %s", async fault => {
      await signIn();
      const session = await authDatabase!.prepare("SELECT id FROM session WHERE userId = ?").bind(ownerId).first<{id:string}>();
      let concurrentState: unknown;
      const guarded = new Proxy(authDatabase!, {
        get(target, key) {
          if (key === "batch") return async (statements: D1PreparedStatement[]) => {
            if (fault === "expired session") await target.prepare("UPDATE session SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(session!.id).run();
            if (fault === "revoked session") await target.prepare("DELETE FROM session WHERE id = ?").bind(session!.id).run();
            if (fault === "changed password") await target.prepare("UPDATE account SET password = ? WHERE userId = ? AND providerId = 'credential'").bind(bcrypt.hashSync("Changed-Synthetic-Password!2026",10),ownerId).run();
            if (fault === "suspended user") await target.prepare('UPDATE "user" SET banned = 1 WHERE id = ?').bind(ownerId).run();
            if (fault === "ambiguous credential") await target.prepare("INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)")
              .bind("62000000-0000-4000-8000-000000000088","second-synthetic-credential",ownerId,passwordHash,now,now).run();
            concurrentState = await authSnapshot();
            return target.batch(statements);
          };
          const value = Reflect.get(target,key,target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      await expect(deleteAuthenticatedAccount(guarded,ownerId,session!.id,password)).rejects.toThrow();
      expect(concurrentState).toBeDefined();
      expect(await authSnapshot()).toEqual(concurrentState);
    },
  );

  it.each(["lottery changed", "new broadcast"])("refuses a business snapshot changed before cleanup: %s", async fault => {
    await useReturnedLicense();
    const cookie = await signIn();
    let concurrentState: unknown;
    const guarded = new Proxy(businessDatabase!, {
      get(target, key) {
        if (key === "batch") return async (statements: D1PreparedStatement[]) => {
          if (statements.length > 20) {
            if (fault === "lottery changed") await target.prepare("UPDATE fanmark_lottery_entries SET updated_at = '2026-10-03T00:00:00.000000Z' WHERE user_id = ?").bind(ownerId).run();
            else await target.prepare("INSERT INTO broadcast_emails(id,created_by,subject,body_text,created_at,updated_at) VALUES (?, ?, 'Synthetic', 'Synthetic', ?, ?)")
              .bind("62000000-0000-4000-8000-000000000013",ownerId,now,now).run();
            concurrentState = await businessSnapshot();
          }
          return target.batch(statements);
        };
        const value = Reflect.get(target,key,target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const authBefore = await authSnapshot();
    expect((await request("/api/me/account/delete",jsonRequest({confirmation:"DELETE",password},cookie),{FANMARK_DB:guarded})).status).toBe(503);
    expect(concurrentState).toBeDefined();
    expect(await businessSnapshot()).toEqual(concurrentState);
    expect(await authSnapshot()).toEqual(authBefore);
    if (fault === "new broadcast") await businessDatabase!.prepare("DELETE FROM broadcast_emails").run();
    expect((await request("/api/me/account/delete",jsonRequest({confirmation:"DELETE",password},cookie))).status).toBe(200);
  });

  it.each(["new customer", "new subscription"])("refuses a billing link introduced after cancellation preflight: %s", async fault => {
    await useReturnedLicense();
    const cookie = await signIn();
    let concurrentState: unknown;
    const guarded = new Proxy(businessDatabase!, {
      get(target,key) {
        if (key === "batch") return async (statements:D1PreparedStatement[]) => {
          if (statements.length > 20) {
            if (fault === "new customer") await target.prepare("UPDATE user_settings SET stripe_customer_id = 'cus_syntheticlate' WHERE user_id = ?").bind(ownerId).run();
            else await target.prepare("INSERT INTO user_subscriptions(id,user_id,stripe_customer_id,stripe_subscription_id,product_id,status,created_at,updated_at) VALUES (?, ?, 'cus_syntheticlate', 'sub_syntheticlate', 'prod_synthetic', 'active', ?, ?)")
              .bind("62000000-0000-4000-8000-000000000090",ownerId,now,now).run();
            concurrentState = await businessSnapshot();
          }
          return target.batch(statements);
        };
        const value = Reflect.get(target,key,target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const authBefore = await authSnapshot();
    expect((await request("/api/me/account/delete",jsonRequest({confirmation:"DELETE",password},cookie),{FANMARK_DB:guarded})).status).toBe(503);
    expect(concurrentState).toBeDefined();
    expect(await businessSnapshot()).toEqual(concurrentState);
    expect(await authSnapshot()).toEqual(authBefore);
  });

  it.each(["customer changed", "subscription inserted"])("rolls back billing links introduced inside cleanup: %s", async fault => {
    await useReturnedLicense();
    const cookie = await signIn();
    const before = await businessSnapshot();
    const authBefore = await authSnapshot();
    const mutation = fault === "customer changed"
      ? `UPDATE user_settings SET stripe_customer_id = 'cus_syntheticlate' WHERE user_id = '${ownerId}';`
      : `INSERT INTO user_subscriptions(id,user_id,stripe_customer_id,stripe_subscription_id,product_id,status,created_at,updated_at)
        VALUES ('62000000-0000-4000-8000-000000000090','${ownerId}','cus_syntheticlate','sub_syntheticlate','prod_synthetic','active','${now}','${now}');`;
    await businessDatabase!.prepare(`CREATE TRIGGER fault_billing_during_cleanup AFTER DELETE ON fanmark_favorites
      WHEN OLD.user_id = '${ownerId}' BEGIN ${mutation} END`).run();
    try {
      expect((await request("/api/me/account/delete",jsonRequest({confirmation:"DELETE",password},cookie))).status).toBe(503);
      expect(await businessSnapshot()).toEqual(before);
      expect(await authSnapshot()).toEqual(authBefore);
    } finally { await businessDatabase!.prepare("DROP TRIGGER fault_billing_during_cleanup").run(); }
    expect((await request("/api/me/account/delete",jsonRequest({confirmation:"DELETE",password},cookie))).status).toBe(200);
  });

  it.each(["invalid metadata", "duplicate audit"])("retains Auth rather than accepting an invalid retry audit: %s", async fault => {
    const cookie = await signIn();
    await authDatabase!.prepare(`CREATE TRIGGER fault_auth_retry BEFORE DELETE ON "user" WHEN OLD.id = '${ownerId}' BEGIN SELECT RAISE(IGNORE); END`).run();
    try {
      expect((await request("/api/me/account/delete",jsonRequest({confirmation:"DELETE",password},cookie))).status).toBe(503);
    } finally { await authDatabase!.prepare("DROP TRIGGER fault_auth_retry").run(); }
    const existing = await businessDatabase!.prepare("SELECT * FROM audit_logs WHERE action = 'DELETE_ACCOUNT' AND user_id = ?").bind(ownerId).first<Record<string,unknown>>();
    expect(existing).toBeTruthy();
    if (fault === "invalid metadata") await businessDatabase!.prepare("UPDATE audit_logs SET metadata = '{}' WHERE id = ?").bind(existing!.id).run();
    else await businessDatabase!.prepare("INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id,metadata,created_at) VALUES (?, ?, 'DELETE_ACCOUNT', 'user', ?, ?, ?)")
      .bind("62000000-0000-4000-8000-000000000089",ownerId,ownerId,existing!.metadata,existing!.created_at).run();
    const before = await businessSnapshot();
    const authBefore = await authSnapshot();
    expect((await request("/api/me/account/delete",jsonRequest({confirmation:"DELETE",password},cookie))).status).toBe(503);
    expect(await businessSnapshot()).toEqual(before);
    expect(await authSnapshot()).toEqual(authBefore);
    if (fault === "invalid metadata") await businessDatabase!.prepare("UPDATE audit_logs SET metadata = ? WHERE id = ?").bind(existing!.metadata,existing!.id).run();
    else await businessDatabase!.prepare("DELETE FROM audit_logs WHERE id = '62000000-0000-4000-8000-000000000089'").run();
    expect((await request("/api/me/account/delete",jsonRequest({confirmation:"DELETE",password},cookie))).status).toBe(200);
    expect((await businessDatabase!.prepare("SELECT id,created_at,metadata FROM audit_logs WHERE action = 'DELETE_ACCOUNT'").all()).results)
      .toEqual([{id:existing!.id,created_at:existing!.created_at,metadata:existing!.metadata}]);
  });

  it("rejects bad passwords and a source-FK broadcast dependency before business effects", async () => {
    const cookie = await signIn();
    const invalidPassword = await request("/api/me/account/delete", jsonRequest({ confirmation: "DELETE", password: "wrong-password" }, cookie));
    expect(invalidPassword.status).toBe(401);

    await businessDatabase?.prepare("INSERT INTO broadcast_emails (id, created_by, subject, body_text, created_at, updated_at) VALUES ('62000000-0000-4000-8000-000000000013', ?, 'Synthetic', 'Synthetic', ?, ?)").bind(ownerId, now, now).run();
    const blocked = await request("/api/me/account/delete", jsonRequest({ confirmation: "DELETE", password }, cookie));
    expect(blocked.status).toBe(409);
    expect((await blocked.json() as { error?: unknown }).error).toBe("account_delete_blocked");
    const license = await businessDatabase?.prepare("SELECT user_id, status FROM fanmark_licenses WHERE id = ?").bind(licenseId).first<Record<string, unknown>>();
    expect(license).toEqual({ user_id: ownerId, status: "active" });
    const user = await authDatabase?.prepare('SELECT "id" FROM "user" WHERE "id" = ?').bind(ownerId).first();
    expect(user).toBeTruthy();
  });

  it("fails closed on a linked Stripe customer when mode-specific secrets are unavailable", async () => {
    await businessDatabase?.prepare("UPDATE user_settings SET stripe_customer_id = ? WHERE user_id = ?")
      .bind("cus_syntheticcustomer", ownerId).run();
    await businessDatabase?.prepare("INSERT INTO user_subscriptions (id, user_id, stripe_customer_id, stripe_subscription_id, product_id, status, created_at, updated_at) VALUES ('62000000-0000-4000-8000-000000000014', ?, 'cus_syntheticcustomer', 'sub_syntheticsubscription', 'prod_synthetic', 'active', ?, ?)")
      .bind(ownerId, now, now).run();
    const cookie = await signIn();
    const response = await request("/api/me/account/delete", jsonRequest({ confirmation: "DELETE", password }, cookie));
    expect(response.status).toBe(503);
    const license = await businessDatabase?.prepare("SELECT user_id, status FROM fanmark_licenses WHERE id = ?")
      .bind(licenseId).first<Record<string, unknown>>();
    expect(license).toEqual({ user_id: ownerId, status: "active" });
    const authUser = await authDatabase?.prepare('SELECT "id" FROM "user" WHERE "id" = ?').bind(ownerId).first();
    expect(authUser).toBeTruthy();
  });

  it("preflights active transfers before attempting Stripe cancellation", async () => {
    await businessDatabase?.prepare("INSERT INTO fanmark_transfer_codes (id, license_id, fanmark_id, issuer_user_id, transfer_code, status, expires_at, disclaimer_agreed_at, created_at, updated_at) VALUES ('62000000-0000-4000-8000-000000000015', ?, ?, ?, 'AAAA-BBBB-CCCC', 'active', '2099-01-01T00:00:00.000000Z', ?, ?, ?)")
      .bind(licenseId, fanmarkId, ownerId, now, now, now).run();
    await businessDatabase?.prepare("UPDATE user_settings SET stripe_customer_id = ? WHERE user_id = ?")
      .bind("cus_syntheticcustomer", ownerId).run();
    const cookie = await signIn();
    const response = await request("/api/me/account/delete", jsonRequest({ confirmation: "DELETE", password }, cookie));
    expect(response.status).toBe(409);
    expect((await response.json() as { error?: unknown }).error).toBe("transfer_in_progress");
    const license = await businessDatabase?.prepare("SELECT user_id, status FROM fanmark_licenses WHERE id = ?")
      .bind(licenseId).first<Record<string, unknown>>();
    expect(license).toEqual({ user_id: ownerId, status: "active" });
    const user = await authDatabase?.prepare('SELECT "id" FROM "user" WHERE "id" = ?').bind(ownerId).first();
    expect(user).toBeTruthy();
  });

  it("keeps Better Auth's direct delete route closed and rejects anonymous deletion", async () => {
    const cookie = await signIn();
    const closed = await request("/api/auth/delete-user", jsonRequest({ password }, cookie));
    expect(closed.status).toBe(403);
    expect((await closed.json() as { error?: unknown }).error).toBe("auth_flow_unavailable");

    const anonymous = await request("/api/me/account/delete", jsonRequest({ confirmation: "DELETE", password }));
    expect(anonymous.status).toBe(401);
  });
});
