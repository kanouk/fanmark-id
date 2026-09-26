import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "./fixtures/d1-fanmark-details.sql?raw";
import { handleFanmarkDetailsRequest } from "../src/fanmark-details-d1-api";
import type { Env } from "../src/repository";
import type { StorageAuthResolver } from "../src/storage-r2";

const runtimeEnv = env as unknown as Env;
const database = runtimeEnv.FANMARK_DB;
const API_BASE = "https://api.example.test";
const APP_ORIGIN = "https://app.example.test";
const FANMARK_ID = "d8416a59-3f01-4c4d-9d9d-201f4f57f00a";
const USER_ID = "e62ce4d0-8055-4ecb-9e3a-759d70d659e0";
const OTHER_USER_ID = "2a1b9c5f-3c8a-4890-9e04-3768885b6dd8";
const OLD_LICENSE_ID = "45111111-1111-4111-8111-111111111111";
const CURRENT_LICENSE_ID = "45222222-2222-4222-8222-222222222222";
const ENTRY_ID = "45333333-3333-4333-8333-333333333333";
const NOW = "2026-09-26T00:00:00.000Z";

interface FanmarkDetailsTestResult extends Record<string, unknown> {
  short_id: string;
  is_current_owner: boolean;
  has_pending_lottery: boolean;
  is_favorited: boolean;
  lottery_entry_count: number;
  license_history: Array<{ username: string; status: string }>;
  history_available: boolean;
  current_owner_username: string | null;
}

const ownerAuth: StorageAuthResolver = async () => ({ available: true, userId: USER_ID });
const otherAuth: StorageAuthResolver = async () => ({ available: true, userId: OTHER_USER_ID });
const anonymousAuth: StorageAuthResolver = async () => ({ available: true, userId: null });

