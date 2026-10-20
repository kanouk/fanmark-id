import { selectD1Database, type Env } from "./repository.ts";
import { isBroadcastEmailWebhookEnabled } from "./broadcast-email-delivery-d1.ts";
import { toUtcMicrosecondTimestamp } from "./utc-timestamp.ts";

const API_PATH = "/api/admin/broadcast-emails";
const MAX_BROADCASTS = 50;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 8 * 1024;
const PROVIDER_TIMEOUT_MS = 8_000;
const EMAIL_TYPES = new Set(["broadcast_announcement", "broadcast_maintenance", "broadcast_security"]);
const PLAN_TYPES = new Set(["free", "creator", "max", "business", "enterprise", "admin"]);
const LANGUAGES = new Set(["en", "ja", "ko", "id"]);
const STATUSES = new Set(["draft", "scheduled", "sending", "completed", "failed", "cancelled"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface BroadcastTestEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
}

export type BroadcastTestEmailSender = (message: BroadcastTestEmail, apiKey: string) => Promise<string>;

type RecipientFilter = {
  plan_types?: string[];
  languages?: string[];
  registered_after?: string;
  registered_before?: string;
};

export type BroadcastEmailAdminAuthorizer = (
  request: Request,
  responseHeaders: Headers,
) => Promise<{ userId: string; sessionId: string } | Response>;

export class BroadcastEmailAdminApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 503) {
    super(code);
    this.name = "BroadcastEmailAdminApiError";
    this.code = code;
    this.status = status;
  }
}

function fail(code: string, status = 503): never {
  throw new BroadcastEmailAdminApiError(code, status);
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function cors(request: Request, env: Env, headers: Headers): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  if (!allowed.has(origin)) return false;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return true;
}

function database(env: Env): D1Database {
  if (env.BROADCAST_EMAIL_BACKEND?.trim() !== "d1" || env.D1_TOPOLOGY?.trim() !== "split") {
    fail("broadcast_email_unavailable", env.BROADCAST_EMAIL_BACKEND ? 500 : 503);
  }
  const selected = selectD1Database(env, "business");
  if (!selected) fail("broadcast_email_unavailable", 500);
  return selected;
}

export function isBroadcastEmailAdminPath(pathname: string): boolean {
  return pathname === API_PATH || pathname.startsWith(`${API_PATH}/`);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function buildTestEmailHtml(subject: string, body: string): string {
  const safeSubject = escapeHtml(subject);
  const safeBody = escapeHtml(body).replace(/\r\n|\r|\n/gu, "<br>");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeSubject}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;color:#333;background:#f5f5f5;margin:0}.container{max-width:600px;margin:0 auto;padding:32px 16px}.card{background:#fff;border-radius:12px;padding:24px}.content{white-space:pre-wrap}</style></head><body><main class="container"><section class="card"><strong>Fanmark</strong><h1>${safeSubject}</h1><div class="content">${safeBody}</div></section></main></body></html>`;
}

async function readProviderResponse(response: Response): Promise<Record<string, unknown>> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/u.test(declared) && Number(declared) > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error("email_provider_response_invalid");
  }
  if (!response.body) throw new Error("email_provider_response_invalid");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("email_provider_response_invalid");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!record(value)) throw new Error("email_provider_response_invalid");
    return value;
  } catch {
    throw new Error("email_provider_response_invalid");
  }
}

