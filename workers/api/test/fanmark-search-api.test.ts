import { describe, expect, it } from "vitest";
import { handleFanmarkSearchDetailsRequest } from "../src/fanmark-search-d1-api";
import type { Env } from "../src/repository";
import type { StorageAuthResolver } from "../src/storage-r2";

const FANMARK_ID = "4d5884a0-304d-4205-8f73-251a2ba2f2d0";
const USER_ID = "e62ce4d0-8055-4ecb-9e3a-759d70d659e0";
const ENTRY_ID = "d1b04d8a-9044-4c23-a57d-30a0b66534f6";
const APP_ORIGIN = "https://app.example.test";

const sourceRow = {
  id: FANMARK_ID,
  user_input_fanmark: "🌹",
  emoji_ids: JSON.stringify(["043a78d4-1e42-4502-9f57-b1d1f93482db"]),
  normalized_emoji: "🌹",
  short_id: "rose-owned",
  status: "active",
  current_owner_id: USER_ID,
  license_id: ENTRY_ID,
  current_license_status: "active",
  license_end: "2999-12-31T23:59:59.000000Z",
  current_grace_expires_at: null,
  display_fanmark: "🌹",
  lottery_entry_count: 1,
  has_user_lottery_entry: 1,
  user_lottery_entry_id: ENTRY_ID,
  target_url: "https://private.example.test",
  text_content: "private message",
};

function setup(row: Record<string, unknown> | null = sourceRow) {
  let bindings: unknown[] = [];
  let sql = "";
  const database = {
    prepare(statement: string) {
      sql = statement;
      return {
        bind(...values: unknown[]) {
          bindings = values;
          return {
            async all() {
              return { success: true, results: row ? [row] : [] };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  const env: Env = {
    FANMARK_DB: database,
    D1_TOPOLOGY: "split",
    FANMARK_SEARCH_BACKEND: "d1",
    AUTH_BACKEND: "better-auth",
    CORS_ALLOWED_ORIGINS: APP_ORIGIN,
  };
  const request = new Request("https://api.example.test/api/fanmarks/search/details", {
    method: "POST",
    headers: { Origin: APP_ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ fanmarkId: FANMARK_ID }),
  });
  return { env, request, getBindings: () => bindings, getSql: () => sql };
}

const signedIn: StorageAuthResolver = async () => ({ available: true, userId: USER_ID });
const anonymous: StorageAuthResolver = async () => ({ available: true, userId: null });

describe("fanmark search details D1 API", () => {
  it("returns only the public search projection and binds identity from the auth resolver", async () => {
    const test = setup();
    const response = await handleFanmarkSearchDetailsRequest(test.request, test.env, signedIn,
      () => new Date("2026-09-25T00:00:00.000Z"));
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("access-control-allow-credentials")).toBe("true");
    const payload = await response?.json() as { schemaVersion: number; result: Record<string, unknown> };
    expect(payload.schemaVersion).toBe(1);
    expect(payload.result.current_owner_id).toBe(USER_ID);
    expect(payload.result.has_active_license).toBe(true);
    expect(payload.result.lottery_entry_count).toBe(1);
    expect(payload.result.has_user_lottery_entry).toBe(true);
    expect(payload.result.user_lottery_entry_id).toBe(ENTRY_ID);
    expect(payload.result).not.toHaveProperty("target_url");
    expect(payload.result).not.toHaveProperty("text_content");
    expect(test.getSql()).toContain("entry_status = 'pending'");
    expect(test.getBindings()).toEqual([FANMARK_ID, USER_ID, USER_ID, USER_ID, FANMARK_ID]);
  });

  it("serves anonymous search details without a user-specific lottery entry", async () => {
    const test = setup({ ...sourceRow, has_user_lottery_entry: 0, user_lottery_entry_id: null });
    const response = await handleFanmarkSearchDetailsRequest(test.request, test.env, anonymous,
      () => new Date("2026-09-25T00:00:00.000Z"));
    const payload = await response?.json() as { result: Record<string, unknown> };
    expect(response?.status).toBe(200);
    expect(payload.result.has_user_lottery_entry).toBe(false);
    expect(payload.result.user_lottery_entry_id).toBeNull();
    expect(test.getBindings()).toEqual([FANMARK_ID, null, null, null, FANMARK_ID]);
  });

  it("returns null for missing fanmarks and fails closed on unavailable auth/configuration", async () => {
    const missing = setup(null);
    const missingResponse = await handleFanmarkSearchDetailsRequest(missing.request, missing.env, anonymous);
    expect(await missingResponse?.json()).toEqual({ schemaVersion: 1, result: null });

    const unavailable = setup();
    const authUnavailable: StorageAuthResolver = async () => ({ available: false });
    expect((await handleFanmarkSearchDetailsRequest(unavailable.request, unavailable.env, authUnavailable))?.status).toBe(503);
    expect((await handleFanmarkSearchDetailsRequest(unavailable.request, { ...unavailable.env, FANMARK_SEARCH_BACKEND: "supabase" }, anonymous))?.status).toBe(503);
  });

  it("rejects malformed input, disallowed origins, and unsupported methods", async () => {
    const test = setup();
    const badBody = new Request(test.request.url, {
      method: "POST",
      headers: { Origin: APP_ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ fanmarkId: FANMARK_ID, target_url: "https://private.example.test" }),
    });
    expect((await handleFanmarkSearchDetailsRequest(badBody, test.env, anonymous))?.status).toBe(400);
    const badOrigin = new Request(test.request.url, {
      method: "POST",
      headers: { Origin: "https://attacker.example.test", "Content-Type": "application/json" },
      body: JSON.stringify({ fanmarkId: FANMARK_ID }),
    });
    expect((await handleFanmarkSearchDetailsRequest(badOrigin, test.env, anonymous))?.status).toBe(403);
    const unsupported = new Request(test.request.url, { method: "GET", headers: { Origin: APP_ORIGIN } });
    expect((await handleFanmarkSearchDetailsRequest(unsupported, test.env, anonymous))?.status).toBe(405);
  });
});
