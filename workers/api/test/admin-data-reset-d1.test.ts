import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleAdminDataResetRequest, recordUnauthorizedDataResetAttempt, RESET_TABLES } from "../src/admin-data-reset-d1-api";
import type { Env } from "../src/repository";
import { buildResetCanaryDeleteGuards } from "../../../scripts/migration/admin-data-reset-canary-guards.mjs";

const runtime = env as unknown as Env;
const db = runtime.FANMARK_DB!;
const ORIGIN = "https://app.example.test";
const OWNER = "e62ce4d0-8055-4ecb-9e3a-759d70d659e0";
const FANMARK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LICENSE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DISCOVERY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
let initialIncarnation = 0;
const NOW = "2026-10-03T00:00:00.123000Z";
const migrations = import.meta.glob<string>("../migrations-business/*.sql", { query: "?raw", import: "default", eager: true });

function splitSql(sql: string): string[] {
  const source = sql.replace(/^--.*(?:\r?\n|$)/gmu, "");
  const statements: string[] = [];
  let start = 0;
  let single = false;
  let double = false;
  for (let i = 0; i < source.length; i++) {
    const character = source[i];
    if (character === "'" && !double) {
      if (single && source[i + 1] === "'") i++; else single = !single;
      continue;
    }
    if (character === '"' && !single) {
      if (double && source[i + 1] === '"') i++; else double = !double;
      continue;
    }
    if (character !== ";" || single || double) continue;
    const candidate = source.slice(start, i).trim();
    if (/^create\s+trigger\b/iu.test(candidate)) {
      const cases = candidate.match(/\bCASE\b/giu)?.length ?? 0;
      const ends = candidate.match(/\bEND\b/giu)?.length ?? 0;
      if (ends < cases + 1) continue;
    }
    if (candidate) statements.push(candidate);
    start = i + 1;
  }
  if (source.slice(start).trim()) statements.push(source.slice(start).trim());
  return statements;
}

async function run(sql: string, ...values: unknown[]): Promise<void> {
  await db.prepare(sql).bind(...values).run();
}

async function request(body: unknown = { requestId: crypto.randomUUID(), confirmation: "DELETE" },
  options: { overrides?: Partial<Env>; denied?: boolean; owner?: string; method?: string; origin?: string | null } = {}): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.origin !== null) headers.set("origin", options.origin ?? ORIGIN);
  const method = options.method ?? "POST";
  return (await handleAdminDataResetRequest(new Request(`${ORIGIN}/api/admin/data-reset`, {
    method, headers, ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  }), { ...runtime, ...options.overrides }, async (_request, responseHeaders) => options.denied
    ? new Response(JSON.stringify({ error: "mfa_required" }), { status: 403, headers: responseHeaders })
    : { userId: options.owner ?? OWNER, sessionId: "synthetic-current-session" }, () => new Date(NOW)))!;
}

async function seed(): Promise<void> {
  await run(`INSERT INTO fanmarks (id, user_input_fanmark, normalized_emoji, short_id, tier_level, created_at, updated_at)
    VALUES (?, '🌹', '🌹', 'reset-test', 1, ?, ?)`, FANMARK, NOW, NOW);
  await run(`INSERT INTO fanmark_licenses (id, fanmark_id, user_id, license_start, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`, LICENSE, FANMARK, OWNER, NOW, NOW, NOW);
  for (const table of RESET_TABLES.slice(0, 5)) {
    const extra = table === "fanmark_redirect_configs" ? ", target_url" : table === "fanmark_password_configs" ? ", access_password" : "";
    const placeholder = extra ? ", ?" : "";
    await run(`INSERT INTO ${table} (license_id, created_at, updated_at${extra}) VALUES (?, ?, ?${placeholder})`,
      LICENSE, NOW, NOW, ...(extra ? [table === "fanmark_redirect_configs" ? "https://example.test" : "synthetic-local-password"] : []));
  }
  await run(`INSERT INTO fanmark_discoveries (id, emoji_ids, normalized_emoji_ids, fanmark_id, availability_status, first_seen_at, last_seen_at)
    VALUES (?, '[]', '[]', ?, 'owned_by_user', ?, ?)`, DISCOVERY, FANMARK, NOW, NOW);
  await run(`INSERT INTO fanmark_favorites (user_id, discovery_id, fanmark_id, normalized_emoji_ids, created_at)
    VALUES (?, ?, ?, '[]', ?)`, OWNER, DISCOVERY, FANMARK, NOW);
  await run(`INSERT INTO user_settings (user_id, username, created_at, updated_at) VALUES (?, 'reset-owner', ?, ?)`, OWNER, NOW, NOW);
  await run(`INSERT INTO system_settings (setting_key, setting_value, created_at, updated_at)
    VALUES ('reset-preserve', 'true', ?, ?)`, NOW, NOW);
}