export async function sendBroadcastTestEmailViaResend(
  message: BroadcastTestEmail,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": message.idempotencyKey,
      },
      body: JSON.stringify({ from: message.from, to: [message.to], subject: message.subject, html: message.html }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("email_provider_rejected");
    const payload = await readProviderResponse(response);
    if (typeof payload.id !== "string" || payload.id.length < 1 || payload.id.length > 256) {
      throw new Error("email_provider_response_invalid");
    }
    return payload.id;
  } catch {
    throw new Error("email_provider_failed");
  } finally {
    clearTimeout(timer);
  }
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseRecipientFilter(value: unknown, allowNull = true): RecipientFilter | null {
  if (value === null && allowNull) return null;
  if (!record(value)) fail("invalid_recipient_filter", 400);
  const allowed = new Set(["plan_types", "languages", "registered_after", "registered_before"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail("invalid_recipient_filter", 400);
  const result: RecipientFilter = {};
  for (const key of ["plan_types", "languages"] as const) {
    const item = value[key];
    if (item === undefined) continue;
    const accepted = key === "plan_types" ? PLAN_TYPES : LANGUAGES;
    if (!Array.isArray(item) || item.length > accepted.size || item.some((entry) => typeof entry !== "string" || !accepted.has(entry))) {
      fail("invalid_recipient_filter", 400);
    }
    const unique = [...new Set(item as string[])];
    if (unique.length !== item.length) fail("invalid_recipient_filter", 400);
    if (unique.length) result[key] = unique;
  }
  for (const key of ["registered_after", "registered_before"] as const) {
    const item = value[key];
    if (item === undefined || item === "") continue;
    if (!isDate(item)) fail("invalid_recipient_filter", 400);
    result[key] = item;
  }
  if (result.registered_after && result.registered_before && result.registered_after > result.registered_before) {
    fail("invalid_recipient_filter", 400);
  }
  return Object.keys(result).length ? result : null;
}

function parseBroadcast(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof value.id !== "string" || value.id.length > 64 ||
      typeof value.subject !== "string" || value.subject.length > 256 ||
      typeof value.body_text !== "string" || value.body_text.length > 10_000 ||
      typeof value.email_type !== "string" || !EMAIL_TYPES.has(value.email_type) ||
      !Number.isSafeInteger(value.total_recipients) || Number(value.total_recipients) < 0 ||
      !Number.isSafeInteger(value.sent_count) || Number(value.sent_count) < 0 ||
      !Number.isSafeInteger(value.failed_count) || Number(value.failed_count) < 0 ||
      typeof value.status !== "string" || !STATUSES.has(value.status) ||
      !(value.created_at === null || (typeof value.created_at === "string" && Number.isFinite(Date.parse(value.created_at)))) ||
      !(value.started_at === null || (typeof value.started_at === "string" && Number.isFinite(Date.parse(value.started_at)))) ||
      !(value.completed_at === null || (typeof value.completed_at === "string" && Number.isFinite(Date.parse(value.completed_at))))) {
    fail("broadcast_email_unavailable");
  }
  let recipientFilter: RecipientFilter | null;
  try {
    recipientFilter = parseRecipientFilter(value.recipient_filter === null ? null : JSON.parse(String(value.recipient_filter)));
  } catch (error) {
    if (error instanceof BroadcastEmailAdminApiError) throw error;
    fail("broadcast_email_unavailable");
  }
  let deliveryStatus: "needs_review" | null = null;
  if (typeof value.error_details === "string") {
    try {
      const details: unknown = JSON.parse(value.error_details);
      if (record(details) && details.code === "needs_review") deliveryStatus = "needs_review";
    } catch {
      // Legacy detail payloads are intentionally ignored by this public DTO.
    }
  }
  return {
    id: value.id,
    subject: value.subject,
    body_text: value.body_text,
    email_type: value.email_type,
    total_recipients: Number(value.total_recipients),
    sent_count: Number(value.sent_count),
    failed_count: Number(value.failed_count),
    status: value.status,
    delivery_status: deliveryStatus,
    recipient_filter: recipientFilter,
    created_at: value.created_at,
    started_at: value.started_at,
    completed_at: value.completed_at,
  };
}

function parseTemplate(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof value.id !== "string" || value.id.length > 64 ||
      typeof value.email_type !== "string" || !EMAIL_TYPES.has(value.email_type) ||
      typeof value.language !== "string" || !LANGUAGES.has(value.language) ||
      typeof value.subject !== "string" || value.subject.length > 256 ||
      typeof value.body_text !== "string" || value.body_text.length > 10_000 ||
      typeof value.button_text !== "string" || value.button_text.length > 128) fail("broadcast_email_unavailable");
  return {
    id: value.id,
    email_type: value.email_type,
    language: value.language,
    subject: value.subject,
    body_text: value.body_text,
    button_text: value.button_text,
  };
}

