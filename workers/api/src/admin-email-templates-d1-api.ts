import { selectD1Database, type Env } from "./repository.ts";

const API_PATH = "/api/admin/email-templates";
const METHODS = "GET, PATCH, OPTIONS";
const MAX_BODY_BYTES = 16 * 1024;
const EMAIL_TYPES = new Set(["signup", "recovery", "magiclink", "email_change"]);
const LANGUAGES = new Set(["en", "ja", "ko", "id"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface AdminEmailTemplateDto {
  id: string;
  email_type: string;
  language: string;
  subject: string;
  body_text: string;
  button_text: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type AdminEmailTemplateAuthorizer = (
  request: Request,
  responseHeaders: Headers,
) => Promise<{ userId: string; sessionId: string } | Response>;

export class AdminEmailTemplatesApiError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "AdminEmailTemplatesApiError";
  }
}

function fail(code: string, status = 503): never {
  throw new AdminEmailTemplatesApiError(code, status);
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function allowedOrigin(request: Request, env: Env, headers: Headers): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  if (!allowed.has(origin)) return false;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", METHODS);
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return true;
}

function database(env: Env): D1Database {
  const backend = env.EMAIL_TEMPLATE_ADMIN_BACKEND?.trim();
  if (backend !== "d1") fail(backend ? "server_misconfigured" : "email_templates_unavailable", backend ? 500 : 503);
  if (env.D1_TOPOLOGY?.trim() !== "split") fail("server_misconfigured", 500);
  const selected = selectD1Database(env, "business");
  if (!selected) fail("email_templates_unavailable");
  return selected;
}

type Route = { id: string | null };

function route(pathname: string): Route | null {
  if (pathname === API_PATH) return { id: null };
  const match = /^\/api\/admin\/email-templates\/([0-9a-f-]+)$/iu.exec(pathname);
  if (!match || !UUID.test(match[1]!)) return null;
  return { id: match[1]!.toLowerCase() };
}

export function isAdminEmailTemplatesPath(pathname: string): boolean {
  return pathname === API_PATH || route(pathname) !== null || pathname.startsWith(`${API_PATH}/`);
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function mapTemplate(row: Record<string, unknown>): AdminEmailTemplateDto {
  if (typeof row.id !== "string" || !UUID.test(row.id) ||
      typeof row.email_type !== "string" || !EMAIL_TYPES.has(row.email_type) ||
      typeof row.language !== "string" || !LANGUAGES.has(row.language) ||
      typeof row.subject !== "string" || row.subject.length > 256 ||
      typeof row.body_text !== "string" || row.body_text.length > 10_000 ||
      typeof row.button_text !== "string" || row.button_text.length > 128 ||
      !(Number(row.is_active) === 0 || Number(row.is_active) === 1) ||
      !validTime(row.created_at) || !validTime(row.updated_at)) {
    fail("email_templates_unavailable");
  }
  return {
    id: row.id,
    email_type: row.email_type,
    language: row.language,
    subject: row.subject,
    body_text: row.body_text,
    button_text: row.button_text,
    is_active: Number(row.is_active) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function readTemplate(db: D1Database, id: string): Promise<AdminEmailTemplateDto | null> {
  const row = await db.prepare(`
    SELECT id, email_type, language, subject, body_text, button_text,
           is_active, created_at, updated_at
    FROM email_templates
    WHERE id = ? AND email_type IN ('signup', 'recovery', 'magiclink', 'email_change')
  `).bind(id).first<Record<string, unknown>>();
  return row ? mapTemplate(row) : null;
}

async function readAll(db: D1Database): Promise<AdminEmailTemplateDto[]> {
  const result = await db.prepare(`
    SELECT id, email_type, language, subject, body_text, button_text,
           is_active, created_at, updated_at
    FROM email_templates
    WHERE email_type IN ('signup', 'recovery', 'magiclink', 'email_change')
    ORDER BY email_type, language
  `).all<Record<string, unknown>>();
  if (!result.success || !Array.isArray(result.results) || result.results.length > 16) fail("email_templates_unavailable");
  const templates = result.results.map(mapTemplate);
  const identities = new Set(templates.map((template) => `${template.email_type}/${template.language}`));
  if (identities.size !== templates.length) fail("email_templates_unavailable");
  return templates;
}

interface UpdateRequest {
  expectedUpdatedAt: string;
  subject: string;
  bodyText: string;
  buttonText: string;
}

function parseUpdate(value: unknown): UpdateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_request", 400);
  const record = value as Record<string, unknown>;
  const keys = ["expectedUpdatedAt", "subject", "bodyText", "buttonText"];
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key)) ||
      !validTime(record.expectedUpdatedAt) || typeof record.subject !== "string" ||
      record.subject.length < 1 || record.subject.length > 256 ||
      typeof record.bodyText !== "string" || record.bodyText.length < 1 || record.bodyText.length > 10_000 ||
      typeof record.buttonText !== "string" || record.buttonText.length < 1 || record.buttonText.length > 128) {
    fail("invalid_request", 400);
  }
  return record as unknown as UpdateRequest;
}

