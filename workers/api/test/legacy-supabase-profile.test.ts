import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { handleRequest } from "../src";
import type { Env } from "../src/repository";
import { network } from "./network";

const root = "https://legacy-fixture.supabase.co";
const origin = "https://app.example.test";
const owner = "e62ce4d0-8055-4ecb-9e3a-759d70d659e0";
const foreign = "2a1b9c5f-3c8a-4890-9e04-3768885b6dd8";
const serviceKey = "sb_secret_synthetic_only";
const publicKey = "sb_publishable_synthetic_only";
const encoder = new TextEncoder();
const config: Env = {
  AUTH_BACKEND: "supabase", PROFILE_BACKEND: "supabase", SUPABASE_URL: root,
  SUPABASE_PUBLISHABLE_KEY: publicKey, SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  CORS_ALLOWED_ORIGINS: origin,
};
type ObservedRequest = Pick<Request, "method" | "headers" | "url" | "json">;
let authCalls: ObservedRequest[], dataCalls: ObservedRequest[];
let row: Record<string, unknown>;
let active: boolean;

function encode(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function signingKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode("owned-test-only-signing-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function jwt(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}): Promise<string> {
  const data = `${encode({ alg: "HS256", typ: "JWT", ...header })}.${encode({
    sub: owner, iss: `${root}/auth/v1`, aud: "authenticated", role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 300, ...claims,
  })}`;
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(data)));
  return `${data}.${btoa(String.fromCharCode(...signature)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
async function request(token?: string, init: RequestInit = {}, overrides: Partial<Env> = {}, query = ""): Promise<Response> {
  const headers = new Headers({ origin, ...(token ? { authorization: `Bearer ${token}` } : {}) });
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return handleRequest(new Request(`https://api.example.test/api/me/profile${query}`, { ...init, headers }), { ...config, ...overrides });
}
function patch(value: unknown): RequestInit {
  return { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(value) };
}