async function requireAdminPlan(db: D1Database, userId: string, action: string, now: string): Promise<void> {
  const setting = await db.prepare("SELECT plan_type FROM user_settings WHERE user_id = ? LIMIT 1")
    .bind(userId).first<{ plan_type?: unknown }>();
  if (setting?.plan_type === "admin") return;
  const results = await db.batch([
    db.prepare(`INSERT INTO audit_logs (id, user_id, action, resource_type, metadata, created_at)
      VALUES (?, ?, 'ADMIN_CHECK', 'system', ?, ?)`)
      .bind(crypto.randomUUID(), userId, JSON.stringify({ timestamp: now, session_valid: true, admin_check_result: false, attempted_action: action }), now),
    db.prepare(`INSERT INTO audit_logs (id, user_id, action, resource_type, metadata, created_at)
      VALUES (?, ?, 'UNAUTHORIZED_BROADCAST_EMAIL_ACCESS', 'broadcast_email', ?, ?)`)
      .bind(crypto.randomUUID(), userId, JSON.stringify({ timestamp: now, attempted_action: action, security_level: "HIGH_RISK" }), now),
  ]);
  if (!results.every((item) => item.success && item.meta?.changes === 1)) fail("broadcast_email_unavailable");
  fail("super_admin_required", 403);
}

async function listBroadcasts(db: D1Database): Promise<Record<string, unknown>[]> {
  const result = await db.prepare(`SELECT id, subject, body_text, email_type, total_recipients, sent_count,
      failed_count, status, recipient_filter, error_details, created_at, started_at, completed_at
    FROM broadcast_emails ORDER BY created_at DESC, id DESC LIMIT ?`).bind(MAX_BROADCASTS).all<Record<string, unknown>>();
  if (!result.success || !Array.isArray(result.results) || result.results.length > MAX_BROADCASTS) fail("broadcast_email_unavailable");
  return result.results.map(parseBroadcast);
}

async function listTemplates(db: D1Database): Promise<Record<string, unknown>[]> {
  const result = await db.prepare(`SELECT id, email_type, language, subject, body_text, button_text
    FROM email_templates WHERE email_type IN (?, ?, ?) AND is_active = 1 ORDER BY email_type, language`)
    .bind(...EMAIL_TYPES).all<Record<string, unknown>>();
  if (!result.success || !Array.isArray(result.results) || result.results.length > 12) fail("broadcast_email_unavailable");
  const templates = result.results.map(parseTemplate);
  if (new Set(templates.map((item) => `${item.email_type}/${item.language}`)).size !== templates.length) {
    fail("broadcast_email_unavailable");
  }
  return templates;
}