async function readBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    fail("json_content_type_required", 415);
  }
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) fail("request_too_large", 413);
  const reader = request.body?.getReader();
  if (!reader) fail("invalid_request", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); fail("request_too_large", 413); }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AdminEmailTemplatesApiError) throw error;
    fail("invalid_request", 400);
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { fail("invalid_request", 400); }
}

export async function handleAdminEmailTemplatesRequest(
  request: Request,
  env: Env,
  authorizeAdmin: AdminEmailTemplateAuthorizer,
  options: { now?: () => Date } = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = route(url.pathname);
  if (!match) return null;
  const headers = new Headers();
  if (!allowedOrigin(request, env, headers)) return json({ error: "origin_not_allowed" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if ((match.id === null && request.method !== "GET") || (match.id !== null && request.method !== "PATCH")) {
    headers.set("allow", match.id === null ? "GET, OPTIONS" : "PATCH, OPTIONS");
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  const authorization = await authorizeAdmin(request, headers);
  if (authorization instanceof Response) return authorization;

  try {
    const db = database(env);
    if (match.id === null) return json({ templates: await readAll(db) }, 200, headers);

    const update = parseUpdate(await readBody(request));
    const existing = await readTemplate(db, match.id);
    if (!existing) return json({ error: "email_template_not_found" }, 404, headers);
    if (existing.updated_at !== update.expectedUpdatedAt) return json({ error: "stale_email_template" }, 409, headers);

    const currentMillis = Date.parse(existing.updated_at);
    if (!Number.isFinite(currentMillis)) fail("email_templates_unavailable");
    const updatedAt = new Date(Math.max((options.now?.() ?? new Date()).getTime(), currentMillis + 1)).toISOString();
    const requestId = crypto.randomUUID();
    const statements = await db.batch([
      db.prepare(`
        UPDATE email_templates
        SET subject = ?, body_text = ?, button_text = ?, updated_at = ?
        WHERE id = ? AND email_type IN ('signup', 'recovery', 'magiclink', 'email_change')
          AND updated_at = ?
      `).bind(update.subject, update.bodyText, update.buttonText, updatedAt, match.id, update.expectedUpdatedAt),
      db.prepare(`
        INSERT INTO audit_logs
          (id, user_id, action, resource_type, resource_id, request_id, metadata, created_at)
        SELECT ?, ?, 'admin_update_email_template', 'email_template', id, ?, ?, ?
        FROM email_templates WHERE id = ? AND updated_at = ? AND changes() = 1
      `).bind(requestId, authorization.userId, requestId,
        JSON.stringify({ email_type: existing.email_type, language: existing.language, updated_fields: ["subject", "body_text", "button_text"] }),
        updatedAt, match.id, updatedAt),
    ]);
    if (statements.length !== 2 || statements.some((statement) => !statement.success)) fail("email_template_update_failed");
    if (statements[0]?.meta?.changes !== 1) return json({ error: "stale_email_template" }, 409, headers);
    if (statements[1]?.meta?.changes !== 1) fail("email_template_audit_failed");
    const updated = await readTemplate(db, match.id);
    if (!updated || updated.updated_at !== updatedAt || updated.subject !== update.subject ||
        updated.body_text !== update.bodyText || updated.button_text !== update.buttonText) {
      return json({ error: "stale_email_template" }, 409, headers);
    }
    return json({ template: updated }, 200, headers);
  } catch (error) {
    if (error instanceof AdminEmailTemplatesApiError) return json({ error: error.code }, error.status, headers);
    return json({ error: "email_templates_unavailable" }, 503, headers);
  }
}
