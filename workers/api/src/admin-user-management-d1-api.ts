import { selectD1Database, type Env } from "./repository.ts";

const API_PATH = "/api/admin/users";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_FETCH = 1000;
const MAX_PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PLANS = new Set(["free", "creator", "max", "business", "enterprise", "admin"]);
const LANGUAGES = new Set(["en", "ja", "ko", "id"]);

export interface AdminUserManagementAuthorizer {
  (request: Request, responseHeaders: Headers): Promise<{ userId: string; sessionId: string } | Response>;
}

export class AdminUserManagementD1Error extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "AdminUserManagementD1Error";
  }
}

function fail(code: string, status = 503): never {
  throw new AdminUserManagementD1Error(code, status);
}

function logAdminUserManagementStageFailure(stage: string, error: unknown, searchTerm?: string): void {
  let diagnostic = error instanceof AdminUserManagementD1Error ? error.code : "unexpected_error";
  let sanitizedMessage = "";
  if (!(error instanceof AdminUserManagementD1Error) && error instanceof Error) {
    let safeMessage = error.message;
    if (searchTerm) {
      const normalizedSearch = searchTerm.toLocaleLowerCase();
      safeMessage = safeMessage.replaceAll(searchTerm, "<search>").replaceAll(normalizedSearch, "<search>");
    }
    safeMessage = safeMessage
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, "<email>")
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu, "<uuid>")
      .replace(/\b\d{4,}\b/gu, "<number>")
      .replace(/\s+/gu, " ")
      .slice(0, 180);
    sanitizedMessage = safeMessage;
    const message = safeMessage.toLowerCase();
    const categories: Array<[string, RegExp]> = [
      ["sql_syntax_error", /syntax error|incomplete input/u],
      ["sql_no_such_column", /no such column/u],
      ["sql_no_such_table", /no such table/u],
      ["sql_bind_parameter_mismatch", /bind parameter|binding count|wrong number of arguments/u],
      ["sql_too_many_variables", /too many (?:sql )?variables/u],
      ["sql_escape_error", /escape expression|like.*escape/u],
      ["sql_database_locked", /database is locked/u],
      ["sql_constraint_error", /constraint failed/u],
    ];
    diagnostic = categories.find(([, pattern]) => pattern.test(message))?.[0] ?? `unexpected_${error.name.toLowerCase()}`;
  }
  console.error("admin_user_management_stage_failed", { stage, diagnostic, sanitizedMessage });
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
  headers.set("access-control-allow-methods", "POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return true;
}

function selectedDatabases(env: Env): { business: D1Database; auth: D1Database } {
  if (env.ADMIN_USER_MANAGEMENT_BACKEND?.trim() !== "d1" || env.D1_TOPOLOGY?.trim() !== "split") {
    fail("admin_user_management_unavailable", env.ADMIN_USER_MANAGEMENT_BACKEND ? 500 : 503);
  }
  const business = selectD1Database(env, "business");
  const auth = selectD1Database(env, "auth");
  if (!business || !auth) fail("admin_user_management_unavailable", 500);
  return { business, auth };
}

export function isAdminUserManagementPath(pathname: string): boolean {
  return pathname === API_PATH || pathname.startsWith(`${API_PATH}/`);
}

interface ListRequest {
  search: string | null;
  plans: string[] | null;
  status: "active" | "suspended" | null;
  page: number;
  pageSize: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    if (error instanceof AdminUserManagementD1Error) throw error;
    fail("invalid_request", 400);
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { fail("invalid_request", 400); }
}

