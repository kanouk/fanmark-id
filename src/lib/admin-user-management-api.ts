import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from "./recent-fanmarks.ts";

const API_PATH = "/api/admin/users";
const MAX_RESPONSE_BYTES = 512 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PLANS = new Set(["free", "creator", "max", "business", "enterprise", "admin"]);
const LANGUAGES = new Set(["en", "ja", "ko", "id"]);

export interface AdminListedUser {
  userId: string;
  email: string | null;
  emailConfirmedAt: string | null;
  emailVerified?: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  status: "active" | "suspended";
  bannedUntil: string | null;
  displayName: string | null;
  username: string;
  planType: "free" | "creator" | "max" | "business" | "enterprise" | "admin";
  preferredLanguage: string;
  profileUpdatedAt: string;
  licenseCounts: { active: number; grace: number; expired: number };
  enterpriseSettings: { custom_fanmarks_limit: number | null; custom_pricing: number | null; notes: string | null } | null;
}

export interface AdminListedUsersResponse {
  data: AdminListedUser[];
  pagination: { page: number; pageSize: number; totalCount: number; totalPages: number };
  filters: { search: string | null; plans: string[] | null; status: "active" | "suspended" | null };
  meta: { totalMatchedBeforeStatus: number | null };
}

export interface AdminUserDetailResponse {
  auth: {
    email: string | null;
    emailConfirmedAt: string | null;
    emailVerified?: boolean;
    createdAt: string | null;
    lastSignInAt: string | null;
    phone: string | null;
    status: "active" | "suspended";
    bannedUntil: string | null;
    factors: { type: string; createdAt: string | null }[];
  };
  profile: {
    userId: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    planType: AdminListedUser["planType"];
    preferredLanguage: string;
    createdAt: string;
    updatedAt: string;
  };
  enterpriseSettings: { customFanmarksLimit: number | null; customPricing: number | null; notes: string | null; updatedAt: string | null } | null;
  licenseSummary: { active: number; grace: number; expired: number; total: number };
  recentFanmarks: Array<{
    licenseId: string;
    status: string;
    licenseEnd: string | null;
    graceExpiresAt: string | null;
    planExcluded: boolean;
    excludedAt: string | null;
    excludedFromPlan: string | null;
    fanmarkId: string;
    emoji: string;
    fanmarkName: string | null;
    accessType: string | null;
  }>;
  recentAuditLogs: Array<{
    id: string;
    userId: string | null;
    action: string;
    resourceType: string;
    resourceId: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
}

export interface AdminPlanUpdateResult {
  success: true;
  previousPlanType: AdminListedUser["planType"];
  newPlanType: AdminListedUser["planType"];
  enterpriseSettings: { customFanmarksLimit: number | null; customPricing: number | null; notes: string | null } | null;
  updatedAt: string;
}

export interface AdminUserStatusUpdateResult {
  success: true;
  updated: boolean;
  userId: string;
  status: "active" | "suspended";
  bannedUntil: string | null;
  updatedAt: string;
}

export interface AdminLicenseExpireResult {
  success: true;
  licenseId: string;
  alreadyExpired: boolean;
  updatedAt: string;
}

export interface AdminPasswordResetResult {
  success: true;
  userId: string;
  requestedAt: string;
}

export class AdminUserManagementApiError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network" | "timeout";
  readonly status?: number;