async function counts(): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of RESET_TABLES) result[table] = (await db.prepare(`SELECT count(*) AS count FROM ${table}`).first<{ count: number }>())!.count;
  return result;
}

beforeAll(async () => {
  expect(Object.keys(migrations)).toContain("../migrations-business/0023_admin_data_reset.sql");
  for (const [name, sql] of Object.entries(migrations).sort(([a], [b]) => a.localeCompare(b))) {
    for (const statement of splitSql(sql)) {
      try { await run(statement); } catch (error) { throw new Error(`${name}: ${statement.slice(0, 80)}`, { cause: error }); }
    }
  }
});
beforeEach(async () => {
  await run("DELETE FROM license_expiry_run_items");
  await run("DELETE FROM license_expiry_runs");
  await run("DELETE FROM extension_coupon_usages");
  for (const table of RESET_TABLES) await run(`DELETE FROM ${table}`);
  for (const table of ["admin_data_reset_commands", "audit_logs", "fanmark_discoveries", "user_settings", "system_settings", "extension_coupons"]) await run(`DELETE FROM ${table}`);
  await seed();
  initialIncarnation = (await db.prepare("SELECT incarnation FROM fanmark_license_incarnations WHERE license_id = ?").bind(LICENSE).first<{ incarnation: number }>())!.incarnation;
});