function parseListRequest(value: unknown): ListRequest {
  if (!isRecord(value) || Object.keys(value).some((key) => !["search", "plans", "status", "page", "pageSize"].includes(key))) {
    fail("invalid_request", 400);
  }
  const search = value.search === undefined || value.search === null ? null : value.search;
  if (!(search === null || (typeof search === "string" && search.length <= 200))) fail("invalid_request", 400);
  const status = value.status === undefined || value.status === null ? null : value.status;
  if (!(status === null || status === "active" || status === "suspended")) fail("invalid_request", 400);
  const plans = value.plans === undefined || value.plans === null ? null : value.plans;
  if (!(plans === null || (Array.isArray(plans) && plans.length <= PLANS.size &&
      plans.every((plan) => typeof plan === "string" && PLANS.has(plan)) && new Set(plans).size === plans.length))) {
    fail("invalid_request", 400);
  }
  const page = value.page === undefined ? 1 : value.page;
  const pageSize = value.pageSize === undefined ? 20 : value.pageSize;
  if (!Number.isSafeInteger(page) || Number(page) < 1 || Number(page) > 1_000_000 ||
      !Number.isSafeInteger(pageSize) || Number(pageSize) < 1 || Number(pageSize) > MAX_PAGE_SIZE) {
    fail("invalid_request", 400);
  }
  return {
    search: typeof search === "string" && search.trim() ? search.trim() : null,
    plans: Array.isArray(plans) && plans.length ? plans as string[] : null,
    status: status as ListRequest["status"],
    page: Number(page),
    pageSize: Number(pageSize),
  };
}

interface UpdatePlanRequest {
  userId: string;
  newPlanType: string;
  reason: string | null;
  enterpriseOverrides: { customFanmarksLimit: number | null; customPricing: number | null; notes: string | null };
}

function parseNullableNonnegativeInteger(value: unknown): number | null {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail("invalid_request", 400);
  return parsed;
}

function parseUpdatePlanRequest(value: unknown, pathUserId: string): UpdatePlanRequest {
  if (!isRecord(value) || Object.keys(value).some((key) =>
    !["userId", "newPlanType", "reason", "enterpriseOverrides"].includes(key)) ||
      value.userId !== pathUserId || typeof value.newPlanType !== "string" || !PLANS.has(value.newPlanType)) {
    fail("invalid_request", 400);
  }
  const reason = value.reason === undefined || value.reason === null ? null : value.reason;
  if (!(reason === null || (typeof reason === "string" && reason.length <= 2000))) fail("invalid_request", 400);
  const overrides = value.enterpriseOverrides;
  if (overrides !== undefined && overrides !== null && (!isRecord(overrides) || Object.keys(overrides).some((key) =>
    !["customFanmarksLimit", "customPricing", "notes"].includes(key)))) {
    fail("invalid_request", 400);
  }
  const overrideValues = isRecord(overrides) ? overrides : {};
  const notes = overrideValues.notes === undefined || overrideValues.notes === null ? null : overrideValues.notes;
  if (!(notes === null || (typeof notes === "string" && notes.length <= 8192))) fail("invalid_request", 400);
  return {
    userId: pathUserId,
    newPlanType: value.newPlanType,
    reason,
    enterpriseOverrides: {
      customFanmarksLimit: parseNullableNonnegativeInteger(overrideValues.customFanmarksLimit),
      customPricing: parseNullableNonnegativeInteger(overrideValues.customPricing),
      notes,
    },
  };
}

async function readProfiles(
  business: D1Database,
  auth: D1Database,
  request: ListRequest,
): Promise<{ profiles: Array<Record<string, unknown>>; profileCount: number }> {
  let stage = "build_profile_filter";
  try {
    return await readProfilesCore(business, auth, request, (nextStage) => { stage = nextStage; });
  } catch (error) {
    logAdminUserManagementStageFailure(stage, error, request.search ?? undefined);
    throw error;
  }
}

