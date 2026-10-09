import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import bcrypt from "bcryptjs";
import { handleRequest } from "../src";
import { checkedInSqlStatements } from "./schema-statements";
import authSchema from "../migrations/0003_better_auth_core.sql?raw";
import signupSchema from "../migrations/0007_auth_signup_command.sql?raw";
import suspensionSchema from "../migrations/0008_auth_user_suspension.sql?raw";
import oauthSchema from "../migrations/0009_auth_oauth_signup.sql?raw";

declare module "vitest" {
  export interface ProvidedContext {
    businessTransferMigrations: Array<{ name: string; sql: string }>;
  }
}
import masterSchema from "./fixtures/d1-fanmark-registration-master.sql?raw";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const business = runtimeEnv.FANMARK_DB!;
const master = runtimeEnv.MASTER_DB!;
const authDb = runtimeEnv.AUTH_DB!;
const PASSWORD = "Synthetic-Transfer-Only!2026";
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 10);
const cookies = new Map<string, Promise<string>>();
const OWNER = "e62ce4d0-8055-4ecb-9e3a-759d70d659e0";
const RECIPIENT = "2a1b9c5f-3c8a-4890-9e04-3768885b6dd8";
const OTHER = "3520ec30-f70d-433e-a5d5-d33e19406313";
const FANMARK = "10000000-0000-4000-8000-000000000001";
const LICENSE = "20000000-0000-4000-8000-000000000001";
const SECOND_FANMARK = "10000000-0000-4000-8000-000000000002";
const SECOND_LICENSE = "20000000-0000-4000-8000-000000000002";
const NOW = "2026-09-25T10:15:23.123000Z";
const NEXT = "2026-09-25T10:16:23.123000Z";
let clockValue = new Date("2026-09-25T10:15:23.123Z");
const CLOCK = () => new Date(clockValue);
const ORIGIN = "https://app.example.test";
const requestEnv: Env = { ...runtimeEnv, D1_TOPOLOGY: "split", AUTH_BACKEND: "better-auth", FANMARK_TRANSFER_BACKEND: "d1", CORS_ALLOWED_ORIGINS: ORIGIN };

function statements(sql: string): string[] {
  return checkedInSqlStatements(sql);
}

async function applyStatements(db: D1Database, sql: string): Promise<void> {
  const parts = statements(sql);
  await db.batch(parts.map((part) => db.prepare(part)));
}

async function run(db: D1Database, sql: string, ...values: unknown[]): Promise<void> {
  await db.prepare(sql).bind(...values).run();
}

async function count(db: D1Database, table: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM " + table).first<{ count: number }>();
  return row?.count ?? -1;
}

