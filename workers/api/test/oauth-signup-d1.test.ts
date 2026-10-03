import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, expect, inject, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import authSql from "../migrations/0003_better_auth_core.sql?raw";
import commandSql from "../migrations/0007_auth_signup_command.sql?raw";
import suspensionSql from "../migrations/0008_auth_user_suspension.sql?raw";
import oauthSql from "../migrations/0009_auth_oauth_signup.sql?raw";
import { handleRequest } from "../src";
import type { Env } from "../src/repository";
import { checkedInSqlStatements } from "./schema-statements";

declare module "vitest" {
  export interface ProvidedContext {
    businessOAuthMigrations: Array<{ name: string; sql: string }>;
  }
}

const runtimeEnv = env as unknown as Env;
const authDb = runtimeEnv.AUTH_DB!;
const businessDb = runtimeEnv.FANMARK_DB!;
const apiBase = "https://api.example.test";
const appOrigin = "https://app.example.test";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const providers = ["google", "github", "discord", "apple"] as const;
type Provider = typeof providers[number];
let signingKey: CryptoKey;
let providerRequests: string[] = [];

function request(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}) {
  const headers = new Headers(init.headers);
  headers.set("Origin", appOrigin);
  return handleRequest(new Request(apiBase + path, { ...init, headers }), { ...runtimeEnv, ...overrides });
}

function cookiePairs(response: Response) {
  return (response.headers.get("set-cookie") ?? "").split(/,(?=[^;,]+=)/u)
    .map(value => value.trim().split(";", 1)[0]).filter(Boolean).join("; ");
}

function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

async function idToken(provider: "google" | "apple", subject: string, email: string, verified: boolean) {
  const header = encode(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "synthetic-signup-key" })));
  const body = encode(new TextEncoder().encode(JSON.stringify({
    iss: provider === "google" ? "https://accounts.google.com" : "https://appleid.apple.com",
    aud: `synthetic-${provider}-client-id`, sub: subject, email, email_verified: verified,
    name: "Provider supplied public name", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
  })));
  const input = `${header}.${body}`;
  return `${input}.${encode(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signingKey, new TextEncoder().encode(input))))}`;
}

async function start(provider: Provider, language = "ja", overrides: Partial<Env> = {}, extra: Record<string, unknown> = {}) {
  const response = await request("/api/auth/sign-in/social", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, callbackURL: `${appOrigin}/auth`, errorCallbackURL: `${appOrigin}/auth`,
      additionalData: { preferredLanguage: language, ...extra } }),
  }, overrides);
  expect(response.status).toBe(200);
  const body = await response.json() as { url: string };
  const state = new URL(body.url).searchParams.get("state");
  expect(state).toBeTruthy();
  return { state: state!, cookie: cookiePairs(response) };
}

async function callback(provider: Provider, flow: { state: string; cookie: string }, overrides: Partial<Env> = {}) {
  const params = new URLSearchParams({ code: `synthetic-${provider}-code`, state: flow.state });
  if (provider === "apple") {
    const response = await request(`/api/auth/callback/${provider}`, {
      method: "POST", headers: { cookie: flow.cookie, "content-type": "application/x-www-form-urlencoded" }, body: params,
    }, overrides);
    expect(response.status).toBe(302);
    const next = new URL(response.headers.get("location")!);
    expect(next.origin).toBe(apiBase);
    expect(next.pathname).toBe("/api/auth/callback/apple");
    return request(next.pathname + next.search, { headers: { cookie: flow.cookie } }, overrides);
  }
  return request(`/api/auth/callback/${provider}?${params}`, { headers: { cookie: flow.cookie } }, overrides);
}