async function readProfilesCore(
  business: D1Database,
  auth: D1Database,
  request: ListRequest,
  setStage: (stage: string) => void,
): Promise<{ profiles: Array<Record<string, unknown>>; profileCount: number }> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (request.plans) {
    clauses.push(`plan_type IN (${request.plans.map(() => "?").join(",")})`);
    values.push(...request.plans);
  }
  if (request.search) {
    clauses.push(`(instr(lower(COALESCE(display_name, '')), ?) > 0 OR instr(lower(username), ?) > 0)`);
    const normalizedSearch = request.search.toLocaleLowerCase();
    values.push(normalizedSearch, normalizedSearch);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  setStage("count_profile_rows");
  const count = await business.prepare(`SELECT COUNT(*) AS count FROM user_settings ${where}`)
    .bind(...values).first<{ count?: unknown }>();
  if (typeof count?.count !== "number" || !Number.isSafeInteger(count.count) || count.count < 0) fail("admin_user_management_unavailable");
  if (count.count > MAX_FETCH) fail("admin_user_dataset_too_large", 413);
  setStage("read_profile_rows");
  const result = await business.prepare(`
    SELECT user_id, username, display_name, plan_type, preferred_language, updated_at, created_at
    FROM user_settings ${where} ORDER BY created_at DESC, user_id ASC LIMIT ?
  `).bind(...values, MAX_FETCH + 1).all<Record<string, unknown>>();
  if (!result.success || !Array.isArray(result.results) || result.results.length > MAX_FETCH) fail("admin_user_management_unavailable");
  const profilesById = new Map(result.results.map((row) => [String(row.user_id), row]));

  if (request.search) {
    setStage("search_auth_emails");
    let emailMatches;
    try {
      emailMatches = await auth.prepare(`
        SELECT id FROM "user" WHERE instr(lower(email), ?) > 0 ORDER BY id ASC LIMIT ?
      `).bind(request.search.toLocaleLowerCase(), MAX_FETCH + 1).all<{ id?: unknown }>();
    } catch (error) {
      throw error;
    }
    if (!emailMatches.success || !Array.isArray(emailMatches.results) || emailMatches.results.length > MAX_FETCH) {
      fail("admin_user_dataset_too_large", 413);
    }
    const emailUserIds = emailMatches.results.map((row) => {
      if (typeof row.id !== "string" || row.id.length < 1 || row.id.length > 128) {
        fail("admin_user_management_unavailable");
      }
      return row.id;
    }).filter((id) => !profilesById.has(id));
    const planSql = request.plans ? ` AND plan_type IN (${request.plans.map(() => "?").join(",")})` : "";
    setStage("lookup_email_profiles");
    for (let index = 0; index < emailUserIds.length; index += 100) {
      const chunk = emailUserIds.slice(index, index + 100);
      let byEmail;
      try {
        byEmail = await business.prepare(`SELECT user_id, username, display_name, plan_type, preferred_language, updated_at, created_at
          FROM user_settings WHERE user_id IN (${chunk.map(() => "?").join(",")})${planSql}`)
          .bind(...chunk, ...(request.plans ?? [])).all<Record<string, unknown>>();
      } catch (error) {
        throw error;
      }
      if (!byEmail.success || !Array.isArray(byEmail.results)) {
        fail("admin_user_management_unavailable");
      }
      for (const row of byEmail.results) profilesById.set(String(row.user_id), row);
    }
  }

  setStage("sort_profile_rows");
  if (profilesById.size > MAX_FETCH) fail("admin_user_dataset_too_large", 413);
  const profiles = [...profilesById.values()].sort((left, right) => {
    const byCreatedAt = String(right.created_at).localeCompare(String(left.created_at));
    return byCreatedAt || String(left.user_id).localeCompare(String(right.user_id));
  });
  return { profiles, profileCount: count.count };
}

async function rowsByUserIds<T extends Record<string, unknown>>(
  db: D1Database,
  sqlForPlaceholders: (placeholders: string) => string,
  ids: string[],
): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100);
    const result = await db.prepare(sqlForPlaceholders(chunk.map(() => "?").join(",")))
      .bind(...chunk).all<T>();
    if (!result.success || !Array.isArray(result.results)) fail("admin_user_management_unavailable");
    rows.push(...result.results);
  }
  return rows;
}

interface AuthUserRow extends Record<string, unknown> {
  id: string;
  name: string;
  email: string;
  emailVerified: number;
  createdAt: string;
  updatedAt: string;
}

interface ListedUser {
  userId: string;
  email: string | null;
  emailConfirmedAt: string | null;
  emailVerified: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  status: "active" | "suspended";
  bannedUntil: string | null;
  displayName: string | null;
  username: string;
  planType: string;
  preferredLanguage: string;
  profileUpdatedAt: string;
  licenseCounts: { active: number; grace: number; expired: number };
  enterpriseSettings: { custom_fanmarks_limit: number | null; custom_pricing: number | null; notes: string | null } | null;
}

function validNullableText(value: unknown, max = 4096): value is string | null {
  return value === null || (typeof value === "string" && value.length <= max);
}

