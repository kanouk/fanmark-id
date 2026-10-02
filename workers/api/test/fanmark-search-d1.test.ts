import { env } from "cloudflare:workers";
import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import authSchema from "../migrations/0003_better_auth_core.sql?raw";
import { handleRequest } from "../src";
import type { Env } from "../src/repository";

declare module "vitest" {
  export interface ProvidedContext {
    businessSearchMigrations: Array<{ name: string; sql: string }>;
  }
}

const runtime = env as unknown as Env;
const business = runtime.FANMARK_DB!;
const auth = runtime.AUTH_DB!;
const origin = "https://app.example.test";
const now = new Date("2026-10-03T00:00:00.500Z");
const timestamp = "2026-10-03T00:00:00.500000Z";
const fanmarkId = "edc06d2b-00d6-49ab-ac40-1222f41c00d5";
const licenseId = "a4651127-8fc7-4bdc-8da9-913333b014e7";
const olderId = "a4651127-8fc7-4bdc-8da9-913333b014e8";
const ownerId = "0323d70f-094e-46e9-b509-5c5551b06f3b";
const otherId = "0323d70f-094e-46e9-b509-5c5551b06f3c";
const ownerEntry = "0323d70f-094e-46e9-b509-5c5551b06f3d";
const otherEntry = "0323d70f-094e-46e9-b509-5c5551b06f3e";
const password = "Synthetic-Search-Only!2026";
const hash = bcrypt.hashSync(password, 10);
const ids = '["5bb06a1c-a5d2-4e3f-a31d-58fce75887b3"]';

