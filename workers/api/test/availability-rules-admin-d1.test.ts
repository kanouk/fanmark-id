import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "./fixtures/d1-availability-rules-admin.sql?raw";
import {
  handleAvailabilityRulesAdminRequest,
  type AvailabilityRulesAdminAuthorizer,
} from "../src/availability-rules-admin-d1-api";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const database = runtimeEnv.FANMARK_DB;
const apiBase = "https://api.example.test";
const appOrigin = "https://app.example.test";
const now = new Date("2026-09-26T12:34:56.000Z");
const initialTime = "2026-09-25T12:00:00.000000Z";
const ruleIds = [
  "a5111111-1111-4111-8111-111111111111",
  "a5222222-2222-4222-8222-222222222222",
  "a5333333-3333-4333-8333-333333333333",
  "a5444444-4444-4444-8444-444444444444",
];
const allowAdmin: AvailabilityRulesAdminAuthorizer = async () => ({ userId: "synthetic-admin", sessionId: "synthetic-session" });
const denyAdmin: AvailabilityRulesAdminAuthorizer = async (_request, headers) =>
  new Response(JSON.stringify({ error: "mfa_required" }), { status: 403, headers });

function splitSql(sql: string): string[] {
  return sql.split(/;\s*(?:\r?\n|$)/u).map((statement) => statement.trim()).filter(Boolean);
}

async function prepareSchema(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch(splitSql(schemaSql).map((statement) => database.prepare(statement)));
}

async function request(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}, authorize = allowAdmin): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", appOrigin);
  const response = await handleAvailabilityRulesAdminRequest(
    new Request(`${apiBase}${path}`, { ...init, headers }),
    { ...runtimeEnv, ...overrides },
    authorize,
    () => now,
  );
  if (!response) throw new Error("Availability rules admin route did not match");
  return response;
}

async function resetRows(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.prepare("DELETE FROM fanmark_availability_rules").run();
  const rows = [
    [ruleIds[0], "specific_pattern", 1, JSON.stringify({ patterns: ["🎄", "🏢", "💎"] }), 0, 9999, "Specific reserved patterns"],
    [ruleIds[1], "duplicate_pattern", 2, JSON.stringify({ enabled: true }), 0, 1999, "Consecutive duplicate emojis"],
    [ruleIds[2], "prefix_pattern", 3, JSON.stringify({ prefixes: { "🎄": 5.99, "🏢": 29.99, "💎": 19.99 } }), 0, null, "Prefix-based pricing"],
    [ruleIds[3], "count_based", 4, JSON.stringify({ pricing: { "1": 0.99, "2": 4.99, "3": 9.99, "4": 19.99, "5": 39.99 } }), 0, null, "Count-based default pricing"],
  ] as const;
  await database.batch(rows.map(([id, type, priority, config, active, price, description]) => database!.prepare(`
    INSERT INTO fanmark_availability_rules
      (id, rule_type, priority, rule_config, is_available, price_usd, description, created_at, updated_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'private-synthetic-user')
  `).bind(id, type, priority, config, active, price, description, initialTime, initialTime)));
}

beforeAll(prepareSchema);
beforeEach(resetRows);

describe("D1 availability rule admin API", () => {
  it("returns only the bounded admin projection and requires the existing MFA authorizer", async () => {
    expect((await request("/api/admin/availability-rules", {}, {}, denyAdmin)).status).toBe(403);
    const listed = await request("/api/admin/availability-rules");
    expect(listed.status).toBe(200);
    expect(listed.headers.get("cache-control")).toBe("no-store");
    expect(listed.headers.get("access-control-allow-credentials")).toBe("true");
    expect(await listed.json()).toEqual({
      schemaVersion: 1,
      rules: [
        { id: ruleIds[0], rule_type: "specific_pattern", priority: 1, rule_config: { patterns: ["🎄", "🏢", "💎"] }, is_available: false, price_usd: "99.99", description: "Specific reserved patterns", updated_at: initialTime },
        { id: ruleIds[1], rule_type: "duplicate_pattern", priority: 2, rule_config: { enabled: true }, is_available: false, price_usd: "19.99", description: "Consecutive duplicate emojis", updated_at: initialTime },
        { id: ruleIds[2], rule_type: "prefix_pattern", priority: 3, rule_config: { prefixes: { "🎄": 5.99, "🏢": 29.99, "💎": 19.99 } }, is_available: false, price_usd: null, description: "Prefix-based pricing", updated_at: initialTime },
        { id: ruleIds[3], rule_type: "count_based", priority: 4, rule_config: { pricing: { "1": 0.99, "2": 4.99, "3": 9.99, "4": 19.99, "5": 39.99 } }, is_available: false, price_usd: null, description: "Count-based default pricing", updated_at: initialTime },
      ],
    });
  });

  it("updates availability with compare-and-set and rejects stale or forged fields", async () => {
    const updated = await request(`/api/admin/availability-rules/${ruleIds[0]}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ isAvailable: true, expectedUpdatedAt: initialTime }),
    });
    expect(updated.status).toBe(200);
    const payload = await updated.json() as { rule: Record<string, unknown> };
    expect(payload.rule).toMatchObject({ id: ruleIds[0], is_available: true, updated_at: "2026-09-26T12:34:56.000000Z" });
    expect(JSON.stringify(payload)).not.toContain("private-synthetic-user");

    const stale = await request(`/api/admin/availability-rules/${ruleIds[0]}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ isAvailable: false, expectedUpdatedAt: initialTime }),
    });
    expect(stale.status).toBe(409);

    const forged = await request(`/api/admin/availability-rules/${ruleIds[0]}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ created_by: "attacker", expectedUpdatedAt: initialTime }),
    });
    expect(forged.status).toBe(400);
  });

  it("stores prefix prices at two decimal places and confines edits to supported prefixes", async () => {
    const updated = await request(`/api/admin/availability-rules/${ruleIds[2]}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefixPrice: { emoji: "🏢", priceUsd: "120.05" }, expectedUpdatedAt: initialTime }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      schemaVersion: 1,
      rule: { rule_config: { prefixes: { "🎄": 5.99, "🏢": 120.05, "💎": 19.99 } } },
    });

    const wrongRule = await request(`/api/admin/availability-rules/${ruleIds[0]}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefixPrice: { emoji: "🏢", priceUsd: "1.00" }, expectedUpdatedAt: initialTime }),
    });
    expect(wrongRule.status).toBe(400);

    const unsupportedPrefix = await request(`/api/admin/availability-rules/${ruleIds[2]}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefixPrice: { emoji: "🌸", priceUsd: "1.00" }, expectedUpdatedAt: initialTime }),
    });
    expect(unsupportedPrefix.status).toBe(400);
  });

  it("rejects invalid origins, methods, and non-selected backends", async () => {
    expect((await request("/api/admin/availability-rules", { headers: { Origin: "https://attacker.example" } })).status).toBe(403);
    expect((await request("/api/admin/availability-rules", { method: "POST" })).status).toBe(405);
    expect((await request("/api/admin/availability-rules", {}, { AVAILABILITY_RULES_ADMIN_BACKEND: undefined })).status).toBe(503);
  });
});