function validateProfile(row: Record<string, unknown>): void {
  if (typeof row.user_id !== "string" || row.user_id.length < 1 || row.user_id.length > 128 ||
      typeof row.username !== "string" || row.username.length > 128 ||
      !validNullableText(row.display_name, 256) || typeof row.plan_type !== "string" || !PLANS.has(row.plan_type) ||
      typeof row.preferred_language !== "string" || !LANGUAGES.has(row.preferred_language) ||
      typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at)) ||
      typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) {
    fail("admin_user_management_unavailable");
  }
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

async function readAuthUsers(db: D1Database, ids: string[]): Promise<AuthUserRow[]> {
  return rowsByUserIds<AuthUserRow>(db, (placeholders) => `
    SELECT id, name, email, emailVerified, createdAt, updatedAt
    FROM "user" WHERE id IN (${placeholders})
  `, ids);
}

async function readLastSignIns(db: D1Database, ids: string[]): Promise<Map<string, string>> {
  const rows = await rowsByUserIds<Record<string, unknown>>(db, (placeholders) => `
    SELECT userId AS user_id, MAX(createdAt) AS last_sign_in_at
    FROM "session" WHERE userId IN (${placeholders}) GROUP BY userId
  `, ids);
  const result = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.user_id !== "string" || !validTimestamp(row.last_sign_in_at)) fail("admin_user_management_unavailable");
    result.set(row.user_id, row.last_sign_in_at);
  }
  return result;
}

async function readLicenseCounts(db: D1Database, ids: string[]): Promise<Map<string, { active: number; grace: number; expired: number }>> {
  const rows = await rowsByUserIds<Record<string, unknown>>(db, (placeholders) => `
    SELECT user_id, status, COUNT(*) AS count FROM fanmark_licenses
    WHERE user_id IN (${placeholders}) GROUP BY user_id, status
  `, ids);
  const result = new Map<string, { active: number; grace: number; expired: number }>();
  for (const row of rows) {
    if (typeof row.user_id !== "string" || typeof row.status !== "string" ||
        typeof row.count !== "number" || !Number.isSafeInteger(row.count) || row.count < 0) fail("admin_user_management_unavailable");
    const current = result.get(row.user_id) ?? { active: 0, grace: 0, expired: 0 };
    if (row.status === "active" || row.status === "grace" || row.status === "expired") current[row.status] = row.count;
    result.set(row.user_id, current);
  }
  return result;
}

async function readEnterpriseSettings(db: D1Database, ids: string[]): Promise<Map<string, ListedUser["enterpriseSettings"]>> {
  const rows = await rowsByUserIds<Record<string, unknown>>(db, (placeholders) => `
    SELECT user_id, custom_fanmarks_limit, custom_pricing, notes
    FROM enterprise_user_settings WHERE user_id IN (${placeholders})
  `, ids);
  const result = new Map<string, ListedUser["enterpriseSettings"]>();
  for (const row of rows) {
    if (typeof row.user_id !== "string" ||
        !(row.custom_fanmarks_limit === null || (typeof row.custom_fanmarks_limit === "number" && Number.isSafeInteger(row.custom_fanmarks_limit))) ||
        !(row.custom_pricing === null || (typeof row.custom_pricing === "number" && Number.isSafeInteger(row.custom_pricing))) ||
        !validNullableText(row.notes, 8192)) fail("admin_user_management_unavailable");
    result.set(row.user_id, {
      custom_fanmarks_limit: row.custom_fanmarks_limit as number | null,
      custom_pricing: row.custom_pricing as number | null,
      notes: row.notes as string | null,
    });
  }
  return result;
}

