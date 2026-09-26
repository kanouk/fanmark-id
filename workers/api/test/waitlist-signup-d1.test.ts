import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "./fixtures/d1-waitlist-signup.sql?raw";
import { handleWaitlistSignupRequest } from "../src/waitlist-signup-d1-api";
import { handleRequest } from "../src/index";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const database = runtimeEnv.FANMARK_DB;
const apiBase = "https://api.example.test";
const appOrigin = "https://app.example.test";
const syntheticIp = "192.0.2.44";
let limiterMode: "allowed" | "blocked" | "throws" = "allowed";
const seenLimiterKeys: string[] = [];
const limiter = {
  async limit({ key }: { key: string }) {
    seenLimiterKeys.push(key);
    if (limiterMode === "throws") throw new Error("synthetic limiter error");
    return { success: limiterMode === "allowed" };
  },
};

function splitSql(sql: string): string[] {
  return sql.split(/;\s*(?:\r?\n|$)/u).map((statement) => statement.trim()).filter(Boolean);
}

async function prepareSchema(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch(splitSql(schemaSql).map((statement) => database.prepare(statement)));
}

async function request(
  init: RequestInit = {},
  overrides: Partial<Env> = {},
  url = `${apiBase}/api/waitlist`,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", appOrigin);
  if (!headers.has("content-type") && init.method?.toUpperCase() === "POST") headers.set("content-type", "application/json");
  const response = await handleWaitlistSignupRequest(
    new Request(url, { ...init, headers }),
    { ...runtimeEnv, WAITLIST_SIGNUP_LIMITER: limiter, ...overrides },
  );
  if (!response) throw new Error("Waitlist signup route did not match");
  return response;
}

async function countRows(): Promise<number> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  const row = await database.prepare("SELECT COUNT(*) AS count FROM waitlist").first<{ count: number }>();
  return Number(row?.count);
}

beforeAll(prepareSchema);
beforeEach(async () => {
  limiterMode = "allowed";
  seenLimiterKeys.length = 0;
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.prepare("DELETE FROM waitlist").run();
});

describe("D1 waitlist public signup API", () => {
  it("normalizes the address and creates a pending entry without exposing it", async () => {
    const response = await request({
      method: "POST",
      headers: { "cf-connecting-ip": syntheticIp },
      body: JSON.stringify({ email: "  Synthetic+Signup@Example.test  ", referral_source: "invitation_page" }),
    });
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json();
    expect(payload).toEqual({ schemaVersion: 1, accepted: true });
    expect(JSON.stringify(payload)).not.toContain("synthetic+signup@example.test");
    const row = await database!.prepare("SELECT email, referral_source, status, created_at FROM waitlist LIMIT 1")
      .first<{ email: string; referral_source: string; status: string; created_at: string }>();
    expect(row).toMatchObject({
      email: "synthetic+signup@example.test",
      referral_source: "invitation_page",
      status: "waiting",
    });
    expect(Number.isFinite(Date.parse(row!.created_at))).toBe(true);
    expect(seenLimiterKeys).toHaveLength(1);
    expect(seenLimiterKeys[0]).toMatch(/^waitlist-signup:v1:[0-9a-f]{64}$/u);
    expect(seenLimiterKeys[0]).not.toContain(syntheticIp);
  });

  it("treats normalized duplicates as the same generic accepted response", async () => {
    const first = await request({ method: "POST", body: JSON.stringify({ email: "Person@Example.test" }) });
    const duplicate = await request({ method: "POST", body: JSON.stringify({ email: " person@example.test " }) });
    expect(first.status).toBe(202);
    expect(duplicate.status).toBe(202);
    expect(await first.json()).toEqual(await duplicate.json());
    expect(await countRows()).toBe(1);
  });

  it("reaches the D1 signup handler through the deployed Worker router", async () => {
    const headers = new Headers({
      Origin: appOrigin,
      "content-type": "application/json",
      "cf-connecting-ip": syntheticIp,
    });
    const response = await handleRequest(
      new Request(`${apiBase}/api/waitlist`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email: "router-smoke@example.test" }),
      }),
      { ...runtimeEnv, WAITLIST_SIGNUP_LIMITER: limiter },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ schemaVersion: 1, accepted: true });
    expect(await countRows()).toBe(1);
  });

  it("rejects untrusted origins, methods, query strings, and non-JSON content", async () => {
    expect((await request({ method: "POST", headers: { Origin: "https://attacker.example" }, body: "{}" })).status).toBe(403);
    expect((await request({ method: "GET" })).status).toBe(405);
    expect((await request({ method: "POST", headers: { "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
    expect((await request({ method: "POST", body: JSON.stringify({ email: "person@example.test" }) }, {}, `${apiBase}/api/waitlist?unexpected=1`)).status).toBe(404);
    expect((await request({ method: "OPTIONS" })).status).toBe(204);
    expect(await countRows()).toBe(0);
  });

  it("validates the request shape, email, referral source, and declared size", async () => {
    const badRequests: RequestInit[] = [
      { method: "POST", body: "{" },
      { method: "POST", body: JSON.stringify({ email: "not-an-email" }) },
      { method: "POST", body: JSON.stringify({ email: "person@example.test", extra: true }) },
      { method: "POST", body: JSON.stringify({ email: "person@example.test", referral_source: "x".repeat(501) }) },
      { method: "POST", headers: { "content-length": "2049" }, body: JSON.stringify({ email: "person@example.test" }) },
    ];
    for (const init of badRequests) expect((await request(init)).status).toBe(400);
    expect(await countRows()).toBe(0);
  });

  it("returns generic rate-limit and unavailable responses without writing", async () => {
    limiterMode = "blocked";
    const blocked = await request({ method: "POST", body: JSON.stringify({ email: "person@example.test" }) });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
    expect(await countRows()).toBe(0);

    limiterMode = "throws";
    const failed = await request({ method: "POST", body: JSON.stringify({ email: "person@example.test" }) });
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("person@example.test");

    const unconfigured = await request({ method: "POST", body: JSON.stringify({ email: "person@example.test" }) }, {
      WAITLIST_SIGNUP_BACKEND: undefined,
    });
    expect(unconfigured.status).toBe(503);
    expect(await countRows()).toBe(0);
  });
});
