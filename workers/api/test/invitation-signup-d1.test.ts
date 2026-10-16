import { env } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import authSchemaSql from "../migrations/0003_better_auth_core.sql?raw";
import signupAuthMigrationSql from "../migrations/0007_auth_signup_command.sql?raw";
import suspensionSchemaSql from "../migrations/0008_auth_user_suspension.sql?raw";
import sourceProvisioningJson from "./fixtures/source-signup-provisioning.json?raw";
import { checkedInSqlStatements as splitSql } from "./schema-statements";
import { handleRequest } from "../src";
import { handleInvitationCodeValidationRequest } from "../src/invitation-signup-d1-api";
import { handleStripeCustomerPortalD1Request } from "../src/stripe-customer-portal-d1-api";
import type { Env } from "../src/repository";
import { network } from "./network";

declare module "vitest" {
  export interface ProvidedContext {
    businessSignupMigrations: Array<{ name: string; sql: string }>;
  }
}

const runtimeEnv = env as unknown as Env;
const businessDb = runtimeEnv.FANMARK_DB;
const authDb = runtimeEnv.AUTH_DB;
const apiBase = "https://api.example.test";
const appOrigin = "https://app.example.test";
const invitationId = "80000000-0000-4000-8000-000000000014";
const timestamp = "2026-09-26T12:00:00.000Z";
const password = "Synthetic-Signup-Password!2026";
const signingSecret = "local-invitation-signup-test-secret-not-for-deployment-0000000000000000000000";
const sourceProvisioning = JSON.parse(sourceProvisioningJson) as {
  provisioning: Array<{
    label: string; plan_type: string; preferred_language: string; requires_password_setup: boolean;
  }>;
};
let resendRequests: Array<Record<string, unknown>> = [];

async function applySql(database: D1Database, sql: string): Promise<void> {
  const statements = splitSql(sql);
  await database.batch(statements.map((statement) => database.prepare(statement)));
}