async function reset(): Promise<void> {
  clockValue = new Date("2026-09-25T10:15:23.123Z");
  cookies.clear();
  await authDb.prepare('DELETE FROM "user" WHERE id IN (?, ?, ?)').bind(OWNER, RECIPIENT, OTHER).run();
  for (const id of [OWNER, RECIPIENT, OTHER]) {
    await authDb.prepare('INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
      .bind(id, "Synthetic transfer", `${id}@example.invalid`, NOW, NOW).run();
    await authDb.prepare('INSERT INTO account (id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, id, "credential", id, PASSWORD_HASH, NOW, NOW).run();
  }
  await business.batch([
    "DELETE FROM notification_events", "DELETE FROM audit_logs", "DELETE FROM fanmark_lottery_entries",
    "DELETE FROM fanmark_transfer_requests", "DELETE FROM fanmark_transfer_codes", "DELETE FROM fanmark_password_configs",
    "DELETE FROM fanmark_profiles", "DELETE FROM fanmark_messageboard_configs", "DELETE FROM fanmark_redirect_configs",
    "DELETE FROM fanmark_basic_configs", "DELETE FROM fanmark_licenses", "DELETE FROM fanmarks",
    "DELETE FROM user_settings", "DELETE FROM system_settings",
  ].map((sql) => business.prepare(sql)));
  await master.prepare("DELETE FROM fanmark_tiers").run();
  await run(business, `INSERT INTO fanmarks (id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at, tier_level, normalized_emoji_ids)
    VALUES (?, '🌹', '🌹', 'rose1234', 'active', ?, ?, 1, json_array(?))`, FANMARK, NOW, NOW, FANMARK);
  await run(business, `INSERT INTO fanmark_licenses
    (id, fanmark_id, user_id, license_start, license_end, status, is_initial_license, created_at, updated_at, display_fanmark)
    VALUES (?, ?, ?, ?, '2026-10-15T00:00:00.000000Z', 'active', 1, ?, ?, '🌹')`, LICENSE, FANMARK, OWNER, NOW, NOW, NOW);
  for (const [id, userId, username, display] of [
    ["30000000-0000-4000-8000-000000000001", OWNER, "owner", "Owner"],
    ["30000000-0000-4000-8000-000000000002", RECIPIENT, "recipient", "Recipient"],
    ["30000000-0000-4000-8000-000000000003", OTHER, "other", "Other"],
  ]) {
    await run(business, "INSERT INTO user_settings (id, user_id, username, display_name, plan_type, created_at, updated_at) VALUES (?, ?, ?, ?, 'free', ?, ?)",
      id, userId, username, display, NOW, NOW);
  }
  await run(master, "INSERT INTO fanmark_tiers (tier_level, display_name, initial_license_days, is_active) VALUES (1, 'Tier 1', 7, 1)");
  await run(business, "INSERT INTO fanmark_basic_configs (license_id, fanmark_name, access_type, created_at, updated_at) VALUES (?, 'old', 'profile', ?, ?)", LICENSE, NOW, NOW);
  await run(business, "INSERT INTO fanmark_redirect_configs (license_id, target_url, created_at, updated_at) VALUES (?, 'https://old.example', ?, ?)", LICENSE, NOW, NOW);
  await run(business, "INSERT INTO fanmark_messageboard_configs (license_id, content, created_at, updated_at) VALUES (?, 'old text', ?, ?)", LICENSE, NOW, NOW);
  await run(business, "INSERT INTO fanmark_password_configs (license_id, access_password, created_at, updated_at) VALUES (?, '1234', ?, ?)", LICENSE, NOW, NOW);
  await run(business, "INSERT INTO fanmark_profiles (license_id, display_name, created_at, updated_at) VALUES (?, 'old profile', ?, ?)", LICENSE, NOW, NOW);
  await seedEntry("40000000-0000-4000-8000-000000000001", OTHER, LICENSE);
}

async function seedEntry(id: string, userId: string, licenseId: string, fanmarkId = FANMARK, status = "pending"): Promise<void> {
  await run(business, `INSERT INTO fanmark_lottery_entries
    (id, user_id, license_id, fanmark_id, entry_status, applied_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, userId, licenseId, fanmarkId, status, NOW, NOW, NOW);
}

async function call(
  action: string,
  body: unknown,
  userId: string | null = OWNER,
  method = "POST",
): Promise<Response> {
  let cookie = "";
  if (userId) {
    if (!cookies.has(userId)) cookies.set(userId, (async () => {
      const signedIn = await handleRequest(new Request("https://api.example.test/api/auth/sign-in/email", {
        method: "POST", headers: { Origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ email: `${userId}@example.invalid`, password: PASSWORD }),
      }), requestEnv);
      expect(signedIn.status).toBe(200);
      const value = signedIn.headers.get("set-cookie")?.split(";")[0];
      if (!value) throw new Error("Synthetic transfer cookie missing");
      return value;
    })());
    cookie = await cookies.get(userId)!;
  }
  const request = new Request("https://api.example.test/api/me/transfers" + action, {
    method,
    headers: { Origin: ORIGIN, Cookie: cookie, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
  return handleRequest(request, requestEnv, fetch, CLOCK, CLOCK);
}

async function approvalSnapshot(): Promise<unknown> {
  const tables = ["fanmark_licenses", "fanmark_transfer_codes", "fanmark_transfer_requests", "fanmark_lottery_entries",
    "fanmark_basic_configs", "fanmark_profiles", "fanmark_redirect_configs", "fanmark_messageboard_configs",
    "fanmark_password_configs", "audit_logs", "notification_events", "notification_worker_wake_state"];
  return Promise.all(tables.map(async table => ({ table,
    rows: (await business.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results })));
}

async function issue(licenseId = LICENSE, issuer = OWNER): Promise<Record<string, unknown>> {
  const response = await call("/issue", { license_id: licenseId, disclaimer_agreed: true }, issuer);
  expect(response.status).toBe(200);
  return await response.json() as Record<string, unknown>;
}

async function apply(code: string): Promise<Record<string, unknown>> {
  const response = await call("/apply", { transfer_code: code, disclaimer_agreed: true }, RECIPIENT);
  expect(response.status).toBe(200);
  return await response.json() as Record<string, unknown>;
}

async function seedRecipientLicenses(): Promise<void> {
  for (const [index, emoji] of ["🌸", "🌼"].entries()) {
    const suffix = String(index + 3).padStart(12, "0");
    const fanmarkId = `10000000-0000-4000-8000-${suffix}`;
    const licenseId = `20000000-0000-4000-8000-${suffix}`;
    await run(business, `INSERT INTO fanmarks
      (id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at, tier_level, normalized_emoji_ids)
      VALUES (?, ?, ?, ?, 'active', ?, ?, 1, json_array(?))`, fanmarkId, emoji, emoji, `recipient${index + 1}`, NOW, NOW, fanmarkId);
    await run(business, `INSERT INTO fanmark_licenses
      (id, fanmark_id, user_id, license_start, license_end, status, is_initial_license, created_at, updated_at, display_fanmark)
      VALUES (?, ?, ?, ?, '2026-10-15T00:00:00.000000Z', 'active', 1, ?, ?, ?)`,
    licenseId, fanmarkId, RECIPIENT, NOW, NOW, NOW, emoji);
  }
}

beforeAll(async () => {
  for (const schema of [authSchema, signupSchema, suspensionSchema, oauthSchema]) await applyStatements(authDb, schema);
  const migrations = inject("businessTransferMigrations");
  expect(migrations.length).toBeGreaterThanOrEqual(25);
  for (const migration of migrations) {
    const parts = statements(migration.sql);
    for (let offset = 0; offset < parts.length; offset += 50) {
      await business.batch(parts.slice(offset, offset + 50).map(sql => business.prepare(sql)));
    }
  }
  await applyStatements(master, masterSchema);
});

beforeEach(reset);
afterEach(async () => {
  for (const db of [business, authDb, master]) expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});

describe("D1 fanmark transfer", () => {
  it("issues a 48-hour code and replaces only prior active codes", async () => {
    const result = await issue();
    expect(result).toMatchObject({ success: true, fanmark_name: "🌹", expires_at: "2026-09-27T10:15:23.123000Z" });
    expect(result.transfer_code).toMatch(/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/u);
    await issue();
    expect(await count(business, "fanmark_transfer_codes")).toBe(2);
    expect(await business.prepare("SELECT status FROM fanmark_transfer_codes ORDER BY status")
      .all<{ status: string }>()).toMatchObject({ results: [{ status: "active" }, { status: "cancelled" }] });
    expect((await business.prepare("SELECT disclaimer_agreed_at, created_at, updated_at FROM fanmark_transfer_codes ORDER BY status")
      .all<Record<string, unknown>>()).results).toEqual([
      { disclaimer_agreed_at: NOW, created_at: NOW, updated_at: NOW },
      { disclaimer_agreed_at: NOW, created_at: NOW, updated_at: NOW },
    ]);
    expect(await count(business, "audit_logs")).toBe(2);
    const forbidden = await call("/issue", { license_id: LICENSE, disclaimer_agreed: false });
    expect(forbidden.status).toBe(400);
    expect(await count(business, "fanmark_transfer_codes")).toBe(2);
  });

  it("applies and approves atomically, resets old settings, creates an inactive new license, and locks it", async () => {
    const issued = await issue();
    const applied = await apply(String(issued.transfer_code));
    const requestId = String(applied.request_id);
    const ownerList = await call("", {}, OWNER, "GET");
    expect(ownerList.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(await ownerList.json()).toMatchObject({ pendingRequests: [{ id: requestId, requester_user_id: RECIPIENT }] });
    const response = await call("/approve", { request_id: requestId, transferredFanmarkName: "Rose" });
    expect(response.status).toBe(200);
    const result = await response.json() as Record<string, unknown>;
    expect(result).toMatchObject({ success: true, fanmark_name: "🌹", new_license_end: "2026-10-03T00:00:00.000000Z" });
    const oldLicense = await business.prepare("SELECT status, is_returned, license_end, updated_at FROM fanmark_licenses WHERE id = ?")
      .bind(LICENSE).first<Record<string, unknown>>();
    expect(oldLicense).toEqual({ status: "expired", is_returned: 1, license_end: NOW, updated_at: NOW });
    const nextLicense = await business.prepare("SELECT user_id, status, is_transferred, transfer_locked_until, license_end, display_fanmark, license_start, created_at, updated_at FROM fanmark_licenses WHERE id = ?")
      .bind(result.new_license_id).first<Record<string, unknown>>();
    expect(nextLicense).toEqual({
      user_id: RECIPIENT, status: "active", is_transferred: 1, license_start: NOW, created_at: NOW, updated_at: NOW,
      transfer_locked_until: "2026-10-25T10:15:23.123000Z", license_end: "2026-10-03T00:00:00.000000Z", display_fanmark: "🌹",
    });
    expect(await count(business, "fanmark_basic_configs")).toBe(1);
    expect(await business.prepare("SELECT fanmark_name, access_type, created_at, updated_at FROM fanmark_basic_configs WHERE license_id = ?")
      .bind(result.new_license_id).first<Record<string, unknown>>()).toEqual({
      fanmark_name: "Rose", access_type: "inactive", created_at: NOW, updated_at: NOW,
    });
    for (const table of ["fanmark_redirect_configs", "fanmark_messageboard_configs", "fanmark_password_configs", "fanmark_profiles"]) {
      expect(await count(business, table)).toBe(0);
    }
    expect(await business.prepare("SELECT status, rejection_reason FROM fanmark_transfer_requests WHERE id = ?")
      .bind(requestId).first<Record<string, unknown>>()).toEqual({ status: "approved", rejection_reason: null });
    expect(await business.prepare("SELECT status FROM fanmark_transfer_codes").first<{ status: string }>()).toEqual({ status: "completed" });
    expect(await business.prepare("SELECT entry_status, cancellation_reason FROM fanmark_lottery_entries")
      .first<Record<string, unknown>>()).toEqual({ entry_status: "cancelled", cancellation_reason: "system" });
    const cancelledEntryAudit = await business.prepare(
      "SELECT user_id, resource_type, resource_id, metadata, created_at FROM audit_logs WHERE action = 'LOTTERY_ENTRY_STATUS_CHANGED'",
    ).first<Record<string, unknown>>();
    expect(cancelledEntryAudit).toMatchObject({
      user_id: OTHER, resource_type: "fanmark_lottery_entry", resource_id: "40000000-0000-4000-8000-000000000001", created_at: NOW,
    });
    expect(JSON.parse(String(cancelledEntryAudit?.metadata))).toEqual({
      old_status: "pending", new_status: "cancelled", cancellation_reason: "system",
    });
    expect(await count(business, "notification_events")).toBe(2);
    expect((await business.prepare(`SELECT event_type, trigger_at, created_at, updated_at
      FROM notification_events ORDER BY event_type`).all<Record<string, unknown>>()).results).toEqual([
      { event_type: "transfer_approved", trigger_at: NOW, created_at: NOW, updated_at: NOW },
      { event_type: "transfer_requested", trigger_at: NOW, created_at: NOW, updated_at: NOW },
    ]);
    expect((await call("/approve", { request_id: requestId })).status).toBe(400);
    expect(await business.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'LOTTERY_ENTRY_STATUS_CHANGED'")
      .first()).toEqual({ count: 1 });
    const lockedIssue = await call("/issue", {
      license_id: result.new_license_id, disclaimer_agreed: true,
    }, RECIPIENT);
    expect(lockedIssue.status).toBe(400);
    expect(await lockedIssue.json()).toMatchObject({ error: "transfer_locked" });
  });

  it("audits each pending entry on the transferred license and leaves other entries unchanged", async () => {
    await seedRecipientLicenses();
    const additionalEntry = "40000000-0000-4000-8000-000000000002";
    const previouslyCancelled = "40000000-0000-4000-8000-000000000003";
    const unrelatedEntry = "40000000-0000-4000-8000-000000000004";
    await seedEntry(additionalEntry, OWNER, LICENSE);
    await seedEntry(previouslyCancelled, RECIPIENT, LICENSE, FANMARK, "cancelled");
    await seedEntry(unrelatedEntry, OTHER, "20000000-0000-4000-8000-000000000003", "10000000-0000-4000-8000-000000000003");
    const issued = await issue();
    const applied = await apply(String(issued.transfer_code));
    expect((await call("/approve", { request_id: applied.request_id })).status).toBe(200);
    const audits = await business.prepare(
      "SELECT user_id, resource_id, metadata, created_at FROM audit_logs WHERE action = 'LOTTERY_ENTRY_STATUS_CHANGED' ORDER BY resource_id",
    ).all<Record<string, unknown>>();
    expect(audits.results.map((row) => ({ user_id: row.user_id, resource_id: row.resource_id, created_at: row.created_at })))
      .toEqual([
        { user_id: OTHER, resource_id: "40000000-0000-4000-8000-000000000001", created_at: NOW },
        { user_id: OWNER, resource_id: additionalEntry, created_at: NOW },
      ]);
    for (const row of audits.results) expect(JSON.parse(String(row.metadata))).toEqual({
      old_status: "pending", new_status: "cancelled", cancellation_reason: "system",
    });
    expect(await business.prepare("SELECT entry_status FROM fanmark_lottery_entries WHERE id = ?")
      .bind(unrelatedEntry).first()).toEqual({ entry_status: "pending" });
    expect(await business.prepare("SELECT cancellation_reason, updated_at FROM fanmark_lottery_entries WHERE id = ?")
      .bind(previouslyCancelled).first()).toEqual({ cancellation_reason: null, updated_at: NOW });
  });

  it("rolls back approval when an entry cancellation audit fails and retries without duplicate effects", async () => {
    const issued = await issue();
    const applied = await apply(String(issued.transfer_code));
    const requestId = String(applied.request_id);
    const auditsBefore = await count(business, "audit_logs");
    await business.prepare(`CREATE TRIGGER reject_transfer_lottery_audit BEFORE INSERT ON audit_logs
      WHEN NEW.action = 'LOTTERY_ENTRY_STATUS_CHANGED'
      BEGIN SELECT RAISE(ABORT, 'synthetic lottery audit failure'); END`).run();
    try {
      expect((await call("/approve", { request_id: requestId })).status).toBe(500);
      expect(await business.prepare("SELECT status FROM fanmark_transfer_requests WHERE id = ?")
        .bind(requestId).first()).toEqual({ status: "pending" });
      expect(await business.prepare("SELECT status FROM fanmark_transfer_codes WHERE id = ?")
        .bind(issued.transfer_code_id).first()).toEqual({ status: "applied" });
      expect(await business.prepare("SELECT status FROM fanmark_licenses WHERE id = ?")
        .bind(LICENSE).first()).toEqual({ status: "active" });
      expect(await count(business, "fanmark_licenses")).toBe(1);
      expect(await count(business, "audit_logs")).toBe(auditsBefore);
      expect(await count(business, "notification_events")).toBe(1);
      expect(await business.prepare("SELECT entry_status FROM fanmark_lottery_entries").first())
        .toEqual({ entry_status: "pending" });
      expect(await business.prepare("SELECT fanmark_name, access_type FROM fanmark_basic_configs").first())
        .toEqual({ fanmark_name: "old", access_type: "profile" });
    } finally {
      await business.prepare("DROP TRIGGER reject_transfer_lottery_audit").run();
    }
    expect((await call("/approve", { request_id: requestId })).status).toBe(200);
    expect(await business.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'LOTTERY_ENTRY_STATUS_CHANGED'")
      .first()).toEqual({ count: 1 });
    expect(await count(business, "fanmark_licenses")).toBe(2);
    expect(await count(business, "notification_events")).toBe(2);
  });

  it.each([
    ["ignored", "BEFORE", "SELECT RAISE(IGNORE);"],
    ["metadata", "AFTER", "UPDATE audit_logs SET metadata = '{}' WHERE id = NEW.id;"],
    ["deleted", "AFTER", "DELETE FROM audit_logs WHERE id = NEW.id;"],
    ["id", "AFTER", "UPDATE audit_logs SET id = 'ffffffff-ffff-4fff-8fff-ffffffffffff' WHERE id = NEW.id;"],
    ["actor", "AFTER", "UPDATE audit_logs SET user_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff' WHERE id = NEW.id;"],
    ["action", "AFTER", "UPDATE audit_logs SET action = 'LOTTERY_ENTRY_CREATED' WHERE id = NEW.id;"],
    ["resource_type", "AFTER", "UPDATE audit_logs SET resource_type = 'user' WHERE id = NEW.id;"],
    ["resource", "AFTER", "UPDATE audit_logs SET resource_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff' WHERE id = NEW.id;"],
    ["time", "AFTER", "UPDATE audit_logs SET created_at = '2026-09-25T10:15:23.124000Z' WHERE id = NEW.id;"],
    ["request", "AFTER", "UPDATE audit_logs SET request_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff' WHERE id = NEW.id;"],
  ])("rolls back approval for %s entry audit and retries safely", async (_label, timing, faultSql) => {
    const issued = await issue();
    const applied = await apply(String(issued.transfer_code));
    const requestId = String(applied.request_id);
    const before = await approvalSnapshot();
    await business.prepare(`CREATE TRIGGER fault_transfer_entry_audit ${timing} INSERT ON audit_logs
      WHEN NEW.action = 'LOTTERY_ENTRY_STATUS_CHANGED' BEGIN ${faultSql} END`).run();
    try {
      expect((await call("/approve", { request_id: requestId })).status).toBe(500);
      expect(await approvalSnapshot()).toEqual(before);
    } finally {
      await business.prepare("DROP TRIGGER fault_transfer_entry_audit").run();
    }
    expect((await call("/approve", { request_id: requestId })).status).toBe(200);
    const audit = await business.prepare("SELECT * FROM audit_logs WHERE action = 'LOTTERY_ENTRY_STATUS_CHANGED'").first<Record<string, unknown>>();
    expect(audit).toMatchObject({ user_id: OTHER, resource_type: "fanmark_lottery_entry",
      resource_id: "40000000-0000-4000-8000-000000000001", request_id: null, created_at: NOW });
    expect(audit?.id).toMatch(/^[a-f0-9-]{36}$/u);
    expect(JSON.parse(String(audit?.metadata))).toEqual({ old_status: "pending", new_status: "cancelled", cancellation_reason: "system" });
    expect((await call("/approve", { request_id: requestId })).status).toBe(400);
    expect(await business.prepare("SELECT count(*) AS n FROM audit_logs WHERE action = 'LOTTERY_ENTRY_STATUS_CHANGED'").first()).toEqual({ n: 1 });
  });

  it.each([
    ["ignored", "BEFORE", "SELECT RAISE(IGNORE);"],
    ["metadata", "AFTER", "UPDATE audit_logs SET metadata = '{}' WHERE id = NEW.id;"],
    ["deleted", "AFTER", "DELETE FROM audit_logs WHERE id = NEW.id;"],
  ])("rolls back for %s license transfer audit and retries", async (_label, timing, sql) => {
    const issued = await issue();
    const applied = await apply(String(issued.transfer_code));
    const before = await approvalSnapshot();
    await business.prepare(`CREATE TRIGGER fault_transfer_license_audit ${timing} INSERT ON audit_logs
      WHEN NEW.action = 'LICENSE_TRANSFERRED' BEGIN ${sql} END`).run();
    try {
      expect((await call("/approve", { request_id: applied.request_id })).status).toBe(500);
      expect(await approvalSnapshot()).toEqual(before);
    } finally {
      await business.prepare("DROP TRIGGER fault_transfer_license_audit").run();
    }
    expect((await call("/approve", { request_id: applied.request_id })).status).toBe(200);
    expect(await business.prepare("SELECT count(*) AS n FROM audit_logs WHERE action = 'LICENSE_TRANSFERRED'").first()).toEqual({ n: 1 });
  });

  it.each([
    ["old license", "BEFORE UPDATE ON fanmark_licenses WHEN NEW.status = 'expired'"],
    ["new license", "BEFORE INSERT ON fanmark_licenses WHEN NEW.is_transferred = 1"],
    ["basic config", "BEFORE INSERT ON fanmark_basic_configs WHEN NEW.access_type = 'inactive'"],
    ["old profile deletion", "BEFORE DELETE ON fanmark_profiles"],
    ["request", "BEFORE UPDATE ON fanmark_transfer_requests WHEN NEW.status = 'approved'"],
    ["code", "BEFORE UPDATE ON fanmark_transfer_codes WHEN NEW.status = 'completed'"],
    ["entry cancellation", "BEFORE UPDATE ON fanmark_lottery_entries WHEN NEW.entry_status = 'cancelled'"],
    ["outbox", "BEFORE INSERT ON notification_events WHEN NEW.event_type = 'transfer_approved'"],
  ])("rolls back for suppressed %s effect and retries", async (_label, triggerClause) => {
    const issued = await issue();
    const applied = await apply(String(issued.transfer_code));
    const before = await approvalSnapshot();
    await business.prepare(`CREATE TRIGGER fault_transfer_effect ${triggerClause} BEGIN SELECT RAISE(IGNORE); END`).run();
    try {
      expect((await call("/approve", { request_id: applied.request_id })).status).toBe(500);
      expect(await approvalSnapshot()).toEqual(before);
    } finally {
      await business.prepare("DROP TRIGGER fault_transfer_effect").run();
    }
    expect((await call("/approve", { request_id: applied.request_id })).status).toBe(200);
  });

  it("rolls back all entry audits if only the second applicant audit is suppressed", async () => {
    const second = "40000000-0000-4000-8000-000000000002";
    await seedEntry(second, OWNER, LICENSE);
    const issued = await issue();
    const applied = await apply(String(issued.transfer_code));
    const before = await approvalSnapshot();
    await business.prepare(`CREATE TRIGGER fault_second_transfer_audit BEFORE INSERT ON audit_logs
      WHEN NEW.action = 'LOTTERY_ENTRY_STATUS_CHANGED' AND NEW.resource_id = '${second}'
      BEGIN SELECT RAISE(IGNORE); END`).run();
    try {
      expect((await call("/approve", { request_id: applied.request_id })).status).toBe(500);
      expect(await approvalSnapshot()).toEqual(before);
    } finally {
      await business.prepare("DROP TRIGGER fault_second_transfer_audit").run();
    }
    expect((await call("/approve", { request_id: applied.request_id })).status).toBe(200);
    expect(await business.prepare("SELECT count(*) AS n FROM audit_logs WHERE action = 'LOTTERY_ENTRY_STATUS_CHANGED'").first()).toEqual({ n: 2 });
  });

  it("rolls back if a native trigger introduces an uncaptured pending applicant", async () => {
    const issued = await issue();
    const applied = await apply(String(issued.transfer_code));
    const before = await approvalSnapshot();
    await business.prepare(`CREATE TRIGGER fault_new_transfer_entry AFTER INSERT ON audit_logs
      WHEN NEW.action = 'LOTTERY_ENTRY_STATUS_CHANGED' BEGIN
        INSERT INTO fanmark_lottery_entries (id, user_id, license_id, fanmark_id, applied_at, created_at, updated_at)
        VALUES ('40000000-0000-4000-8000-000000000002', '${RECIPIENT}', '${LICENSE}', '${FANMARK}', '${NOW}', '${NOW}', '${NOW}');
      END`).run();
    try {
      expect((await call("/approve", { request_id: applied.request_id })).status).toBe(500);
      expect(await approvalSnapshot()).toEqual(before);
    } finally {
      await business.prepare("DROP TRIGGER fault_new_transfer_entry").run();
    }
    expect((await call("/approve", { request_id: applied.request_id })).status).toBe(200);
  });

  it("refuses a snapshot changed before batch acquisition without undoing the concurrent write", async () => {
    const issued = await issue();
    const applied = await apply(String(issued.transfer_code));
    let before: unknown;
    const proxied = new Proxy(business, {
      get(target, property) {
        if (property !== "prepare") {
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (sql: string) => {
          const statement = target.prepare(sql);
          if (!sql.includes("SELECT id, user_id, fanmark_id, license_id, lottery_probability")) return statement;
          const wrap = (query: D1PreparedStatement): D1PreparedStatement => new Proxy(query, {
            get(queryTarget, key) {
              if (key === "bind") return (...values: unknown[]) => wrap(queryTarget.bind(...values));
              if (key === "all") return async () => {
                const result = await queryTarget.all();
                await run(business, "UPDATE fanmark_lottery_entries SET updated_at = ?", NEXT);
                before = await approvalSnapshot();
                return result;
              };
              const value = Reflect.get(queryTarget, key, queryTarget);
              return typeof value === "function" ? value.bind(queryTarget) : value;
            },
          });
          return wrap(statement);
        };
      },
    });
    requestEnv.FANMARK_DB = proxied;
    try {
      expect((await call("/approve", { request_id: applied.request_id })).status).toBe(500);
      expect(before).toBeDefined();
      expect(await approvalSnapshot()).toEqual(before);
    } finally {
      requestEnv.FANMARK_DB = business;
    }
    expect((await call("/approve", { request_id: applied.request_id })).status).toBe(200);
  });

  it("approves when no pending lottery rows need cancellation", async () => {
    await run(business, "DELETE FROM fanmark_lottery_entries");
    const issued = await issue();
    const applied = await apply(String(issued.transfer_code));
    expect((await call("/approve", { request_id: applied.request_id })).status).toBe(200);
    expect(await business.prepare("SELECT count(*) AS n FROM audit_logs WHERE action = 'LOTTERY_ENTRY_STATUS_CHANGED'").first()).toEqual({ n: 0 });
  });

  it("refuses a caller-selected owner and a revoked warmed real session", async () => {
    const issued = await issue();
    const applied = await apply(String(issued.transfer_code));
    const before = await approvalSnapshot();
    expect((await call("/approve", { request_id: applied.request_id, user_id: OWNER }, OTHER)).status).toBe(403);
    expect((await call("/approve", { request_id: applied.request_id }, OTHER)).status).toBe(403);
    expect(await approvalSnapshot()).toEqual(before);
    await authDb.prepare('DELETE FROM session WHERE userId = ?').bind(OWNER).run();
    expect((await call("/approve", { request_id: applied.request_id })).status).toBe(401);
    expect(await approvalSnapshot()).toEqual(before);
  });

  it("enforces ownership and restores a code after rejection", async () => {
    const issued = await issue();
    const applied = await apply(String(issued.transfer_code));
    const requestId = String(applied.request_id);
    const denied = await call("/reject", { request_id: requestId }, OTHER);
    expect(denied.status).toBe(403);
    clockValue = new Date("2026-09-25T10:16:23.123Z");
    const rejected = await call("/reject", { request_id: requestId, reason: "Not now" });
    expect(rejected.status).toBe(200);
    expect(await business.prepare("SELECT status FROM fanmark_transfer_codes").first<{ status: string }>()).toEqual({ status: "active" });
    expect(await business.prepare("SELECT status, rejection_reason FROM fanmark_transfer_requests WHERE id = ?")
      .bind(requestId).first<Record<string, unknown>>()).toEqual({ status: "rejected", rejection_reason: "Not now" });
    expect(await business.prepare("SELECT disclaimer_agreed_at, created_at, updated_at FROM fanmark_transfer_codes WHERE id = ?")
      .bind(issued.transfer_code_id).first<Record<string, unknown>>()).toEqual({
      disclaimer_agreed_at: NOW, created_at: NOW, updated_at: NEXT,
    });
    expect(await business.prepare("SELECT disclaimer_agreed_at, applied_at, created_at, updated_at FROM fanmark_transfer_requests WHERE id = ?")
      .bind(requestId).first<Record<string, unknown>>()).toEqual({
      disclaimer_agreed_at: NOW, applied_at: NOW, created_at: NOW, updated_at: NEXT,
    });
    expect(await count(business, "notification_events")).toBe(2);
    expect((await business.prepare(`SELECT event_type, trigger_at, created_at, updated_at
      FROM notification_events ORDER BY event_type`).all<Record<string, unknown>>()).results).toEqual([
      { event_type: "transfer_rejected", trigger_at: NEXT, created_at: NEXT, updated_at: NEXT },
      { event_type: "transfer_requested", trigger_at: NOW, created_at: NOW, updated_at: NOW },
    ]);
  });

  it("prevents self-transfer, expired or reused codes, and exposes only the caller's rows", async () => {
    const issued = await issue();
    const self = await call("/apply", { transfer_code: issued.transfer_code, disclaimer_agreed: true });
    expect(await self.json()).toMatchObject({ error: "self_transfer_not_allowed" });
    const mine = await call("", {}, RECIPIENT, "GET");
    expect(await mine.json()).toMatchObject({ issuedCodes: [], pendingRequests: [], myRequests: [] });
    await apply(String(issued.transfer_code));
    const reuse = await call("/apply", { transfer_code: issued.transfer_code, disclaimer_agreed: true }, OTHER);
    expect(reuse.status).toBe(400);
  });

  it("marks an expired active code expired before rejecting an application", async () => {
    const issued = await issue();
    await run(business, "UPDATE fanmark_transfer_codes SET expires_at = ? WHERE id = ?", NOW, issued.transfer_code_id);
    const response = await call("/apply", {
      transfer_code: issued.transfer_code, disclaimer_agreed: true,
    }, RECIPIENT);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "code_expired" });
    expect(await business.prepare("SELECT status FROM fanmark_transfer_codes WHERE id = ?")
      .bind(issued.transfer_code_id).first<{ status: string }>()).toEqual({ status: "expired" });
  });

  it("enforces the recipient plan limit and protects the endpoint with auth and CORS", async () => {
    for (let index = 0; index < 3; index += 1) {
      await run(business, `INSERT INTO fanmark_licenses (id, fanmark_id, user_id, license_start, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?)`, "50000000-0000-4000-8000-00000000000" + (index + 1), FANMARK, RECIPIENT, NOW, NOW, NOW);
    }
    const issued = await issue();
    const denied = await call("/apply", { transfer_code: issued.transfer_code, disclaimer_agreed: true }, RECIPIENT);
    expect(denied.status).toBe(400);
    expect(await denied.json()).toMatchObject({ error: "fanmark_limit_exceeded", current: 3, limit: 3 });
    expect(await business.prepare("SELECT status FROM fanmark_transfer_codes").first<{ status: string }>()).toEqual({ status: "active" });
    const unauthenticated = await call("", {}, null, "GET");
    expect(unauthenticated.status).toBe(401);
    const badOrigin = new Request("https://api.example.test/api/me/transfers", { method: "GET", headers: { Origin: "https://evil.example" } });
    const response = await handleRequest(badOrigin, requestEnv, fetch, CLOCK, CLOCK);
    expect(response.status).toBe(403);
  });

  it("reserves the final recipient plan slot across competing incoming transfers", async () => {
    await seedRecipientLicenses();
    await run(business, `INSERT INTO fanmarks
      (id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at, tier_level, normalized_emoji_ids)
      VALUES (?, '🌻', '🌻', 'other0001', 'active', ?, ?, 1, json_array(?))`, SECOND_FANMARK, NOW, NOW, SECOND_FANMARK);
    await run(business, `INSERT INTO fanmark_licenses
      (id, fanmark_id, user_id, license_start, license_end, status, is_initial_license, created_at, updated_at, display_fanmark)
      VALUES (?, ?, ?, ?, '2026-10-15T00:00:00.000000Z', 'active', 1, ?, ?, '🌻')`,
    SECOND_LICENSE, SECOND_FANMARK, OTHER, NOW, NOW, NOW);

    const firstCode = await issue();
    const secondCode = await issue(SECOND_LICENSE, OTHER);
    const attempts = await Promise.all([
      call("/apply", { transfer_code: firstCode.transfer_code, disclaimer_agreed: true }, RECIPIENT),
      call("/apply", { transfer_code: secondCode.transfer_code, disclaimer_agreed: true }, RECIPIENT),
    ]);
    expect(attempts.filter(response => response.status === 200)).toHaveLength(1);
    expect(attempts.filter(response => response.status === 400 || response.status === 409)).toHaveLength(1);
    const results = await Promise.all(attempts.map(async (response) => ({
      status: response.status,
      body: await response.json() as Record<string, unknown>,
    })));
    const winner = results.find((result) => result.status === 200);
    const loser = results.find((result) => result.status !== 200);
    expect(winner?.body).toMatchObject({ success: true });
    expect(loser?.body).toMatchObject({ error: "fanmark_limit_exceeded", current: 3, limit: 3 });
    expect(await count(business, "fanmark_transfer_requests")).toBe(1);
    expect(await business.prepare("SELECT status FROM fanmark_transfer_codes ORDER BY status")
      .all<{ status: string }>()).toMatchObject({ results: [{ status: "active" }, { status: "applied" }] });
    const pending = await business.prepare(
      "SELECT r.id, r.transfer_code_id FROM fanmark_transfer_requests AS r WHERE r.status = 'pending'",
    ).first<{ id: string; transfer_code_id: string }>();
    const issuer = pending?.transfer_code_id === firstCode.transfer_code_id ? OWNER : OTHER;
    const approved = await call("/approve", { request_id: pending?.id }, issuer);
    expect(approved.status).toBe(200);
    const recipientActive = await business.prepare(
      "SELECT COUNT(*) AS count FROM fanmark_licenses WHERE user_id = ? AND status = 'active' AND (license_end IS NULL OR license_end > ?)",
    ).bind(RECIPIENT, NOW).first<{ count: number }>();
    expect(recipientActive?.count).toBe(3);
  });

  it("rechecks recipient capacity atomically when an incoming transfer is approved", async () => {
    await seedRecipientLicenses();
    const issued = await issue();
    const applied = await call("/apply", {
      transfer_code: issued.transfer_code, disclaimer_agreed: true,
    }, RECIPIENT);
    expect(applied.status).toBe(200);
    const request = await applied.json() as { request_id: string };
    await run(business,
      "INSERT INTO system_settings (id, setting_key, setting_value, created_at, updated_at) VALUES (?, 'free_fanmarks_limit', '2', ?, ?)",
      crypto.randomUUID(), NOW, NOW);

    const approved = await call("/approve", { request_id: request.request_id });
    expect(approved.status).toBe(409);
    expect(await approved.json()).toMatchObject({ error: "fanmark_limit_exceeded", current: 3, limit: 2 });
    expect(await business.prepare("SELECT status, user_id FROM fanmark_licenses WHERE id = ?")
      .bind(LICENSE).first<Record<string, unknown>>()).toEqual({ status: "active", user_id: OWNER });
    expect(await business.prepare("SELECT status FROM fanmark_transfer_codes WHERE id = ?")
      .bind(issued.transfer_code_id).first<{ status: string }>()).toEqual({ status: "applied" });
    expect(await business.prepare("SELECT status FROM fanmark_transfer_requests WHERE id = ?")
      .bind(request.request_id).first<{ status: string }>()).toEqual({ status: "pending" });
    expect(await count(business, "fanmark_licenses")).toBe(3);
  });

  it("cancels only an active code issued by the authenticated owner", async () => {
    const issued = await issue();
    const codeId = String(issued.transfer_code_id);
    const denied = await call("/cancel", { transfer_code_id: codeId }, OTHER);
    expect(denied.status).toBe(403);
    const cancelled = await call("/cancel", { transfer_code_id: codeId });
    expect(cancelled.status).toBe(200);
    expect(await business.prepare("SELECT status FROM fanmark_transfer_codes WHERE id = ?")
      .bind(codeId).first<{ status: string }>()).toEqual({ status: "cancelled" });
  });
});
