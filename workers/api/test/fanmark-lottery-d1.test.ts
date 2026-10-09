import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import bcrypt from "bcryptjs";
import { handleRequest } from "../src";
import { checkedInSqlStatements } from "./schema-statements";
import authSchema from "../migrations/0003_better_auth_core.sql?raw";
import signupSchema from "../migrations/0007_auth_signup_command.sql?raw";
import suspensionSchema from "../migrations/0008_auth_user_suspension.sql?raw";
import oauthSchema from "../migrations/0009_auth_oauth_signup.sql?raw";

declare module "vitest" {
  export interface ProvidedContext {
    businessLotteryMigrations: Array<{ name: string; sql: string }>;
  }
}
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const business = runtimeEnv.FANMARK_DB;
const authDb = runtimeEnv.AUTH_DB;
const PASSWORD = "Synthetic-Lottery-Only!2026";
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 10);
const cookies = new Map<string, Promise<string>>();
const OWNER = "e62ce4d0-8055-4ecb-9e3a-759d70d659e0";
const OTHER = "2a1b9c5f-3c8a-4890-9e04-3768885b6dd8";
const FANMARK = "10000000-0000-4000-8000-000000000001";
const LICENSE = "20000000-0000-4000-8000-000000000001";
const ENTRY = "30000000-0000-4000-8000-000000000001";
const NOW = "2026-09-25T10:15:23.123000Z";
const NEXT = "2026-09-25T10:16:23.123000Z";
let clockValue = new Date("2026-09-25T10:15:23.123Z");
const CLOCK = () => new Date(clockValue);
const ORIGIN = "https://app.example.test";
const requestEnv: Env = {
  ...runtimeEnv,
  D1_TOPOLOGY: "split",
  AUTH_BACKEND: "better-auth",
  FANMARK_LOTTERY_BACKEND: "d1",
  CORS_ALLOWED_ORIGINS: ORIGIN,
};

async function run(sql: string, ...values: unknown[]): Promise<void> {
  await business!.prepare(sql).bind(...values).run();
}