function authRequest(
  path: string,
  body?: Record<string, unknown>,
  overrides: Partial<Env> = {},
): Promise<Response> {
  return handleRequest(
    new Request(`${apiBase}/api/auth${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Origin: appOrigin,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    { ...runtimeEnv, ...overrides },
  );
}

function signupRequest(
  commandId: string,
  email: string,
  invitationCode: string | null = "WELCOME",
  overrides: Partial<Env> = {},
): Promise<Response> {
  return authRequest("/sign-up/email", {
    commandId,
    email,
    password,
    invitationCode,
    preferredLanguage: "ja",
  }, overrides);
}

async function resetRows(): Promise<void> {
  if (!businessDb || !authDb) throw new Error("D1 test bindings are unavailable");
  await businessDb.batch([
    businessDb.prepare("DELETE FROM user_settings"),
    businessDb.prepare("DELETE FROM invitation_signup_attempts"),
    businessDb.prepare("DELETE FROM invitation_codes"),
    businessDb.prepare("DELETE FROM system_settings"),
  ]);
  await authDb.prepare('DELETE FROM "user"').run();
  await businessDb.batch([
    businessDb.prepare(`INSERT INTO system_settings
      (id, setting_key, setting_value, is_public, created_at, updated_at)
      VALUES (?, 'invitation_mode', 'true', 0, ?, ?)`)
      .bind("system-setting-invitation-mode", timestamp, timestamp),
    businessDb.prepare(`INSERT INTO invitation_codes
      (id, code, max_uses, used_count, expires_at, special_perks, created_by, is_active, created_at, updated_at)
      VALUES (?, 'WELCOME', 2, 0, NULL, '{"source":"synthetic"}', NULL, 1, ?, ?)`)
      .bind(invitationId, timestamp, timestamp),
  ]);
  resendRequests = [];
  network.use(http.post("https://api.resend.com/emails", async ({ request }) => {
    resendRequests.push(await request.json() as Record<string, unknown>);
    return HttpResponse.json({ id: "synthetic-resend-id" });
  }));
}

async function emailFingerprint(email: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(signingSecret), {
    name: "HMAC",
    hash: "SHA-256",
  }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`fanmark.invitation-signup.v1:${email}`),
  ));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

beforeAll(async () => {
  if (!businessDb || !authDb) throw new Error("D1 test bindings are unavailable");
  for (const migration of inject("businessSignupMigrations")) {
    await applySql(businessDb, migration.sql);
  }
  for (const sql of [authSchemaSql, signupAuthMigrationSql, suspensionSchemaSql]) {
    await applySql(authDb, sql);
  }
});
beforeEach(resetRows);
afterEach(async () => {
  for (const database of [businessDb, authDb]) {
    expect((await database!.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  }
});

describe("invitation signup across split Auth and business D1", () => {
  it.each(["en", "ja", "ko", "id"])("preserves the %s signup language and source privacy defaults under the complete schema", async (language) => {
    const source = sourceProvisioning.provisioning.find(row => row.label === `credential_${language}`);
    expect(source).toBeDefined();
    const commandId = crypto.randomUUID();
    const response = await authRequest("/sign-up/email", {
      commandId,
      email: `language-${language}@example.invalid`,
      password,
      invitationCode: "WELCOME",
      preferredLanguage: language,
    });
    expect(response.status).toBe(200);
    const user = await authDb!.prepare('SELECT "id", "emailVerified", "banned" FROM "user" WHERE "signupCommandId" = ?')
      .bind(commandId).first<{ id: string; emailVerified: number; banned: number }>();
    expect(user).toMatchObject({ emailVerified: 0, banned: 0 });
    // Source Auth IDs and downstream billing actor checks use UUIDs. Imported
    // UUID fixtures do not prove the format Better Auth generates for signup.
    expect(user!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
    // Exercise a real downstream UUID actor check with the generated ID. The
    // resolver is synthetic; provider credentials are absent and no billing
    // client may be constructed. This is not verified-email/session acceptance.
    const billing = await handleStripeCustomerPortalD1Request(new Request(
      `${apiBase}/api/billing/customer-portal`,
      { method: "POST", headers: { Origin: appOrigin } },
    ), {
      ...runtimeEnv,
      AUTH_BACKEND: "better-auth",
      BETTER_AUTH_URL: appOrigin,
      CORS_ALLOWED_ORIGINS: appOrigin,
      STRIPE_CUSTOMER_PORTAL_BACKEND: "d1",
      STRIPE_WEBHOOK_BACKEND: "d1",
      STRIPE_DISPATCH_BACKEND: "d1",
      STRIPE_WEBHOOK_SECRET: "whsec_synthetic_signup_actor_only",
      STRIPE_MODE_POLICY: "test_only",
      STRIPE_SECRET_KEY: undefined,
      STRIPE_SECRET_KEY_TEST: undefined,
      STRIPE_SECRET_KEY_LIVE: undefined,
    }, {
      resolveUser: async () => user!.id,
      createStripeClient: () => { throw new Error("signup actor proof must not contact Stripe"); },
    });
    expect(billing?.status).toBe(503);
    expect(await billing!.json()).toEqual({ error: "stripe_portal_not_ready" });
    const settings = await businessDb!.prepare(`SELECT user_id, username, display_name, plan_type,
      preferred_language, invited_by_code, requires_password_setup FROM user_settings WHERE user_id = ?`)
      .bind(user!.id).first();
    expect(settings).toEqual({
      user_id: user!.id,
      username: `user_${user!.id.slice(0, 8)}`,
      display_name: `user_${user!.id.slice(0, 8)}`,
      plan_type: source!.plan_type,
      preferred_language: source!.preferred_language,
      invited_by_code: "WELCOME",
      requires_password_setup: Number(source!.requires_password_setup),
    });
    expect(resendRequests).toHaveLength(1);
    const replay = await authRequest("/sign-up/email", {
      commandId, email: `language-${language}@example.invalid`, password,
      invitationCode: "WELCOME", preferredLanguage: language,
    });
    expect(replay.status).toBe(200);
    expect(resendRequests).toHaveLength(1);
    expect((await businessDb!.prepare("SELECT used_count FROM invitation_codes WHERE id = ?")
      .bind(invitationId).first<{ used_count: number }>())?.used_count).toBe(1);
  });

  it("does not forward caller-controlled provisioning metadata or roles to either D1", async () => {
    const commandId = crypto.randomUUID();
    const suppliedId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const response = await authRequest("/sign-up/email", {
      commandId, email: "forged-metadata@example.invalid", password,
      invitationCode: "WELCOME", preferredLanguage: "ko",
      id: suppliedId, userId: suppliedId, user_id: suppliedId,
      username: "chosen-admin", display_name: "chosen-admin", name: "chosen-admin",
      plan_type: "admin", emailVerified: true, banned: false,
      requires_password_setup: true, invited_by_code: "UNRESERVED",
      raw_user_meta_data: { username: "chosen-admin", display_name: "chosen-admin", plan_type: "admin" },
      data: { username: "chosen-admin", display_name: "chosen-admin", plan_type: "admin" },
    });
    expect(response.status).toBe(200);
    const user = await authDb!.prepare('SELECT "id", "name", "emailVerified", "banned" FROM "user" WHERE "signupCommandId" = ?')
      .bind(commandId).first<{ id: string; name: string; emailVerified: number; banned: number }>();
    expect(user!.id).not.toBe(suppliedId);
    expect(user).toMatchObject({ name: "fanmark.id user", emailVerified: 0, banned: 0 });
    expect(await businessDb!.prepare(`SELECT user_id, username, display_name, plan_type,
      preferred_language, invited_by_code, requires_password_setup FROM user_settings WHERE user_id = ?`)
      .bind(user!.id).first()).toEqual({
      user_id: user!.id, username: `user_${user!.id.slice(0, 8)}`,
      display_name: `user_${user!.id.slice(0, 8)}`, plan_type: "free",
      preferred_language: "ko", invited_by_code: "WELCOME", requires_password_setup: 0,
    });
    expect((await authDb!.prepare('SELECT count(*) AS count FROM "adminRole"').first<{ count: number }>())?.count).toBe(0);
  });

  it("keeps an invitation and reservation alive one D1 microsecond past the clock", async () => {
    const expiresAt = "2026-09-26T12:00:00.000001Z";
    const fingerprint = await emailFingerprint("reserved-boundary@example.invalid");
    await businessDb!.prepare("UPDATE invitation_codes SET expires_at = ? WHERE id = ?")
      .bind(expiresAt, invitationId).run();
    await businessDb!.prepare(`INSERT INTO invitation_signup_attempts (
      attempt_id, email_fingerprint, invitation_code_id, preferred_language, state,
      auth_user_id, created_at, updated_at, expires_at
    ) VALUES (?, ?, ?, 'ja', 'reserved', NULL, ?, ?, ?)`)
      .bind("10000000-0000-4000-8000-000000000051", fingerprint, invitationId, timestamp, timestamp, expiresAt).run();
    const response = await handleInvitationCodeValidationRequest(
      new Request(`${apiBase}/api/auth/validate-invitation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "WELCOME" }),
      }),
      businessDb,
      true,
      new Headers(),
      () => new Date(timestamp),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      isValid: true,
      remainingUses: 1,
      perks: { source: "synthetic" },
      invitationRequired: true,
    });
  });

  it("exposes signup only when email delivery and the invitation-mode source are configured", async () => {
    const enabled = await authRequest("/capabilities");
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toMatchObject({
      emailVerification: true,
      signUp: true,
      invitationRequired: true,
    });

    const selectorOff = await authRequest("/capabilities", undefined, {
      INVITATION_SIGNUP_BACKEND: undefined,
    });
    expect(await selectorOff.json()).toMatchObject({ signUp: false, invitationRequired: false });

    const emailOff = await authRequest("/capabilities", undefined, {
      AUTH_EMAIL_BACKEND: undefined,
    });
    expect(await emailOff.json()).toMatchObject({ emailVerification: false, signUp: false });
  });

  it("validates codes against reservations and rejects depleted or malformed codes", async () => {
    const valid = await authRequest("/invitations/validate", { code: "welcome" });
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({
      isValid: true,
      remainingUses: 2,
      perks: { source: "synthetic" },
      invitationRequired: true,
    });

    const invalid = await authRequest("/invitations/validate", { code: "unknown" });
    expect(await invalid.json()).toMatchObject({ isValid: false, remainingUses: 0 });

    const missingMode = await authRequest("/invitations/validate", { code: "WELCOME" }, {
      INVITATION_SIGNUP_BACKEND: undefined,
    });
    expect(missingMode.status).toBe(503);
  });

  it("creates an unverified Auth identity and profile, consumes one invite once, and recovers a replay", async () => {
    const commandId = "a8f53c30-f3e6-41f8-9d2e-970ceb5793f1";
    const response = await signupRequest(commandId, "Synthetic.User@example.invalid");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: true });

    const authUser = await authDb!.prepare(`SELECT "id", "email", "emailVerified", "signupCommandId"
      FROM "user" WHERE "signupCommandId" = ?`).bind(commandId).first<Record<string, unknown>>();
    expect(authUser).toMatchObject({
      email: "synthetic.user@example.invalid",
      emailVerified: 0,
      signupCommandId: commandId,
    });
    const account = await authDb!.prepare(`SELECT "password" FROM "account" WHERE "userId" = ?`)
      .bind(authUser?.id).first<{ password: string }>();
    expect(account?.password).not.toBe(password);

    const profile = await businessDb!.prepare(`SELECT user_id, username, display_name, plan_type,
      preferred_language, invited_by_code, requires_password_setup, created_at, updated_at FROM user_settings WHERE user_id = ?`)
      .bind(authUser?.id).first<Record<string, unknown>>();
    expect(profile).toMatchObject({
      user_id: authUser?.id,
      username: `user_${String(authUser?.id).slice(0, 8)}`,
      display_name: `user_${String(authUser?.id).slice(0, 8)}`,
      plan_type: "free",
      preferred_language: "ja",
      invited_by_code: "WELCOME",
      requires_password_setup: 0,
    });
    expect(profile?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
    expect(profile?.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);

    const completedAttempt = await businessDb!.prepare(`SELECT created_at, updated_at
      FROM invitation_signup_attempts WHERE attempt_id = ?`).bind(commandId).first<Record<string, unknown>>();
    expect(completedAttempt?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
    expect(completedAttempt?.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
    expect(profile?.created_at).toBe(profile?.updated_at);
    expect(profile?.updated_at).toBe(completedAttempt?.updated_at);

    const invite = await businessDb!.prepare("SELECT used_count FROM invitation_codes WHERE id = ?")
      .bind(invitationId).first<{ used_count: number }>();
    expect(invite?.used_count).toBe(1);
    const attempt = await businessDb!.prepare("SELECT * FROM invitation_signup_attempts WHERE attempt_id = ?")
      .bind(commandId).first<Record<string, unknown>>();
    expect(attempt?.state).toBe("completed");
    expect(JSON.stringify(attempt)).not.toContain("synthetic.user@example.invalid");
    expect(JSON.stringify(attempt)).not.toContain(password);
    expect(attempt?.email_fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(resendRequests).toHaveLength(1);

    const replay = await signupRequest(commandId, "synthetic.user@example.invalid");
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ status: true });
    expect(resendRequests).toHaveLength(1);
    expect((await businessDb!.prepare("SELECT used_count FROM invitation_codes WHERE id = ?")
      .bind(invitationId).first<{ used_count: number }>())?.used_count).toBe(1);
    expect(Number((await businessDb!.prepare("SELECT count(*) AS count FROM user_settings")
      .first<{ count: number }>())?.count)).toBe(1);
  });

  it("does not create an identity for invalid invitations or missing consented code", async () => {
    const invalid = await signupRequest("c8494418-0b1e-4fe9-badc-9f55a916e1c2", "invalid@example.invalid", "WRONG");
    expect(invalid.status).toBe(400);
    const absent = await signupRequest("a491aa16-f06b-41b0-9db9-08b1da6cbfa5", "absent@example.invalid", null);
    expect(absent.status).toBe(400);
    expect(Number((await authDb!.prepare('SELECT count(*) AS count FROM "user"')
      .first<{ count: number }>())?.count)).toBe(0);
    expect(Number((await businessDb!.prepare("SELECT count(*) AS count FROM invitation_signup_attempts")
      .first<{ count: number }>())?.count)).toBe(0);
  });

  it("serializes the last invitation slot across different signup commands", async () => {
    await businessDb!.prepare("UPDATE invitation_codes SET max_uses = 1 WHERE id = ?").bind(invitationId).run();
    const [first, second] = await Promise.all([
      signupRequest("cb2d575c-89c3-4bb0-a6e5-a04122c0dd28", "first@example.invalid"),
      signupRequest("ce6f6dd9-26f2-41a7-8813-c4c0357a37d4", "second@example.invalid"),
    ]);
    expect([first.status, second.status].filter((status) => status === 200)).toHaveLength(1);
    expect([first.status, second.status].filter((status) => status === 409)).toHaveLength(1);
    expect((await businessDb!.prepare("SELECT used_count FROM invitation_codes WHERE id = ?")
      .bind(invitationId).first<{ used_count: number }>())?.used_count).toBe(1);
    expect(Number((await businessDb!.prepare("SELECT count(*) AS count FROM user_settings")
      .first<{ count: number }>())?.count)).toBe(1);
  });

  it("keeps an Auth-created reservation recoverable when email delivery fails", async () => {
    const commandId = "0ca8990c-9fe1-4f35-b5bd-fc256b331ba0";
    network.use(http.post("https://api.resend.com/emails", () => HttpResponse.json({ error: "synthetic failure" }, { status: 503 })));
    const failedDelivery = await signupRequest(commandId, "recover@example.invalid");
    expect(failedDelivery.status).toBe(503);
    expect(Number((await authDb!.prepare('SELECT count(*) AS count FROM "user" WHERE "signupCommandId" = ?')
      .bind(commandId).first<{ count: number }>())?.count)).toBe(1);
    expect((await businessDb!.prepare("SELECT state FROM invitation_signup_attempts WHERE attempt_id = ?")
      .bind(commandId).first<{ state: string }>())?.state).toBe("auth_created");
    expect(Number((await businessDb!.prepare("SELECT count(*) AS count FROM user_settings")
      .first<{ count: number }>())?.count)).toBe(0);
    expect((await businessDb!.prepare("SELECT used_count FROM invitation_codes WHERE id = ?")
      .bind(invitationId).first<{ used_count: number }>())?.used_count).toBe(0);

    network.use(http.post("https://api.resend.com/emails", async ({ request }) => {
      resendRequests.push(await request.json() as Record<string, unknown>);
      return HttpResponse.json({ id: "synthetic-resend-retry" });
    }));
    const recovered = await signupRequest("ef571c19-dddd-4359-8bf6-74e0ddad2142", "recover@example.invalid");
    expect(recovered.status).toBe(200);
    expect((await businessDb!.prepare("SELECT state FROM invitation_signup_attempts WHERE attempt_id = ?")
      .bind(commandId).first<{ state: string }>())?.state).toBe("completed");
    expect((await businessDb!.prepare("SELECT used_count FROM invitation_codes WHERE id = ?")
      .bind(invitationId).first<{ used_count: number }>())?.used_count).toBe(1);
  });

  it("recovers an expired reservation when Auth committed before the acknowledgement was lost", async () => {
    const originalCommandId = "c8d8e28d-1e96-4c24-91e6-bbf59615c489";
    const email = "lost-ack@example.invalid";
    const fingerprint = await emailFingerprint(email);
    await authDb!.prepare(`INSERT INTO "user"
      ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "signupCommandId")
      VALUES ('lost-ack-auth-user', 'fanmark.id user', ?, 0, ?, ?, ?)`)
      .bind(email, timestamp, timestamp, originalCommandId).run();
    await businessDb!.prepare(`INSERT INTO invitation_signup_attempts
      (attempt_id, email_fingerprint, invitation_code_id, preferred_language, state,
       auth_user_id, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, 'ja', 'reserved', NULL, ?, ?, '2020-01-01T00:00:00.000Z')`)
      .bind(originalCommandId, fingerprint, invitationId, timestamp, timestamp).run();

    const retryAfterReload = await signupRequest("2e94e8cb-19e3-41ba-939b-08cfa10aaf63", email);
    expect(retryAfterReload.status).toBe(200);
    const recoveredAttempt = await businessDb!.prepare("SELECT state, auth_user_id FROM invitation_signup_attempts WHERE attempt_id = ?")
      .bind(originalCommandId).first<{ state: string; auth_user_id: string }>();
    expect(recoveredAttempt).toMatchObject({ state: "completed", auth_user_id: "lost-ack-auth-user" });
    expect((await businessDb!.prepare("SELECT used_count FROM invitation_codes WHERE id = ?")
      .bind(invitationId).first<{ used_count: number }>())?.used_count).toBe(1);
    expect((await businessDb!.prepare("SELECT user_id FROM user_settings WHERE user_id = 'lost-ack-auth-user'")
      .first<{ user_id: string }>())?.user_id).toBe("lost-ack-auth-user");
  });

  it("does not reveal duplicate email status or consume its invitation slot", async () => {
    await authDb!.prepare(`INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
      VALUES ('existing-auth-user', 'synthetic', 'existing@example.invalid', 0, ?, ?)`)
      .bind(timestamp, timestamp).run();
    const response = await signupRequest("71f06367-0f97-435b-a2fc-c66544839860", "existing@example.invalid");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    expect((await businessDb!.prepare("SELECT state, invitation_code_id FROM invitation_signup_attempts")
      .first<{ state: string; invitation_code_id: string | null }>())?.state).toBe("released");
    expect((await businessDb!.prepare("SELECT used_count FROM invitation_codes WHERE id = ?")
      .bind(invitationId).first<{ used_count: number }>())?.used_count).toBe(0);
    expect(resendRequests).toHaveLength(0);
  });

  it("rejects command replay with changed terms and requires HTTPS trusted origins", async () => {
    const commandId = "46785259-261e-4006-ae70-5164b04d643f";
    const created = await signupRequest(commandId, "terms@example.invalid");
    expect(created.status).toBe(200);

    const changed = await signupRequest(commandId, "other@example.invalid");
    expect(changed.status).toBe(409);
    const forbidden = await handleRequest(new Request(`${apiBase}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { Origin: "https://attacker.example", "content-type": "application/json" },
      body: JSON.stringify({ commandId, email: "terms@example.invalid", password, invitationCode: "WELCOME", preferredLanguage: "ja" }),
    }), runtimeEnv);
    expect(forbidden.status).toBe(403);
  });
});
