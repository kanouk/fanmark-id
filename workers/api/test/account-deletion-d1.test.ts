import { env } from "cloudflare:workers";
import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import authSchemaSql from "../migrations/0003_better_auth_core.sql?raw";
import businessSchemaSql from "./fixtures/d1-account-deletion.sql?raw";
import { handleRequest } from "../src";
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
const now = "2026-09-27T12:00:00.000Z";

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
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
    const statement = sql.slice(start, index).trim();
    if (/^create\s+trigger\b/iu.test(statement) && !/\bend\s*$/iu.test(statement)) continue;
    if (statement) statements.push(statement);
    start = index + 1;
  }
  const last = sql.slice(start).trim();
  if (last) statements.push(last);
  return statements;
}

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

async function seedAccount(): Promise<void> {
  if (!authDatabase || !businessDatabase) throw new Error("split D1 bindings unavailable");
  await authDatabase.batch([
    authDatabase.prepare('DELETE FROM "session" WHERE "userId" = ?').bind(ownerId),
    authDatabase.prepare('DELETE FROM "account" WHERE "userId" = ?').bind(ownerId),
    authDatabase.prepare('DELETE FROM "user" WHERE "id" = ?').bind(ownerId),
  ]);
  await businessDatabase.batch([
    businessDatabase.prepare("DELETE FROM user_subscriptions WHERE user_id = ?").bind(ownerId),
    businessDatabase.prepare("DELETE FROM user_settings WHERE user_id = ?").bind(ownerId),
    businessDatabase.prepare("DELETE FROM enterprise_user_settings WHERE user_id = ?").bind(ownerId),
    businessDatabase.prepare("DELETE FROM user_roles WHERE user_id IN (?, ?)").bind(ownerId, otherId),
    businessDatabase.prepare("DELETE FROM fanmark_lottery_entries WHERE user_id = ?").bind(ownerId),
    businessDatabase.prepare("DELETE FROM fanmark_lottery_history WHERE id = 'delete-history'").bind(),
    businessDatabase.prepare("DELETE FROM notifications WHERE user_id = ?").bind(ownerId),
    businessDatabase.prepare("DELETE FROM notification_preferences WHERE user_id = ?").bind(ownerId),
    businessDatabase.prepare("DELETE FROM notification_events WHERE json_extract(payload, '$.user_id') IN (?, ?)").bind(ownerId, otherId),
    businessDatabase.prepare("DELETE FROM fanmark_favorites WHERE user_id IN (?, ?)").bind(ownerId, otherId),
    businessDatabase.prepare("DELETE FROM notification_rules WHERE id = 'delete-rule'").bind(),
    businessDatabase.prepare("DELETE FROM fanmark_availability_rules WHERE id = 'delete-availability-rule'").bind(),
    businessDatabase.prepare("DELETE FROM broadcast_emails WHERE id = 'delete-broadcast'").bind(),
    businessDatabase.prepare("DELETE FROM audit_logs WHERE user_id = ?").bind(ownerId),
    businessDatabase.prepare("DELETE FROM fanmark_transfer_codes WHERE license_id = ?").bind(licenseId),
    businessDatabase.prepare("DELETE FROM fanmark_licenses WHERE id = ?").bind(licenseId),
    businessDatabase.prepare("DELETE FROM fanmarks WHERE id = ?").bind(fanmarkId),
    businessDatabase.prepare("DELETE FROM system_settings WHERE setting_key = 'grace_period_days'").bind(),
  ]);
  await authDatabase.prepare(
    'INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)',
  ).bind(ownerId, "Account Delete Synthetic", ownerEmail, now, now).run();
  await authDatabase.prepare(
    'INSERT INTO "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt") VALUES (?, ?, "credential", ?, ?, ?, ?)',
  ).bind(`${ownerId}-account`, ownerId, ownerId, bcrypt.hashSync(password, 10), now, now).run();

  await businessDatabase.batch([
    businessDatabase.prepare("INSERT INTO system_settings (setting_key, setting_value) VALUES ('grace_period_days', '1')"),
    businessDatabase.prepare("INSERT INTO fanmarks (id, short_id, status) VALUES (?, 'delete-canary', 'active')").bind(fanmarkId),
    businessDatabase.prepare("INSERT INTO fanmark_licenses (id, fanmark_id, user_id, display_fanmark, status, license_end, updated_at) VALUES (?, ?, ?, '🧪', 'active', NULL, ?)").bind(licenseId, fanmarkId, ownerId, now),
    businessDatabase.prepare("INSERT INTO user_settings (id, user_id, stripe_customer_id) VALUES ('delete-profile', ?, NULL)").bind(ownerId),
    businessDatabase.prepare("INSERT INTO enterprise_user_settings (id, user_id) VALUES ('delete-enterprise', ?)").bind(ownerId),
    businessDatabase.prepare("INSERT INTO user_roles (user_id, created_by) VALUES (?, ?)").bind(ownerId, ownerId),
    businessDatabase.prepare("INSERT INTO user_roles (user_id, created_by) VALUES (?, ?)").bind(otherId, ownerId),
    businessDatabase.prepare("INSERT INTO notification_rules (id, created_by, updated_at) VALUES ('delete-rule', ?, ?)").bind(ownerId, now),
    businessDatabase.prepare("INSERT INTO fanmark_availability_rules (id, created_by, updated_at) VALUES ('delete-availability-rule', ?, ?)").bind(ownerId, now),
    businessDatabase.prepare("INSERT INTO fanmark_favorites (id, fanmark_id, user_id, display_fanmark) VALUES ('delete-own-favorite', ?, ?, '🧪'), ('other-favorite', ?, ?, '🧪')").bind(fanmarkId, ownerId, fanmarkId, otherId),
    businessDatabase.prepare("INSERT INTO notifications (id, user_id) VALUES ('delete-notification', ?)").bind(ownerId),
    businessDatabase.prepare("INSERT INTO notification_preferences (id, user_id) VALUES ('delete-preference', ?)").bind(ownerId),
    businessDatabase.prepare("INSERT INTO notification_events (id, event_type, payload, trigger_at, dedupe_key, status, created_at, updated_at) VALUES ('delete-pending-event', 'fanmark_returned_owner', json_object('user_id', ?), ?, 'delete-pending-event', 'pending', ?, ?)").bind(ownerId, now, now, now),
    businessDatabase.prepare("INSERT INTO fanmark_lottery_entries (id, user_id, entry_status, updated_at) VALUES ('delete-pending-lottery', ?, 'pending', ?)").bind(ownerId, now),
    businessDatabase.prepare("INSERT INTO fanmark_lottery_history (id, winner_user_id) VALUES ('delete-history', ?)").bind(ownerId),
  ]);
}

