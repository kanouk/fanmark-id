import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "./fixtures/d1-admin-email-templates.sql?raw";
import {
  handleAdminEmailTemplatesRequest,
  type AdminEmailTemplateAuthorizer,
} from "../src/admin-email-templates-d1-api";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const business = runtimeEnv.FANMARK_DB;
const baseUrl = "https://api.example.test";
const origin = "https://app.example.test";
const time = "2026-09-25T12:00:00.000Z";
const adminId = "49999999-9999-4999-8999-999999999999";
const signupJa = "81111111-1111-4111-8111-111111111111";
const signupEn = "82222222-2222-4222-8222-222222222222";
const recoveryJa = "83333333-3333-4333-8333-333333333333";
const broadcastId = "84444444-4444-4444-8444-444444444444";
const allowAdmin: AdminEmailTemplateAuthorizer = async () => ({ userId: adminId, sessionId: "mfa-session" });
const denyAdmin: AdminEmailTemplateAuthorizer = async (_request, headers) =>
  new Response(JSON.stringify({ error: "mfa_required" }), { status: 403, headers });

function splitSql(sql: string): string[] {
  return sql.split(/;\s*(?:\r?\n|$)/u).map((statement) => statement.trim()).filter(Boolean);
}

async function prepareSchema(): Promise<void> {
  if (!business) throw new Error("Business D1 binding is unavailable");
  await business.batch(splitSql(schemaSql).map((statement) => business.prepare(statement)));
}

async function request(
  path: string,
  init: RequestInit = {},
  overrides: Partial<Env> = {},
  authorize = allowAdmin,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", origin);
  const response = await handleAdminEmailTemplatesRequest(
    new Request(`${baseUrl}${path}`, { ...init, headers }),
    { ...runtimeEnv, ...overrides },
    authorize,
    { now: () => new Date("2026-09-26T12:34:56.000Z") },
  );
  if (!response) throw new Error("Admin email templates route did not match");
  return response;
}

async function resetRows(): Promise<void> {
  if (!business) throw new Error("Business D1 binding is unavailable");
  await business.batch([business.prepare("DELETE FROM audit_logs"), business.prepare("DELETE FROM email_templates")]);
  await business.batch([
    business.prepare(`INSERT INTO email_templates
      (id, email_type, language, subject, body_text, button_text, is_active, created_at, updated_at)
      VALUES (?, 'signup', 'ja', '登録確認', '確認してください', '確認', 1, ?, ?)`)
      .bind(signupJa, time, time),
    business.prepare(`INSERT INTO email_templates
      (id, email_type, language, subject, body_text, button_text, is_active, created_at, updated_at)
      VALUES (?, 'signup', 'en', 'Verify', 'Verify your email', 'Verify', 1, ?, ?)`)
      .bind(signupEn, time, time),
    business.prepare(`INSERT INTO email_templates
      (id, email_type, language, subject, body_text, button_text, is_active, created_at, updated_at)
      VALUES (?, 'recovery', 'ja', '再設定', '再設定してください', '再設定', 1, ?, ?)`)
      .bind(recoveryJa, time, time),
    business.prepare(`INSERT INTO email_templates
      (id, email_type, language, subject, body_text, button_text, is_active, created_at, updated_at)
      VALUES (?, 'broadcast_announcement', 'ja', '告知', '対象外です', '開く', 1, ?, ?)`)
      .bind(broadcastId, time, time),
  ]);
}

beforeAll(prepareSchema);
beforeEach(resetRows);

describe("admin email templates D1 API", () => {
  it("lists only the four explicit auth template types after MFA authorization", async () => {
    const response = await request("/api/admin/email-templates");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as { templates: Array<Record<string, unknown>> };
    expect(body.templates.map(({ email_type: type, language }) => `${type}/${language}`)).toEqual([
      "recovery/ja", "signup/en", "signup/ja",
    ]);
    expect(body.templates[0]).toEqual({
      id: recoveryJa, email_type: "recovery", language: "ja", subject: "再設定",
      body_text: "再設定してください", button_text: "再設定", is_active: true,
      created_at: time, updated_at: time,
    });

    const denied = await request("/api/admin/email-templates", {}, {}, denyAdmin);
    expect(denied.status).toBe(403);
    const wrongOrigin = await request("/api/admin/email-templates", {
      headers: { Origin: "https://attacker.example.test" },
    });
    expect(wrongOrigin.status).toBe(403);
  });

  it("updates exact editable fields with updated_at CAS and an atomic audit row", async () => {
    const response = await request(`/api/admin/email-templates/${signupJa}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: time, subject: "新しい件名", bodyText: "新しい本文", buttonText: "進む" }),
    });
    expect(response.status).toBe(200);
    const result = await response.json() as { template: Record<string, unknown> };
    expect(result.template).toMatchObject({
      id: signupJa, email_type: "signup", language: "ja", subject: "新しい件名",
      body_text: "新しい本文", button_text: "進む", updated_at: "2026-09-26T12:34:56.000Z",
    });
    const audit = await business!.prepare("SELECT user_id, action, resource_type, resource_id, request_id, metadata FROM audit_logs").first<Record<string, unknown>>();
    expect(audit).toMatchObject({
      user_id: adminId, action: "admin_update_email_template", resource_type: "email_template", resource_id: signupJa,
    });
    expect(typeof audit?.request_id).toBe("string");
    expect(JSON.parse(String(audit?.metadata))).toEqual({
      email_type: "signup", language: "ja", updated_fields: ["subject", "body_text", "button_text"],
    });

    const stale = await request(`/api/admin/email-templates/${signupJa}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: time, subject: "古い", bodyText: "古い", buttonText: "古い" }),
    });
    expect(stale.status).toBe(409);
    expect((await business!.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{ count: number }>())?.count).toBe(1);
  });

  it("records only the winning audit entry when two edits race on the same version", async () => {
    const update = (subject: string) => request(`/api/admin/email-templates/${signupJa}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: time, subject, bodyText: "本文", buttonText: "確認" }),
    });
    const responses = await Promise.all([update("競合A"), update("競合B")]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect((await business!.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{ count: number }>())?.count).toBe(1);
    const current = await business!.prepare("SELECT subject FROM email_templates WHERE id = ?").bind(signupJa).first<{ subject: string }>();
    expect(["競合A", "競合B"]).toContain(current?.subject);
  });

  it("fails closed for malformed updates, missing templates, and an absent selector", async () => {
    const bad = await request(`/api/admin/email-templates/${signupJa}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: time, subject: "", bodyText: "ok", buttonText: "ok" }),
    });
    expect(bad.status).toBe(400);
    const missing = await request("/api/admin/email-templates/85555555-5555-4555-8555-555555555555", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: time, subject: "ok", bodyText: "ok", buttonText: "ok" }),
    });
    expect(missing.status).toBe(404);
    const unconfigured = await request("/api/admin/email-templates", {}, { EMAIL_TEMPLATE_ADMIN_BACKEND: undefined });
    expect(unconfigured.status).toBe(503);
    expect((await business!.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{ count: number }>())?.count).toBe(0);
  });
});
