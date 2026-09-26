import { selectD1Database, type Env } from "./repository";

const API_PATH = "/api/admin/invitation-codes";
const MAX_BODY_BYTES = 8 * 1024;
const MAX_CODES = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CODE = /^[A-Za-z0-9-]{3,64}$/u;

export interface InvitationCodeDto {
  id: string;
  code: string;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  special_perks: Record<string, unknown> | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type InvitationAdminAuthorizer = (
  request: Request,
  responseHeaders: Headers,
) => Promise<{ userId: string; sessionId: string } | Response>;

export class InvitationAdminApiError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "InvitationAdminApiError";
  }
}

function fail(code: string, status = 503): never {
  throw new InvitationAdminApiError(code, status);
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
  headers.set("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return true;
}

function database(env: Env): D1Database {
  if (env.INVITATION_ADMIN_BACKEND?.trim() !== "d1" || env.D1_TOPOLOGY?.trim() !== "split") {
    fail("invitation_admin_unavailable", env.INVITATION_ADMIN_BACKEND ? 500 : 503);
  }
  const selected = selectD1Database(env, "business");
  if (!selected) fail("invitation_admin_unavailable", 500);
  return selected;
}

function parsePerks(value: unknown, invalidStatus = 503): Record<string, unknown> | null {
  if (value === null || value === undefined || value === "") return null;
  let parsed: unknown = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value) as unknown; } catch { fail(invalidStatus === 400 ? "invalid_request" : "invitation_admin_unavailable", invalidStatus); }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail(invalidStatus === 400 ? "invalid_request" : "invitation_admin_unavailable", invalidStatus);
  return parsed as Record<string, unknown>;
}

function parseCode(value: Record<string, unknown>): InvitationCodeDto {
  if (typeof value.id !== "string" || !UUID.test(value.id) || typeof value.code !== "string" || !CODE.test(value.code) ||
      !Number.isSafeInteger(value.max_uses) || Number(value.max_uses) < 1 ||
      !Number.isSafeInteger(value.used_count) || Number(value.used_count) < 0 || Number(value.used_count) > Number(value.max_uses) ||
      !(value.expires_at === null || (typeof value.expires_at === "string" && Number.isFinite(Date.parse(value.expires_at)))) ||
      typeof value.is_active !== "number" || ![0, 1].includes(value.is_active as number) ||
      typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at)) ||
      typeof value.updated_at !== "string" || !Number.isFinite(Date.parse(value.updated_at))) fail("invitation_admin_unavailable");
  return {
    id: value.id,
    code: value.code,
    max_uses: Number(value.max_uses),
    used_count: Number(value.used_count),
    expires_at: value.expires_at as string | null,
    special_perks: parsePerks(value.special_perks),
    is_active: value.is_active === 1,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
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
    if (error instanceof InvitationAdminApiError) throw error;
    fail("invalid_request", 400);
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { fail("invalid_request", 400); }
}

function parsePatch(value: unknown): { max_uses?: number; expires_at?: string | null; special_perks?: Record<string, unknown> | null; is_active?: boolean; expectedUpdatedAt: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_request", 400);
  const body = value as Record<string, unknown>;
  const allowed = new Set(["max_uses", "expires_at", "special_perks", "is_active", "expectedUpdatedAt"]);
  const keys = Object.keys(body);
  if (!keys.length || keys.some((key) => !allowed.has(key)) ||
      typeof body.expectedUpdatedAt !== "string" || body.expectedUpdatedAt.length > 64 || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) {
    fail("invalid_request", 400);
  }
  const patch: { max_uses?: number; expires_at?: string | null; special_perks?: Record<string, unknown> | null; is_active?: boolean; expectedUpdatedAt: string } = {
    expectedUpdatedAt: body.expectedUpdatedAt,
  };
  if (Object.hasOwn(body, "max_uses")) {
    if (!Number.isSafeInteger(body.max_uses) || Number(body.max_uses) < 1 || Number(body.max_uses) > 2_147_483_647) fail("invalid_request", 400);
    patch.max_uses = Number(body.max_uses);
  }
  if (Object.hasOwn(body, "expires_at")) {
    if (body.expires_at !== null && (typeof body.expires_at !== "string" || body.expires_at.length > 64 || !Number.isFinite(Date.parse(body.expires_at)))) fail("invalid_request", 400);
    patch.expires_at = body.expires_at as string | null;
  }
  if (Object.hasOwn(body, "special_perks")) patch.special_perks = parsePerks(body.special_perks, 400);
  if (Object.hasOwn(body, "is_active")) {
    if (typeof body.is_active !== "boolean") fail("invalid_request", 400);
    patch.is_active = body.is_active;
  }
  if (Object.keys(patch).length === 1) fail("invalid_request", 400);
  return patch;
}

function parseCreate(value: unknown): { code: string | null; max_uses: number; expires_at: string | null; special_perks: Record<string, unknown> | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_request", 400);
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.length !== 4 || keys.some((key) => !["code", "max_uses", "expires_at", "special_perks"].includes(key)) ||
      !(body.code === null || (typeof body.code === "string" && CODE.test(body.code.trim().toUpperCase()))) ||
      !Number.isSafeInteger(body.max_uses) || Number(body.max_uses) < 1 || Number(body.max_uses) > 2_147_483_647 ||
      !(body.expires_at === null || (typeof body.expires_at === "string" && body.expires_at.length <= 64 && Number.isFinite(Date.parse(body.expires_at))))) {
    fail("invalid_request", 400);
  }
  return {
    code: body.code === null ? null : (body.code as string).trim().toUpperCase(),
    max_uses: Number(body.max_uses),
    expires_at: body.expires_at as string | null,
    special_perks: parsePerks(body.special_perks, 400),
  };
}