beforeAll(async () => {
  if (!authDatabase || !businessDatabase) throw new Error("split D1 bindings unavailable");
  await authDatabase.batch(splitSqlStatements(authSchemaSql).map((statement) => authDatabase.prepare(statement)));
  await businessDatabase.batch(splitSqlStatements(businessSchemaSql).map((statement) => businessDatabase.prepare(statement)));
});

beforeEach(async () => {
  await seedAccount();
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

    const license = await businessDatabase?.prepare("SELECT user_id, status, license_end, grace_expires_at, is_returned FROM fanmark_licenses WHERE id = ?")
      .bind(licenseId).first<Record<string, unknown>>();
    expect(license).toMatchObject({ user_id: null, status: "grace", is_returned: 1 });
    expect(typeof license?.license_end).toBe("string");
    expect(typeof license?.grace_expires_at).toBe("string");

    const [settings, favorites, notifications, preferences, subscriptions, enterpriseSettings, lottery, history, otherRole, rules] = await Promise.all([
      businessDatabase?.prepare("SELECT COUNT(*) AS total FROM user_settings WHERE user_id = ?").bind(ownerId).first<{ total: number }>(),
      businessDatabase?.prepare("SELECT COUNT(*) AS total FROM fanmark_favorites WHERE user_id = ?").bind(ownerId).first<{ total: number }>(),
      businessDatabase?.prepare("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?").bind(ownerId).first<{ total: number }>(),
      businessDatabase?.prepare("SELECT COUNT(*) AS total FROM notification_preferences WHERE user_id = ?").bind(ownerId).first<{ total: number }>(),
      businessDatabase?.prepare("SELECT COUNT(*) AS total FROM user_subscriptions WHERE user_id = ?").bind(ownerId).first<{ total: number }>(),
      businessDatabase?.prepare("SELECT COUNT(*) AS total FROM enterprise_user_settings WHERE user_id = ?").bind(ownerId).first<{ total: number }>(),
      businessDatabase?.prepare("SELECT entry_status, cancellation_reason FROM fanmark_lottery_entries WHERE user_id = ?").bind(ownerId).first<Record<string, unknown>>(),
      businessDatabase?.prepare("SELECT winner_user_id FROM fanmark_lottery_history WHERE id = 'delete-history'").first<Record<string, unknown>>(),
      businessDatabase?.prepare("SELECT created_by FROM user_roles WHERE user_id = ?").bind(otherId).first<Record<string, unknown>>(),
      businessDatabase?.prepare("SELECT created_by FROM notification_rules WHERE id = 'delete-rule'").first<Record<string, unknown>>(),
    ]);
    expect(settings?.total).toBe(0);
    expect(favorites?.total).toBe(0);
    expect(notifications?.total).toBe(0);
    expect(preferences?.total).toBe(0);
    expect(subscriptions?.total).toBe(0);
    expect(enterpriseSettings?.total).toBe(0);
    expect(lottery).toEqual({ entry_status: "cancelled", cancellation_reason: "user_request" });
    expect(history).toEqual({ winner_user_id: null });
    expect(otherRole).toEqual({ created_by: null });
    expect(rules).toEqual({ created_by: null });

    const events = await businessDatabase?.prepare("SELECT event_type, payload FROM notification_events ORDER BY event_type").all<Record<string, unknown>>();
    expect(events?.results).toHaveLength(1);
    expect(events?.results[0]?.event_type).toBe("favorite_fanmark_available");
    expect(String(events?.results[0]?.payload)).toContain(otherId);
    const audits = await businessDatabase?.prepare("SELECT action, metadata FROM audit_logs WHERE user_id = ? ORDER BY action").bind(ownerId).all<Record<string, unknown>>();
    expect(audits?.results.map((row) => row.action)).toContain("FANMARK_RETURNED_ON_ACCOUNT_DELETE");
    expect(audits?.results.map((row) => row.action)).toContain("DELETE_ACCOUNT");
    expect(JSON.stringify(audits?.results)).not.toContain(ownerEmail);
  });

  it("rejects bad passwords and a source-FK broadcast dependency before business effects", async () => {
    const cookie = await signIn();
    const invalidPassword = await request("/api/me/account/delete", jsonRequest({ confirmation: "DELETE", password: "wrong-password" }, cookie));
    expect(invalidPassword.status).toBe(401);

    await businessDatabase?.prepare("INSERT INTO broadcast_emails (id, created_by) VALUES ('delete-broadcast', ?)").bind(ownerId).run();
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
    await businessDatabase?.prepare("INSERT INTO user_subscriptions (id, user_id, stripe_customer_id, stripe_subscription_id, status) VALUES ('delete-subscription', ?, 'cus_syntheticcustomer', 'sub_syntheticsubscription', 'active')")
      .bind(ownerId).run();
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
    await businessDatabase?.prepare("INSERT INTO fanmark_transfer_codes (id, license_id, status) VALUES ('delete-active-transfer', ?, 'active')")
      .bind(licenseId).run();
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