async function stubProvider(provider: Provider, email: string, verified = true, selectedSubject?: string) {
  const subject = selectedSubject ?? (provider === "github" ? "90123001" : provider === "discord" ? "120000000000000003" : `synthetic-${provider}-new-subject`);
  const token = provider === "google" || provider === "apple" ? await idToken(provider, subject, email, verified) : null;
  const tokenUrl = {
    google: "https://oauth2.googleapis.com/token", apple: "https://appleid.apple.com/auth/token",
    github: "https://github.com/login/oauth/access_token", discord: "https://discord.com/api/oauth2/token",
  }[provider];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const parsed = new URL(input instanceof Request ? input.url : String(input));
    const url = parsed.origin + decodeURIComponent(parsed.pathname);
    providerRequests.push(url);
    if (url === tokenUrl) return Response.json({ access_token: `synthetic-${provider}-token`, token_type: "bearer",
      expires_in: 3600, scope: provider === "github" ? "read:user,user:email" : "identify email openid profile",
      ...(token ? { id_token: token } : {}) });
    if (url === "https://api.github.com/user") return Response.json({ id: Number(subject), login: "provider-public-name",
      name: "Provider supplied public name", email: null, avatar_url: "https://assets.example.invalid/avatar.png" });
    if (url === "https://api.github.com/user/emails") return Response.json([{ email, primary: true, verified, visibility: "private" }]);
    if (url === "https://discord.com/api/users/@me") return Response.json({ id: subject, username: "provider-public-name",
      global_name: "Provider supplied public name", email, verified, avatar: null, discriminator: "0" });
    throw new Error(`Unexpected synthetic provider request: ${url}`);
  });
  return subject;
}

async function counts() {
  return {
    auth: await authDb.prepare(`SELECT (SELECT count(*) FROM "user") AS users,
      (SELECT count(*) FROM "account") AS accounts, (SELECT count(*) FROM "session") AS sessions`).first(),
    profiles: await businessDb.prepare("SELECT count(*) AS count FROM user_settings").first(),
  };
}