async function request(body: unknown, headers: Record<string, string> = {}): Promise<Request> {
  return new Request(`${API_BASE}/api/fanmarks/details`, {
    method: "POST",
    headers: { Origin: APP_ORIGIN, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  if (!database) throw new Error("Business D1 binding unavailable");
  const statements = schemaSql.split(";").map((statement) => statement.trim()).filter(Boolean);
  await database.batch(statements.map((statement) => database.prepare(statement)));
});

beforeEach(async () => {
  if (!database) throw new Error("Business D1 binding unavailable");
  for (const table of ["fanmark_favorites", "fanmark_discoveries", "fanmark_lottery_entries", "fanmark_licenses", "user_settings", "fanmarks"]) {
    await database.prepare(`DELETE FROM ${table}`).run();
  }
  await database.prepare(
    "INSERT INTO fanmarks (id, short_id, user_input_fanmark, normalized_emoji, emoji_ids, normalized_emoji_ids, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)",
  ).bind(FANMARK_ID, "rose-owned", "🌹", "🌹", JSON.stringify(["043a78d4-1e42-4502-9f57-b1d1f93482db"]),
    JSON.stringify(["043a78d4-1e42-4502-9f57-b1d1f93482db"]), "2025-01-01T00:00:00.000Z").run();
  await database.prepare("INSERT INTO user_settings (id, user_id, username, display_name) VALUES (?, ?, ?, ?)")
    .bind(`${USER_ID}-settings`, USER_ID, "rose_owner", "Rose Owner").run();
  await database.prepare("INSERT INTO user_settings (id, user_id, username, display_name) VALUES (?, ?, ?, ?)")
    .bind(`${OTHER_USER_ID}-settings`, OTHER_USER_ID, "former_holder", "Former Holder").run();
  await database.prepare(
    "INSERT INTO fanmark_licenses (id, fanmark_id, user_id, license_start, license_end, grace_expires_at, excluded_at, is_returned, status, is_initial_license, display_fanmark, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(OLD_LICENSE_ID, FANMARK_ID, OTHER_USER_ID, "2025-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z", null, null,
    0, "expired", 1, "🌹", "2025-01-02T00:00:00.000Z").run();
  await database.prepare(
    "INSERT INTO fanmark_licenses (id, fanmark_id, user_id, license_start, license_end, grace_expires_at, excluded_at, is_returned, status, is_initial_license, display_fanmark, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(CURRENT_LICENSE_ID, FANMARK_ID, USER_ID, "2026-01-02T00:00:00.000Z", "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z", null,
    0, "grace", 0, "🌹", "2026-01-02T00:00:00.000Z").run();
  await database.prepare("INSERT INTO fanmark_lottery_entries (id, fanmark_id, user_id, license_id, entry_status) VALUES (?, ?, ?, ?, 'pending')")
    .bind(ENTRY_ID, FANMARK_ID, USER_ID, CURRENT_LICENSE_ID).run();
  await database.prepare("INSERT INTO fanmark_discoveries (id, fanmark_id, normalized_emoji_ids) VALUES (?, ?, ?)")
    .bind("d7416a59-3f01-4c4d-9d9d-201f4f57f00a", FANMARK_ID, JSON.stringify(["043a78d4-1e42-4502-9f57-b1d1f93482db"])).run();
  await database.prepare("INSERT INTO fanmark_favorites (id, user_id, discovery_id, fanmark_id, normalized_emoji_ids, created_at, display_fanmark) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind("f7416a59-3f01-4c4d-9d9d-201f4f57f00a", USER_ID, "d7416a59-3f01-4c4d-9d9d-201f4f57f00a", FANMARK_ID,
      JSON.stringify(["043a78d4-1e42-4502-9f57-b1d1f93482db"]), NOW, "🌹").run();
});

describe("authenticated fanmark details D1 API", () => {
  it("returns the bounded history projection and derives user state from the session", async () => {
    const response = await handleFanmarkDetailsRequest(await request({ shortId: "rose-owned" }), runtimeEnv, ownerAuth,
      () => new Date(NOW));
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    const serialized = await response!.text();
    const payload = JSON.parse(serialized) as { schemaVersion: number; result: FanmarkDetailsTestResult };
    expect(payload.schemaVersion).toBe(1);
    expect(payload.result.short_id).toBe("rose-owned");
    expect(payload.result.is_current_owner).toBe(true);
    expect(payload.result.has_pending_lottery).toBe(true);
    expect(payload.result.is_favorited).toBe(true);
    expect(payload.result.lottery_entry_count).toBe(1);
    expect(payload.result.license_history).toHaveLength(2);
    expect(payload.result.license_history[0]).toMatchObject({ username: "rose_owner", status: "grace" });
    expect(payload.result.license_history[1]).toMatchObject({ username: "former_holder", status: "expired" });
    expect(serialized).not.toContain(USER_ID);
    expect(serialized).not.toContain(OTHER_USER_ID);
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("user_id");
    expect(serialized).not.toContain("license_id");
  });

  it("serves an anonymous-safe projection, reports missing short IDs, and rejects malformed requests", async () => {
    const anonymous = await handleFanmarkDetailsRequest(await request({ shortId: "rose-owned" }), runtimeEnv, anonymousAuth);
    const anonymousPayload = await anonymous?.json() as { result: FanmarkDetailsTestResult };
    expect(anonymous?.status).toBe(200);
    expect(anonymousPayload.result.history_available).toBe(false);
    expect(anonymousPayload.result.license_history).toEqual([]);
    expect(anonymousPayload.result.current_owner_username).toBeNull();
    expect(anonymousPayload.result.lottery_entry_count).toBe(0);
    expect(anonymousPayload.result.is_favorited).toBe(false);

    const missing = await handleFanmarkDetailsRequest(await request({ shortId: "missing" }), runtimeEnv, ownerAuth);
    expect(await missing?.json()).toEqual({ schemaVersion: 1, result: null });
    const legacyId = await handleFanmarkDetailsRequest(await request({ shortId: "legacy_id" }), runtimeEnv, ownerAuth);
    expect(await legacyId?.json()).toEqual({ schemaVersion: 1, result: null });

    const invalid = await handleFanmarkDetailsRequest(await request({ shortId: "rose-owned", userId: USER_ID }), runtimeEnv, ownerAuth);
    expect(invalid?.status).toBe(400);

    const forbidden = await handleFanmarkDetailsRequest(
      await request({ shortId: "rose-owned" }, { Origin: "https://attacker.example.test" }), runtimeEnv, ownerAuth,
    );
    expect(forbidden?.status).toBe(403);
  });

  it("does not mark another user's owner or lottery state", async () => {
    const response = await handleFanmarkDetailsRequest(await request({ shortId: "rose-owned" }), runtimeEnv, otherAuth);
    const payload = await response?.json() as { result: Record<string, unknown> };
    expect(payload.result.history_available).toBe(true);
    expect(payload.result.is_current_owner).toBe(false);
    expect(payload.result.has_pending_lottery).toBe(false);
    expect(payload.result.has_user_lottery_entry).toBe(false);
    expect(payload.result.is_favorited).toBe(false);
  });
});
