import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schema from "./fixtures/d1-fanmark-lottery.sql?raw";
import { handleFanmarkLotteryRequest } from "../src/fanmark-lottery-d1-api";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const business = runtimeEnv.FANMARK_DB;
const OWNER = "e62ce4d0-8055-4ecb-9e3a-759d70d659e0";
const OTHER = "2a1b9c5f-3c8a-4890-9e04-3768885b6dd8";
const FANMARK = "10000000-0000-4000-8000-000000000001";
const LICENSE = "20000000-0000-4000-8000-000000000001";
const ENTRY = "30000000-0000-4000-8000-000000000001";
const NOW = "2026-09-25T10:15:23.123000Z";
const CLOCK = () => new Date("2026-09-25T10:15:23.123Z");
const ORIGIN = "https://app.example.test";
const requestEnv: Env = {
  ...runtimeEnv,
  D1_TOPOLOGY: "split",
  AUTH_BACKEND: "better-auth",
  FANMARK_LOTTERY_BACKEND: "d1",
  CORS_ALLOWED_ORIGINS: ORIGIN,
};

function splitStatements(sql: string): string[] {
  return sql.split(/;\s*(?:\r?\n|$)/u).map((part) => part.trim()).filter(Boolean);
}

async function run(sql: string, ...values: unknown[]): Promise<void> {
  await business!.prepare(sql).bind(...values).run();
}

async function reset(): Promise<void> {
  if (!business) throw new Error("Lottery D1 binding unavailable");
  for (const table of ["notification_events", "audit_logs", "fanmark_lottery_entries", "fanmark_licenses", "fanmarks", "user_settings", "system_settings"]) {
    await business.prepare(`DELETE FROM ${table}`).run();
  }
  await run("INSERT INTO fanmarks (id, user_input_fanmark, short_id, status) VALUES (?, '🌹', 'rose0001', 'active')", FANMARK);
  await run(`INSERT INTO fanmark_licenses
    (id, fanmark_id, user_id, license_end, status, is_returned, grace_expires_at, display_fanmark, created_at, updated_at)
    VALUES (?, ?, ?, NULL, 'grace', 0, '2026-09-26T00:00:00.000000Z', '🌹', ?, ?)`, LICENSE, FANMARK, OTHER, NOW, NOW);
  await run("INSERT INTO user_settings (id, user_id, plan_type) VALUES (?, ?, 'free')", crypto.randomUUID(), OWNER);
}