// Execute real native D1 statements. A one-shot fault can happen either before
// commit or after a successful commit whose acknowledgement was lost. Never
// replace a write with a canned successful response.
function faultDatabase(database: D1Database, matches: (sql: string) => boolean, phase: "before" | "after") {
  let triggered = 0;
  const nativeStatements = new WeakMap<object, D1PreparedStatement>();
  function wrap(statement: D1PreparedStatement, sql: string): D1PreparedStatement {
    const proxy = new Proxy(statement, {
      get(target, property) {
        if (property === "bind") return (...values: unknown[]) => wrap(target.bind(...values), sql);
        const member = Reflect.get(target, property, target);
        if (typeof member !== "function") return member;
        if (!["all", "run", "first", "raw"].includes(String(property))) return member.bind(target);
        return async (...args: unknown[]) => {
          const selected = !triggered && matches(sql);
          if (selected) triggered++;
          if (selected && phase === "before") throw new Error("Synthetic D1 pre-commit failure");
          const result = await member.apply(target, args);
          if (selected && phase === "after") throw new Error("Synthetic D1 acknowledgement lost after native commit");
          return result;
        };
      },
    });
    nativeStatements.set(proxy, statement);
    return proxy;
  }
  const binding = new Proxy(database, {
    get(target, property) {
      if (property === "prepare") return (sql: string) => wrap(target.prepare(sql), sql);
      if (property === "batch") return (statements: D1PreparedStatement[]) =>
        target.batch(statements.map(statement => nativeStatements.get(statement) ?? statement));
      const member = Reflect.get(target, property, target);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  return { binding, get triggered() { return triggered; } };
}

function refusesSession(response: Response) {
  expect(response.headers.get("location")).not.toBe(`${appOrigin}/auth`);
  expect(cookiePairs(response)).not.toContain("better-auth.session_token=");
}

async function pendingUser() {
  const result = await authDb.prepare(`SELECT id, oauthSignupCommandId, oauthSignupProfileId,
    oauthSignupProvider, oauthSignupSubject, oauthSignupLanguage, oauthSignupState FROM "user"`).all();
  expect(result.results).toHaveLength(1);
  return result.results[0] as { id: string; oauthSignupProfileId: string; oauthSignupState: string };
}

beforeAll(async () => {
  const migrations = inject("businessOAuthMigrations");
  expect(migrations).toHaveLength(25);
  for (const migration of migrations) {
    await businessDb.batch(checkedInSqlStatements(migration.sql).map(sql => businessDb.prepare(sql)));
  }
  for (const migration of [authSql, commandSql, suspensionSql, oauthSql]) {
    await authDb.batch(checkedInSqlStatements(migration).map(sql => authDb.prepare(sql)));
  }
  // A second native binding represents the deployed pre-0009 Auth schema.
  for (const migration of [authSql, commandSql, suspensionSql]) {
    await runtimeEnv.MASTER_DB!.batch(checkedInSqlStatements(migration).map(sql => runtimeEnv.MASTER_DB!.prepare(sql)));
  }
  signingKey = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-256" }, true, ["sign", "verify"])).privateKey;
});

beforeEach(async () => {
  providerRequests = [];
  await businessDb.prepare("DELETE FROM user_settings").run();
  await authDb.prepare('DELETE FROM "user"').run();
  await authDb.prepare('DELETE FROM "verification"').run();
  await businessDb.batch([
    businessDb.prepare("DELETE FROM system_settings WHERE setting_key IN ('social_login_enabled', 'invitation_mode')"),
    businessDb.prepare(`INSERT INTO system_settings (setting_key, setting_value, created_at, updated_at)
      VALUES ('social_login_enabled','true',?,?),('invitation_mode','false',?,?)`)
      .bind(...Array(4).fill("2026-10-03T00:00:00.000000Z")),
  ]);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  expect((await authDb.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  expect((await businessDb.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});

it.each(providers)("provisions a new %s identity before its first session and completes password setup", async provider => {
  const email = `private-prefix-${provider}@example.invalid`;
  const subject = await stubProvider(provider, email);
  const language = { google: "ja", github: "en", discord: "ko", apple: "id" }[provider];
  const flow = await start(provider, language, {}, {
    serverContext: { fanmarkSignup: { version: 1, provider, commandId: crypto.randomUUID(), profileId: crypto.randomUUID(), language: "en" } },
    plan_type: "admin", username: "forged-public-name", requires_password_setup: false,
  });
  const response = await callback(provider, flow);
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(`${appOrigin}/auth`);
  const cookie = cookiePairs(response);
  expect(cookie).toContain("better-auth.session_token=");
  const sessionResponse = await request("/api/auth/get-session", { headers: { cookie } });
  expect(sessionResponse.status).toBe(200);
  const session = await sessionResponse.json() as { user: { id: string }; session: { id: string } };
  expect(session.user.id).toMatch(uuid);
  expect(session.session.id).toMatch(uuid);
  expect(JSON.stringify(session)).not.toContain("oauthSignup");
  const user = await authDb.prepare('SELECT * FROM "user" WHERE email = ?').bind(email).first();
  expect(user).toMatchObject({ id: session.user.id, oauthSignupProvider: provider,
    oauthSignupSubject: subject, oauthSignupLanguage: language, oauthSignupState: "completed" });
  const profile = await businessDb.prepare("SELECT * FROM user_settings WHERE user_id = ?").bind(session.user.id).first();
  expect(profile).toMatchObject({ id: user?.oauthSignupProfileId, user_id: session.user.id,
    username: `user_${session.user.id.slice(0, 8)}`, display_name: `user_${session.user.id.slice(0, 8)}`,
    plan_type: "free", preferred_language: language, requires_password_setup: 1 });
  expect(JSON.stringify(profile)).not.toContain("private-prefix");
  const setup = await request("/api/me/password-setup", {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ newPassword: "Synthetic-New-OAuth-Password!2026" }),
  });
  expect(setup.status).toBe(200);
  expect(await businessDb.prepare("SELECT requires_password_setup FROM user_settings WHERE user_id = ?")
    .bind(session.user.id).first()).toEqual({ requires_password_setup: 0 });
  const repeat = await callback(provider, await start(provider, "en"));
  expect(repeat.headers.get("location")).toBe(`${appOrigin}/auth`);
  expect(await businessDb.prepare("SELECT id, preferred_language, requires_password_setup FROM user_settings WHERE user_id = ?")
    .bind(session.user.id).first()).toEqual({ id: profile?.id, preferred_language: language, requires_password_setup: 0 });
  expect((await counts()).profiles).toEqual({ count: 1 });
});

for (const phase of ["before", "after"] as const) {
  it.each(providers)(`recovers %s account creation after a ${phase}-commit failure without trusting unverified email`, async provider => {
    await stubProvider(provider, `unverified-${provider}@example.invalid`, false);
    const fault = faultDatabase(authDb, sql => /^insert into "account"/iu.test(sql.trim()), phase);
    const failed = await callback(provider, await start(provider), { AUTH_DB: fault.binding });
    refusesSession(failed);
    expect(fault.triggered).toBe(1);
    const user = await pendingUser();
    expect(user.oauthSignupState).toBe("pending");
    expect(await counts()).toEqual({ auth: { users: 1, accounts: phase === "before" ? 0 : 1, sessions: 0 }, profiles: { count: 0 } });
    const retry = await callback(provider, await start(provider, "en"));
    expect(retry.headers.get("location")).toBe(`${appOrigin}/auth`);
    const recovered = await pendingUser();
    expect(recovered).toMatchObject({ id: user.id, oauthSignupProfileId: user.oauthSignupProfileId,
      oauthSignupState: "completed", oauthSignupLanguage: "ja" });
    expect(await counts()).toEqual({ auth: { users: 1, accounts: 1, sessions: 1 }, profiles: { count: 1 } });
    expect(await businessDb.prepare("SELECT id, user_id FROM user_settings").first())
      .toEqual({ id: user.oauthSignupProfileId, user_id: user.id });
  });

  for (const stage of ["profile", "completion"] as const) {
    it.each(providers)(`recovers %s ${stage} after a ${phase}-commit failure using the same profile ID`, async provider => {
      await stubProvider(provider, `${stage}-${provider}@example.invalid`);
      const fault = faultDatabase(stage === "profile" ? businessDb : authDb,
        sql => stage === "profile" ? /^INSERT INTO user_settings/iu.test(sql.trim())
          : /^UPDATE "user" SET "oauthSignupState" = 'completed'/iu.test(sql.trim()), phase);
      const overrides = stage === "profile" ? { FANMARK_DB: fault.binding } : { AUTH_DB: fault.binding };
      refusesSession(await callback(provider, await start(provider), overrides));
      expect(fault.triggered).toBe(1);
      const user = await pendingUser();
      expect(user.oauthSignupState).toBe(stage === "completion" && phase === "after" ? "completed" : "pending");
      expect(await counts()).toEqual({ auth: { users: 1, accounts: 1, sessions: 0 },
        profiles: { count: stage === "profile" && phase === "before" ? 0 : 1 } });
      const retry = await callback(provider, await start(provider));
      expect(retry.headers.get("location")).toBe(`${appOrigin}/auth`);
      expect(await pendingUser()).toMatchObject({ id: user.id, oauthSignupProfileId: user.oauthSignupProfileId,
        oauthSignupState: "completed" });
      expect(await counts()).toEqual({ auth: { users: 1, accounts: 1, sessions: 1 }, profiles: { count: 1 } });
      expect(await businessDb.prepare("SELECT id, user_id FROM user_settings").first())
        .toEqual({ id: user.oauthSignupProfileId, user_id: user.id });
    });
  }
}

async function interruptProfile(provider: Provider = "google") {
  await stubProvider(provider, "pending-identity@example.invalid");
  const fault = faultDatabase(businessDb, sql => /^INSERT INTO user_settings/iu.test(sql.trim()), "before");
  refusesSession(await callback(provider, await start(provider), { FANMARK_DB: fault.binding }));
  expect(fault.triggered).toBe(1);
  return pendingUser();
}

it("refuses a conflicting existing profile and never overwrites or deletes it", async () => {
  const user = await interruptProfile();
  const otherId = crypto.randomUUID();
  await businessDb.prepare(`INSERT INTO user_settings (id,user_id,username,display_name,plan_type,preferred_language,
    requires_password_setup,created_at,updated_at) VALUES (?,?, 'existing-private-name', 'Edited profile','creator','ko',0,?,?)`)
    .bind(otherId, user.id, ...Array(2).fill("2026-10-03T00:00:00.000000Z")).run();
  const before = (await businessDb.prepare("SELECT * FROM user_settings").all()).results;
  refusesSession(await callback("google", await start("google")));
  expect((await businessDb.prepare("SELECT * FROM user_settings").all()).results).toEqual(before);
  expect((await pendingUser()).oauthSignupState).toBe("pending");
  expect((await counts()).auth).toEqual({ users: 1, accounts: 1, sessions: 0 });
});

it("retains a username collision and recovers only after it is resolved", async () => {
  const user = await interruptProfile();
  const otherId = crypto.randomUUID();
  const otherUser = crypto.randomUUID();
  await businessDb.prepare(`INSERT INTO user_settings (id,user_id,username,display_name,plan_type,preferred_language,
    requires_password_setup,created_at,updated_at) VALUES (?,?,?,'Other owner','max','id',0,?,?)`)
    .bind(otherId, otherUser, `user_${user.id.slice(0, 8)}`, ...Array(2).fill("2026-10-03T00:00:00.000000Z")).run();
  const before = await businessDb.prepare("SELECT * FROM user_settings WHERE id=?").bind(otherId).first();
  refusesSession(await callback("google", await start("google")));
  expect(await businessDb.prepare("SELECT * FROM user_settings WHERE id=?").bind(otherId).first()).toEqual(before);
  expect((await pendingUser()).oauthSignupState).toBe("pending");
  await businessDb.prepare("UPDATE user_settings SET username='collision-resolved' WHERE id=?").bind(otherId).run();
  expect((await callback("google", await start("google"))).headers.get("location")).toBe(`${appOrigin}/auth`);
  expect(await businessDb.prepare("SELECT id FROM user_settings WHERE user_id=?").bind(user.id).first())
    .toEqual({ id: user.oauthSignupProfileId });
});

it.each(["google", "github"] as const)("refuses a different %s identity with a pending user's email", async provider => {
  const user = await interruptProfile();
  const before = await counts();
  await stubProvider(provider, "pending-identity@example.invalid", true, provider === "google" ? "different-google-subject" : "90123002");
  refusesSession(await callback(provider, await start(provider)));
  expect(await counts()).toEqual(before);
  expect(await pendingUser()).toEqual(user);
});

it("refuses pending login when signup is disabled again", async () => {
  const user = await interruptProfile();
  const overrides = { AUTH_SOCIAL_PROVISIONING_BACKEND: undefined };
  refusesSession(await callback("google", await start("google", "ja", overrides), overrides));
  expect(await counts()).toEqual({ auth: { users: 1, accounts: 1, sessions: 0 }, profiles: { count: 0 } });
  expect(await pendingUser()).toEqual(user);
});

it("refuses a banned pending identity before creating its profile", async () => {
  const user = await interruptProfile();
  await authDb.prepare('UPDATE "user" SET "banned"=1 WHERE id=?').bind(user.id).run();
  refusesSession(await callback("google", await start("google")));
  expect(await counts()).toEqual({ auth: { users: 1, accounts: 1, sessions: 0 }, profiles: { count: 0 } });
  expect((await pendingUser()).oauthSignupState).toBe("pending");
});

it("does not resurrect a deleted completed profile", async () => {
  await stubProvider("google", "deleted-profile@example.invalid");
  expect((await callback("google", await start("google"))).headers.get("location")).toBe(`${appOrigin}/auth`);
  await authDb.prepare('DELETE FROM "session"').run();
  await businessDb.prepare("DELETE FROM user_settings").run();
  const before = await counts();
  refusesSession(await callback("google", await start("google")));
  expect(await counts()).toEqual(before);
  expect((await pendingUser()).oauthSignupState).toBe("completed");
});

it("preserves edited completed profile data on later OAuth logins", async () => {
  await stubProvider("google", "edited-profile@example.invalid");
  expect((await callback("google", await start("google"))).headers.get("location")).toBe(`${appOrigin}/auth`);
  await businessDb.prepare(`UPDATE user_settings SET username='owner-choice', display_name='Owner edited name',
    plan_type='creator', preferred_language='ko', requires_password_setup=0`).run();
  const before = (await businessDb.prepare("SELECT * FROM user_settings").all()).results;
  expect((await callback("google", await start("google", "en"))).headers.get("location")).toBe(`${appOrigin}/auth`);
  expect((await businessDb.prepare("SELECT * FROM user_settings").all()).results).toEqual(before);
});

it("rejects tampered state and replay without additional provider requests or writes", async () => {
  await stubProvider("google", "state-proof@example.invalid");
  const flow = await start("google");
  const before = await counts();
  refusesSession(await callback("google", { ...flow, state: "tampered-state" }));
  expect(providerRequests).toEqual([]);
  expect(await counts()).toEqual(before);
  expect((await callback("google", flow)).headers.get("location")).toBe(`${appOrigin}/auth`);
  const after = await counts();
  const requests = providerRequests.length;
  refusesSession(await callback("google", flow));
  expect(providerRequests).toHaveLength(requests);
  expect(await counts()).toEqual(after);
});

it("concurrent callbacks retain one durable identity, account and profile and can be retried", async () => {
  await stubProvider("google", "concurrent@example.invalid");
  const flows = await Promise.all([start("google"), start("google")]);
  const responses = await Promise.all(flows.map(flow => callback("google", flow)));
  expect(responses.some(response => response.headers.get("location") === `${appOrigin}/auth`)).toBe(true);
  const user = await pendingUser();
  expect(user.oauthSignupState).toBe("completed");
  const before = await counts();
  expect(before.auth).toMatchObject({ users: 1, accounts: 1 });
  expect(before.profiles).toEqual({ count: 1 });
  expect((await callback("google", await start("google"))).headers.get("location")).toBe(`${appOrigin}/auth`);
  expect(await pendingUser()).toEqual(user);
  expect((await counts()).profiles).toEqual({ count: 1 });
});

it.each(["oauthSignupCommandId", "oauthSignupProfileId", "oauthSignupProvider", "oauthSignupSubject", "oauthSignupLanguage"])(
  "rejects a partial durable marker missing %s without creating a profile or session", async field => {
    await interruptProfile();
    await authDb.prepare(`UPDATE "user" SET "${field}" = NULL`).run();
    const before = await counts();
    refusesSession(await callback("google", await start("google")));
    expect(await counts()).toEqual(before);
  },
);

it("refuses recovery when the provider account belongs to another user", async () => {
  const user = await interruptProfile();
  await authDb.prepare('DELETE FROM "account"').run();
  const other = crypto.randomUUID();
  const now = new Date().toISOString();
  await authDb.prepare(`INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt,banned)
    VALUES (?, 'Other identity', 'other-owner@example.invalid',1,?,?,0)`).bind(other, now, now).run();
  await authDb.prepare(`INSERT INTO "account" (id,accountId,providerId,userId,createdAt,updatedAt)
    VALUES (?, 'synthetic-google-new-subject','google',?,?,?)`).bind(crypto.randomUUID(), other, now, now).run();
  const before = await counts();
  refusesSession(await callback("google", await start("google")));
  expect(await counts()).toEqual(before);
  expect(await authDb.prepare('SELECT "userId" FROM "account"').first()).toEqual({ userId: other });
  expect(await authDb.prepare('SELECT "oauthSignupState" FROM "user" WHERE id=?').bind(user.id).first())
    .toEqual({ oauthSignupState: "pending" });
});

it("cannot complete a missing OAuth account through credential login", async () => {
  await stubProvider("google", "pending-credential@example.invalid");
  const fault = faultDatabase(authDb, sql => /^insert into "account"/iu.test(sql.trim()), "before");
  refusesSession(await callback("google", await start("google"), { AUTH_DB: fault.binding }));
  const user = await pendingUser();
  const password = "Synthetic-Recovery-Password!2026";
  const now = new Date().toISOString();
  await authDb.prepare(`INSERT INTO "account" (id,accountId,providerId,userId,password,createdAt,updatedAt)
    VALUES (?,?,'credential',?,?,?,?)`).bind(crypto.randomUUID(), user.id, user.id,
      await bcrypt.hash(password, 4), now, now).run();
  const response = await request("/api/auth/sign-in/email", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "pending-credential@example.invalid", password }) });
  expect(response.status).toBe(409);
  expect(cookiePairs(response)).not.toContain("better-auth.session_token=");
  expect(await counts()).toEqual({ auth: { users: 1, accounts: 1, sessions: 0 }, profiles: { count: 0 } });
  expect((await pendingUser()).oauthSignupState).toBe("pending");
  expect((await callback("google", await start("google"))).headers.get("location")).toBe(`${appOrigin}/auth`);
  expect(await counts()).toEqual({ auth: { users: 1, accounts: 2, sessions: 1 }, profiles: { count: 1 } });
});

it("keeps new-user signup closed with the provisioning selector absent", async () => {
  await stubProvider("google", "disabled-new-signup@example.invalid");
  const overrides = { AUTH_SOCIAL_PROVISIONING_BACKEND: undefined };
  refusesSession(await callback("google", await start("google", "ja", overrides), overrides));
  expect(await counts()).toEqual({ auth: { users: 0, accounts: 0, sessions: 0 }, profiles: { count: 0 } });
});

it("closes provider capabilities, start and callback against the native pre-0009 schema", async () => {
  const overrides = { AUTH_DB: runtimeEnv.MASTER_DB };
  const caps = await request("/api/auth/capabilities", {}, overrides);
  expect(caps.status).toBe(200);
  expect(await caps.json()).toMatchObject({ socialProviders: [] });
  const startResponse = await request("/api/auth/sign-in/social", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "google", callbackURL: `${appOrigin}/auth` }) }, overrides);
  expect(startResponse.status).toBe(403);
  expect((await request("/api/auth/callback/google?state=synthetic&code=synthetic", {}, overrides)).status).toBe(403);
  expect(providerRequests).toEqual([]);
  expect(await runtimeEnv.MASTER_DB!.prepare('SELECT count(*) AS count FROM "user"').first()).toEqual({ count: 0 });
});