// Trusted checked-in migrations only. Quoted literals/comments do not contribute
// BEGIN/CASE/END tokens; trigger body semicolons stay in the same statement.
function statements(sql: string): string[] {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  let trigger = false;
  let words: string[] = [];
  for (const token of sql.matchAll(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|[A-Za-z_]\w*|;/gu)) {
    const value = token[0];
    if (/^(?:--|\/\*|'|")/u.test(value)) continue;
    const word = value.toUpperCase();
    if (word !== ";") {
      words.push(word);
      if (words[0] === "CREATE" && word === "TRIGGER") trigger = true;
      if (trigger && (word === "BEGIN" || word === "CASE")) depth += 1;
      if (trigger && word === "END") depth -= 1;
    } else if (depth === 0) {
      const statement = sql.slice(start, token.index).trim();
      if (statement.replace(/--[^\n]*/gu, "").trim()) result.push(statement);
      start = token.index! + 1;
      words = [];
      trigger = false;
    }
  }
  if (sql.slice(start).replace(/--[^\n]*/gu, "").trim()) throw new Error("Incomplete fixture SQL");
  return result;
}

async function request(body: unknown, cookie = "", route = "/api/fanmarks/search/details") {
  return handleRequest(new Request(`https://api.example.test${route}`, {
    method: "POST", headers: { Origin: origin, Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  }), runtime, fetch, () => now);
}

async function signin(userId: string) {
  const response = await request({ email: `${userId}@example.invalid`, password }, "", "/api/auth/sign-in/email");
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Synthetic session cookie missing");
  return cookie;
}

async function details(cookie = "") {
  const response = await request({ fanmarkId }, cookie);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return (await response.json() as { schemaVersion: number; result: Record<string, unknown> }).result;
}

beforeAll(async () => {
  if (!business || !auth) throw new Error("Split D1 bindings unavailable");
  await auth.batch(statements(authSchema).map(sql => auth.prepare(sql)));
  const migrations = inject("businessSearchMigrations");
  expect(migrations.length).toBeGreaterThanOrEqual(25);
  expect(migrations[0].name).toBe("0000_business_schema_v4_staging.sql");
  for (const migration of migrations) {
    const sql = statements(migration.sql);
    for (let offset = 0; offset < sql.length; offset += 50) {
      await business.batch(sql.slice(offset, offset + 50).map(statement => business.prepare(statement)));
    }
  }
});

beforeEach(async () => {
  await business.prepare("DELETE FROM fanmark_lottery_entries").run();
  await business.prepare("DELETE FROM fanmarks WHERE id = ?").bind(fanmarkId).run();
  await auth.prepare('DELETE FROM "user" WHERE id IN (?, ?)').bind(ownerId, otherId).run();
  for (const id of [ownerId, otherId]) {
    await auth.prepare('INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
      .bind(id, "Synthetic search owner", `${id}@example.invalid`, timestamp, timestamp).run();
    await auth.prepare('INSERT INTO account (id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, id, "credential", id, hash, timestamp, timestamp).run();
  }
  await business.prepare("INSERT INTO fanmarks (id,short_id,user_input_fanmark,normalized_emoji,emoji_ids,normalized_emoji_ids,status,tier_level,created_at,updated_at) VALUES (?, 'search-proof', '👋', '👋', ?, ?, 'active', 4, ?, ?)")
    .bind(fanmarkId, ids, ids, timestamp, timestamp).run();
  await business.prepare("INSERT INTO fanmark_licenses (id,fanmark_id,user_id,license_start,license_end,status,display_fanmark,created_at,updated_at) VALUES (?, ?, ?, ?, NULL, 'active', '👋', ?, ?)")
    .bind(licenseId, fanmarkId, ownerId, timestamp, timestamp, timestamp).run();
});

describe("full-schema native D1 search authorization and source lifecycle", () => {
  it("resolves only each real Better Auth session's pending lottery entry", async () => {
    await business.prepare("INSERT INTO fanmark_licenses (id,fanmark_id,user_id,license_start,license_end,status,created_at,updated_at) VALUES (?, ?, ?, ?, ?, 'expired', ?, ?)")
      .bind(olderId, fanmarkId, ownerId, "2025-01-01T00:00:00.000000Z", "2025-02-01T00:00:00.000000Z", timestamp, timestamp).run();
    for (const [id, userId, status, entryLicense] of [[ownerEntry, ownerId, "pending", licenseId], [otherEntry, otherId, "pending", licenseId], [olderId, ownerId, "cancelled", olderId]]) {
      await business.prepare("INSERT INTO fanmark_lottery_entries (id,fanmark_id,user_id,license_id,entry_status,applied_at,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, fanmarkId, userId, entryLicense, status, timestamp, timestamp, timestamp).run();
    }
    const before = await business.prepare("SELECT * FROM fanmark_lottery_entries ORDER BY id").all();
    for (const [userId, expected] of [[ownerId, ownerEntry], [otherId, otherEntry]]) {
      const cookie = await signin(userId);
      expect(await details(cookie)).toMatchObject({ lottery_entry_count: 2, has_user_lottery_entry: true, user_lottery_entry_id: expected });
      for (const field of ["user_id", "userId", "user_id_param"]) {
        expect((await request({ fanmarkId, [field]: ownerId }, cookie)).status).toBe(400);
      }
    }
    expect(await details()).toMatchObject({ lottery_entry_count: 2, has_user_lottery_entry: false, user_lottery_entry_id: null });
    expect((await business.prepare("SELECT * FROM fanmark_lottery_entries ORDER BY id").all()).results).toEqual(before.results);
  });

  it.each([
    ["active", null, null, true, true, null],
    ["active", "2026-10-03T00:00:00.500001Z", null, true, true, "2026-10-03T00:00:00.500001Z"],
    ["active", timestamp, null, false, false, null],
    ["active", "2026-10-03T00:00:00.499999Z", null, false, false, null],
    ["grace", "2026-10-03T00:00:00.499999Z", "2026-10-03T00:00:00.500001Z", false, true, "2026-10-03T00:00:00.500001Z"],
    ["grace", "2026-10-03T00:00:00.500001Z", null, false, true, "2026-10-03T00:00:00.500001Z"],
    ["grace", "2026-10-03T00:00:00.500001Z", timestamp, false, false, null],
    ["grace", timestamp, null, false, false, null],
    ["expired", null, null, false, false, null],
  ])("matches %s end %s / grace %s at the exact frozen microsecond", async (status, end, grace, active, blocked, next) => {
    await business.prepare("UPDATE fanmark_licenses SET status = ?, license_end = ?, grace_expires_at = ? WHERE id = ?")
      .bind(status, end, grace, licenseId).run();
    expect(await details()).toMatchObject({ has_active_license: active, is_blocked_for_registration: blocked, next_available_at: next });
  });

  it("preserves source NULL-first latest-license selection even over a newer finite row", async () => {
    await business.prepare("INSERT INTO fanmark_licenses (id,fanmark_id,user_id,license_start,license_end,status,created_at,updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)")
      .bind(olderId, fanmarkId, otherId, timestamp, "2999-12-31T00:00:00.000000Z", timestamp, timestamp).run();
    expect(await details()).toMatchObject({ license_id: licenseId, current_owner_id: ownerId, has_active_license: true, next_available_at: null });
  });

  it("never selects config content for public or signed-in search responses", async () => {
    await business.prepare("INSERT INTO fanmark_basic_configs (id,license_id,fanmark_name,access_type,created_at,updated_at) VALUES (?, ?, 'Synthetic protected name', 'redirect', ?, ?)")
      .bind(ownerId, licenseId, timestamp, timestamp).run();
    await business.prepare("INSERT INTO fanmark_redirect_configs (id,license_id,target_url,created_at,updated_at) VALUES (?, ?, 'https://example.invalid/protected', ?, ?)")
      .bind(ownerId, licenseId, timestamp, timestamp).run();
    await business.prepare("INSERT INTO fanmark_password_configs (id,license_id,access_password,is_enabled,created_at,updated_at) VALUES (?, ?, ?, 1, ?, ?)")
      .bind(ownerId, licenseId, hash, timestamp, timestamp).run();
    for (const cookie of ["", await signin(ownerId), await signin(otherId)]) {
      const result = await details(cookie);
      for (const field of ["fanmark_name", "target_url", "text_content", "access_password", "is_password_protected"]) expect(result).not.toHaveProperty(field);
      expect(JSON.stringify(result)).not.toContain("Synthetic protected name");
      expect(JSON.stringify(result)).not.toContain("https://example.invalid/protected");
    }
  });
});