async function estimateRecipients(db: D1Database, filter: RecipientFilter | null): Promise<number> {
  const clauses = ["1 = 1"];
  const values: (string | number)[] = [];
  if (filter?.plan_types?.length) {
    clauses.push(`plan_type IN (${filter.plan_types.map(() => "?").join(",")})`);
    values.push(...filter.plan_types);
  }
  if (filter?.languages?.length) {
    clauses.push(`preferred_language IN (${filter.languages.map(() => "?").join(",")})`);
    values.push(...filter.languages);
  }
  if (filter?.registered_after) {
    clauses.push("created_at >= ?");
    values.push(filter.registered_after);
  }
  if (filter?.registered_before) {
    clauses.push("created_at <= ?");
    values.push(filter.registered_before);
  }
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM user_settings WHERE ${clauses.join(" AND ")}`)
    .bind(...values).first<{ count?: unknown }>();
  const count = Number(row?.count);
  if (!Number.isSafeInteger(count) || count < 0) fail("broadcast_email_unavailable");
  return count;
}

async function readJson(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/u.test(declared) && Number(declared) > MAX_BODY_BYTES) fail("invalid_request", 413);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !request.body) {
    fail("invalid_request", 400);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        fail("invalid_request", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    fail("invalid_request", 400);
  }
}

async function handleEstimate(db: D1Database, userId: string, body: unknown, now: string, headers: Headers): Promise<Response> {
  if (!record(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, "recipientFilter")) fail("invalid_request", 400);
  const recipientFilter = parseRecipientFilter(body.recipientFilter);
  await requireAdminPlan(db, userId, "estimate_recipients", now);
  return json({ count: await estimateRecipients(db, recipientFilter) }, 200, headers);
}

async function handleCreateDraft(db: D1Database, userId: string, body: unknown, now: string, headers: Headers): Promise<Response> {
  if (!record(body) || Object.keys(body).some((key) => !["emailType", "subject", "bodyText", "recipientFilter"].includes(key)) ||
      typeof body.emailType !== "string" || !EMAIL_TYPES.has(body.emailType) ||
      typeof body.subject !== "string" || body.subject.trim().length < 1 || body.subject.trim().length > 256 || /[\r\n]/u.test(body.subject) ||
      typeof body.bodyText !== "string" || body.bodyText.trim().length < 1 || body.bodyText.length > 10_000 ||
      (body.recipientFilter !== undefined && body.recipientFilter !== null && !record(body.recipientFilter))) fail("invalid_request", 400);
  const recipientFilter = parseRecipientFilter(body.recipientFilter ?? null);
  await requireAdminPlan(db, userId, "create_draft", now);
  const id = crypto.randomUUID();
  const filterJson = recipientFilter ? JSON.stringify(recipientFilter) : null;
  const results = await db.batch([
    db.prepare(`INSERT INTO broadcast_emails
      (id, subject, body_text, email_type, recipient_filter, total_recipients, sent_count, failed_count, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, 0, 'draft', ?, ?, ?)`)
      .bind(id, body.subject.trim(), body.bodyText, body.emailType, filterJson, userId, now, now),
    db.prepare(`INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata, created_at)
      VALUES (?, ?, 'BROADCAST_DRAFT_CREATE', 'broadcast_email', ?, ?, ?)`)
      .bind(crypto.randomUUID(), userId, id, JSON.stringify({ email_type: body.emailType, recipient_filter_present: Boolean(recipientFilter) }), now),
  ]);
  if (!results.every((item) => item.success && item.meta?.changes === 1)) fail("broadcast_email_unavailable");
  const row = await db.prepare(`SELECT id, subject, body_text, email_type, total_recipients, sent_count,
      failed_count, status, recipient_filter, created_at, started_at, completed_at
    FROM broadcast_emails WHERE id = ? LIMIT 1`).bind(id).first<Record<string, unknown>>();
  if (!row) fail("broadcast_email_unavailable");
  return json({ broadcast: parseBroadcast(row) }, 201, headers);
}

async function handleTestSend(
  db: D1Database,
  env: Env,
  userId: string,
  body: unknown,
  now: string,
  headers: Headers,
  sender: BroadcastTestEmailSender,
): Promise<Response> {
  if (!record(body) || Object.keys(body).length !== 3 ||
      typeof body.broadcastId !== "string" || !UUID.test(body.broadcastId) ||
      typeof body.language !== "string" || !LANGUAGES.has(body.language) ||
      typeof body.requestId !== "string" || !UUID.test(body.requestId)) {
    fail("invalid_request", 400);
  }
  await requireAdminPlan(db, userId, "test_send", now);

  const recipient = env.BROADCAST_TEST_RECIPIENT?.trim();
  const from = env.RESEND_FROM_EMAIL?.trim();
  const apiKey = env.RESEND_API_KEY?.trim();
  if (env.BROADCAST_TEST_SEND_BACKEND?.trim() !== "resend" ||
      !recipient || recipient.length > 320 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(recipient) ||
      !from || from.length > 320 || /[\r\n]/u.test(from) || !from.includes("@") ||
      !apiKey || apiKey.length > 512) {
    fail("test_send_unavailable", 503);
  }

  const row = await db.prepare(`SELECT id, subject, body_text, email_type, total_recipients, sent_count,
      failed_count, status, recipient_filter, created_at, started_at, completed_at
    FROM broadcast_emails WHERE id = ? LIMIT 1`).bind(body.broadcastId).first<Record<string, unknown>>();
  if (!row) fail("broadcast_not_found", 404);
  const broadcast = parseBroadcast(row);
  if (broadcast.status !== "draft") fail("broadcast_not_draft", 409);

  let templateRow = await db.prepare(`SELECT id, email_type, language, subject, body_text, button_text
      FROM email_templates WHERE email_type = ? AND language = ? AND is_active = 1 LIMIT 1`)
    .bind(broadcast.email_type, body.language).first<Record<string, unknown>>();
  if (!templateRow && body.language !== "ja") {
    templateRow = await db.prepare(`SELECT id, email_type, language, subject, body_text, button_text
        FROM email_templates WHERE email_type = ? AND language = 'ja' AND is_active = 1 LIMIT 1`)
      .bind(broadcast.email_type).first<Record<string, unknown>>();
  }
  if (!templateRow) fail("broadcast_template_unavailable", 409);
  const template = parseTemplate(templateRow);
  const subject = String(broadcast.subject).trim() || String(template.subject);
  const bodyText = String(broadcast.body_text).trim() || String(template.body_text);
  const message: BroadcastTestEmail = {
    from,
    to: recipient,
    subject: `[テスト] ${subject}`,
    html: buildTestEmailHtml(subject, bodyText),
    idempotencyKey: `broadcast-test/${body.broadcastId}/${body.requestId}`,
  };

  let providerMessageId: string;
  try {
    providerMessageId = await sender(message, apiKey);
  } catch {
    fail("email_delivery_failed", 502);
  }
  if (typeof providerMessageId !== "string" || providerMessageId.length < 1 || providerMessageId.length > 256) {
    fail("email_delivery_failed", 502);
  }

  const audit = await db.prepare(`INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata, created_at)
    VALUES (?, ?, 'BROADCAST_EMAIL_TEST_SENT', 'broadcast_email', ?, ?, ?)`)
    .bind(crypto.randomUUID(), userId, broadcast.id,
      JSON.stringify({ email_type: broadcast.email_type, language: template.language, provider_message_id: providerMessageId }), now)
    .run();
  if (!audit.success || audit.meta?.changes !== 1) fail("test_send_unavailable", 503);
  return json({ success: true }, 200, headers);
}

async function readDeliveryRun(db: D1Database, run: Record<string, unknown>): Promise<Record<string, unknown>> {
  const row = await db.prepare(`SELECT id, status, recipient_count,
      (SELECT COUNT(*) FROM broadcast_delivery_recipients AS recipient
       WHERE recipient.run_id = run.id AND recipient.status IN ('sent', 'delivered')) AS sent_count,
      (SELECT COUNT(*) FROM broadcast_delivery_recipients AS recipient
       WHERE recipient.run_id = run.id AND recipient.status IN ('failed', 'bounced', 'suppressed')) AS failed_count
    FROM broadcast_delivery_runs AS run WHERE id = ? LIMIT 1`).bind(run.id).first<Record<string, unknown>>();
  if (!row || typeof row.id !== "string" || typeof row.status !== "string") fail("broadcast_email_unavailable");
  return {
    accepted: true,
    runId: row.id,
    status: row.status,
    recipientCount: Number(row.recipient_count) || 0,
    sentCount: Number(row.sent_count) || 0,
    failedCount: Number(row.failed_count) || 0,
  };
}

function deliveryConfigurationReady(env: Env): boolean {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM_EMAIL?.trim();
  const webhookSecret = env.BROADCAST_WEBHOOK_SIGNING_SECRET?.trim();
  const authSecret = env.BETTER_AUTH_SECRET?.trim();
  return env.BROADCAST_SEND_BACKEND?.trim() === "d1" &&
    isBroadcastEmailWebhookEnabled(env) &&
    env.D1_TOPOLOGY?.trim() === "split" &&
    Boolean(selectD1Database(env, "auth")) &&
    Boolean(apiKey && apiKey.length <= 512) &&
    Boolean(from && from.length <= 320 && from.includes("@") && !/[\r\n]/u.test(from)) &&
    validResendWebhookSecret(webhookSecret) &&
    Boolean(authSecret && authSecret.length >= 32);
}

function validResendWebhookSecret(value: string | undefined): boolean {
  if (!value || !/^whsec_[A-Za-z0-9+/_=-]{16,240}$/u.test(value)) return false;
  try {
    const encoded = value.slice("whsec_".length).replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = encoded.padEnd(encoded.length + ((4 - encoded.length % 4) % 4), "=");
    return atob(padded).length >= 16;
  } catch {
    return false;
  }
}

async function handleStartDelivery(
  db: D1Database,
  env: Env,
  userId: string,
  body: unknown,
  now: string,
  headers: Headers,
): Promise<Response> {
  if (!record(body) || Object.keys(body).length !== 2 ||
      typeof body.broadcastId !== "string" || !UUID.test(body.broadcastId) ||
      typeof body.requestId !== "string" || !UUID.test(body.requestId)) {
    fail("invalid_request", 400);
  }
  await requireAdminPlan(db, userId, "send_broadcast", now);

  const existingRequest = await db.prepare(`SELECT id, broadcast_id, status, recipient_count
    FROM broadcast_delivery_runs WHERE requested_by = ? AND request_id = ? LIMIT 1`)
    .bind(userId, body.requestId).first<Record<string, unknown>>();
  if (existingRequest) {
    if (existingRequest.broadcast_id !== body.broadcastId) fail("idempotency_conflict", 409);
    return json(await readDeliveryRun(db, existingRequest), 200, headers);
  }
  const existingBroadcast = await db.prepare(`SELECT id FROM broadcast_delivery_runs WHERE broadcast_id = ? LIMIT 1`)
    .bind(body.broadcastId).first<Record<string, unknown>>();
  if (existingBroadcast) fail("broadcast_already_started", 409);
  if (!deliveryConfigurationReady(env)) fail("broadcast_send_unavailable", 503);

  const row = await db.prepare(`SELECT id, subject, body_text, email_type, recipient_filter, status
    FROM broadcast_emails WHERE id = ? LIMIT 1`).bind(body.broadcastId).first<Record<string, unknown>>();
  if (!row) fail("broadcast_not_found", 404);
  if (row.status !== "draft") fail("broadcast_not_draft", 409);
  if (typeof row.subject !== "string" || typeof row.body_text !== "string" ||
      typeof row.email_type !== "string" || !EMAIL_TYPES.has(row.email_type)) {
    fail("broadcast_email_unavailable");
  }
  let recipientFilter: RecipientFilter | null;
  try {
    recipientFilter = row.recipient_filter === null || row.recipient_filter === undefined
      ? null
      : parseRecipientFilter(JSON.parse(String(row.recipient_filter)));
  } catch (error) {
    if (error instanceof BroadcastEmailAdminApiError) throw error;
    fail("broadcast_email_unavailable");
  }

  const templatesResult = await db.prepare(`SELECT id, email_type, language, subject, body_text, button_text
    FROM email_templates WHERE email_type = ? AND is_active = 1 ORDER BY language`)
    .bind(row.email_type).all<Record<string, unknown>>();
  if (!templatesResult.success || !Array.isArray(templatesResult.results) || templatesResult.results.length > 4) {
    fail("broadcast_email_unavailable");
  }
  const templates = templatesResult.results.map(parseTemplate);
  const byLanguage = new Map(templates.map((template) => [String(template.language), template]));
  const fallback = byLanguage.get("ja");
  if (!fallback) fail("broadcast_template_unavailable", 409);
  const templatesByLanguage = Object.fromEntries([...LANGUAGES].map((language) => [language, byLanguage.get(language) ?? fallback]));
  const templateSnapshot = JSON.stringify({
    schemaVersion: 1,
    broadcast: {
      id: row.id,
      emailType: row.email_type,
      subject: row.subject,
      bodyText: row.body_text,
      recipientFilter,
    },
    templatesByLanguage,
  });

  const runId = crypto.randomUUID();
  const recipientFilterJson = recipientFilter ? JSON.stringify(recipientFilter) : null;
  let results: D1Result[];
  try {
    results = await db.batch([
      db.prepare(`INSERT INTO broadcast_delivery_runs
        (id, broadcast_id, request_id, requested_by, status, recipient_filter, recipient_count,
         template_snapshot, created_at)
        SELECT ?, ?, ?, ?, 'snapshotting', ?, 0, ?, ?
        FROM broadcast_emails WHERE id = ? AND status = 'draft'`)
        .bind(runId, body.broadcastId, body.requestId, userId, recipientFilterJson, templateSnapshot, now, body.broadcastId),
      db.prepare(`UPDATE broadcast_emails SET status = 'scheduled', total_recipients = 0, sent_count = 0,
          failed_count = 0, started_at = NULL, completed_at = NULL, error_details = NULL, updated_at = ?
        WHERE id = ? AND status = 'draft'
          AND EXISTS (SELECT 1 FROM broadcast_delivery_runs WHERE id = ? AND broadcast_id = broadcast_emails.id)`)
        .bind(now, body.broadcastId, runId),
      db.prepare(`INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata, created_at)
        SELECT ?, ?, 'BROADCAST_EMAIL_SEND_QUEUED', 'broadcast_email', ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM broadcast_delivery_runs WHERE id = ? AND broadcast_id = ?)`)
        .bind(crypto.randomUUID(), userId, body.broadcastId,
          JSON.stringify({ request_id: body.requestId, email_type: row.email_type, recipient_filter_present: Boolean(recipientFilter) }),
          now, runId, body.broadcastId),
    ]);
  } catch {
    const racedRequest = await db.prepare(`SELECT id, broadcast_id, status, recipient_count
      FROM broadcast_delivery_runs WHERE requested_by = ? AND request_id = ? LIMIT 1`)
      .bind(userId, body.requestId).first<Record<string, unknown>>();
    if (racedRequest) {
      if (racedRequest.broadcast_id !== body.broadcastId) fail("idempotency_conflict", 409);
      return json(await readDeliveryRun(db, racedRequest), 200, headers);
    }
    const racedBroadcast = await db.prepare(`SELECT id FROM broadcast_delivery_runs WHERE broadcast_id = ? LIMIT 1`)
      .bind(body.broadcastId).first<Record<string, unknown>>();
    if (racedBroadcast) fail("broadcast_already_started", 409);
    throw new BroadcastEmailAdminApiError("broadcast_email_unavailable");
  }
  if (!results.every((item) => item.success) || results[0].meta?.changes !== 1 ||
      results[1].meta?.changes !== 1 || results[2].meta?.changes !== 1) {
    const racedRequest = await db.prepare(`SELECT id, broadcast_id, status, recipient_count
      FROM broadcast_delivery_runs WHERE requested_by = ? AND request_id = ? LIMIT 1`)
      .bind(userId, body.requestId).first<Record<string, unknown>>();
    if (racedRequest) {
      if (racedRequest.broadcast_id !== body.broadcastId) fail("idempotency_conflict", 409);
      return json(await readDeliveryRun(db, racedRequest), 200, headers);
    }
    const racedBroadcast = await db.prepare(`SELECT id FROM broadcast_delivery_runs WHERE broadcast_id = ? LIMIT 1`)
      .bind(body.broadcastId).first<Record<string, unknown>>();
    if (racedBroadcast) fail("broadcast_already_started", 409);
    const current = await db.prepare(`SELECT id, status FROM broadcast_emails WHERE id = ? LIMIT 1`)
      .bind(body.broadcastId).first<{ id?: unknown; status?: unknown }>();
    if (!current) fail("broadcast_not_found", 404);
    if (current.status !== "draft") fail("broadcast_not_draft", 409);
    fail("broadcast_email_unavailable");
  }
  return json({ accepted: true, runId, status: "snapshotting", recipientCount: 0, sentCount: 0, failedCount: 0 }, 202, headers);
}

export async function handleBroadcastEmailAdminRequest(
  request: Request,
  env: Env,
  authorizeAdmin: BroadcastEmailAdminAuthorizer,
  clock: () => Date = () => new Date(),
  sendTestEmail: BroadcastTestEmailSender = sendBroadcastTestEmailViaResend,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isBroadcastEmailAdminPath(url.pathname)) return null;
  const isRoot = url.pathname === API_PATH;
  const isEstimate = url.pathname === `${API_PATH}/estimate`;
  const isTestSend = url.pathname === `${API_PATH}/test-send`;
  const isStartSend = url.pathname === `${API_PATH}/send`;
  if (!isRoot && !isEstimate && !isTestSend && !isStartSend) return json({ error: "not_found" }, 404);
  if (url.search || url.hash) return json({ error: "not_found" }, 404);
  const headers = new Headers();
  if (!cors(request, env, headers)) return json({ error: "forbidden_origin" }, 403);
  const allowed = isEstimate || isTestSend || isStartSend ? "POST, OPTIONS" : "GET, POST, OPTIONS";
  if (request.method.toUpperCase() === "OPTIONS") {
    headers.set("allow", allowed);
    return new Response(null, { status: 204, headers });
  }
  const method = request.method.toUpperCase();
  if (((isEstimate || isTestSend || isStartSend) && method !== "POST") || (isRoot && method !== "GET" && method !== "POST")) {
    headers.set("allow", allowed);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  if (env.AUTH_BACKEND?.trim() !== "better-auth") return json({ error: "auth_unavailable" }, 503, headers);
  const authorization = await authorizeAdmin(request, headers);
  if (authorization instanceof Response) return authorization;

  try {
    const db = database(env);
    const now = toUtcMicrosecondTimestamp(clock());
    if (isEstimate) return await handleEstimate(db, authorization.userId, await readJson(request), now, headers);
    if (isTestSend) return await handleTestSend(db, env, authorization.userId, await readJson(request), now, headers, sendTestEmail);
    if (isStartSend) return await handleStartDelivery(db, env, authorization.userId, await readJson(request), now, headers);
    if (method === "POST") return await handleCreateDraft(db, authorization.userId, await readJson(request), now, headers);
    await requireAdminPlan(db, authorization.userId, "list", now);
    return json({ broadcasts: await listBroadcasts(db), templates: await listTemplates(db) }, 200, headers);
  } catch (error) {
    if (error instanceof BroadcastEmailAdminApiError) return json({ error: error.code }, error.status, headers);
    return json({ error: "broadcast_email_unavailable" }, 503, headers);
  }
}