  constructor(kind: AdminUserManagementApiError["kind"], status?: number) {
    super(kind === "http" && status ? `admin user management request failed (${status})` : `admin user management request ${kind}`);
    this.name = "AdminUserManagementApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getAdminUserManagementBackend(
  value: string | undefined = import.meta.env?.VITE_ADMIN_USER_MANAGEMENT_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new AdminUserManagementApiError("configuration");
}

interface RequestOptions {
  baseUrl?: string;
  authBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function nullableText(value: unknown, max = 4096): value is string | null {
  return value === null || (typeof value === "string" && value.length <= max);
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseListedUser(value: unknown): AdminListedUser {
  const keys = ["userId", "email", "emailConfirmedAt", "emailVerified", "createdAt", "lastSignInAt", "status", "bannedUntil", "displayName", "username", "planType", "preferredLanguage", "profileUpdatedAt", "licenseCounts", "enterpriseSettings"];
  if (!isRecord(value) || !exactKeys(value, keys) || typeof value.userId !== "string" || value.userId.length > 128 ||
      !nullableText(value.email, 320) || !nullableText(value.emailConfirmedAt, 64) ||
      !(value.emailConfirmedAt === null || validTime(value.emailConfirmedAt)) || typeof value.emailVerified !== "boolean" ||
      !nullableText(value.createdAt, 64) || !(value.createdAt === null || validTime(value.createdAt)) ||
      !nullableText(value.lastSignInAt, 64) || !(value.lastSignInAt === null || validTime(value.lastSignInAt)) ||
      (value.status !== "active" && value.status !== "suspended") || !nullableText(value.bannedUntil, 64) ||
      !(value.bannedUntil === null || validTime(value.bannedUntil)) || !nullableText(value.displayName, 256) ||
      typeof value.username !== "string" || value.username.length > 128 || typeof value.planType !== "string" || !PLANS.has(value.planType) ||
      typeof value.preferredLanguage !== "string" || !LANGUAGES.has(value.preferredLanguage) || !validTime(value.profileUpdatedAt) ||
      !isRecord(value.licenseCounts) || !exactKeys(value.licenseCounts, ["active", "grace", "expired"]) ||
      !nonnegativeInteger(value.licenseCounts.active) || !nonnegativeInteger(value.licenseCounts.grace) || !nonnegativeInteger(value.licenseCounts.expired)) {
    throw new AdminUserManagementApiError("invalid_response");
  }
  if (value.enterpriseSettings !== null && (!isRecord(value.enterpriseSettings) ||
      !exactKeys(value.enterpriseSettings, ["custom_fanmarks_limit", "custom_pricing", "notes"]) ||
      !(value.enterpriseSettings.custom_fanmarks_limit === null || Number.isSafeInteger(value.enterpriseSettings.custom_fanmarks_limit)) ||
      !(value.enterpriseSettings.custom_pricing === null || Number.isSafeInteger(value.enterpriseSettings.custom_pricing)) ||
      !nullableText(value.enterpriseSettings.notes, 8192))) throw new AdminUserManagementApiError("invalid_response");
  return value as unknown as AdminListedUser;
}

function parseList(value: unknown): AdminListedUsersResponse {
  if (!isRecord(value) || !exactKeys(value, ["data", "pagination", "filters", "meta"]) || !Array.isArray(value.data) ||
      !isRecord(value.pagination) || !exactKeys(value.pagination, ["page", "pageSize", "totalCount", "totalPages"]) ||
      !isRecord(value.filters) || !exactKeys(value.filters, ["search", "plans", "status"]) ||
      !isRecord(value.meta) || !exactKeys(value.meta, ["totalMatchedBeforeStatus"])) throw new AdminUserManagementApiError("invalid_response");
  const { page, pageSize, totalCount, totalPages } = value.pagination;
  if (![page, pageSize, totalCount, totalPages].every(Number.isSafeInteger) || Number(page) < 1 || Number(pageSize) < 1 ||
      Number(totalCount) < 0 || Number(totalPages) < 0 || value.data.length > Number(pageSize) ||
      !(value.filters.search === null || (typeof value.filters.search === "string" && value.filters.search.length <= 200)) ||
      !(value.filters.plans === null || (Array.isArray(value.filters.plans) && value.filters.plans.every((plan) => typeof plan === "string" && PLANS.has(plan)))) ||
      !(value.filters.status === null || value.filters.status === "active" || value.filters.status === "suspended") ||
      !(value.meta.totalMatchedBeforeStatus === null || nonnegativeInteger(value.meta.totalMatchedBeforeStatus))) {
    throw new AdminUserManagementApiError("invalid_response");
  }
  return {
    data: value.data.map(parseListedUser),
    pagination: value.pagination as unknown as AdminListedUsersResponse["pagination"],
    filters: value.filters as unknown as AdminListedUsersResponse["filters"],
    meta: value.meta as unknown as AdminListedUsersResponse["meta"],
  };
}

function parseDetail(value: unknown): AdminUserDetailResponse {
  if (!isRecord(value) || !exactKeys(value, ["auth", "profile", "enterpriseSettings", "licenseSummary", "recentFanmarks", "recentAuditLogs"]) ||
      !isRecord(value.auth) || !isRecord(value.profile) || !isRecord(value.licenseSummary) ||
      !Array.isArray(value.recentFanmarks) || value.recentFanmarks.length > 25 ||
      !Array.isArray(value.recentAuditLogs) || value.recentAuditLogs.length > 20) throw new AdminUserManagementApiError("invalid_response");
  const auth = value.auth;
  const profile = value.profile;
  if (!nullableText(auth.email, 320) || !nullableText(auth.emailConfirmedAt, 64) ||
      !(auth.emailConfirmedAt === null || validTime(auth.emailConfirmedAt)) || typeof auth.emailVerified !== "boolean" ||
      !nullableText(auth.createdAt, 64) || !(auth.createdAt === null || validTime(auth.createdAt)) ||
      !nullableText(auth.lastSignInAt, 64) || !(auth.lastSignInAt === null || validTime(auth.lastSignInAt)) ||
      !nullableText(auth.phone, 128) || (auth.status !== "active" && auth.status !== "suspended") ||
      !nullableText(auth.bannedUntil, 64) || !(auth.bannedUntil === null || validTime(auth.bannedUntil)) || !Array.isArray(auth.factors) ||
      typeof profile.userId !== "string" || profile.userId.length > 128 || typeof profile.username !== "string" ||
      !nullableText(profile.displayName, 256) || !nullableText(profile.avatarUrl, 4096) || typeof profile.planType !== "string" || !PLANS.has(profile.planType) ||
      typeof profile.preferredLanguage !== "string" || !LANGUAGES.has(profile.preferredLanguage) || !validTime(profile.createdAt) || !validTime(profile.updatedAt) ||
      !["active", "grace", "expired", "total"].every((key) => nonnegativeInteger(value.licenseSummary[key]))) {
    throw new AdminUserManagementApiError("invalid_response");
  }
  if (value.enterpriseSettings !== null && (!isRecord(value.enterpriseSettings) ||
      !exactKeys(value.enterpriseSettings, ["customFanmarksLimit", "customPricing", "notes", "updatedAt"]) ||
      !(value.enterpriseSettings.customFanmarksLimit === null || Number.isSafeInteger(value.enterpriseSettings.customFanmarksLimit)) ||
      !(value.enterpriseSettings.customPricing === null || Number.isSafeInteger(value.enterpriseSettings.customPricing)) ||
      !nullableText(value.enterpriseSettings.notes, 8192) ||
      !(value.enterpriseSettings.updatedAt === null || validTime(value.enterpriseSettings.updatedAt)))) throw new AdminUserManagementApiError("invalid_response");
  for (const factor of auth.factors) {
    if (!isRecord(factor) || !exactKeys(factor, ["type", "createdAt"]) || typeof factor.type !== "string" ||
        !(factor.createdAt === null || validTime(factor.createdAt))) throw new AdminUserManagementApiError("invalid_response");
  }
  for (const fanmark of value.recentFanmarks) {
    if (!isRecord(fanmark) || !exactKeys(fanmark, ["licenseId", "status", "licenseEnd", "graceExpiresAt", "planExcluded", "excludedAt", "excludedFromPlan", "fanmarkId", "emoji", "fanmarkName", "accessType"]) ||
        typeof fanmark.licenseId !== "string" || !UUID.test(fanmark.licenseId) || typeof fanmark.fanmarkId !== "string" || !UUID.test(fanmark.fanmarkId) ||
        typeof fanmark.status !== "string" || !(fanmark.licenseEnd === null || validTime(fanmark.licenseEnd)) ||
        !(fanmark.graceExpiresAt === null || validTime(fanmark.graceExpiresAt)) || typeof fanmark.planExcluded !== "boolean" ||
        !(fanmark.excludedAt === null || validTime(fanmark.excludedAt)) || !nullableText(fanmark.excludedFromPlan, 64) ||
        typeof fanmark.emoji !== "string" || !nullableText(fanmark.fanmarkName, 256) || !nullableText(fanmark.accessType, 128)) {
      throw new AdminUserManagementApiError("invalid_response");
    }
  }
  for (const log of value.recentAuditLogs) {
    if (!isRecord(log) || !exactKeys(log, ["id", "userId", "action", "resourceType", "resourceId", "metadata", "createdAt"]) ||
        typeof log.id !== "string" || !UUID.test(log.id) || !nullableText(log.userId, 128) || typeof log.action !== "string" ||
        typeof log.resourceType !== "string" || !nullableText(log.resourceId, 128) || !isRecord(log.metadata) || !validTime(log.createdAt)) {
      throw new AdminUserManagementApiError("invalid_response");
    }
  }
  return value as unknown as AdminUserDetailResponse;
}

function parsePlanUpdate(value: unknown): AdminPlanUpdateResult {
  if (!isRecord(value) || !exactKeys(value, ["success", "previousPlanType", "newPlanType", "enterpriseSettings", "updatedAt"]) ||
      value.success !== true || typeof value.previousPlanType !== "string" || !PLANS.has(value.previousPlanType) ||
      typeof value.newPlanType !== "string" || !PLANS.has(value.newPlanType) || !validTime(value.updatedAt)) {
    throw new AdminUserManagementApiError("invalid_response");
  }
  if (value.enterpriseSettings !== null && (!isRecord(value.enterpriseSettings) ||
      !exactKeys(value.enterpriseSettings, ["customFanmarksLimit", "customPricing", "notes"]) ||
      !(value.enterpriseSettings.customFanmarksLimit === null || nonnegativeInteger(value.enterpriseSettings.customFanmarksLimit)) ||
      !(value.enterpriseSettings.customPricing === null || nonnegativeInteger(value.enterpriseSettings.customPricing)) ||
      !nullableText(value.enterpriseSettings.notes, 8192))) {
    throw new AdminUserManagementApiError("invalid_response");
  }
  return value as unknown as AdminPlanUpdateResult;
}

function parseStatusUpdate(value: unknown): AdminUserStatusUpdateResult {
  if (!isRecord(value) || !exactKeys(value, ["success", "updated", "userId", "status", "bannedUntil", "updatedAt"]) ||
      value.success !== true || typeof value.updated !== "boolean" || typeof value.userId !== "string" ||
      value.userId.length > 128 || (value.status !== "active" && value.status !== "suspended") ||
      !nullableText(value.bannedUntil, 64) || !(value.bannedUntil === null || validTime(value.bannedUntil)) ||
      !validTime(value.updatedAt) || (value.status === "active" && value.bannedUntil !== null)) {
    throw new AdminUserManagementApiError("invalid_response");
  }
  return value as unknown as AdminUserStatusUpdateResult;
}

function parseLicenseExpireResult(value: unknown): AdminLicenseExpireResult {
  if (!isRecord(value) || !exactKeys(value, ["success", "licenseId", "alreadyExpired", "updatedAt"]) ||
      value.success !== true || typeof value.licenseId !== "string" || !UUID.test(value.licenseId) ||
      typeof value.alreadyExpired !== "boolean" || !validTime(value.updatedAt)) {
    throw new AdminUserManagementApiError("invalid_response");
  }
  return value as unknown as AdminLicenseExpireResult;
}

function parsePasswordResetResult(value: unknown, expectedUserId: string): AdminPasswordResetResult {
  if (!isRecord(value) || !exactKeys(value, ["success", "userId", "requestedAt"]) ||
      value.success !== true || value.userId !== expectedUserId || !validTime(value.requestedAt)) {
    throw new AdminUserManagementApiError("invalid_response");
  }
  return value as unknown as AdminPasswordResetResult;
}

function endpoint(baseUrl: string, suffix = ""): URL {
  try {
    const url = buildRecentFanmarksApiUrl(baseUrl);
    url.pathname = `${API_PATH}${suffix}`;
    url.search = "";
    url.hash = "";
    return url;
  } catch { throw new AdminUserManagementApiError("configuration"); }
}

async function request(path: string, body: unknown, options: RequestOptions): Promise<unknown> {
  const baseUrl = options.baseUrl ?? getRecentFanmarksApiBaseUrl();
  if (!baseUrl) throw new AdminUserManagementApiError("configuration");
  const authBaseUrl = options.authBaseUrl ?? (import.meta.env?.VITE_AUTH_API_BASE_URL?.trim() ||
    (typeof window === "undefined" ? undefined : window.location.origin));
  try {
    if (authBaseUrl && endpoint(baseUrl).origin !== buildRecentFanmarksApiUrl(authBaseUrl).origin) throw new AdminUserManagementApiError("configuration");
  } catch { throw new AdminUserManagementApiError("configuration"); }
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new AdminUserManagementApiError("configuration");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint(baseUrl, path), {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AdminUserManagementApiError("http", response.status);
    }
    if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !response.body) {
      throw new AdminUserManagementApiError("invalid_response");
    }
    const declared = response.headers.get("content-length");
    if (declared && /^\d+$/u.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
      await response.body.cancel();
      throw new AdminUserManagementApiError("invalid_response");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new AdminUserManagementApiError("invalid_response");
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
    catch { throw new AdminUserManagementApiError("invalid_response"); }
  } catch (error) {
    if (controller.signal.aborted) throw new AdminUserManagementApiError("timeout");
    if (error instanceof AdminUserManagementApiError) throw error;
    throw new AdminUserManagementApiError("network");
  } finally { clearTimeout(timer); }
}

export function createAdminUserManagementApi(options: RequestOptions = {}) {
  return {
    async list(input: { search?: string; plans?: string[]; status?: "active" | "suspended"; page: number; pageSize: number }): Promise<AdminListedUsersResponse> {
      return parseList(await request("", input, options));
    },
    async detail(userId: string): Promise<AdminUserDetailResponse> {
      if (!userId || userId.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(userId)) throw new AdminUserManagementApiError("configuration");
      return parseDetail(await request(`/${encodeURIComponent(userId)}`, { userId }, options));
    },
    async updatePlan(input: {
      userId: string;
      newPlanType: AdminListedUser["planType"];
      enterpriseOverrides?: { customFanmarksLimit: number | null; customPricing: number | null; notes: string | null };
      reason?: string | null;
    }): Promise<AdminPlanUpdateResult> {
      if (!input.userId || input.userId.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(input.userId) ||
          !PLANS.has(input.newPlanType) || (input.reason !== undefined && input.reason !== null && input.reason.length > 2000)) {
        throw new AdminUserManagementApiError("configuration");
      }
      return parsePlanUpdate(await request(`/${encodeURIComponent(input.userId)}/plan`, { ...input }, options));
    },
    async updateStatus(input: { userId: string; suspend: boolean; reason?: string | null }): Promise<AdminUserStatusUpdateResult> {
      if (!input.userId || input.userId.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(input.userId) ||
          typeof input.suspend !== "boolean" || (input.reason !== undefined && input.reason !== null && input.reason.length > 2000)) {
        throw new AdminUserManagementApiError("configuration");
      }
      return parseStatusUpdate(await request(`/${encodeURIComponent(input.userId)}/status`, { ...input }, options));
    },
    async expireLicense(input: { userId: string; licenseId: string; reason?: string | null }): Promise<AdminLicenseExpireResult> {
      if (!input.userId || input.userId.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(input.userId) ||
          !UUID.test(input.licenseId) || (input.reason !== undefined && input.reason !== null && input.reason.length > 2000)) {
        throw new AdminUserManagementApiError("configuration");
      }
      return parseLicenseExpireResult(await request(
        `/${encodeURIComponent(input.userId)}/licenses/${encodeURIComponent(input.licenseId)}/expire`,
        { ...input }, options,
      ));
    },
    async requestPasswordReset(input: { userId: string; reason?: string | null }): Promise<AdminPasswordResetResult> {
      if (!input.userId || input.userId.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(input.userId) ||
          (input.reason !== undefined && input.reason !== null && input.reason.length > 2000)) {
        throw new AdminUserManagementApiError("configuration");
      }
      return parsePasswordResetResult(await request(
        `/${encodeURIComponent(input.userId)}/password-reset`, { ...input }, options,
      ), input.userId);
    },
  };
}