async function reset(): Promise<void> {
  if (!business) throw new Error("Lottery D1 binding unavailable");
  clockValue = new Date("2026-09-25T10:15:23.123Z");
  cookies.clear();
  await authDb!.prepare('DELETE FROM "user" WHERE id IN (?, ?)').bind(OWNER, OTHER).run();
  for (const id of [OWNER, OTHER]) {
    await authDb!.prepare('INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
      .bind(id, "Synthetic lottery owner", `${id}@example.invalid`, NOW, NOW).run();
    await authDb!.prepare('INSERT INTO account (id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, id, "credential", id, PASSWORD_HASH, NOW, NOW).run();
  }
  for (const table of ["notification_events", "audit_logs", "fanmark_lottery_entries", "fanmark_licenses", "fanmarks", "user_settings", "system_settings"]) {
    await business.prepare(`DELETE FROM ${table}`).run();
  }
  const ids = '["5bb06a1c-a5d2-4e3f-a31d-58fce75887b3"]';
  await run(`INSERT INTO fanmarks (id, user_input_fanmark, normalized_emoji, emoji_ids, normalized_emoji_ids,
    short_id, status, tier_level, created_at, updated_at) VALUES (?, '🌹', '🌹', ?, ?, 'rose0001', 'active', 4, ?, ?)`,
    FANMARK, ids, ids, NOW, NOW);
  await run(`INSERT INTO fanmark_licenses
    (id, fanmark_id, user_id, license_start, license_end, status, is_returned, grace_expires_at, display_fanmark, created_at, updated_at)
    VALUES (?, ?, ?, '2026-09-01T00:00:00.000000Z', NULL, 'grace', 0, '2026-09-26T00:00:00.000000Z', '🌹', ?, ?)`, LICENSE, FANMARK, OTHER, NOW, NOW);
  await run("INSERT INTO user_settings (id, user_id, username, display_name, plan_type, created_at, updated_at) VALUES (?, ?, 'lottery_owner', 'Synthetic owner', 'free', ?, ?)", crypto.randomUUID(), OWNER, NOW, NOW);
}

async function post(
  action: "apply" | "cancel",
  body: unknown,
  userId: string | null = OWNER,
  origin = ORIGIN,
): Promise<Response> {
  let cookie = "";
  if (userId) {
    if (!cookies.has(userId)) cookies.set(userId, (async () => {
      const response = await handleRequest(new Request("https://api.example.test/api/auth/sign-in/email", {
        method: "POST", headers: { Origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ email: `${userId}@example.invalid`, password: PASSWORD }),
      }), requestEnv);
      expect(response.status).toBe(200);
      const value = response.headers.get("set-cookie")?.split(";")[0];
      if (!value) throw new Error("Synthetic lottery session cookie missing");
      return value;
    })());
    cookie = await cookies.get(userId)!;
  }
  const request = new Request(`https://api.example.test/api/fanmarks/lottery/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: origin, Cookie: cookie },
    body: JSON.stringify(body),
  });
  return handleRequest(request, requestEnv, fetch, CLOCK, CLOCK);
}

async function count(table: string): Promise<number> {
  const row = await business!.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
  return row?.count ?? -1;
}

beforeAll(async () => {
  if (!business || !authDb) throw new Error("Lottery split D1 bindings unavailable");
  for (const schema of [authSchema, signupSchema, suspensionSchema, oauthSchema]) {
    await authDb.batch(checkedInSqlStatements(schema).map(sql => authDb.prepare(sql)));
  }
  const migrations = inject("businessLotteryMigrations");
  expect(migrations.length).toBeGreaterThanOrEqual(25);
  for (const migration of migrations) {
    const sql = checkedInSqlStatements(migration.sql);
    for (let offset = 0; offset < sql.length; offset += 50) {
      await business.batch(sql.slice(offset, offset + 50).map(statement => business.prepare(statement)));
    }
  }
});

beforeEach(reset);
afterEach(async () => {
  expect((await business!.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  expect((await authDb!.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});

describe("D1 fanmark lottery entry actions", () => {
  it("applies atomically, returns the source contract, and enqueues the best-effort event", async () => {
    const response = await post("apply", { fanmark_id: FANMARK });
    expect(response.status).toBe(200);
    const payload = await response.json() as Record<string, unknown>;
    expect(payload).toMatchObject({ success: true, fanmark_id: FANMARK, lottery_probability: 1, total_entries_count: 1,
      grace_expires_at: "2026-09-26T00:00:00.000000Z", applied_at: NOW });
    expect(typeof payload.entry_id).toBe("string");
    expect(await count("fanmark_lottery_entries")).toBe(1);
    expect(await business!.prepare("SELECT applied_at, created_at, updated_at FROM fanmark_lottery_entries WHERE id = ?")
      .bind(payload.entry_id).first<Record<string, unknown>>()).toEqual({
      applied_at: NOW, created_at: NOW, updated_at: NOW,
    });
    expect(await count("audit_logs")).toBe(1);
    expect(await count("notification_events")).toBe(1);
    const event = await business!.prepare(`SELECT event_type, source, payload, trigger_at, created_at, updated_at
      FROM notification_events`).first<Record<string, unknown>>();
    expect(event?.event_type).toBe("lottery_application_submitted");
    expect(event?.source).toBe("edge_function");
    expect(event).toMatchObject({ trigger_at: NOW, created_at: NOW, updated_at: NOW });
    expect(JSON.parse(String(event?.payload))).toMatchObject({ user_id: OWNER, fanmark_id: FANMARK, fanmark_name: "🌹" });
    const audit = await business!.prepare("SELECT action, resource_type, resource_id, metadata, created_at FROM audit_logs").first<Record<string, unknown>>();
    expect(audit?.action).toBe("LOTTERY_ENTRY_CREATED");
    expect(audit?.created_at).toBe(NOW);
    expect(audit?.resource_type).toBe("fanmark_lottery_entry");
    expect(JSON.parse(String(audit?.metadata))).toMatchObject({ fanmark_id: FANMARK, license_id: LICENSE, lottery_probability: 1 });
  });

  it("rejects duplicate pending applications without creating a second entry", async () => {
    await post("apply", { fanmark_id: FANMARK });
    const response = await post("apply", { fanmark_id: FANMARK });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "You have already applied for this fanmark" });
    expect(await count("fanmark_lottery_entries")).toBe(1);
  });

  it("serializes competing requests for the same user and fanmark", async () => {
    const [first, second] = await Promise.all([
      post("apply", { fanmark_id: FANMARK }),
      post("apply", { fanmark_id: FANMARK }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 400]);
    expect(await count("fanmark_lottery_entries")).toBe(1);
    expect(await count("audit_logs")).toBe(1);
  });

  it("reuses a cancelled entry and preserves its cancellation history fields as the source does", async () => {
    await run(`INSERT INTO fanmark_lottery_entries
      (id, fanmark_id, user_id, license_id, entry_status, applied_at, cancelled_at, cancellation_reason, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'cancelled', ?, ?, 'user_request', ?, ?)`, ENTRY, FANMARK, OWNER, LICENSE, NOW, NOW, NOW, NOW);
    clockValue = new Date("2026-09-25T10:16:23.123Z");
    const response = await post("apply", { fanmark_id: FANMARK });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ entry_id: ENTRY });
    const row = await business!.prepare("SELECT entry_status, applied_at, cancelled_at, cancellation_reason, created_at, updated_at FROM fanmark_lottery_entries WHERE id = ?")
      .bind(ENTRY).first<Record<string, unknown>>();
    expect(row).toEqual({
      entry_status: "pending", applied_at: NEXT, cancelled_at: NOW, cancellation_reason: "user_request",
      created_at: NOW, updated_at: NEXT,
    });
    const audit = await business!.prepare("SELECT action, metadata, created_at FROM audit_logs ORDER BY rowid DESC LIMIT 1")
      .first<{ action: string; metadata: string; created_at: string }>();
    expect(audit?.action).toBe("LOTTERY_ENTRY_STATUS_CHANGED");
    expect(audit?.created_at).toBe(NEXT);
    expect(JSON.parse(audit?.metadata ?? "{}")).toMatchObject({ old_status: "cancelled", new_status: "pending" });
  });

  it("enforces the plan limit and uses the source default of three when the setting is absent", async () => {
    await run("INSERT INTO system_settings (id, setting_key, setting_value, created_at, updated_at) VALUES (?, 'free_fanmarks_limit', '2', ?, ?)", crypto.randomUUID(), NOW, NOW);
    for (let index = 0; index < 2; index += 1) {
      await run(`INSERT INTO fanmark_licenses
        (id, fanmark_id, user_id, license_start, license_end, status, is_returned, created_at, updated_at)
        VALUES (?, ?, ?, '2026-09-01T00:00:00.000000Z', '2026-10-01T00:00:00.000000Z', 'active', 0, ?, ?)`, crypto.randomUUID(), FANMARK, OWNER, NOW, NOW);
    }
    const limited = await post("apply", { fanmark_id: FANMARK });
    expect(limited.status).toBe(400);
    expect(await limited.json()).toMatchObject({ error: "fanmark_limit_reached", current_count: 2, limit: 2 });
    await business!.prepare("DELETE FROM system_settings").run();
    await business!.prepare("DELETE FROM fanmark_licenses WHERE status = 'active'").run();
    for (let index = 0; index < 3; index += 1) {
      await run(`INSERT INTO fanmark_licenses
        (id, fanmark_id, user_id, license_start, license_end, status, is_returned, created_at, updated_at)
        VALUES (?, ?, ?, '2026-09-01T00:00:00.000000Z', '2026-10-01T00:00:00.000000Z', 'active', 0, ?, ?)`, crypto.randomUUID(), FANMARK, OWNER, NOW, NOW);
    }
    const defaultLimited = await post("apply", { fanmark_id: FANMARK });
    expect(defaultLimited.status).toBe(400);
    expect(await defaultLimited.json()).toMatchObject({ error: "fanmark_limit_reached", current_count: 3, limit: 3 });
  });

  it("counts a perpetual active license against the plan limit", async () => {
    await run("INSERT INTO system_settings (id, setting_key, setting_value, created_at, updated_at) VALUES (?, 'free_fanmarks_limit', '1', ?, ?)", crypto.randomUUID(), NOW, NOW);
    await run(`INSERT INTO fanmark_licenses
      (id, fanmark_id, user_id, license_start, license_end, status, is_returned, created_at, updated_at)
      VALUES (?, ?, ?, '2026-09-01T00:00:00.000000Z', NULL, 'active', 0, ?, ?)`, crypto.randomUUID(), FANMARK, OWNER, NOW, NOW);
    const response = await post("apply", { fanmark_id: FANMARK });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "fanmark_limit_reached", current_count: 1, limit: 1 });
    expect(await count("fanmark_lottery_entries")).toBe(0);
  });

  it("cancels only the authenticated owner's pending entry", async () => {
    const applied = await post("apply", { fanmark_id: FANMARK });
    const payload = await applied.json() as { entry_id: string };
    const forbidden = await post("cancel", { entry_id: payload.entry_id }, OTHER);
    expect(forbidden.status).toBe(403);
    clockValue = new Date("2026-09-25T10:16:23.123Z");
    const cancelled = await post("cancel", { entry_id: payload.entry_id });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({ success: true, entry_id: payload.entry_id, entry_status: "cancelled", cancelled_at: NEXT });
    expect(await business!.prepare("SELECT applied_at, cancelled_at, created_at, updated_at FROM fanmark_lottery_entries WHERE id = ?")
      .bind(payload.entry_id).first<Record<string, unknown>>()).toEqual({
      applied_at: NOW, cancelled_at: NEXT, created_at: NOW, updated_at: NEXT,
    });
    expect(await count("audit_logs")).toBe(2);
    expect((await post("cancel", { entry_id: payload.entry_id })).status).toBe(400);
  });

  it("keeps apply and cancel from changing entries while an expiry operation holds the license claim", async () => {
    const applied = await post("apply", { fanmark_id: FANMARK });
    const payload = await applied.json() as { entry_id: string };
    await business!.prepare("UPDATE fanmark_licenses SET lifecycle_claim_id = ? WHERE id = ?")
      .bind("expiry-operation-claim", LICENSE).run();

    expect((await post("apply", { fanmark_id: FANMARK })).status).toBe(400);
    expect((await post("cancel", { entry_id: payload.entry_id })).status).toBe(400);
    const entry = await business!.prepare("SELECT entry_status FROM fanmark_lottery_entries WHERE id = ?")
      .bind(payload.entry_id).first<{ entry_status: string }>();
    expect(entry?.entry_status).toBe("pending");
    expect(await count("audit_logs")).toBe(1);
  });

  it("keeps stale grace licenses unavailable and rejects missing user settings", async () => {
    await run("UPDATE fanmark_licenses SET grace_expires_at = '2026-09-25T10:15:23.122000Z' WHERE id = ?", LICENSE);
    expect((await post("apply", { fanmark_id: FANMARK })).status).toBe(400);
    await business!.prepare("UPDATE fanmark_licenses SET grace_expires_at = '2026-09-26T00:00:00.000000Z' WHERE id = ?").bind(LICENSE).run();
    await business!.prepare("DELETE FROM user_settings WHERE user_id = ?").bind(OWNER).run();
    expect((await post("apply", { fanmark_id: FANMARK })).status).toBe(500);
  });

  it("requires a valid session and permitted origin", async () => {
    expect((await post("apply", { fanmark_id: FANMARK }, null)).status).toBe(401);
    expect((await post("apply", { fanmark_id: FANMARK }, OWNER, "https://bad.example.test")).status).toBe(403);
  });

  it("rolls back entry state if the required audit effect fails", async () => {
    await business!.prepare(`CREATE TRIGGER reject_lottery_audit BEFORE INSERT ON audit_logs
      BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END`).run();
    try {
      expect((await post("apply", { fanmark_id: FANMARK })).status).toBe(500);
      expect(await count("fanmark_lottery_entries")).toBe(0);
      expect(await count("notification_events")).toBe(0);
    } finally {
      await business!.prepare("DROP TRIGGER IF EXISTS reject_lottery_audit").run();
    }
  });

  it("keeps the saved application when best-effort notification enqueue fails", async () => {
    await business!.prepare(`CREATE TRIGGER reject_lottery_notification BEFORE INSERT ON notification_events
      BEGIN SELECT RAISE(ABORT, 'synthetic notification failure'); END`).run();
    try {
      expect((await post("apply", { fanmark_id: FANMARK })).status).toBe(200);
      expect(await count("fanmark_lottery_entries")).toBe(1);
      expect(await count("audit_logs")).toBe(1);
      expect(await count("notification_events")).toBe(0);
    } finally {
      await business!.prepare("DROP TRIGGER IF EXISTS reject_lottery_notification").run();
    }
  });
});

const auditFaults = [
  ["ignored", "BEFORE INSERT", "SELECT RAISE(IGNORE)"],
  ["metadata changed", "AFTER INSERT", "UPDATE audit_logs SET metadata = '{}' WHERE id = NEW.id"],
  ["deleted", "AFTER INSERT", "DELETE FROM audit_logs WHERE id = NEW.id"],
  ["ID changed", "AFTER INSERT", "UPDATE audit_logs SET id = '10000000-0000-4000-8000-000000000099' WHERE id = NEW.id"],
  ["actor changed", "AFTER INSERT", "UPDATE audit_logs SET user_id = '10000000-0000-4000-8000-000000000099' WHERE id = NEW.id"],
  ["action changed", "AFTER INSERT", "UPDATE audit_logs SET action = 'LOTTERY_ENTRY_CHANGED' WHERE id = NEW.id"],
  ["resource changed", "AFTER INSERT", "UPDATE audit_logs SET resource_id = '10000000-0000-4000-8000-000000000099' WHERE id = NEW.id"],
  ["time changed", "AFTER INSERT", "UPDATE audit_logs SET created_at = '2026-09-25T10:15:23.123000Z' WHERE id = NEW.id"],
  ["request changed", "AFTER INSERT", "UPDATE audit_logs SET request_id = 'unrelated-command' WHERE id = NEW.id"],
] as const;

for (const action of ["new application", "reapplication", "cancellation"] as const) {
  for (const [fault, timing, sql] of auditFaults) {
    it(`rolls back ${action} when its required audit is ${fault}, then retries safely`, async () => {
      let id = ENTRY;
      if (action === "reapplication") {
        await run(`INSERT INTO fanmark_lottery_entries
          (id, fanmark_id, user_id, license_id, entry_status, applied_at, cancelled_at, cancellation_reason, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'cancelled', ?, ?, 'user_request', ?, ?)`, ENTRY, FANMARK, OWNER, LICENSE, NOW, NOW, NOW, NOW);
      } else if (action === "cancellation") {
        const response = await post("apply", { fanmark_id: FANMARK });
        expect(response.status).toBe(200);
        id = (await response.json() as { entry_id: string }).entry_id;
      }
      const before = {
        entries: (await business!.prepare("SELECT * FROM fanmark_lottery_entries ORDER BY id").all()).results,
        audits: (await business!.prepare("SELECT * FROM audit_logs ORDER BY id").all()).results,
        events: (await business!.prepare("SELECT * FROM notification_events ORDER BY id").all()).results,
      };
      clockValue = new Date("2026-09-25T10:16:23.123Z");
      await business!.prepare(`CREATE TRIGGER fault_lottery_audit ${timing} ON audit_logs
        WHEN NEW.action IN ('LOTTERY_ENTRY_CREATED', 'LOTTERY_ENTRY_STATUS_CHANGED')
        BEGIN ${sql}; END`).run();
      try {
        const response = await post(action === "cancellation" ? "cancel" : "apply",
          action === "cancellation" ? { entry_id: id } : { fanmark_id: FANMARK });
        expect(response.status).toBe(500);
        expect((await business!.prepare("SELECT * FROM fanmark_lottery_entries ORDER BY id").all()).results).toEqual(before.entries);
        expect((await business!.prepare("SELECT * FROM audit_logs ORDER BY id").all()).results).toEqual(before.audits);
        expect((await business!.prepare("SELECT * FROM notification_events ORDER BY id").all()).results).toEqual(before.events);
      } finally {
        await business!.prepare("DROP TRIGGER fault_lottery_audit").run();
      }
      const response = await post(action === "cancellation" ? "cancel" : "apply",
        action === "cancellation" ? { entry_id: id } : { fanmark_id: FANMARK });
      expect(response.status).toBe(200);
      expect(await count("audit_logs")).toBe(before.audits!.length + 1);
      expect(await count("fanmark_lottery_entries")).toBe(1);
    });
  }
}

it("serializes cancellation races and records one exact status audit", async () => {
  const applied = await post("apply", { fanmark_id: FANMARK });
  expect(applied.status).toBe(200);
  const id = (await applied.json() as { entry_id: string }).entry_id;
  clockValue = new Date("2026-09-25T10:16:23.123Z");
  const responses = await Promise.all([post("cancel", { entry_id: id }), post("cancel", { entry_id: id })]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 400]);
  const audits = (await business!.prepare("SELECT user_id, resource_type, resource_id, metadata, created_at FROM audit_logs WHERE action = 'LOTTERY_ENTRY_STATUS_CHANGED'").all()).results;
  expect(audits).toEqual([{ user_id: OWNER, resource_type: "fanmark_lottery_entry", resource_id: id,
    metadata: JSON.stringify({ old_status: "pending", new_status: "cancelled", cancellation_reason: "user_request" }), created_at: NEXT }]);
});

it("rejects caller-selected owner IDs without mutating either user's data", async () => {
  const response = await post("apply", { fanmark_id: FANMARK, user_id: OTHER });
  expect(response.status).toBe(400);
  expect(await count("fanmark_lottery_entries")).toBe(0);
  expect(await count("audit_logs")).toBe(0);
  expect(await count("notification_events")).toBe(0);
});

it("refuses a warmed, revoked session for apply and cancel and preserves the entry", async () => {
  const applied = await post("apply", { fanmark_id: FANMARK });
  expect(applied.status).toBe(200);
  const id = (await applied.json() as { entry_id: string }).entry_id;
  const before = (await business!.prepare("SELECT * FROM fanmark_lottery_entries").all()).results;
  await authDb!.batch([
    authDb!.prepare('UPDATE "user" SET banned = 1, banExpires = NULL WHERE id = ?').bind(OWNER),
    authDb!.prepare('DELETE FROM session WHERE userId = ?').bind(OWNER),
  ]);
  expect((await post("apply", { fanmark_id: FANMARK })).status).toBe(401);
  expect((await post("cancel", { entry_id: id })).status).toBe(401);
  expect((await business!.prepare("SELECT * FROM fanmark_lottery_entries").all()).results).toEqual(before);
  expect(await count("audit_logs")).toBe(1);
});