describe("legacy JWT and service-role own-profile bridge on Worker", () => {
  beforeEach(() => {
    authCalls = []; dataCalls = []; active = true;
    row = { id: "c4c3f3db-e13e-4598-8ae8-5ded9c72f31d", user_id: owner, username: "owner",
      display_name: "Owner", avatar_url: null, plan_type: "free", preferred_language: "ja",
      created_at: "2026-10-13T00:00:00Z", updated_at: "2026-10-13T00:00:00Z", requires_password_setup: false,
      stripe_customer_id: "private-customer", invited_by_code: "private-invitation" };
    network.use(http.get(`${root}/auth/v1/user`, async ({ request: upstream }) => {
      authCalls.push(upstream.clone());
      expect(upstream.headers.get("apikey")).toBe(publicKey);
      expect(upstream.headers.get("cookie")).toBeNull();
      const token = upstream.headers.get("authorization")?.slice(7) ?? "";
      const parts = token.split(".");
      let signatureValid = false;
      try {
        signatureValid = await crypto.subtle.verify("HMAC", await signingKey(),
          Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)),
          encoder.encode(`${parts[0]}.${parts[1]}`));
      } catch { /* Reject malformed signature. */ }
      if (!signatureValid || !active) return HttpResponse.json({ error: "private-auth-error" }, { status: 401 });
      return HttpResponse.json({ id: owner, role: "authenticated", email: "private@example.invalid",
        user_metadata: { role: "admin", user_id: foreign } });
    }));
    network.use(http.all(`${root}/rest/v1/user_settings`, async ({ request: upstream }) => {
      dataCalls.push(upstream.clone());
      const url = new URL(upstream.url);
      expect(url.searchParams.get("user_id")).toBe(`eq.${owner}`);
      expect(url.searchParams.get("select")).not.toContain("stripe_customer_id");
      expect(upstream.headers.get("apikey")).toBe(serviceKey);
      expect(upstream.headers.get("authorization")).toBe(`Bearer ${serviceKey}`);
      expect(upstream.headers.get("cookie")).toBeNull();
      if (upstream.method === "PATCH") {
        if (url.searchParams.has("limit")) return HttpResponse.json({ code: "PGRST109" }, { status: 400 });
        expect(url.searchParams.get("id")).toBe(`eq.${row.id}`);
        const value = await upstream.json() as Record<string, unknown>;
        row = { ...row, ...value };
      }
      return HttpResponse.json([row]);
    }));
  });

  it("validates the bearer at Auth, independently authorizes service-role reads and strips private fields", async () => {
    const response = await request(await jwt(), { headers: { cookie: "must-not-forward=1" } }, {
      FANMARK_DB: { prepare() { throw new Error("D1 must never be accessed"); } } as unknown as D1Database,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(await response.json()).toEqual({ schemaVersion: 1, profile: Object.fromEntries(
      Object.entries(row).filter(([key]) => !["stripe_customer_id", "invited_by_code"].includes(key))) });
    expect(authCalls).toHaveLength(1); expect(dataCalls).toHaveLength(1);
  });

  it("updates only the verified owner's named editable fields, without D1 or identity/plan writes", async () => {
    const response = await request(await jwt(), patch({ display_name: "Edited", preferred_language: "ko" }));
    expect(response.status).toBe(200);
    expect(row.display_name).toBe("Edited"); expect(row.plan_type).toBe("free"); expect(row.user_id).toBe(owner);
    expect(dataCalls.map(r => r.method)).toEqual(["GET", "PATCH"]);
    expect(await dataCalls[1].json()).toEqual({ display_name: "Edited", preferred_language: "ko" });
  });

  it("independently authorizes the retained legacy username route", async () => {
    let usernameCalls = 0;
    network.use(http.post(`${root}/rest/v1/rpc/check_username_availability_secure`, async ({ request: upstream }) => {
      usernameCalls++;
      expect(upstream.headers.get("authorization")).toBe(`Bearer ${serviceKey}`);
      expect(await upstream.json()).toEqual({ username_to_check: "OWNER", current_user_id: owner });
      return HttpResponse.json(true);
    }));
    const response = await handleRequest(new Request("https://api.example.test/api/me/username-availability?username=OWNER", {
      headers: { origin, authorization: `Bearer ${await jwt()}` },
    }), config);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ schemaVersion: 1, available: true });
    expect(usernameCalls).toBe(1); expect(authCalls).toHaveLength(1);
  });

  it.each(["?username=owner&current_user_id=foreign", "?username=a&username=b", "?username=" + "x".repeat(257)])("rejects caller identity, duplicate and oversized username query: %s", async query => {
    const response = await handleRequest(new Request(`https://api.example.test/api/me/username-availability${query}`, {
      headers: { origin, authorization: `Bearer ${await jwt()}` },
    }), config);
    expect(response.status).toBe(400); expect(authCalls).toHaveLength(0); expect(dataCalls).toHaveLength(0);
  });

  it("rejects malformed availability payloads without exposing or retrying the RPC", async () => {
    let calls = 0;
    network.use(http.post(`${root}/rest/v1/rpc/check_username_availability_secure`, () => { calls++; return HttpResponse.json({ available: true, private: "must-not-escape" }); }));
    const response = await handleRequest(new Request("https://api.example.test/api/me/username-availability?username=owner", {
      headers: { origin, authorization: `Bearer ${await jwt()}` },
    }), config);
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "username_availability_unavailable" });
    expect(calls).toBe(1);
  });

  it("accepts a current owner's Supabase upload reference", async () => {
    const avatar = `${root}/storage/v1/object/public/avatars/${owner}/1791849600000.png`;
    expect((await request(await jwt(), patch({ avatar_url: avatar }))).status).toBe(200);
    expect(row.avatar_url).toBe(avatar);
  });

  it("rejects forged signatures and Auth-server rejection before elevated access", async () => {
    const token = await jwt();
    const forged = token.slice(0, token.lastIndexOf(".") + 1) + "Zm9yZ2Vk";
    expect((await request(forged)).status).toBe(401);
    active = false;
    const response = await request(token);
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(dataCalls).toHaveLength(0);
  });

  it.each([
    { role: "service_role" }, { role: "anon" }, { aud: "other" }, { sub: "not-a-uuid" },
    { iss: "https://other.supabase.co/auth/v1" }, { exp: 1 }, { nbf: 9999999999 },
  ])("rejects non-user/foreign/expired claims without any upstream call: %j", async claims => {
    expect((await request(await jwt(claims))).status).toBe(401);
    expect(authCalls).toHaveLength(0); expect(dataCalls).toHaveLength(0);
  });

  it("rejects missing bearer, cookie-only auth and unsigned JWTs", async () => {
    expect((await request(undefined, { headers: { cookie: "better-auth.session_token=anything" } })).status).toBe(401);
    expect((await request(await jwt({}, { alg: "none" }))).status).toBe(401);
    expect(authCalls).toHaveLength(0); expect(dataCalls).toHaveLength(0);
  });

  it.each(["user_id", "id", "plan_type", "stripe_customer_id", "requires_password_setup"])("rejects privilege or identity PATCH field %s", async field => {
    expect((await request(await jwt(), patch({ [field]: foreign }))).status).toBe(400);
    expect(authCalls).toHaveLength(0); expect(dataCalls).toHaveLength(0);
  });

  it.each([
    `${root}/storage/v1/object/public/avatars/${foreign}/1791849600000.png`,
    `https://foreign.example/storage/v1/object/public/avatars/${owner}/1791849600000.png`,
    `${root}/storage/v1/object/public/avatars/${owner}/1791849600000.png?private=1`,
  ])("rejects foreign or noncanonical avatar before mutation: %s", async avatar => {
    expect((await request(await jwt(), patch({ avatar_url: avatar }))).status).toBe(400);
    expect(dataCalls.map(r => r.method)).toEqual(["GET"]);
  });

  it("rejects incorrect Auth user identity even if user_metadata claims ownership", async () => {
    network.use(http.get(`${root}/auth/v1/user`, () => HttpResponse.json({ id: foreign, role: "authenticated", user_metadata: { id: owner } })));
    expect((await request(await jwt())).status).toBe(401); expect(dataCalls).toHaveLength(0);
  });

  it.each([{ is_anonymous: true }, { deleted_at: "2026-10-13T00:00:00Z" },
    { banned_until: "2999-01-01T00:00:00Z" }, { banned_until: "invalid" }])("rejects invalid or suspended Auth user state: %j", async state => {
    network.use(http.get(`${root}/auth/v1/user`, () => HttpResponse.json({ id: owner, role: "authenticated", ...state })));
    expect((await request(await jwt())).status).toBe(401); expect(dataCalls).toHaveLength(0);
  });

  it("uses a separately pinned custom Auth origin and issuer without redirects", async () => {
    const authOrigin = "https://auth.example.test";
    let calls = 0;
    network.use(http.get(`${authOrigin}/auth/v1/user`, ({ request: upstream }) => {
      calls++; expect(upstream.headers.get("apikey")).toBe(publicKey);
      return HttpResponse.json({ id: owner, role: "authenticated" });
    }));
    expect((await request(await jwt({ iss: `${authOrigin}/auth/v1` }), {}, { SUPABASE_AUTH_URL: authOrigin })).status).toBe(200);
    expect(calls).toBe(1); expect(authCalls).toHaveLength(0); expect(dataCalls).toHaveLength(1);
  });

  it("supports a server-configured legacy service-role JWT without accepting it as user auth", async () => {
    const key = await jwt({ role: "service_role" });
    network.use(http.get(`${root}/rest/v1/user_settings`, ({ request: upstream }) => {
      expect(upstream.headers.get("authorization")).toBe(`Bearer ${key}`);
      expect(new URL(upstream.url).searchParams.get("user_id")).toBe(`eq.${owner}`);
      return HttpResponse.json([row]);
    }));
    expect((await request(await jwt(), {}, { SUPABASE_SERVICE_ROLE_KEY: key })).status).toBe(200);
    expect((await request(key)).status).toBe(401);
  });

  it.each([{ rows: [{ user_id: foreign }] }, { rows: [{}, {}] }])("refuses wrong owner/ambiguous profile rows before PATCH: %j", async ({ rows }) => {
    let reads = 0;
    network.use(http.get(`${root}/rest/v1/user_settings`, () => { reads++; return HttpResponse.json(rows.map(v => ({ ...row, ...v }))); }));
    expect((await request(await jwt(), patch({ display_name: "Attack" }))).status).toBe(503);
    expect(reads).toBe(1);
    expect(dataCalls).toHaveLength(0); expect(row.display_name).toBe("Owner");
  });

  it.each([302, 500])("does not follow Auth redirect or leak upstream failure %s", async status => {
    network.use(http.get(`${root}/auth/v1/user`, () => HttpResponse.json({ private: "must-not-escape" }, { status, headers: { location: "https://foreign.example" } })));
    const response = await request(await jwt());
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "supabase_unavailable" });
    expect(dataCalls).toHaveLength(0);
  });

  it("rejects oversized Auth responses without elevated access", async () => {
    network.use(http.get(`${root}/auth/v1/user`, () => HttpResponse.json({ id: owner, role: "authenticated", padding: "x".repeat(65536) })));
    expect((await request(await jwt())).status).toBe(503); expect(dataCalls).toHaveLength(0);
  });

  it.each([
    { AUTH_BACKEND: "better-auth" }, { STORAGE_BACKEND: "r2" },
    { SUPABASE_SERVICE_ROLE_KEY: publicKey }, { SUPABASE_PUBLISHABLE_KEY: serviceKey },
    { SUPABASE_URL: "https://legacy-fixture.supabase.co/unsafe" },
  ])("fails closed on mixed or unsafe source configuration %j", async overrides => {
    expect((await request(await jwt(), {}, overrides)).status).toBe(500);
    expect(authCalls).toHaveLength(0); expect(dataCalls).toHaveLength(0);
  });

  it("rejects unlisted Origin, owner query parameters, and unsupported methods before auth", async () => {
    expect((await request(await jwt(), { headers: { origin: "https://foreign.example" } })).status).toBe(403);
    expect((await request(await jwt(), {}, {}, `?user_id=${foreign}`)).status).toBe(400);
    expect((await request(await jwt(), { method: "DELETE" })).status).toBe(405);
    expect(authCalls).toHaveLength(0); expect(dataCalls).toHaveLength(0);
  });

  it("allows only named preflight methods and authorization header, with no Auth/DB call", async () => {
    const response = await request(undefined, { method: "OPTIONS", headers: { "access-control-request-method": "PATCH" } });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toBe("authorization, content-type");
    expect((await request(undefined, { method: "OPTIONS", headers: { "access-control-request-method": "DELETE" } })).status).toBe(405);
    expect(authCalls).toHaveLength(0); expect(dataCalls).toHaveLength(0);
  });

  it("never retries an ambiguous source PATCH acknowledgement", async () => {
    network.use(http.patch(`${root}/rest/v1/user_settings`, () => { dataCalls.push(new Request(root, { method: "PATCH" })); return HttpResponse.error(); }));
    expect((await request(await jwt(), patch({ display_name: "Edit" }))).status).toBe(503);
    expect(dataCalls.filter(r => r.method === "PATCH")).toHaveLength(1);
  });
});