async function logAdminRead(db: D1Database, adminId: string, action: string, resourceId: string | null, metadata: object, now: Date): Promise<void> {
  try {
    const id = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata, created_at)
      VALUES (?, ?, ?, 'user', ?, ?, ?)
    `).bind(id, adminId, action, resourceId, JSON.stringify(metadata), now.toISOString()).run();
  } catch {
    // Listing remains available if its best-effort audit insert is unavailable;
    // the read itself never mutates a user or entitlement.
  }
}

function profilesToListedUsers(
  profiles: Array<Record<string, unknown>>,
  authUsers: AuthUserRow[],
  licenseCounts: Map<string, ListedUser["licenseCounts"]>,
  enterprise: Map<string, ListedUser["enterpriseSettings"]>,
  lastSignIns: Map<string, string>,
  request: ListRequest,
): ListedUser[] {
  const authById = new Map(authUsers.map((user) => [user.id, user]));
  return profiles.flatMap((profile) => {
    validateProfile(profile);
    const authUser = authById.get(profile.user_id as string);
    if (!authUser) return [];
    if (request.status === "suspended") return [];
    const search = request.search?.toLocaleLowerCase();
    if (search && !(authUser.email ?? "").toLocaleLowerCase().includes(search) &&
        !(String(profile.display_name ?? "")).toLocaleLowerCase().includes(search) &&
        !String(profile.username).toLocaleLowerCase().includes(search)) return [];
    if (typeof authUser.id !== "string" || authUser.id !== profile.user_id ||
        !validNullableText(authUser.email, 320) || !validNullableText(authUser.name, 256) ||
        (authUser.emailVerified !== 0 && authUser.emailVerified !== 1) ||
        !validTimestamp(authUser.createdAt) || !validTimestamp(authUser.updatedAt)) fail("admin_user_management_unavailable");
    return [{
      userId: authUser.id,
      email: authUser.email,
      emailConfirmedAt: null,
      emailVerified: authUser.emailVerified === 1,
      createdAt: authUser.createdAt,
      lastSignInAt: lastSignIns.get(authUser.id) ?? null,
      status: "active" as const,
      bannedUntil: null,
      displayName: profile.display_name as string | null,
      username: profile.username as string,
      planType: profile.plan_type as string,
      preferredLanguage: profile.preferred_language as string,
      profileUpdatedAt: profile.updated_at as string,
      licenseCounts: licenseCounts.get(authUser.id) ?? { active: 0, grace: 0, expired: 0 },
      enterpriseSettings: enterprise.get(authUser.id) ?? null,
    }];
  });
}

async function listUsers(
  request: Request,
  business: D1Database,
  auth: D1Database,
  authorization: { userId: string; sessionId: string },
  now: Date,
  headers: Headers,
): Promise<Response> {
  const input = parseListRequest(await readBody(request));
  const { profiles, profileCount } = await readProfiles(business, auth, input);
  const ids = profiles.map((row) => {
    validateProfile(row);
    return row.user_id as string;
  });
  const [authUsers, licenseCounts, enterprise, lastSignIns] = await Promise.all([
    readAuthUsers(auth, ids),
    readLicenseCounts(business, ids),
    readEnterpriseSettings(business, ids),
    readLastSignIns(auth, ids),
  ]);
  let assembled: ListedUser[];
  try {
    assembled = profilesToListedUsers(profiles, authUsers, licenseCounts, enterprise, lastSignIns, input);
  } catch (error) {
    logAdminUserManagementStageFailure("assemble_user_list", error);
    throw error;
  }
  const totalFiltered = assembled.length;
  const start = (input.page - 1) * input.pageSize;
  const pagedUsers = assembled.slice(start, start + input.pageSize);
  await logAdminRead(business, authorization.userId, "ADMIN_LIST_USERS", null, {
    page: input.page,
    pageSize: input.pageSize,
    returned: pagedUsers.length,
    totalFiltered,
    totalMatchedBeforeStatus: profileCount,
  }, now);
  return json({
    data: pagedUsers,
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      totalCount: totalFiltered,
      totalPages: Math.ceil(totalFiltered / input.pageSize),
    },
    filters: { search: input.search, plans: input.plans, status: input.status },
    meta: { totalMatchedBeforeStatus: profileCount },
  }, 200, headers);
}

async function updateUserPlan(
  input: UpdatePlanRequest,
  business: D1Database,
  auth: D1Database,
  authorization: { userId: string; sessionId: string },
  now: Date,
  headers: Headers,
): Promise<Response> {
  const [profile, authUser] = await Promise.all([
    business.prepare("SELECT plan_type FROM user_settings WHERE user_id = ?").bind(input.userId)
      .first<{ plan_type?: unknown }>(),
    auth.prepare('SELECT id FROM "user" WHERE id = ?').bind(input.userId).first<{ id?: unknown }>(),
  ]);
  if (!profile || !authUser || authUser.id !== input.userId) fail("user_not_found", 404);
  if (typeof profile.plan_type !== "string" || !PLANS.has(profile.plan_type)) fail("admin_user_management_unavailable");

  const previousPlanType = profile.plan_type;
  const updatedAt = now.toISOString();
  const id = crypto.randomUUID();
  const enterprise = input.newPlanType === "enterprise" ? input.enterpriseOverrides : null;
  const metadata = JSON.stringify({
    previousPlan: previousPlanType,
    newPlan: input.newPlanType,
    reason: input.reason,
    enterpriseOverrides: enterprise,
  });
  const statements = [
    business.prepare(`UPDATE user_settings SET plan_type = ?, updated_at = ?
      WHERE user_id = ? AND plan_type = ?`).bind(input.newPlanType, updatedAt, input.userId, previousPlanType),
    business.prepare(`INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata, created_at)
      SELECT ?, ?, 'ADMIN_UPDATE_PLAN', 'user', ?, ?, ? WHERE changes() = 1`)
      .bind(id, authorization.userId, input.userId, metadata, updatedAt),
    enterprise
      ? business.prepare(`INSERT INTO enterprise_user_settings
          (user_id, custom_fanmarks_limit, custom_pricing, notes, created_at, updated_at, created_by)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1
        ON CONFLICT(user_id) DO UPDATE SET
          custom_fanmarks_limit = excluded.custom_fanmarks_limit,
          custom_pricing = excluded.custom_pricing,
          notes = excluded.notes,
          updated_at = excluded.updated_at,
          created_by = excluded.created_by`)
        .bind(input.userId, enterprise.customFanmarksLimit, enterprise.customPricing, enterprise.notes, updatedAt,
          updatedAt, authorization.userId)
      : business.prepare("DELETE FROM enterprise_user_settings WHERE user_id = ? AND changes() = 1")
        .bind(input.userId),
  ];
  const results = await business.batch(statements);
  if (results.length !== statements.length || results.some((result) => !result.success)) fail("admin_user_management_unavailable");
  if (results[0]?.meta.changes !== 1) fail("user_plan_conflict", 409);
  return json({
    success: true,
    previousPlanType,
    newPlanType: input.newPlanType,
    enterpriseSettings: enterprise,
    updatedAt,
  }, 200, headers);
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value !== "string" || value.length > 16 * 1024) fail("admin_user_management_unavailable");
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; } catch { fail("admin_user_management_unavailable"); }
  if (!isRecord(parsed)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(parsed)) {
    if (/password|credential|secret|token|authorization|email|phone|address|cookie|session/iu.test(key)) continue;
    if (typeof item === "string" && item.length <= 4096) output[key] = item;
    else if (typeof item === "number" || typeof item === "boolean" || item === null) output[key] = item;
    else if (Array.isArray(item) && item.length <= 100 && item.every((entry) => entry === null || ["string", "number", "boolean"].includes(typeof entry))) output[key] = item;
    else if (isRecord(item) && Object.keys(item).length <= 100) output[key] = safeMetadata(JSON.stringify(item));
  }
  return output;
}

async function getUserDetail(
  userId: string,
  business: D1Database,
  auth: D1Database,
  authorization: { userId: string; sessionId: string },
  now: Date,
  headers: Headers,
): Promise<Response> {
  const [authUser, profile] = await Promise.all([
    auth.prepare(`SELECT id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled
      FROM "user" WHERE id = ? LIMIT 1`).bind(userId).first<Record<string, unknown>>(),
    business.prepare(`SELECT user_id, username, display_name, avatar_url, plan_type, preferred_language, created_at, updated_at
      FROM user_settings WHERE user_id = ? LIMIT 1`).bind(userId).first<Record<string, unknown>>(),
  ]);
  if (!authUser || !profile) return json({ error: "user_not_found" }, 404, headers);
  validateProfile({ ...profile, user_id: profile.user_id, plan_type: profile.plan_type });
  if (authUser.id !== userId || !validNullableText(authUser.email, 320) || !validNullableText(authUser.name, 256) ||
      (authUser.emailVerified !== 0 && authUser.emailVerified !== 1) || !validTimestamp(authUser.createdAt) ||
      !validTimestamp(authUser.updatedAt) || (authUser.twoFactorEnabled !== 0 && authUser.twoFactorEnabled !== 1)) {
    fail("admin_user_management_unavailable");
  }
  const [lastSignIns, factorsResult, enterprise, summaryRows, fanmarkRows, auditRows] = await Promise.all([
    readLastSignIns(auth, [userId]),
    auth.prepare(`SELECT "verified" FROM "twoFactor" WHERE "userId" = ? LIMIT 3`).bind(userId).all<Record<string, unknown>>(),
    business.prepare(`SELECT custom_fanmarks_limit, custom_pricing, notes, updated_at
      FROM enterprise_user_settings WHERE user_id = ? LIMIT 1`).bind(userId).first<Record<string, unknown>>(),
    business.prepare(`SELECT status, COUNT(*) AS count FROM fanmark_licenses WHERE user_id = ? GROUP BY status`).bind(userId).all<Record<string, unknown>>(),
    business.prepare(`SELECT l.id AS license_id, l.status, l.license_end, l.grace_expires_at, l.plan_excluded,
        l.excluded_at, l.excluded_from_plan, l.fanmark_id, COALESCE(l.display_fanmark, f.user_input_fanmark, '') AS emoji,
        c.fanmark_name, c.access_type
      FROM fanmark_licenses l
      JOIN fanmarks f ON f.id = l.fanmark_id
      LEFT JOIN fanmark_basic_configs c ON c.license_id = l.id
      WHERE l.user_id = ? ORDER BY l.updated_at DESC, l.id ASC LIMIT 25`).bind(userId).all<Record<string, unknown>>(),
    business.prepare(`SELECT id, user_id, action, resource_type, resource_id, metadata, created_at
      FROM audit_logs WHERE user_id = ? OR resource_id = ?
      ORDER BY created_at DESC, id ASC LIMIT 20`).bind(userId, userId).all<Record<string, unknown>>(),
  ]);
  if (!factorsResult.success || !Array.isArray(factorsResult.results) || factorsResult.results.length > 2 ||
      !summaryRows.success || !Array.isArray(summaryRows.results) ||
      !fanmarkRows.success || !Array.isArray(fanmarkRows.results) || fanmarkRows.results.length > 25 ||
      !auditRows.success || !Array.isArray(auditRows.results) || auditRows.results.length > 20) fail("admin_user_management_unavailable");

  const licenseSummary = { active: 0, grace: 0, expired: 0, total: 0 };
  for (const row of summaryRows.results) {
    if (typeof row.status !== "string" || typeof row.count !== "number" || !Number.isSafeInteger(row.count) || row.count < 0) fail("admin_user_management_unavailable");
    licenseSummary.total += row.count;
    if (row.status === "active" || row.status === "grace" || row.status === "expired") licenseSummary[row.status] = row.count;
  }
  const recentFanmarks = fanmarkRows.results.map((row) => {
    if (typeof row.license_id !== "string" || !UUID.test(row.license_id) || typeof row.fanmark_id !== "string" || !UUID.test(row.fanmark_id) ||
        typeof row.status !== "string" || !validNullableText(row.license_end, 64) || !validNullableText(row.grace_expires_at, 64) ||
        (row.plan_excluded !== 0 && row.plan_excluded !== 1 && row.plan_excluded !== null) || !validNullableText(row.excluded_at, 64) ||
        !validNullableText(row.excluded_from_plan, 64) || typeof row.emoji !== "string" || row.emoji.length > 256 ||
        !validNullableText(row.fanmark_name, 256) || !validNullableText(row.access_type, 128)) fail("admin_user_management_unavailable");
    return {
      licenseId: row.license_id,
      status: row.status,
      licenseEnd: row.license_end,
      graceExpiresAt: row.grace_expires_at,
      planExcluded: row.plan_excluded === 1,
      excludedAt: row.excluded_at,
      excludedFromPlan: row.excluded_from_plan,
      fanmarkId: row.fanmark_id,
      emoji: row.emoji,
      fanmarkName: row.fanmark_name,
      accessType: row.access_type,
    };
  });
  const recentAuditLogs = auditRows.results.map((row) => {
    if (typeof row.id !== "string" || !UUID.test(row.id) || !(row.user_id === null || typeof row.user_id === "string") ||
        typeof row.action !== "string" || row.action.length > 256 || typeof row.resource_type !== "string" || row.resource_type.length > 128 ||
        !validNullableText(row.resource_id, 128) || !validTimestamp(row.created_at)) fail("admin_user_management_unavailable");
    return {
      id: row.id,
      userId: row.user_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      metadata: safeMetadata(row.metadata),
      createdAt: row.created_at,
    };
  });
  let enterpriseSettings: Record<string, unknown> | null = null;
  if (enterprise) {
    if (!(enterprise.custom_fanmarks_limit === null || (typeof enterprise.custom_fanmarks_limit === "number" && Number.isSafeInteger(enterprise.custom_fanmarks_limit))) ||
        !(enterprise.custom_pricing === null || (typeof enterprise.custom_pricing === "number" && Number.isSafeInteger(enterprise.custom_pricing))) ||
        !validNullableText(enterprise.notes, 8192) || !validTimestamp(enterprise.updated_at)) fail("admin_user_management_unavailable");
    enterpriseSettings = {
      customFanmarksLimit: enterprise.custom_fanmarks_limit,
      customPricing: enterprise.custom_pricing,
      notes: enterprise.notes,
      updatedAt: enterprise.updated_at,
    };
  }
  const factors = factorsResult.results.filter((row) => row.verified === 1).map(() => ({ type: "totp", createdAt: null }));
  await logAdminRead(business, authorization.userId, "ADMIN_VIEW_USER_DETAIL", userId, { requestedUserId: userId }, now);
  return json({
    auth: {
      email: authUser.email,
      emailConfirmedAt: null,
      emailVerified: authUser.emailVerified === 1,
      createdAt: authUser.createdAt,
      lastSignInAt: lastSignIns.get(userId) ?? null,
      phone: null,
      status: "active",
      bannedUntil: null,
      factors,
    },
    profile: {
      userId: profile.user_id,
      username: profile.username,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
      planType: profile.plan_type,
      preferredLanguage: profile.preferred_language,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    },
    enterpriseSettings,
    licenseSummary,
    recentFanmarks,
    recentAuditLogs,
  }, 200, headers);
}

export async function handleAdminUserManagementRequest(
  request: Request,
  env: Env,
  authorizeAdmin: AdminUserManagementAuthorizer,
  dependencies: { now?: () => Date } = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isAdminUserManagementPath(url.pathname)) return null;
  if (url.search || url.hash) return json({ error: "not_found" }, 404);
  const headers = new Headers();
  if (!cors(request, env, headers)) return json({ error: "forbidden_origin" }, 403);
  const planMatch = /^\/api\/admin\/users\/([^/]+)\/plan$/u.exec(url.pathname);
  const detailMatch = /^\/api\/admin\/users\/([^/]+)$/u.exec(url.pathname);
  const userId = planMatch?.[1] ?? detailMatch?.[1] ?? null;
  if (url.pathname !== API_PATH && userId === null) return json({ error: "not_found" }, 404, headers);
  if (userId !== null && (!userId || userId.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(userId))) return json({ error: "not_found" }, 404, headers);
  if (request.method === "OPTIONS") { headers.set("allow", "POST, OPTIONS"); return new Response(null, { status: 204, headers }); }
  if (request.method !== "POST") { headers.set("allow", "POST, OPTIONS"); return json({ error: "method_not_allowed" }, 405, headers); }
  if (env.AUTH_BACKEND?.trim() !== "better-auth") return json({ error: "auth_unavailable" }, 503, headers);
  const authorization = await authorizeAdmin(request, headers);
  if (authorization instanceof Response) return authorization;

  try {
    const { business, auth } = selectedDatabases(env);
    if (planMatch && userId !== null) {
      const body = await readBody(request);
      return await updateUserPlan(
        parseUpdatePlanRequest(body, userId), business, auth, authorization, dependencies.now?.() ?? new Date(), headers,
      );
    }
    if (userId !== null) {
      const body = await readBody(request);
      if (!isRecord(body) || Object.keys(body).length !== 1 || body.userId !== userId) fail("invalid_request", 400);
      return await getUserDetail(userId, business, auth, authorization, dependencies.now?.() ?? new Date(), headers);
    }
    return await listUsers(request, business, auth, authorization, dependencies.now?.() ?? new Date(), headers);
  } catch (error) {
    if (error instanceof AdminUserManagementD1Error) return json({ error: error.code }, error.status, headers);
    return json({ error: "admin_user_management_unavailable" }, 503, headers);
  }
}
