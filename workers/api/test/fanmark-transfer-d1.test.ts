import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import businessSchema from "./fixtures/d1-fanmark-transfer.sql?raw";
import masterSchema from "./fixtures/d1-fanmark-registration-master.sql?raw";
import { handleFanmarkTransferRequest } from "../src/fanmark-transfer-d1-api";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const business = runtimeEnv.FANMARK_DB!;
const master = runtimeEnv.MASTER_DB!;
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
  return sql.split(/;\s*(?:\r?\n|$)/u).map((part) => part.trim()).filter(Boolean);
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
  await business.batch([
    "DELETE FROM notification_events", "DELETE FROM audit_logs", "DELETE FROM fanmark_lottery_entries",
    "DELETE FROM fanmark_transfer_requests", "DELETE FROM fanmark_transfer_codes", "DELETE FROM fanmark_password_configs",
    "DELETE FROM fanmark_profiles", "DELETE FROM fanmark_messageboard_configs", "DELETE FROM fanmark_redirect_configs",
    "DELETE FROM fanmark_basic_configs", "DELETE FROM fanmark_licenses", "DELETE FROM fanmarks",
    "DELETE FROM user_settings", "DELETE FROM system_settings",
  ].map((sql) => business.prepare(sql)));
  await master.prepare("DELETE FROM fanmark_tiers").run();
  await run(business, `INSERT INTO fanmarks (id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at, tier_level)
    VALUES (?, '🌹', '🌹', 'rose1234', 'active', ?, ?, 1)`, FANMARK, NOW, NOW);
  await run(business, `INSERT INTO fanmark_licenses
    (id, fanmark_id, user_id, license_start, license_end, status, is_initial_license, created_at, updated_at, display_fanmark)
    VALUES (?, ?, ?, ?, '2026-10-15T00:00:00.000000Z', 'active', 1, ?, ?, '🌹')`, LICENSE, FANMARK, OWNER, NOW, NOW, NOW);
  for (const [id, userId, username, display] of [
    ["30000000-0000-4000-8000-000000000001", OWNER, "owner", "Owner"],
    ["30000000-0000-4000-8000-000000000002", RECIPIENT, "recipient", "Recipient"],
    ["30000000-0000-4000-8000-000000000003", OTHER, "other", "Other"],
  ]) {
    await run(business, "INSERT INTO user_settings (id, user_id, username, display_name, plan_type) VALUES (?, ?, ?, ?, 'free')",
      id, userId, username, display);
  }
  await run(master, "INSERT INTO fanmark_tiers (tier_level, display_name, initial_license_days, is_active) VALUES (1, 'Tier 1', 7, 1)");
  await run(business, "INSERT INTO fanmark_basic_configs (license_id, fanmark_name, access_type, created_at, updated_at) VALUES (?, 'old', 'profile', ?, ?)", LICENSE, NOW, NOW);
  await run(business, "INSERT INTO fanmark_redirect_configs (license_id, target_url, created_at, updated_at) VALUES (?, 'https://old.example', ?, ?)", LICENSE, NOW, NOW);
  await run(business, "INSERT INTO fanmark_messageboard_configs (license_id, content, created_at, updated_at) VALUES (?, 'old text', ?, ?)", LICENSE, NOW, NOW);
  await run(business, "INSERT INTO fanmark_password_configs (license_id, access_password, created_at, updated_at) VALUES (?, '1234', ?, ?)", LICENSE, NOW, NOW);
  await run(business, "INSERT INTO fanmark_profiles (license_id, display_name, created_at, updated_at) VALUES (?, 'old profile', ?, ?)", LICENSE, NOW, NOW);
  await run(business, "INSERT INTO fanmark_lottery_entries (id, user_id, license_id, entry_status) VALUES ('40000000-0000-4000-8000-000000000001', ?, ?, 'pending')", OTHER, LICENSE);
}

async function call(
  action: string,
  body: unknown,
  userId: string | null = OWNER,
  method = "POST",
): Promise<Response> {
  const request = new Request("https://api.example.test/api/me/transfers" + action, {
    method,
    headers: { Origin: ORIGIN, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
  return handleFanmarkTransferRequest(request, requestEnv, async () => ({ available: true, userId }), CLOCK);
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
      (id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at, tier_level)
      VALUES (?, ?, ?, ?, 'active', ?, ?, 1)`, fanmarkId, emoji, emoji, `recipient${index + 1}`, NOW, NOW);
    await run(business, `INSERT INTO fanmark_licenses
      (id, fanmark_id, user_id, license_start, license_end, status, is_initial_license, created_at, updated_at, display_fanmark)
      VALUES (?, ?, ?, ?, '2026-10-15T00:00:00.000000Z', 'active', 1, ?, ?, ?)`,
    licenseId, fanmarkId, RECIPIENT, NOW, NOW, NOW, emoji);
  }
}

beforeAll(async () => {
  await applyStatements(business, businessSchema);
  await applyStatements(master, masterSchema);
});

beforeEach(reset);

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
    await run(business, `INSERT INTO fanmark_lottery_entries (id, user_id, license_id, entry_status)
      VALUES (?, ?, ?, 'pending'), (?, ?, ?, 'cancelled'), (?, ?, ?, 'pending')`,
    additionalEntry, OWNER, LICENSE, previouslyCancelled, RECIPIENT, LICENSE,
    unrelatedEntry, OTHER, "20000000-0000-4000-8000-000000000003");
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
      .bind(previouslyCancelled).first()).toEqual({ cancellation_reason: null, updated_at: null });
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
    const response = await handleFanmarkTransferRequest(badOrigin, requestEnv, async () => ({ available: true, userId: OWNER }), CLOCK);
    expect(response.status).toBe(403);
  });

  it("reserves the final recipient plan slot across competing incoming transfers", async () => {
    await seedRecipientLicenses();
    await run(business, `INSERT INTO fanmarks
      (id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at, tier_level)
      VALUES (?, '🌻', '🌻', 'other0001', 'active', ?, ?, 1)`, SECOND_FANMARK, NOW, NOW);
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
    expect(attempts.map((response) => response.status).sort()).toEqual([200, 409]);
    const results = await Promise.all(attempts.map(async (response) => ({
      status: response.status,
      body: await response.json() as Record<string, unknown>,
    })));
    const winner = results.find((result) => result.status === 200);
    const loser = results.find((result) => result.status === 409);
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
      "INSERT INTO system_settings (id, setting_key, setting_value) VALUES (?, 'free_fanmarks_limit', '2')",
      crypto.randomUUID());

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