async function post(
  action: "apply" | "cancel",
  body: unknown,
  userId: string | null = OWNER,
  origin = ORIGIN,
): Promise<Response> {
  const request = new Request(`https://api.example.test/api/fanmarks/lottery/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
  return handleFanmarkLotteryRequest(request, requestEnv, async () => ({ available: true, userId }), CLOCK);
}

async function count(table: string): Promise<number> {
  const row = await business!.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
  return row?.count ?? -1;
}

beforeAll(async () => {
  if (!business) throw new Error("Lottery D1 binding unavailable");
  for (const statement of splitStatements(schema)) await business.prepare(statement).run();
});

beforeEach(reset);

describe("D1 fanmark lottery entry actions", () => {
  it("applies atomically, returns the source contract, and enqueues the best-effort event", async () => {
    const response = await post("apply", { fanmark_id: FANMARK });
    expect(response.status).toBe(200);
    const payload = await response.json() as Record<string, unknown>;
    expect(payload).toMatchObject({ success: true, fanmark_id: FANMARK, lottery_probability: 1, total_entries_count: 1,
      grace_expires_at: "2026-09-26T00:00:00.000000Z", applied_at: NOW });
    expect(typeof payload.entry_id).toBe("string");
    expect(await count("fanmark_lottery_entries")).toBe(1);
    expect(await count("audit_logs")).toBe(1);
    expect(await count("notification_events")).toBe(1);
    const event = await business!.prepare("SELECT event_type, source, payload FROM notification_events").first<Record<string, unknown>>();
    expect(event?.event_type).toBe("lottery_application_submitted");
    expect(event?.source).toBe("edge_function");
    expect(JSON.parse(String(event?.payload))).toMatchObject({ user_id: OWNER, fanmark_id: FANMARK, fanmark_name: "🌹" });
    const audit = await business!.prepare("SELECT action, resource_type, resource_id, metadata FROM audit_logs").first<Record<string, unknown>>();
    expect(audit?.action).toBe("LOTTERY_ENTRY_CREATED");
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
    const response = await post("apply", { fanmark_id: FANMARK });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ entry_id: ENTRY });
    const row = await business!.prepare("SELECT entry_status, cancelled_at, cancellation_reason FROM fanmark_lottery_entries WHERE id = ?")
      .bind(ENTRY).first<Record<string, unknown>>();
    expect(row).toEqual({ entry_status: "pending", cancelled_at: NOW, cancellation_reason: "user_request" });
    const audit = await business!.prepare("SELECT action, metadata FROM audit_logs ORDER BY rowid DESC LIMIT 1")
      .first<{ action: string; metadata: string }>();
    expect(audit?.action).toBe("LOTTERY_ENTRY_STATUS_CHANGED");
    expect(JSON.parse(audit?.metadata ?? "{}")).toMatchObject({ old_status: "cancelled", new_status: "pending" });
  });

  it("enforces the plan limit and uses the source default of three when the setting is absent", async () => {
    await run("INSERT INTO system_settings (id, setting_key, setting_value) VALUES (?, 'free_fanmarks_limit', '2')", crypto.randomUUID());
    for (let index = 0; index < 2; index += 1) {
      await run(`INSERT INTO fanmark_licenses
        (id, fanmark_id, user_id, license_end, status, is_returned, created_at, updated_at)
        VALUES (?, ?, ?, '2026-10-01T00:00:00.000Z', 'active', 0, ?, ?)`, crypto.randomUUID(), FANMARK, OWNER, NOW, NOW);
    }
    const limited = await post("apply", { fanmark_id: FANMARK });
    expect(limited.status).toBe(400);
    expect(await limited.json()).toMatchObject({ error: "fanmark_limit_reached", current_count: 2, limit: 2 });
    await business!.prepare("DELETE FROM system_settings").run();
    await business!.prepare("DELETE FROM fanmark_licenses WHERE status = 'active'").run();
    for (let index = 0; index < 3; index += 1) {
      await run(`INSERT INTO fanmark_licenses
        (id, fanmark_id, user_id, license_end, status, is_returned, created_at, updated_at)
        VALUES (?, ?, ?, '2026-10-01T00:00:00.000Z', 'active', 0, ?, ?)`, crypto.randomUUID(), FANMARK, OWNER, NOW, NOW);
    }
    const defaultLimited = await post("apply", { fanmark_id: FANMARK });
    expect(defaultLimited.status).toBe(400);
    expect(await defaultLimited.json()).toMatchObject({ error: "fanmark_limit_reached", current_count: 3, limit: 3 });
  });

  it("does not count perpetual active licenses because the source uses a strict license_end filter", async () => {
    await run(`INSERT INTO fanmark_licenses
      (id, fanmark_id, user_id, license_end, status, is_returned, created_at, updated_at)
      VALUES (?, ?, ?, NULL, 'active', 0, ?, ?)`, crypto.randomUUID(), FANMARK, OWNER, NOW, NOW);
    expect((await post("apply", { fanmark_id: FANMARK })).status).toBe(200);
  });

  it("cancels only the authenticated owner's pending entry", async () => {
    const applied = await post("apply", { fanmark_id: FANMARK });
    const payload = await applied.json() as { entry_id: string };
    const forbidden = await post("cancel", { entry_id: payload.entry_id }, OTHER);
    expect(forbidden.status).toBe(403);
    const cancelled = await post("cancel", { entry_id: payload.entry_id });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({ success: true, entry_id: payload.entry_id, entry_status: "cancelled", cancelled_at: NOW });
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