describe("atomic D1 administrator data reset with the complete Business schema", () => {
  it("deletes eight source tables with exact audited counts and preserves accounts/settings/discoveries and incarnation tombstones", async () => {
    const before = await counts();
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ success: true, deletedCounts: before, totalDeleted: 8 });
    expect(Object.values(await counts())).toEqual(Array(8).fill(0));
    expect(await db.prepare("SELECT fanmark_id FROM fanmark_discoveries WHERE id = ?").bind(DISCOVERY).first()).toEqual({ fanmark_id: null });
    expect(await db.prepare("SELECT count(*) AS count FROM user_settings").first()).toEqual({ count: 1 });
    expect(await db.prepare("SELECT count(*) AS count FROM system_settings").first()).toEqual({ count: 1 });
    expect(await db.prepare("SELECT incarnation FROM fanmark_license_incarnations WHERE license_id = ?").bind(LICENSE).first()).toEqual({ incarnation: initialIncarnation + 1 });
    const audit = await db.prepare("SELECT user_id, created_at, metadata FROM audit_logs WHERE action = 'ADMIN_DATA_RESET'").first<{ user_id: string; created_at: string; metadata: string }>();
    expect(audit).toMatchObject({ user_id: OWNER, created_at: NOW });
    expect(JSON.parse(audit!.metadata)).toEqual({ timestamp: NOW, deletedCounts: before, totalDeleted: 8, security_level: "ADMIN_VERIFIED" });
    expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });

  it("replays a response lost after commit without deleting rows subsequently created, including concurrent duplicate requests", async () => {
    const body = { requestId: crypto.randomUUID(), confirmation: "DELETE" };
    const responses = await Promise.all([request(body), request(body)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const first = await responses[0].json();
    expect(await responses[1].json()).toEqual(first);
    await run(`INSERT INTO fanmarks (id, user_input_fanmark, normalized_emoji, short_id, tier_level, created_at, updated_at)
      VALUES (?, '🌹', '🌹', 'new-after-reset', 1, ?, ?)`, FANMARK, NOW, NOW);
    const retry = await request(body);
    expect(retry.status).toBe(200); expect(await retry.json()).toEqual(first);
    expect((await counts()).fanmarks).toBe(1);
    expect((await request(body, { owner: "other-admin" })).status).toBe(409);
    expect((await counts()).fanmarks).toBe(1);
    expect(await db.prepare("SELECT count(*) AS count FROM audit_logs WHERE action = 'ADMIN_DATA_RESET'").first()).toEqual({ count: 1 });
  });

  it("audits a confirmed empty reset and protects completed retry receipts from alteration", async () => {
    expect((await request()).status).toBe(200);
    const body = { requestId: crypto.randomUUID(), confirmation: "DELETE" };
    const response = await request(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, deletedCounts: Object.fromEntries(RESET_TABLES.map((table) => [table, 0])), totalDeleted: 0 });
    await expect(run("UPDATE admin_data_reset_commands SET result_json = '{}' WHERE request_id = ?", body.requestId))
      .rejects.toThrow("admin_data_reset_receipt_immutable");
    expect(await db.prepare("SELECT count(*) AS count FROM audit_logs WHERE action = 'ADMIN_DATA_RESET'").first()).toEqual({ count: 2 });
  });

  it.each(["ABORT", "IGNORE"])("rolls back every table and the command when a delete trigger uses RAISE(%s), and permits retry", async (mode) => {
    const before = await counts();
    const body = { requestId: crypto.randomUUID(), confirmation: "DELETE" };
    await run(`CREATE TRIGGER reset_fault BEFORE DELETE ON fanmark_favorites BEGIN SELECT RAISE(${mode}${mode === "IGNORE" ? "" : ", 'synthetic delete failure'"}); END`);
    try {
      expect((await request(body)).status).toBe(503);
      expect(await counts()).toEqual(before);
      expect(await db.prepare("SELECT count(*) AS count FROM admin_data_reset_commands").first()).toEqual({ count: 0 });
      expect(await db.prepare("SELECT count(*) AS count FROM audit_logs").first()).toEqual({ count: 0 });
    } finally { await run("DROP TRIGGER reset_fault"); }
    expect((await request(body)).status).toBe(200);
  });

  it.each(["ABORT", "IGNORE", "CORRUPT"])("rolls back deletes and lifecycle generation when the audit is %s", async (mode) => {
    const before = await counts();
    await run(mode === "CORRUPT"
      ? `CREATE TRIGGER reset_audit_fault AFTER INSERT ON audit_logs WHEN NEW.action = 'ADMIN_DATA_RESET'
          BEGIN UPDATE audit_logs SET metadata = '{}' WHERE id = NEW.id; END`
      : `CREATE TRIGGER reset_audit_fault BEFORE INSERT ON audit_logs WHEN NEW.action = 'ADMIN_DATA_RESET'
          BEGIN SELECT RAISE(${mode}${mode === "IGNORE" ? "" : ", 'synthetic audit failure'"}); END`);
    try {
      expect((await request()).status).toBe(503);
      expect(await counts()).toEqual(before);
      expect(await db.prepare("SELECT incarnation FROM fanmark_license_incarnations WHERE license_id = ?").bind(LICENSE).first()).toEqual({ incarnation: initialIncarnation });
      expect(await db.prepare("SELECT count(*) AS count FROM admin_data_reset_commands").first()).toEqual({ count: 0 });
    } finally { await run("DROP TRIGGER reset_audit_fault"); }
  });

  it("refuses restrictive history references without partially deleting settings or erasing coupon history", async () => {
    const before = await counts();
    await run(`INSERT INTO extension_coupons (id, code, months, created_at, updated_at) VALUES ('coupon', 'RESET-TEST', 1, ?, ?)`, NOW, NOW);
    await run(`INSERT INTO extension_coupon_usages (coupon_id, user_id, fanmark_id, license_id, used_at) VALUES ('coupon', ?, ?, ?, ?)`, OWNER, FANMARK, LICENSE, NOW);
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "data_reset_blocked_by_history" });
    expect(await counts()).toEqual(before);
    expect(await db.prepare("SELECT count(*) AS count FROM extension_coupon_usages").first()).toEqual({ count: 1 });
  });

  it("also preserves target lifecycle journals and their fences when they prevent a reset", async () => {
    const before = await counts();
    await run(`INSERT INTO license_expiry_runs (run_id, target_incarnation, schema_extension_digest, captured_now, grace_period_days, status)
      VALUES ('protected-run', 'synthetic-target', 'synthetic-digest', ?, 1, 'completed')`, NOW);
    await run(`INSERT INTO license_expiry_run_items
      (run_id, license_id, fanmark_id, fanmark_short_id, fanmark_name, user_id, license_end,
       license_incarnation, license_lifecycle_generation, access_generation, operation_id, audit_id, notification_event_id, grace_expires_at)
      SELECT 'protected-run', l.id, l.fanmark_id, f.short_id, f.normalized_emoji, l.user_id, ?,
       av.license_incarnation, l.lifecycle_generation, av.access_generation, 'operation', 'audit', 'event', ?
      FROM fanmark_licenses l JOIN fanmarks f ON f.id = l.fanmark_id JOIN fanmark_access_versions av ON av.license_id = l.id
      WHERE l.id = ?`, NOW, NOW, LICENSE);
    expect((await request()).status).toBe(409);
    expect(await counts()).toEqual(before);
    expect(await db.prepare("SELECT count(*) AS count FROM license_expiry_run_items").first()).toEqual({ count: 1 });
  });

  it("preserves source nil-UUID exclusions for all eight tables", async () => {
    const nil = "00000000-0000-0000-0000-000000000000";
    await run(`INSERT INTO fanmarks (id, user_input_fanmark, normalized_emoji, short_id, tier_level, created_at, updated_at, normalized_emoji_ids)
      VALUES (?, '🐈', '🐈', 'nil-fanmark', 1, ?, ?, '["dddddddd-dddd-4ddd-8ddd-dddddddddddd"]')`, nil, NOW, NOW);
    await run(`INSERT INTO fanmark_licenses (id, fanmark_id, user_id, license_start, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`, nil, nil, OWNER, NOW, NOW, NOW);
    for (const table of RESET_TABLES.slice(0, 5)) {
      const extra = table === "fanmark_redirect_configs" ? ", target_url" : table === "fanmark_password_configs" ? ", access_password" : "";
      await run(`INSERT INTO ${table} (id, license_id, created_at, updated_at${extra}) VALUES (?, ?, ?, ?${extra ? ", ?" : ""})`,
        nil, nil, NOW, NOW, ...(extra ? ["synthetic-nil-value"] : []));
    }
    await run(`INSERT INTO fanmark_discoveries (id, emoji_ids, normalized_emoji_ids, fanmark_id, first_seen_at, last_seen_at)
      VALUES (?, '[]', '["dddddddd-dddd-4ddd-8ddd-dddddddddddd"]', ?, ?, ?)`, nil, nil, NOW, NOW);
    await run(`INSERT INTO fanmark_favorites (id, user_id, discovery_id, fanmark_id, normalized_emoji_ids, created_at)
      VALUES (?, ?, ?, ?, '["dddddddd-dddd-4ddd-8ddd-dddddddddddd"]', ?)`, nil, OWNER, nil, nil, NOW);
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, deletedCounts: Object.fromEntries(RESET_TABLES.map((table) => [table, 1])), totalDeleted: 8 });
    expect(Object.values(await counts())).toEqual(Array(8).fill(1));
    for (const table of RESET_TABLES) expect(await db.prepare(`SELECT id FROM ${table}`).first()).toEqual({ id: nil });
  });

  it("rejects absent MFA, missing/foreign Origin, unsupported methods, unconfigured backend and forged confirmation/actor", async () => {
    const before = await counts();
    expect((await request(undefined, { denied: true })).status).toBe(403);
    expect((await request(undefined, { origin: null })).status).toBe(403);
    expect((await request(undefined, { origin: "https://evil.example" })).status).toBe(403);
    expect((await request(undefined, { method: "GET" })).status).toBe(405);
    expect((await request(undefined, { overrides: { ADMIN_DATA_RESET_BACKEND: undefined } })).status).toBe(503);
    expect((await request({ requestId: crypto.randomUUID(), confirmation: "delete" })).status).toBe(400);
    expect((await request({ requestId: crypto.randomUUID(), confirmation: "DELETE", actorUserId: OWNER })).status).toBe(400);
    expect(await counts()).toEqual(before);
    expect(await db.prepare("SELECT count(*) AS count FROM admin_data_reset_commands").first()).toEqual({ count: 0 });
  });

  it("retains the source role-denial audit for the server-resolved actor, omitting email and headers", async () => {
    const before = await counts();
    await recordUnauthorizedDataResetAttempt(runtime, OWNER, () => new Date(NOW));
    const audit = await db.prepare("SELECT user_id, metadata, created_at FROM audit_logs WHERE action = 'UNAUTHORIZED_DATA_RESET_ATTEMPT'")
      .first<{ user_id: string; metadata: string; created_at: string }>();
    expect(audit).toMatchObject({ user_id: OWNER, created_at: NOW });
    expect(JSON.parse(audit!.metadata)).toEqual({ timestamp: NOW, security_level: "CRITICAL_RISK" });
    expect(await counts()).toEqual(before);
    expect(await db.prepare("SELECT count(*) AS count FROM admin_data_reset_commands").first()).toEqual({ count: 0 });
  });

  it("the staging canary's native row guard rolls back the entire reset if an unrelated row races the preflight", async () => {
    const ids: Record<string, string> = {};
    for (const table of RESET_TABLES) ids[table] = (await db.prepare(`SELECT id FROM ${table}`).first<{ id: string }>())!.id;
    const guards = buildResetCanaryDeleteGuards(crypto.randomUUID(), ids);
    for (const statement of splitSql(guards.createSql)) await run(statement);
    const outsider = crypto.randomUUID();
    try {
      await run(`INSERT INTO fanmarks (id, user_input_fanmark, normalized_emoji, short_id, tier_level, created_at, updated_at, normalized_emoji_ids)
        VALUES (?, '🦋', '🦋', 'racing-outsider', 1, ?, ?, '["dddddddd-dddd-4ddd-8ddd-dddddddddddd"]')`, outsider, NOW, NOW);
      const before = await counts();
      expect((await request()).status).toBe(503);
      expect(await counts()).toEqual(before);
      expect(await db.prepare("SELECT id FROM fanmarks WHERE id = ?").bind(outsider).first()).toEqual({ id: outsider });
      expect(await db.prepare("SELECT count(*) AS count FROM admin_data_reset_commands").first()).toEqual({ count: 0 });
      await run("DELETE FROM fanmarks WHERE id = ?", FANMARK);
    } finally {
      for (const statement of splitSql(guards.dropSql)) await run(statement);
    }
  });

  it("reports a failed role-denial audit to the authorization gate instead of claiming it was recorded", async () => {
    const before = await counts();
    await run(`CREATE TRIGGER reset_denied_audit_fault BEFORE INSERT ON audit_logs
      WHEN NEW.action = 'UNAUTHORIZED_DATA_RESET_ATTEMPT' BEGIN SELECT RAISE(IGNORE); END`);
    try {
      await expect(recordUnauthorizedDataResetAttempt(runtime, OWNER)).rejects.toThrow("data_reset_unavailable");
      expect(await counts()).toEqual(before);
    } finally { await run("DROP TRIGGER reset_denied_audit_fault"); }
  });
});