it.each(["user_oauthSignupCommandId_key", "user_oauthSignupProfileId_key", "user_oauthSignupIdentity_key", "account_providerId_accountId_key"])(
  "closes OAuth when its required unique index %s is missing", async name => {
    const flow = await start("google");
    const definition = await authDb.prepare("SELECT sql FROM sqlite_master WHERE name=? AND type='index'").bind(name).first<{ sql: string }>();
    expect(definition?.sql).toBeTruthy();
    await authDb.prepare(`DROP INDEX "${name}"`).run();
    try {
      expect(await (await request("/api/auth/capabilities")).json()).toMatchObject({ socialProviders: [] });
      const response = await request("/api/auth/sign-in/social", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "google", callbackURL: `${appOrigin}/auth` }) });
      expect(response.status).toBe(403);
      expect((await callback("google", flow)).status).toBe(403);
      expect(providerRequests).toEqual([]);
      expect(await counts()).toEqual({ auth: { users: 0, accounts: 0, sessions: 0 }, profiles: { count: 0 } });
    } finally {
      await authDb.prepare(definition!.sql).run();
    }
    expect(await (await request("/api/auth/capabilities")).json()).toMatchObject({ socialProviders: ["apple", "discord", "github", "google"] });
  },
);

it("refuses an index with the right name but without uniqueness", async () => {
  const name = "account_providerId_accountId_key";
  const definition = await authDb.prepare("SELECT sql FROM sqlite_master WHERE name=?").bind(name).first<{ sql: string }>();
  await authDb.prepare(`DROP INDEX "${name}"`).run();
  await authDb.prepare(`CREATE INDEX "${name}" ON "account" ("providerId", "accountId")`).run();
  try {
    expect(await (await request("/api/auth/capabilities")).json()).toMatchObject({ socialProviders: [] });
    expect(providerRequests).toEqual([]);
  } finally {
    await authDb.prepare(`DROP INDEX "${name}"`).run();
    await authDb.prepare(definition!.sql).run();
  }
});

it("closes OAuth on schema-read failure without treating it as an empty schema", async () => {
  const fault = faultDatabase(authDb, sql => /^PRAGMA table_info\("user"\)/iu.test(sql), "before");
  expect(await (await request("/api/auth/capabilities", {}, { AUTH_DB: fault.binding })).json())
    .toMatchObject({ socialProviders: [] });
  expect(fault.triggered).toBe(1);
  expect(providerRequests).toEqual([]);
  expect(await counts()).toEqual({ auth: { users: 0, accounts: 0, sessions: 0 }, profiles: { count: 0 } });
});

it("rechecks invitation policy before a new-user callback can provision anything", async () => {
  await stubProvider("google", "new-policy-change@example.invalid");
  const flow = await start("google");
  await businessDb.prepare("UPDATE system_settings SET setting_value='true' WHERE setting_key='invitation_mode'").run();
  expect((await callback("google", flow)).status).toBe(403);
  expect(providerRequests).toEqual([]);
  expect(await counts()).toEqual({ auth: { users: 0, accounts: 0, sessions: 0 }, profiles: { count: 0 } });
});
