import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "./fixtures/d1-broadcast-email-admin.sql?raw";
import { handleBroadcastEmailAdminRequest, type BroadcastEmailAdminAuthorizer } from "../src/broadcast-email-admin-d1-api";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const database = runtimeEnv.FANMARK_DB;
const apiBase = "https://api.example.test";
const appOrigin = "https://app.example.test";
const now = new Date("2026-09-27T12:34:56.000Z");
const adminId = "synthetic-admin";
const authorizer: BroadcastEmailAdminAuthorizer = async () => ({ userId: adminId, sessionId: "synthetic-session" });
const mfaRequired: BroadcastEmailAdminAuthorizer = async (_request, headers) =>
  new Response(JSON.stringify({ error: "mfa_required" }), { status: 403, headers });

function splitSql(sql: string): string[] {
  return sql.split(/;\s*(?:\r?\n|$)/u).map((statement) => statement.trim()).filter(Boolean);
}

async function prepareSchema(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch(splitSql(schemaSql).map((statement) => database.prepare(statement)));
}

async function request(
  path: string,
  init: RequestInit = {},
  overrides: Partial<Env> = {},
  authorize = authorizer,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", appOrigin);
  const response = await handleBroadcastEmailAdminRequest(
    new Request(`${apiBase}${path}`, { ...init, headers }),
    { ...runtimeEnv, ...overrides },
    authorize,
    () => now,
  );
  if (!response) throw new Error("Broadcast email admin route did not match");
  return response;
}

async function resetRows(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch([
    database.prepare("DELETE FROM audit_logs"),
    database.prepare("DELETE FROM broadcast_emails"),
    database.prepare("DELETE FROM email_templates"),
    database.prepare("DELETE FROM user_settings"),
  ]);
  await database.batch([
    database.prepare("INSERT INTO user_settings VALUES (?, 'admin', 'ja', '2026-09-01T00:00:00.000Z')").bind(adminId),
    database.prepare("INSERT INTO user_settings VALUES ('free-ja', 'free', 'ja', '2026-09-02T00:00:00.000Z')"),
    database.prepare("INSERT INTO user_settings VALUES ('creator-ko', 'creator', 'ko', '2026-09-10T00:00:00.000Z')"),
    database.prepare("INSERT INTO user_settings VALUES ('max-en', 'max', 'en', '2026-09-26T00:00:00.000Z')"),
  ]);
  await database.batch([
    database.prepare(`INSERT INTO email_templates VALUES
      ('template-ja', 'broadcast_announcement', 'ja', 'お知らせ', '本文', '開く', 1)`),
    database.prepare(`INSERT INTO email_templates VALUES
      ('template-ko', 'broadcast_announcement', 'ko', '공지', '내용', '열기', 1)`),
    database.prepare(`INSERT INTO email_templates VALUES
      ('template-disabled', 'broadcast_security', 'ja', 'inactive', 'inactive body', 'open', 0)`),
    database.prepare(`INSERT INTO email_templates VALUES
      ('template-auth', 'signup', 'ja', 'auth template', 'auth body', 'verify', 1)`),
    database.prepare(`INSERT INTO broadcast_emails
      (id, subject, body_text, email_type, recipient_filter, total_recipients, sent_count, failed_count, status, created_by, error_details, created_at, updated_at)
      VALUES ('existing-draft', 'Draft', 'Body', 'broadcast_announcement', '{"languages":["ja"]}', 0, 0, 0, 'draft', 'old-admin', '{"recipient":"private@example.test"}', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z')`),
  ]);
}

beforeAll(prepareSchema);
beforeEach(resetRows);