export function isInvitationAdminPath(pathname: string): boolean {
  return pathname === API_PATH || /^\/api\/admin\/invitation-codes\/[0-9a-f-]+$/iu.test(pathname) || pathname.startsWith(`${API_PATH}/`);
}

export async function handleInvitationAdminRequest(
  request: Request,
  env: Env,
  authorizeAdmin: InvitationAdminAuthorizer,
  clock: () => Date = () => new Date(),
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isInvitationAdminPath(url.pathname)) return null;
  if (url.search || url.hash) return json({ error: "not_found" }, 404);
  const headers = new Headers();
  if (!cors(request, env, headers)) return json({ error: "forbidden_origin" }, 403);
  const collection = url.pathname === API_PATH;
  const id = collection ? null : url.pathname.slice(`${API_PATH}/`.length);
  if (id && !UUID.test(id)) return json({ error: "not_found" }, 404);
  const method = request.method.toUpperCase();
  const allowed = collection ? "GET, POST, OPTIONS" : "PATCH, DELETE, OPTIONS";
  if (method === "OPTIONS") { headers.set("allow", allowed); return new Response(null, { status: 204, headers }); }
  if (!(collection ? ["GET", "POST"] : ["PATCH", "DELETE"]).includes(method)) {
    headers.set("allow", allowed);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  if (env.AUTH_BACKEND?.trim() !== "better-auth") return json({ error: "auth_unavailable" }, 503, headers);
  const authorization = await authorizeAdmin(request, headers);
  if (authorization instanceof Response) return authorization;
  try {
    const db = database(env);
    if (collection && method === "GET") {
      const result = await db.prepare(`SELECT id, code, max_uses, used_count, expires_at, special_perks, is_active, created_at, updated_at
        FROM invitation_codes ORDER BY created_at DESC, id ASC LIMIT ?`).bind(MAX_CODES + 1).all<Record<string, unknown>>();
      if (!result.success || !Array.isArray(result.results) || result.results.length > MAX_CODES) fail("invitation_admin_unavailable");
      return json({ schemaVersion: 1, codes: result.results.map(parseCode) }, 200, headers);
    }
    const now = clock().toISOString();
    if (collection) {
      const create = parseCreate(await readBody(request));
      const generated = create.code ?? Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[byte % 32]).join("");
      const id = crypto.randomUUID();
      const result = await db.prepare(`INSERT INTO invitation_codes
        (id, code, max_uses, used_count, expires_at, special_perks, created_by, is_active, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?, ?, 1, ?, ?)`)
        .bind(id, generated, create.max_uses, create.expires_at, create.special_perks === null ? null : JSON.stringify(create.special_perks), authorization.userId, now, now).run();
      if (!result.success || result.meta?.changes !== 1) fail("invitation_admin_unavailable");
      const row = await db.prepare(`SELECT id, code, max_uses, used_count, expires_at, special_perks, is_active, created_at, updated_at
        FROM invitation_codes WHERE id = ? LIMIT 1`).bind(id).first<Record<string, unknown>>();
      if (!row) fail("invitation_admin_unavailable");
      return json({ schemaVersion: 1, code: parseCode(row) }, 201, headers);
    }
    if (method === "PATCH") {
      const patch = parsePatch(await readBody(request));
      const columns: string[] = [];
      const values: unknown[] = [];
      if (patch.max_uses !== undefined) { columns.push("max_uses = ?"); values.push(patch.max_uses); }
      if (patch.expires_at !== undefined) { columns.push("expires_at = ?"); values.push(patch.expires_at); }
      if (patch.special_perks !== undefined) { columns.push("special_perks = ?"); values.push(patch.special_perks === null ? null : JSON.stringify(patch.special_perks)); }
      if (patch.is_active !== undefined) { columns.push("is_active = ?"); values.push(patch.is_active ? 1 : 0); }
      columns.push("updated_at = ?"); values.push(now, id, patch.expectedUpdatedAt);
      const updated = await db.prepare(`UPDATE invitation_codes SET ${columns.join(", ")} WHERE id = ? AND updated_at = ?`).bind(...values).run();
      if (!updated.success) fail("invitation_admin_unavailable");
      if (updated.meta?.changes !== 1) {
        const exists = await db.prepare("SELECT id FROM invitation_codes WHERE id = ? LIMIT 1").bind(id).first();
        return json({ error: exists ? "stale_revision" : "not_found" }, exists ? 409 : 404, headers);
      }
      const row = await db.prepare(`SELECT id, code, max_uses, used_count, expires_at, special_perks, is_active, created_at, updated_at
        FROM invitation_codes WHERE id = ? LIMIT 1`).bind(id).first<Record<string, unknown>>();
      if (!row) fail("invitation_admin_unavailable");
      return json({ schemaVersion: 1, code: parseCode(row) }, 200, headers);
    }
    const deleted = await db.prepare("DELETE FROM invitation_codes WHERE id = ?").bind(id).run();
    if (!deleted.success) fail("invitation_code_in_use", 409);
    if (deleted.meta?.changes !== 1) return json({ error: "not_found" }, 404, headers);
    return json({ schemaVersion: 1, deleted: true }, 200, headers);
  } catch (error) {
    if (error instanceof InvitationAdminApiError) return json({ error: error.code }, error.status, headers);
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint|foreign key/iu.test(message)) return json({ error: "invitation_code_conflict" }, 409, headers);
    return json({ error: "invitation_admin_unavailable" }, 503, headers);
  }
}