describe("D1 broadcast email admin API", () => {
  it("lists broadcast drafts and active broadcast templates without creator or error details", async () => {
    const response = await request("/api/admin/broadcast-emails");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json() as Record<string, unknown>;
    expect(payload.broadcasts).toEqual([expect.objectContaining({
      id: "existing-draft",
      subject: "Draft",
      status: "draft",
      recipient_filter: { languages: ["ja"] },
    })]);
    expect(payload.templates).toEqual([
      { id: "template-ja", email_type: "broadcast_announcement", language: "ja", subject: "お知らせ", body_text: "本文", button_text: "開く" },
      { id: "template-ko", email_type: "broadcast_announcement", language: "ko", subject: "공지", body_text: "내용", button_text: "열기" },
    ]);
    expect(JSON.stringify(payload)).not.toContain("private@example.test");
    expect(JSON.stringify(payload)).not.toContain("created_by");
    expect(JSON.stringify(payload)).not.toContain("error_details");
  });

  it("estimates recipient counts using only validated filters", async () => {
    const response = await request("/api/admin/broadcast-emails/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipientFilter: { plan_types: ["creator"], languages: ["ko"], registered_after: "2026-09-01", registered_before: "2026-09-30" } }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 1 });

    const invalid = await request("/api/admin/broadcast-emails/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipientFilter: { plan_types: ["admin' OR 1=1 --"] } }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_recipient_filter" });
  });

  it("creates only a draft, binds creator identity server-side, and audits without recipient data", async () => {
    const response = await request("/api/admin/broadcast-emails", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        emailType: "broadcast_maintenance",
        subject: " Planned maintenance ",
        bodyText: "Synthetic draft body",
        recipientFilter: { languages: ["ja", "ko"] },
      }),
    });
    expect(response.status).toBe(201);
    const payload = await response.json() as { broadcast: Record<string, unknown> };
    expect(payload.broadcast).toMatchObject({
      subject: "Planned maintenance",
      body_text: "Synthetic draft body",
      email_type: "broadcast_maintenance",
      status: "draft",
      total_recipients: 0,
      recipient_filter: { languages: ["ja", "ko"] },
      created_at: now.toISOString(),
    });
    expect(payload.broadcast.id).toMatch(/^[0-9a-f-]{36}$/u);
    const stored = await database!.prepare("SELECT created_by, status FROM broadcast_emails WHERE id = ?")
      .bind(payload.broadcast.id as string).first<{ created_by: string; status: string }>();
    expect(stored).toEqual({ created_by: adminId, status: "draft" });
    const audit = await database!.prepare("SELECT user_id, resource_id, metadata FROM audit_logs WHERE action = 'BROADCAST_DRAFT_CREATE'")
      .first<{ user_id: string; resource_id: string; metadata: string }>();
    expect(audit?.user_id).toBe(adminId);
    expect(audit?.resource_id).toBe(payload.broadcast.id);
    expect(audit?.metadata).toBe(JSON.stringify({ email_type: "broadcast_maintenance", recipient_filter_present: true }));
    expect(await database!.prepare("SELECT COUNT(*) AS count FROM broadcast_emails WHERE status != 'draft'").first<{ count: number }>()).toMatchObject({ count: 0 });
  });

  it("rejects email dispatch actions and unknown routes", async () => {
    expect((await request("/api/admin/broadcast-emails/send")).status).toBe(404);
    expect((await request("/api/admin/broadcast-emails", { method: "DELETE" })).status).toBe(405);
  });

  it("requires the Better Auth MFA gate and a D1 admin plan", async () => {
    const noMfa = await request("/api/admin/broadcast-emails", {}, {}, mfaRequired);
    expect(noMfa.status).toBe(403);
    expect(await database!.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{ count: number }>()).toMatchObject({ count: 0 });

    await database!.prepare("UPDATE user_settings SET plan_type = 'free' WHERE user_id = ?").bind(adminId).run();
    const noAdminPlan = await request("/api/admin/broadcast-emails");
    expect(noAdminPlan.status).toBe(403);
    expect(await noAdminPlan.json()).toEqual({ error: "super_admin_required" });
  });

  it("rejects invalid origin, malformed JSON, and missing backend selectors", async () => {
    expect((await request("/api/admin/broadcast-emails", { headers: { Origin: "https://attacker.example" } })).status).toBe(403);
    expect((await request("/api/admin/broadcast-emails/estimate", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{",
    })).status).toBe(400);
    expect((await request("/api/admin/broadcast-emails", {}, { BROADCAST_EMAIL_BACKEND: undefined })).status).toBe(503);
  });
});
