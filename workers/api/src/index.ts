import {
  createSupabaseRecentFanmarksRepository,
  mapRecentFanmarkRows,
  RecentFanmarksConfigurationError,
  RecentFanmarksTimeoutError,
  RecentFanmarksUpstreamError,
  selectD1Database,
  type Env,
} from "./repository";
import { createD1RecentFanmarksRepository } from "./d1-repository";
import { captureMfaGeneration, createAuth } from "./better-auth.mjs";
import { isResendAuthEmailConfigured } from "./auth-email.mjs";
import { configuredSocialProviders, type ConfiguredSocialProviders } from "./auth-social.mjs";
import {
  handleInvitationCodeValidationRequest,
  handleInvitationSignupRequest,
  isInvitationSignupSchemaReady,
  isInvitationCodeValidationPath,
  readInvitationSignupMode,
} from "./invitation-signup-d1-api";
import {
  AvailabilityConfigurationError,
  AvailabilityTimeoutError,
  AvailabilityUpstreamError,
  parseAvailabilityRequest,
  sanitizeAvailabilityResult,
  type AvailabilityClock,
} from "./availability";
import { createD1AvailabilityRepository } from "./availability-d1-repository";
import { createSupabaseAvailabilityRepository } from "./availability-repository";
import { handleAccountDeletionRequest, isAccountDeletionPath } from "./account-deletion-d1-api";
import { cancelLinkedStripeSubscriptionsForAccountDeletion } from "./stripe-account-deletion";
import { createD1PublicAccessRepository } from "./public-access-d1-repository";
import { handleVerifiedAccessRequest, isVerifiedAccessPath } from "./verified-access.mjs";
import { handleStorageRequest, type StorageAuthResult } from "./storage-r2";
import { handleOwnedFanmarksRequest, isOwnedFanmarksPath } from "./owned-fanmarks-d1-repository";
import { handleProfileRequest, isProfilePath } from "./profile-d1-repository";
import { handleFanmarkProfileRequest, isFanmarkProfilePath } from "./fanmark-profile-d1-api";
import { handleFanmarkSettingsRequest, isFanmarkSettingsPath } from "./fanmark-settings-d1-api";
import {
  handleFanmarkBulkReturnRequest,
  handleFanmarkReturnRequest,
  isFanmarkBulkReturnPath,
  isFanmarkReturnPath,
} from "./fanmark-return-d1-api";
import { handleFanmarkRegistrationRequest, isFanmarkRegistrationPath } from "./fanmark-registration-d1-api";
import { handleFanmarkLotteryRequest, isFanmarkLotteryPath } from "./fanmark-lottery-d1-api";
import { handleFanmarkTransferRequest, isFanmarkTransferPath } from "./fanmark-transfer-d1-api";
import { handleFanmarkSearchDetailsRequest, isFanmarkSearchDetailsPath } from "./fanmark-search-d1-api";
import { handleFanmarkDetailsRequest, isFanmarkDetailsPath } from "./fanmark-details-d1-api";
import { handleNotificationsRequest, isNotificationsPath } from "./notifications-d1-api";
import {
  handleNotificationMasterRequest,
  isNotificationMasterPath,
} from "./notification-master-d1-api";
import {
  handleAvailabilityRulesAdminRequest,
  isAvailabilityRulesAdminPath,
} from "./availability-rules-admin-d1-api";
import {
  handleAdminUserManagementRequest,
  isAdminUserManagementPath,
} from "./admin-user-management-d1-api";
import {
  handleAdminEmailTemplatesRequest,
  isAdminEmailTemplatesPath,
} from "./admin-email-templates-d1-api";
import {
  handleInvitationAdminRequest,
  isInvitationAdminPath,
} from "./invitation-admin-d1-api";
import {
  handleWaitlistAdminRequest,
  isWaitlistAdminPath,
} from "./waitlist-admin-d1-api";
import { handleStripeWebhookD1Request, isStripeWebhookPath } from "./stripe-webhook-d1-api";
import { runScheduledStripeWebhookDispatches } from "./stripe-webhook-d1-scheduled";
import {
  handleStripeExtensionCheckoutD1Request,
  isStripeExtensionCheckoutPath,
} from "./stripe-extension-checkout-d1-api";
import {
  handleExtensionCouponApplicationD1Request,
  isExtensionCouponApplicationPath,
} from "./extension-coupon-application-d1-api";
import {
  handleExtensionCouponAdminRequest,
  isExtensionCouponAdminPath,
} from "./extension-coupon-admin-d1-api";
import {
  handleStripeCustomerPortalD1Request,
  isStripeCustomerPortalPath,
} from "./stripe-customer-portal-d1-api";
import { handleStripePlanCheckoutD1Request, isStripePlanCheckoutPath } from "./stripe-plan-checkout-d1-api";
import { handleStripePlanChangeD1Request, isStripePlanChangePath } from "./stripe-plan-change-d1-api";
import { handleMaintenanceSettingsRequest, isMaintenanceSettingsPath } from "./maintenance-settings-d1-api";
import { handleLifecycleSettingsRequest, isLifecycleSettingsPath } from "./lifecycle-settings-d1-api";
import { handleSystemSettingsRequest, isSystemSettingsPath } from "./system-settings-d1-api";
import { handleFavoritesRequest, isFavoritesPath } from "./favorites-d1-api";
import { handleSubscriptionRequest, isSubscriptionPath } from "./subscription-d1-api";
import { handleUsernameAvailabilityRequest, isUsernameAvailabilityPath } from "./username-availability-d1-api";
import { handleOgpRequest } from "./ogp";
import { handleFanmarkAccessAnalyticsRequest } from "./fanmark-access-analytics-d1-api";
import { handleFanmarkAnalyticsRequest } from "./fanmark-analytics-d1-api";
import {
  runScheduledLicenseExpiry,
  ScheduledLicenseExpiryError,
} from "./license-expiry-scheduled.mjs";
import { runScheduledNotificationEvents } from "./notifications-scheduled";
import { selectScheduledJobs } from "./scheduled-dispatch";
import {
  createEmojiMasterD1Repository,
  EmojiCatalogConfigurationError,
  EmojiCatalogUnavailableError,
  EmojiCatalogUpstreamError,
  parseEmojiCatalogPageRequest,
} from "./emoji-master-d1-repository";
import {
  createReferenceMasterD1Repository,
  isReferenceMasterPath,
  parseReferenceMasterRoute,
  ReferenceMasterConfigurationError,
  ReferenceMasterUnavailableError,
  ReferenceMasterUpstreamError,
} from "./reference-master-d1-repository";
import {
  createReferenceMasterAdminD1Repository,
  ReferenceMasterAdminError,
  type ReferenceMasterAdminPatch,
} from "./reference-master-admin-d1-repository";
import { handleReferenceMasterServiceRequest } from "./reference-master-service-api";
import {
  createEmojiMasterAdminD1Repository,
  EmojiMasterAdminError,
  isEmojiMasterAdminPath,
  parseEmojiMasterAdminRoute,
} from "./emoji-master-admin-d1-repository";
import {
  mapPublicAccessRow,
  mapPublicProfileRow,
  parsePublicAccessEmojiRequest,
  parsePublicAccessPathValue,
  parsePublicAccessRoute,
  PublicAccessConfigurationError,
  PublicAccessResponseTooLargeError,
  PublicAccessUnavailableError,
  PublicAccessUpstreamError,
  publicAccessAllowedHeaders,
  publicAccessAllowedMethods,
  serializePublicAccessBody,
  type PublicAccessRepository,
} from "./public-access";

const RECENT_ALLOWED_METHODS = "GET, OPTIONS";
const AVAILABILITY_ALLOWED_METHODS = "POST, OPTIONS";
const EMOJI_CATALOG_ALLOWED_METHODS = "GET, OPTIONS";
const REFERENCE_MASTER_ALLOWED_METHODS = "GET, OPTIONS";
const AVAILABILITY_ALLOWED_HEADERS = "content-type";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

function baseHeaders(): Headers {
  return new Headers({
    "cache-control": "no-store",
    "content-type": JSON_CONTENT_TYPE,
  });
}

function jsonResponse(body: unknown, status: number, extraHeaders?: HeadersInit): Response {
  const headers = baseHeaders();
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function emptyResponse(status: number, extraHeaders?: HeadersInit): Response {
  const headers = baseHeaders();
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  headers.delete("content-type");
  return new Response(null, { status, headers });
}

function parseAllowedOrigins(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function corsHeaders(
  request: Request,
  env: Env,
  allowedMethods: string,
  allowedHeaders?: string,
  allowCredentials = false,
): { allowed: boolean; headers: Headers } {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (!origin) return { allowed: true, headers };

  if (!parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS).has(origin)) {
    return { allowed: false, headers };
  }

  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", allowedMethods);
  if (allowedHeaders) headers.set("access-control-allow-headers", allowedHeaders);
  if (allowCredentials) headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return { allowed: true, headers };
}

function parseLimit(url: URL): number | null {
  const values = url.searchParams.getAll("limit");
  if (values.length === 0) return 20;
  if (values.length !== 1 || !/^(?:[1-9]|1[0-9]|20)$/.test(values[0])) return null;
  return Number(values[0]);
}

function createRecentFanmarksRepository(env: Env, outboundFetch: typeof fetch) {
  const configuredBackend = env.RECENT_FANMARKS_BACKEND?.trim();
  if (!configuredBackend) {
    return createSupabaseRecentFanmarksRepository(env, outboundFetch);
  }
  if (configuredBackend === "d1") {
    return createD1RecentFanmarksRepository(env);
  }
  // An explicit unknown value must not silently select another data source.
  throw new RecentFanmarksConfigurationError();
}

function createAvailabilityRepository(
  env: Env,
  outboundFetch: typeof fetch,
  clock: AvailabilityClock,
) {
  const configuredBackend = env.AVAILABILITY_BACKEND?.trim();
  if (!configuredBackend) {
    return createSupabaseAvailabilityRepository(env, outboundFetch);
  }
  if (configuredBackend === "d1") {
    return createD1AvailabilityRepository(env, clock);
  }
  throw new AvailabilityConfigurationError();
}

function createPublicAccessRepository(
  env: Env,
  publicAccessClock: () => Date,
): PublicAccessRepository {
  const configuredBackend = env.PUBLIC_ACCESS_BACKEND?.trim();
  if (!configuredBackend) throw new PublicAccessUnavailableError();
  if (configuredBackend === "d1") return createD1PublicAccessRepository(env, publicAccessClock);
  throw new PublicAccessConfigurationError();
}

function errorResponse(code: string, status: number, headers: Headers, extra?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  if (extra) {
    new Headers(extra).forEach((value, key) => responseHeaders.set(key, value));
  }
  return jsonResponse({ error: code }, status, responseHeaders);
}

function publicAccessJsonResponse(body: unknown, status: number, headers: Headers): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", JSON_CONTENT_TYPE);
  return new Response(serializePublicAccessBody(body), { status, headers: responseHeaders });
}

const AUTH_CLOSED_ENDPOINTS = new Set([
  "/sign-up/email",
  "/sign-up/username",
  "/link-social",
  "/unlink-account",
  "/change-email",
  "/delete-user",
  "/delete-user/callback",
]);
const AUTH_EMAIL_ENDPOINTS = new Set([
  "/forget-password",
  "/request-password-reset",
  "/reset-password",
  "/send-verification-email",
  "/verify-email",
]);
const AUTH_KNOWN_ENDPOINTS = new Set([
  ...AUTH_CLOSED_ENDPOINTS,
  ...AUTH_EMAIL_ENDPOINTS,
  "/sign-in/email",
  "/sign-in/social",
  "/sign-out",
  "/get-session",
  "/change-password",
  "/update-user",
  "/verify-password",
  "/update-session",
  "/ok",
  "/capabilities",
  "/invitations/validate",
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/get-totp-uri",
  "/two-factor/verify-totp",
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
  "/two-factor/generate-backup-codes",
  "/two-factor/verify-backup-code",
]);

interface ConfiguredAuth {
  database: D1Database;
  secret: string;
  url: string;
  trustedOrigins: string[];
  emailBackend: string;
  userStatusBackend: string;
  resendApiKey: string;
  resendFromEmail: string;
  socialProviders: ConfiguredSocialProviders;
}

interface CachedApplicationAuth {
  secret: string;
  url: string;
  trustedOrigins: string[];
  emailBackend: string;
  userStatusBackend: string;
  resendApiKey: string;
  resendFromEmail: string;
  socialProviders: ConfiguredSocialProviders;
  auth: ReturnType<typeof createAuth>;
}

const applicationAuthByDatabase = new WeakMap<D1Database, CachedApplicationAuth>();

function configuredAuth(env: Env): ConfiguredAuth | null {
  const authUrl = env.BETTER_AUTH_URL?.trim();
  const secret = env.BETTER_AUTH_SECRET?.trim();
  const database = selectD1Database(env, "auth");
  if (!authUrl || !secret || secret.length < 32 || !database) return null;

  try {
    const base = new URL(authUrl);
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      base.pathname !== "/" ||
      base.search ||
      base.hash
    ) return null;

    const origins = new Set([base.origin]);
    for (const value of (env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean)) {
      const origin = new URL(value);
      if (
        origin.protocol !== "https:" ||
        origin.origin !== value ||
        origin.username ||
        origin.password
      ) return null;
      origins.add(origin.origin);
    }
    return {
      database,
      secret,
      url: base.origin,
      trustedOrigins: [...origins],
      emailBackend: env.AUTH_EMAIL_BACKEND?.trim() ?? "",
      userStatusBackend: env.AUTH_USER_STATUS_BACKEND?.trim() ?? "",
      resendApiKey: env.RESEND_API_KEY?.trim() ?? "",
      resendFromEmail: env.RESEND_FROM_EMAIL?.trim() ?? "",
      socialProviders: configuredSocialProviders(env),
    };
  } catch {
    return null;
  }
}

function createApplicationAuth(
  config: ConfiguredAuth,
  requestState: number | null = null,
  signupCommandId: string | null = null,
) {
  const cached = applicationAuthByDatabase.get(config.database);
  const sameTrustedOrigins = cached?.trustedOrigins.length === config.trustedOrigins.length &&
    cached.trustedOrigins.every((origin, index) => origin === config.trustedOrigins[index]);
  const sameEmailConfiguration = cached?.emailBackend === config.emailBackend &&
    cached.resendApiKey === config.resendApiKey &&
    cached.resendFromEmail === config.resendFromEmail;
  const sameUserStatusConfiguration = cached?.userStatusBackend === config.userStatusBackend;
  const sameSocialProviders = JSON.stringify(cached?.socialProviders) === JSON.stringify(config.socialProviders);
  if (
    requestState === null && signupCommandId === null && cached &&
    cached.secret === config.secret &&
    cached.url === config.url &&
    sameTrustedOrigins &&
    sameEmailConfiguration &&
    sameUserStatusConfiguration &&
    sameSocialProviders
  ) return cached.auth;

  const auth = createAuth(
    {
      AUTH_DB: config.database,
      BETTER_AUTH_SECRET: config.secret,
      BETTER_AUTH_URL: config.url,
      AUTH_EMAIL_BACKEND: config.emailBackend,
      AUTH_USER_STATUS_BACKEND: config.userStatusBackend,
      RESEND_API_KEY: config.resendApiKey,
      RESEND_FROM_EMAIL: config.resendFromEmail,
    },
    [],
    requestState,
    null,
    {
      appName: "fanmark.id",
      issuer: "fanmark.id",
      trustedOrigins: config.trustedOrigins,
      socialProviders: config.socialProviders,
      ...(signupCommandId
        ? {
            allowSignUp: true,
            sendVerificationOnSignUp: false,
            signupCommandId,
          }
        : {}),
    },
  );

  // MFA verification captures a request-specific generation before Better
  // Auth runs. Never cache that instance; ordinary handlers are immutable
  // for one D1 binding/configuration and can be reused by the isolate.
  if (requestState === null && signupCommandId === null) {
    applicationAuthByDatabase.set(config.database, {
      secret: config.secret,
      url: config.url,
      trustedOrigins: [...config.trustedOrigins],
      emailBackend: config.emailBackend,
      userStatusBackend: config.userStatusBackend,
      resendApiKey: config.resendApiKey,
      resendFromEmail: config.resendFromEmail,
      socialProviders: config.socialProviders,
      auth,
    });
  }
  return auth;
}

type AdminAuthorization = { userId: string; sessionId: string } | Response;

async function authorizeAdminRequest(
  request: Request,
  authConfig: NonNullable<ReturnType<typeof configuredAuth>>,
  responseHeaders: Headers,
): Promise<AdminAuthorization> {
  try {
    const auth = createApplicationAuth(authConfig);
    const current = await auth.api.getSession({
      headers: request.headers,
      query: { disableCookieCache: true },
    });
    if (!current?.session?.id || !current.user?.id) {
      return errorResponse("unauthenticated", 401, responseHeaders);
    }

    const role = await authConfig.database
      .prepare('SELECT "role" FROM "adminRole" WHERE "userId" = ? LIMIT 1')
      .bind(current.user.id)
      .first<{ role?: unknown }>();
    if (role?.role !== "admin") {
      return errorResponse("admin_required", 403, responseHeaders);
    }

    const user = await authConfig.database
      .prepare('SELECT "twoFactorEnabled" FROM "user" WHERE "id" = ? LIMIT 1')
      .bind(current.user.id)
      .first<{ twoFactorEnabled?: unknown }>();
    const factor = await authConfig.database
      .prepare('SELECT "id", "verified" FROM "twoFactor" WHERE "userId" = ? AND "verified" = 1 LIMIT 2')
      .bind(current.user.id)
      .all<{ id?: unknown; verified?: unknown }>();
    if (factor.success !== true || !Array.isArray(factor.results)) {
      return errorResponse("auth_unavailable", 503, responseHeaders);
    }
    const verifiedFactors = factor.results;
    const currentFactorId = verifiedFactors.length === 1 &&
      typeof verifiedFactors[0]?.id === "string" &&
      Number(verifiedFactors[0]?.verified) === 1
      ? verifiedFactors[0].id
      : null;
    if (Number(user?.twoFactorEnabled) !== 1 || currentFactorId === null) {
      return errorResponse("mfa_enrollment_required", 403, responseHeaders);
    }

    const assurance = await authConfig.database
      .prepare(`SELECT "userId", "sessionId", "factorId", "expiresAt"
                FROM "mfaAssurance"
                WHERE "userId" = ? AND "sessionId" = ? LIMIT 1`)
      .bind(current.user.id, current.session.id)
      .first<{
        userId?: unknown;
        sessionId?: unknown;
        factorId?: unknown;
        expiresAt?: unknown;
      }>();
    const expiresAt = typeof assurance?.expiresAt === "string"
      ? Date.parse(assurance.expiresAt)
      : NaN;
    if (
      assurance?.userId !== current.user.id ||
      assurance?.sessionId !== current.session.id ||
      assurance?.factorId !== currentFactorId ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      return errorResponse("mfa_required", 403, responseHeaders);
    }

    return { userId: current.user.id, sessionId: current.session.id };
  } catch {
    return errorResponse("auth_unavailable", 503, responseHeaders);
  }
}

async function handleAdminSessionRequest(request: Request, env: Env): Promise<Response> {
  const responseHeaders = baseHeaders();
  if (env.AUTH_BACKEND !== "better-auth") {
    return errorResponse("auth_unavailable", 503, responseHeaders);
  }
  const authConfig = configuredAuth(env);
  if (!authConfig) return errorResponse("auth_unavailable", 503, responseHeaders);

  const cors = corsHeaders(request, env, "GET, OPTIONS", undefined, true);
  if (!cors.allowed) return errorResponse("forbidden_origin", 403, responseHeaders);
  cors.headers.forEach((value, key) => responseHeaders.set(key, value));

  const method = request.method.toUpperCase();
  if (method === "OPTIONS") {
    responseHeaders.set("allow", "GET, OPTIONS");
    return emptyResponse(204, responseHeaders);
  }
  if (method !== "GET") {
    responseHeaders.set("allow", "GET, OPTIONS");
    return errorResponse("method_not_allowed", 405, responseHeaders);
  }

  const authorization = await authorizeAdminRequest(request, authConfig, responseHeaders);
  if (authorization instanceof Response) return authorization;
  return jsonResponse({ authorized: true }, 200, responseHeaders);
}

const MAX_ADMIN_JSON_BYTES = 256 * 1024;

async function readAdminJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new EmojiMasterAdminError("json_content_type_required", 415);
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_ADMIN_JSON_BYTES)) {
    throw new EmojiMasterAdminError("request_too_large", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new EmojiMasterAdminError("invalid_request", 400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ADMIN_JSON_BYTES) {
        void reader.cancel();
        throw new EmojiMasterAdminError("request_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new EmojiMasterAdminError("invalid_json", 400);
  }
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnexpectedQuery(url: URL): void {
  let hasQuery = false;
  url.searchParams.forEach(() => { hasQuery = true; });
  if (hasQuery) throw new EmojiMasterAdminError("invalid_request", 400);
}

async function handleEmojiMasterAdminRequest(request: Request, env: Env, url: URL): Promise<Response> {
  const route = parseEmojiMasterAdminRoute(url);
  if (!route) return errorResponse("not_found", 404, baseHeaders());
  const allowedMethods = route.kind === "list"
    ? "GET, POST, OPTIONS"
    : route.kind === "import"
      ? "POST, OPTIONS"
      : "GET, PUT, DELETE, OPTIONS";
  const responseHeaders = baseHeaders();
  if (env.AUTH_BACKEND !== "better-auth") {
    return errorResponse("auth_unavailable", 503, responseHeaders);
  }
  const authConfig = configuredAuth(env);
  if (!authConfig) return errorResponse("auth_unavailable", 503, responseHeaders);
  const cors = corsHeaders(request, env, allowedMethods, "content-type", true);
  if (!cors.allowed) return errorResponse("forbidden_origin", 403, responseHeaders);
  cors.headers.forEach((value, key) => responseHeaders.set(key, value));

  const method = request.method.toUpperCase();
  if (method === "OPTIONS") {
    responseHeaders.set("allow", allowedMethods);
    return emptyResponse(204, responseHeaders);
  }
  if (!allowedMethods.split(", ").includes(method)) {
    responseHeaders.set("allow", allowedMethods);
    return errorResponse("method_not_allowed", 405, responseHeaders);
  }

  const authorization = await authorizeAdminRequest(request, authConfig, responseHeaders);
  if (authorization instanceof Response) return authorization;

  try {
    const repository = createEmojiMasterAdminD1Repository(env);
    if (route.kind === "list" && method === "GET") {
      return jsonResponse(await repository.list(url), 200, responseHeaders);
    }
    if (route.kind === "item" && method === "GET") {
      rejectUnexpectedQuery(url);
      return jsonResponse(await repository.getById(route.id), 200, responseHeaders);
    }
    if (route.kind === "item" && method === "DELETE") {
      rejectUnexpectedQuery(url);
      await repository.delete(route.id);
    }
    const body = await readAdminJson(request);
    if (route.kind === "import" && method === "POST") {
      rejectUnexpectedQuery(url);
      if (!isJsonRecord(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, "records")) {
        throw new EmojiMasterAdminError("invalid_request", 400);
      }
      return jsonResponse(await repository.import(body.records), 200, responseHeaders);
    }
    if (route.kind === "list" && method === "POST") {
      rejectUnexpectedQuery(url);
      return jsonResponse(await repository.create(body), 201, responseHeaders);
    }
    if (route.kind === "item" && method === "PUT") {
      rejectUnexpectedQuery(url);
      if (!isJsonRecord(body) || !Object.hasOwn(body, "updatedAt")) {
        throw new EmojiMasterAdminError("invalid_request", 400);
      }
      const { updatedAt, ...input } = body;
      return jsonResponse(await repository.update(route.id, updatedAt, input), 200, responseHeaders);
    }
    throw new EmojiMasterAdminError("method_not_allowed", 405);
  } catch (error) {
    if (error instanceof EmojiMasterAdminError) {
      return errorResponse(error.code, error.status, responseHeaders);
    }
    return errorResponse("emoji_master_unavailable", 503, responseHeaders);
  }
}

async function handleReferenceMasterAdminRequest(request: Request, env: Env, url: URL): Promise<Response> {
  const allowedMethods = "GET, PUT, OPTIONS";
  const responseHeaders = baseHeaders();
  if (env.REFERENCE_MASTER_ADMIN_BACKEND?.trim() !== "d1" || env.AUTH_BACKEND !== "better-auth") {
    return errorResponse("reference_master_admin_unavailable", 503, responseHeaders);
  }
  const authConfig = configuredAuth(env);
  if (!authConfig) return errorResponse("auth_unavailable", 503, responseHeaders);
  const cors = corsHeaders(request, env, allowedMethods, "content-type", true);
  if (!cors.allowed) return errorResponse("forbidden_origin", 403, responseHeaders);
  cors.headers.forEach((value, key) => responseHeaders.set(key, value));

  const method = request.method.toUpperCase();
  if (method === "OPTIONS") {
    responseHeaders.set("allow", allowedMethods);
    return emptyResponse(204, responseHeaders);
  }
  if (method !== "GET" && method !== "PUT") {
    responseHeaders.set("allow", allowedMethods);
    return errorResponse("method_not_allowed", 405, responseHeaders);
  }
  const authorization = await authorizeAdminRequest(request, authConfig, responseHeaders);
  if (authorization instanceof Response) return authorization;

  try {
    rejectUnexpectedQuery(url);
    const repository = createReferenceMasterAdminD1Repository(env);
    if (method === "GET") return jsonResponse(await repository.getPricing(), 200, responseHeaders);

    const body = await readAdminJson(request);
    if (!isJsonRecord(body) || Object.keys(body).length !== 4 ||
        typeof body.expectedReleaseVersion !== "string" ||
        (body.type !== "tier" && body.type !== "extension_price") ||
        typeof body.id !== "string" || !isJsonRecord(body.changes)) {
      throw new EmojiMasterAdminError("invalid_request", 400);
    }
    const { expectedReleaseVersion, type, id, changes } = body;
    return jsonResponse(await repository.updatePricing(expectedReleaseVersion,
      { type, id, changes } as ReferenceMasterAdminPatch), 200, responseHeaders);
  } catch (error) {
    if (error instanceof EmojiMasterAdminError) {
      return errorResponse(error.code, error.status, responseHeaders);
    }
    if (error instanceof ReferenceMasterAdminError) {
      return errorResponse(error.message, error.status, responseHeaders);
    }
    return errorResponse("reference_master_admin_unavailable", 503, responseHeaders);
  }
}

async function resolveStorageAuth(request: Request, env: Env): Promise<StorageAuthResult> {
  if (env.AUTH_BACKEND !== "better-auth") return { available: false };
  const config = configuredAuth(env);
  if (!config) return { available: false };
  try {
    const auth = createApplicationAuth(config);
    const session = await auth.api.getSession({ headers: request.headers });
    const userId = session?.user?.id;
    return {
      available: true,
      userId: typeof userId === "string" && userId.length > 0 ? userId : null,
    };
  } catch {
    return { available: false };
  }
}

function authResponseHeaders(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
    headers.set("vary", "Origin");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleBetterAuthRequest(request: Request, env: Env, url: URL): Promise<Response> {
  const authPath = url.pathname.slice("/api/auth".length);
  const isResetTokenRoute = authPath.startsWith("/reset-password/");
  const isOAuthCallback = authPath.startsWith("/callback/");
  if (
    !AUTH_KNOWN_ENDPOINTS.has(authPath) &&
    !isOAuthCallback &&
    !isResetTokenRoute
  ) {
    return jsonResponse({ error: "not_found" }, 404);
  }
  if (env.AUTH_BACKEND !== "better-auth") {
    return jsonResponse({ error: "auth_unavailable" }, 503);
  }
  const authConfig = configuredAuth(env);
  if (!authConfig) return jsonResponse({ error: "auth_unavailable" }, 503);

  const requestOrigin = request.headers.get("Origin");
  if (requestOrigin && !authConfig.trustedOrigins.includes(requestOrigin)) {
    return jsonResponse({ error: "forbidden_origin" }, 403);
  }

  const corsHeaders = new Headers();
  if (requestOrigin) {
    corsHeaders.set("access-control-allow-origin", requestOrigin);
    corsHeaders.set("access-control-allow-credentials", "true");
    corsHeaders.set("access-control-allow-methods", "GET, POST, OPTIONS");
    corsHeaders.set("access-control-allow-headers", "content-type, authorization, x-requested-with, x-csrf-token");
    corsHeaders.set("vary", "Origin");
  }
  const emailEnabled = isResendAuthEmailConfigured({
    AUTH_EMAIL_BACKEND: authConfig.emailBackend,
    RESEND_API_KEY: authConfig.resendApiKey,
    RESEND_FROM_EMAIL: authConfig.resendFromEmail,
  });
  if (request.method.toUpperCase() === "OPTIONS") {
    corsHeaders.set("allow", "GET, POST, OPTIONS");
    return emptyResponse(204, corsHeaders);
  }

  if (authPath === "/ok" && request.method.toUpperCase() === "GET") {
    return jsonResponse({ ok: true }, 200, corsHeaders);
  }

  if (authPath === "/capabilities" && request.method.toUpperCase() === "GET") {
    const businessDb = env.INVITATION_SIGNUP_BACKEND?.trim() === "d1"
      ? selectD1Database(env, "business")
      : undefined;
    const signupSchemaReady = emailEnabled && await isInvitationSignupSchemaReady(businessDb, authConfig.database);
    const invitationMode = signupSchemaReady
      ? await readInvitationSignupMode(businessDb)
      : null;
    return jsonResponse({
      emailVerification: emailEnabled,
      passwordReset: emailEnabled,
      signUp: invitationMode !== null,
      invitationRequired: invitationMode === true,
      socialProviders: Object.keys(authConfig.socialProviders).sort(),
    }, 200, corsHeaders);
  }

  if (isInvitationCodeValidationPath(url.pathname)) {
    const businessDb = env.INVITATION_SIGNUP_BACKEND?.trim() === "d1"
      ? selectD1Database(env, "business")
      : undefined;
    const signupSchemaReady = emailEnabled && await isInvitationSignupSchemaReady(businessDb, authConfig.database);
    const invitationMode = signupSchemaReady
      ? await readInvitationSignupMode(businessDb)
      : null;
    return handleInvitationCodeValidationRequest(request, businessDb, invitationMode, corsHeaders);
  }

  if (authPath === "/sign-up/email" && request.method.toUpperCase() === "POST") {
    if (env.INVITATION_SIGNUP_BACKEND?.trim() !== "d1" || !emailEnabled) {
      return errorResponse("auth_flow_unavailable", 403, corsHeaders);
    }
    const businessDb = env.INVITATION_SIGNUP_BACKEND?.trim() === "d1"
      ? selectD1Database(env, "business")
      : undefined;
    const signupSchemaReady = await isInvitationSignupSchemaReady(businessDb, authConfig.database);
    const invitationMode = signupSchemaReady
      ? await readInvitationSignupMode(businessDb)
      : null;
    return handleInvitationSignupRequest(
      request,
      env,
      invitationMode,
      corsHeaders,
      async (path, body, commandId) => {
        const auth = createApplicationAuth(authConfig, null, commandId);
        const headers = new Headers({
          accept: "application/json",
          "content-type": "application/json",
        });
        for (const name of ["Origin", "cf-connecting-ip", "x-forwarded-for", "user-agent"]) {
          const value = request.headers.get(name);
          if (value) headers.set(name, value);
        }
        const internalRequest = new Request(
          new URL(`/api/auth${path}`, `${authConfig.url}/`),
          { method: "POST", headers, body: JSON.stringify(body) },
        );
        return auth.handler(internalRequest);
      },
    );
  }
  let requestedSocialProvider: string | null = null;
  if (authPath === "/sign-in/social" && request.method.toUpperCase() === "POST") {
    try {
      const body: unknown = await request.clone().json();
      if (body && typeof body === "object" && "provider" in body && typeof body.provider === "string") {
        requestedSocialProvider = body.provider;
      }
    } catch {
      requestedSocialProvider = null;
    }
  }
  const oauthCallbackProvider = authPath.match(/^\/callback\/([a-z]+)$/u)?.[1] ?? null;
  if (
    AUTH_CLOSED_ENDPOINTS.has(authPath) ||
    (AUTH_EMAIL_ENDPOINTS.has(authPath) && !emailEnabled) ||
    (isResetTokenRoute && !emailEnabled) ||
    (authPath === "/sign-in/social" && (!requestedSocialProvider || !Object.hasOwn(authConfig.socialProviders, requestedSocialProvider))) ||
    (isOAuthCallback && (!oauthCallbackProvider || !Object.hasOwn(authConfig.socialProviders, oauthCallbackProvider)))
  ) {
    return errorResponse("auth_flow_unavailable", 403, corsHeaders);
  }

  try {
    const requestState = authPath === "/two-factor/verify-totp"
      ? await captureMfaGeneration({ AUTH_DB: authConfig.database })
      : null;
    const auth = createApplicationAuth(authConfig, requestState);
    return authResponseHeaders(await auth.handler(request), requestOrigin);
  } catch {
    return jsonResponse({ error: "auth_unavailable" }, 503, corsHeaders);
  }
}

async function fetchStaticAsset(request: Request, assets: Fetcher): Promise<Response> {
  const response = await assets.fetch(request);
  const isNavigation =
    request.method === "GET" &&
    (request.headers.get("Sec-Fetch-Mode") === "navigate" ||
      request.headers.get("Accept")?.includes("text/html") === true);
  if (
    response.status === 404 &&
    isNavigation
  ) {
    // Keep SPA fallback limited to browser navigations. A missing script,
    // stylesheet, or other asset must remain a real non-HTML 404.
    return assets.fetch(
      new Request(new URL("/index.html", request.url), {
        method: "GET",
        headers: request.headers,
      }),
    );
  }
  return response;
}

function addNoIndexHeader(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function stagingRobotsResponse(method: string): Response {
  return new Response(method === "HEAD" ? null : "User-agent: *\nDisallow: /\n", {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

export async function handleRequest(
  request: Request,
  env: Env,
  outboundFetch: typeof fetch = fetch,
  availabilityClock: AvailabilityClock = () => new Date(),
  publicAccessClock: () => Date = () => new Date(),
): Promise<Response> {
  const url = new URL(request.url);
  const routeHeaders = baseHeaders();

  const ogpResponse = await handleOgpRequest(request, env, publicAccessClock);
  if (ogpResponse) return ogpResponse;

  // Static Assets owns files and the Worker applies the navigation fallback.
  // API paths stay in this Worker so an unknown API error can never be
  // rewritten to index.html.
  if (!url.pathname.startsWith("/api/") && url.pathname !== "/api" && env.ASSETS) {
    const stagingNoIndex = env.STAGING_NO_INDEX?.trim().toLowerCase() === "true";
    if (stagingNoIndex && (request.method === "GET" || request.method === "HEAD")) {
      if (url.pathname === "/robots.txt") return stagingRobotsResponse(request.method);
      if (url.pathname === "/sitemap.xml") {
        return emptyResponse(404, { "x-robots-tag": "noindex, nofollow" });
      }
    }
    const response = await fetchStaticAsset(request, env.ASSETS);
    return stagingNoIndex ? addNoIndexHeader(response) : response;
  }

  if (url.pathname.startsWith("/api/auth/")) {
    return handleBetterAuthRequest(request, env, url);
  }

  if (isAccountDeletionPath(url.pathname)) {
    return handleAccountDeletionRequest(request, env, {
      resolveUser: async (deleteRequest, requestEnv) => {
        if (requestEnv.AUTH_BACKEND?.trim() !== "better-auth") throw new Error("auth_unavailable");
        const config = configuredAuth(requestEnv);
        if (!config) throw new Error("auth_unavailable");
        const current = await createApplicationAuth(config).api.getSession({
          headers: deleteRequest.headers,
          query: { disableCookieCache: true },
        });
        return typeof current?.user?.id === "string" ? { userId: current.user.id } : null;
      },
      verifyPassword: async (deleteRequest, password, requestEnv) => {
        const config = configuredAuth(requestEnv);
        if (!config) throw new Error("auth_unavailable");
        const authApi = createApplicationAuth(config).api as unknown as {
          verifyPassword(input: { headers: Headers; body: { password: string } }): Promise<{ status: boolean }>;
        };
        try {
          const result = await authApi.verifyPassword({ headers: deleteRequest.headers, body: { password } });
          return result.status === true;
        } catch {
          return false;
        }
      },
      cancelCustomerSubscriptions: (customerIds, requestEnv) =>
        cancelLinkedStripeSubscriptionsForAccountDeletion(customerIds, requestEnv),
      deleteAuthUser: async (deleteRequest, password, requestEnv) => {
        const config = configuredAuth(requestEnv);
        if (!config) throw new Error("auth_unavailable");
        const authApi = createApplicationAuth(config).api as unknown as {
          deleteUser(input: { headers: Headers; body: { password: string }; asResponse: true }): Promise<Response>;
        };
        const response = await authApi.deleteUser({
          headers: deleteRequest.headers,
          body: { password },
          asResponse: true,
        });
        if (!response.ok) return { success: false };
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return { success: false };
        }
        return {
          success: typeof body === "object" && body !== null && (body as { success?: unknown }).success === true,
          ...(response.headers.get("set-cookie") ? { setCookie: response.headers.get("set-cookie") as string } : {}),
        };
      },
    });
  }

  const accessAnalyticsResponse = await handleFanmarkAccessAnalyticsRequest(request, env);
  if (accessAnalyticsResponse) return accessAnalyticsResponse;

  if (isStripeWebhookPath(url.pathname)) {
    return (await handleStripeWebhookD1Request(request, env)) ?? errorResponse("not_found", 404, routeHeaders);
  }

  if (isStripeCustomerPortalPath(url.pathname)) {
    return (await handleStripeCustomerPortalD1Request(request, env, {
      resolveUser: async (portalRequest) => {
        if (env.AUTH_BACKEND?.trim() !== "better-auth") throw new Error("auth_unavailable");
        const config = configuredAuth(env);
        if (!config) throw new Error("auth_unavailable");
        const current = await createApplicationAuth(config).api.getSession({
          headers: portalRequest.headers,
          query: { disableCookieCache: true },
        });
        const userId = current?.user?.id;
        return typeof userId === "string" ? userId : null;
      },
    })) ?? errorResponse("not_found", 404, routeHeaders);
  }

  if (isStripePlanCheckoutPath(url.pathname)) {
    return (await handleStripePlanCheckoutD1Request(request, env, {
      resolveUser: async (checkoutRequest) => {
        if (env.AUTH_BACKEND?.trim() !== "better-auth") throw new Error("auth_unavailable");
        const config = configuredAuth(env);
        if (!config) throw new Error("auth_unavailable");
        const current = await createApplicationAuth(config).api.getSession({
          headers: checkoutRequest.headers,
          query: { disableCookieCache: true },
        });
        const id = current?.user?.id;
        if (typeof id !== "string") return null;
        const authUser = await config.database.prepare(
          'SELECT email FROM "user" WHERE id = ? LIMIT 2',
        ).bind(id).all<{ email: unknown }>();
        if (!authUser.success || authUser.results.length !== 1 || typeof authUser.results[0]?.email !== "string") {
          return null;
        }
        return { id, email: authUser.results[0].email };
      },
    })) ?? errorResponse("not_found", 404, routeHeaders);
  }

  if (isStripePlanChangePath(url.pathname)) {
    return (await handleStripePlanChangeD1Request(request, env, {
      resolveUser: async (changeRequest) => {
        if (env.AUTH_BACKEND?.trim() !== "better-auth") throw new Error("auth_unavailable");
        const config = configuredAuth(env);
        if (!config) throw new Error("auth_unavailable");
        const current = await createApplicationAuth(config).api.getSession({
          headers: changeRequest.headers,
          query: { disableCookieCache: true },
        });
        return typeof current?.user?.id === "string" ? current.user.id : null;
      },
    })) ?? errorResponse("not_found", 404, routeHeaders);
  }

  if (isStripeExtensionCheckoutPath(url.pathname)) {
    return (await handleStripeExtensionCheckoutD1Request(request, env, {
      resolveUser: async (checkoutRequest) => {
        if (env.AUTH_BACKEND?.trim() !== "better-auth") throw new Error("auth_unavailable");
        const config = configuredAuth(env);
        if (!config) throw new Error("auth_unavailable");
        const current = await createApplicationAuth(config).api.getSession({
          headers: checkoutRequest.headers,
          query: { disableCookieCache: true },
        });
        const userId = current?.user?.id;
        return typeof userId === "string" ? userId : null;
      },
    })) ?? errorResponse("not_found", 404, routeHeaders);
  }

  if (isExtensionCouponApplicationPath(url.pathname)) {
    return (await handleExtensionCouponApplicationD1Request(request, env, {
      resolveUser: async (couponRequest) => {
        if (env.AUTH_BACKEND?.trim() !== "better-auth") throw new Error("auth_unavailable");
        const config = configuredAuth(env);
        if (!config) throw new Error("auth_unavailable");
        const current = await createApplicationAuth(config).api.getSession({
          headers: couponRequest.headers,
          query: { disableCookieCache: true },
        });
        return typeof current?.user?.id === "string" ? current.user.id : null;
      },
    })) ?? errorResponse("not_found", 404, routeHeaders);
  }

  if (url.pathname === "/api/admin/session") {
    return handleAdminSessionRequest(request, env);
  }
  if (isSystemSettingsPath(url.pathname)) {
    return (await handleSystemSettingsRequest(request, env, async (adminRequest, responseHeaders) => {
      if (env.AUTH_BACKEND?.trim() !== "better-auth") {
        return errorResponse("auth_unavailable", 503, responseHeaders);
      }
      const authConfig = configuredAuth(env);
      if (!authConfig) return errorResponse("auth_unavailable", 503, responseHeaders);
      return authorizeAdminRequest(adminRequest, authConfig, responseHeaders);
    })) ?? errorResponse("not_found", 404, routeHeaders);
  }
  if (isMaintenanceSettingsPath(url.pathname)) {
    return handleMaintenanceSettingsRequest(request, env, async (adminRequest, responseHeaders) => {
      if (env.AUTH_BACKEND?.trim() !== "better-auth") {
        return errorResponse("auth_unavailable", 503, responseHeaders);
      }
      const authConfig = configuredAuth(env);
      if (!authConfig) return errorResponse("auth_unavailable", 503, responseHeaders);
      return authorizeAdminRequest(adminRequest, authConfig, responseHeaders);
    });
  }
  if (isLifecycleSettingsPath(url.pathname)) {
    return handleLifecycleSettingsRequest(request, env, async (adminRequest, responseHeaders) => {
      if (env.AUTH_BACKEND?.trim() !== "better-auth") {
        return errorResponse("auth_unavailable", 503, responseHeaders);
      }
      const authConfig = configuredAuth(env);
      if (!authConfig) return errorResponse("auth_unavailable", 503, responseHeaders);
      return authorizeAdminRequest(adminRequest, authConfig, responseHeaders);
    });
  }
  if (isAvailabilityRulesAdminPath(url.pathname)) {
    return (await handleAvailabilityRulesAdminRequest(request, env, async (adminRequest, responseHeaders) => {
      if (env.AUTH_BACKEND?.trim() !== "better-auth") {
        return errorResponse("auth_unavailable", 503, responseHeaders);
      }
      const authConfig = configuredAuth(env);
      if (!authConfig) return errorResponse("auth_unavailable", 503, responseHeaders);
      return authorizeAdminRequest(adminRequest, authConfig, responseHeaders);
    })) ?? errorResponse("not_found", 404, routeHeaders);
  }
  if (isAdminUserManagementPath(url.pathname)) {
    return (await handleAdminUserManagementRequest(request, env, async (adminRequest, responseHeaders) => {
      if (env.AUTH_BACKEND?.trim() !== "better-auth") {
        return errorResponse("auth_unavailable", 503, responseHeaders);
      }
      const authConfig = configuredAuth(env);
      if (!authConfig) return errorResponse("auth_unavailable", 503, responseHeaders);
      return authorizeAdminRequest(adminRequest, authConfig, responseHeaders);
    }, {
      deliverPasswordReset: async ({ email, redirectTo, requestHeaders }) => {
        const authConfig = configuredAuth(env);
        if (!authConfig || !isResendAuthEmailConfigured(env)) throw new Error("password_reset_delivery_unavailable");
        const callbackUrl = new URL(redirectTo, `${authConfig.url}/`);
        if (callbackUrl.origin !== authConfig.url) throw new Error("password_reset_redirect_invalid");
        const resetApi = createApplicationAuth(authConfig).api as unknown as {
          requestPasswordReset(input: {
            body: { email: string; redirectTo: string };
            headers: Headers;
          }): Promise<{ status: boolean }>;
        };
        const result = await resetApi.requestPasswordReset({
          body: { email, redirectTo: callbackUrl.href },
          headers: requestHeaders,
        });
        if (result.status !== true) throw new Error("password_reset_delivery_failed");
      },
    })) ?? errorResponse("not_found", 404, routeHeaders);
  }
  if (isAdminEmailTemplatesPath(url.pathname)) {
    return (await handleAdminEmailTemplatesRequest(request, env, async (adminRequest, responseHeaders) => {
      if (env.AUTH_BACKEND?.trim() !== "better-auth") {
        return errorResponse("auth_unavailable", 503, responseHeaders);
      }
      const authConfig = configuredAuth(env);
      if (!authConfig) return errorResponse("auth_unavailable", 503, responseHeaders);
      return authorizeAdminRequest(adminRequest, authConfig, responseHeaders);
    })) ?? errorResponse("not_found", 404, routeHeaders);
  }
  if (url.pathname === "/api/admin/reference-masters/pricing") {
    return handleReferenceMasterAdminRequest(request, env, url);
  }
  if (isNotificationMasterPath(url.pathname)) {
    return (await handleNotificationMasterRequest(request, env, async (adminRequest, responseHeaders) => {
      if (env.AUTH_BACKEND?.trim() !== "better-auth") {
        return errorResponse("auth_unavailable", 503, responseHeaders);
      }
      const authConfig = configuredAuth(env);
      if (!authConfig) return errorResponse("auth_unavailable", 503, responseHeaders);
      return authorizeAdminRequest(adminRequest, authConfig, responseHeaders);
    })) ?? errorResponse("not_found", 404, routeHeaders);
  }
  if (isInvitationAdminPath(url.pathname)) {
    return (await handleInvitationAdminRequest(request, env, async (adminRequest, responseHeaders) => {
      if (env.AUTH_BACKEND?.trim() !== "better-auth") {
        return errorResponse("auth_unavailable", 503, responseHeaders);
      }
      const authConfig = configuredAuth(env);
      if (!authConfig) return errorResponse("auth_unavailable", 503, responseHeaders);
      return authorizeAdminRequest(adminRequest, authConfig, responseHeaders);
    })) ?? errorResponse("not_found", 404, routeHeaders);
  }
  if (isWaitlistAdminPath(url.pathname)) {
    return (await handleWaitlistAdminRequest(request, env, async (adminRequest, responseHeaders) => {
      if (env.AUTH_BACKEND?.trim() !== "better-auth") {
        return errorResponse("auth_unavailable", 503, responseHeaders);
      }
      const authConfig = configuredAuth(env);
      if (!authConfig) return errorResponse("auth_unavailable", 503, responseHeaders);
      return authorizeAdminRequest(adminRequest, authConfig, responseHeaders);
    })) ?? errorResponse("not_found", 404, routeHeaders);
  }
  if (isExtensionCouponAdminPath(url.pathname)) {
    return (await handleExtensionCouponAdminRequest(request, env, async (adminRequest, responseHeaders) => {
      if (env.AUTH_BACKEND?.trim() !== "better-auth") {
        return errorResponse("auth_unavailable", 503, responseHeaders);
      }
      const authConfig = configuredAuth(env);
      if (!authConfig) return errorResponse("auth_unavailable", 503, responseHeaders);
      return authorizeAdminRequest(adminRequest, authConfig, responseHeaders);
    })) ?? errorResponse("not_found", 404, routeHeaders);
  }
  const referenceMasterServiceResponse = await handleReferenceMasterServiceRequest(request, env);
  if (referenceMasterServiceResponse) return referenceMasterServiceResponse;
  if (isOwnedFanmarksPath(url.pathname)) {
    return handleOwnedFanmarksRequest(request, env, resolveStorageAuth);
  }
  if (isFanmarkProfilePath(url.pathname)) {
    return handleFanmarkProfileRequest(request, env, resolveStorageAuth);
  }
  if (isFanmarkSettingsPath(url.pathname)) {
    return handleFanmarkSettingsRequest(request, env, resolveStorageAuth);
  }
  if (isFanmarkReturnPath(url.pathname)) {
    return handleFanmarkReturnRequest(request, env, resolveStorageAuth);
  }
  if (isFanmarkBulkReturnPath(url.pathname)) {
    return handleFanmarkBulkReturnRequest(request, env, resolveStorageAuth);
  }
  if (isFanmarkRegistrationPath(url.pathname)) {
    return handleFanmarkRegistrationRequest(request, env, resolveStorageAuth);
  }
  if (isFanmarkLotteryPath(url.pathname)) {
    return handleFanmarkLotteryRequest(request, env, resolveStorageAuth);
  }
  if (isFanmarkTransferPath(url.pathname)) {
    return handleFanmarkTransferRequest(request, env, resolveStorageAuth);
  }
  if (isFanmarkSearchDetailsPath(url.pathname)) {
    return (await handleFanmarkSearchDetailsRequest(request, env, resolveStorageAuth, availabilityClock)) ??
      errorResponse("not_found", 404, routeHeaders);
  }
  if (isFanmarkDetailsPath(url.pathname)) {
    return (await handleFanmarkDetailsRequest(request, env, resolveStorageAuth, availabilityClock)) ??
      errorResponse("not_found", 404, routeHeaders);
  }
  if (isProfilePath(url.pathname)) {
    return handleProfileRequest(request, env, resolveStorageAuth);
  }
  if (isUsernameAvailabilityPath(url.pathname)) {
    return (await handleUsernameAvailabilityRequest(request, env, resolveStorageAuth)) ?? errorResponse("not_found", 404, routeHeaders);
  }
  const fanmarkAnalyticsResponse = await handleFanmarkAnalyticsRequest(request, env, resolveStorageAuth, availabilityClock);
  if (fanmarkAnalyticsResponse) return fanmarkAnalyticsResponse;
  if (isNotificationsPath(url.pathname)) {
    return handleNotificationsRequest(request, env, resolveStorageAuth);
  }
  if (isFavoritesPath(url.pathname)) {
    return handleFavoritesRequest(request, env, resolveStorageAuth);
  }
  if (isSubscriptionPath(url.pathname)) {
    return (await handleSubscriptionRequest(request, env, resolveStorageAuth)) ?? errorResponse("not_found", 404, routeHeaders);
  }
  if (isEmojiMasterAdminPath(url)) {
    return handleEmojiMasterAdminRequest(request, env, url);
  }
  if (url.pathname === "/api/admin" || url.pathname.startsWith("/api/admin/")) {
    return errorResponse("not_found", 404, baseHeaders());
  }

  if (isVerifiedAccessPath(url.pathname)) {
    if (env.VERIFIED_ACCESS_BACKEND?.trim() !== "d1") {
      return errorResponse("verified_access_unavailable", 503, routeHeaders);
    }
    const businessDatabase = selectD1Database(env, "business");
    if (!businessDatabase || !env.VERIFIED_ACCESS_SECRET) {
      return errorResponse("server_misconfigured", 500, routeHeaders);
    }
    return handleVerifiedAccessRequest(request, {
      ...env,
      ACCESS_DB: businessDatabase,
      MASTER_DB: selectD1Database(env, "master"),
      VERIFIED_ACCESS_ORIGINS: env.CORS_ALLOWED_ORIGINS,
    });
  }

  const storageResponse = await handleStorageRequest(request, env, resolveStorageAuth);
  if (storageResponse) return storageResponse;

  const publicAccessRoute = parsePublicAccessRoute(url);
  const isEmojiCatalogRoute = url.pathname === "/api/emoji/catalog";
  const isReferenceMasterApiRoute = isReferenceMasterPath(url);
  const referenceMasterRoute = parseReferenceMasterRoute(url);
  if (isReferenceMasterApiRoute && referenceMasterRoute === null) {
    return errorResponse("not_found", 404, routeHeaders);
  }
  if (
    url.pathname !== "/api/fanmarks/recent" &&
    url.pathname !== "/api/fanmarks/availability" &&
    !isEmojiCatalogRoute &&
    !isReferenceMasterApiRoute &&
    !publicAccessRoute
  ) {
    return errorResponse("not_found", 404, routeHeaders);
  }

  const isAvailabilityRoute = url.pathname === "/api/fanmarks/availability";
  const isRecentRoute = url.pathname === "/api/fanmarks/recent";
  const allowedMethods = publicAccessRoute
    ? publicAccessAllowedMethods(publicAccessRoute)
    : isEmojiCatalogRoute
      ? EMOJI_CATALOG_ALLOWED_METHODS
      : isReferenceMasterApiRoute
        ? REFERENCE_MASTER_ALLOWED_METHODS
        : isAvailabilityRoute
          ? AVAILABILITY_ALLOWED_METHODS
          : RECENT_ALLOWED_METHODS;
  const cors = corsHeaders(
    request,
    env,
    allowedMethods,
    publicAccessRoute
      ? publicAccessAllowedHeaders(publicAccessRoute)
      : isAvailabilityRoute
        ? AVAILABILITY_ALLOWED_HEADERS
        : undefined,
  );
  if (!cors.allowed) {
    return errorResponse("forbidden_origin", 403, routeHeaders);
  }

  const method = request.method.toUpperCase();
  const responseHeaders = new Headers(routeHeaders);
  cors.headers.forEach((value, key) => responseHeaders.set(key, value));

  if (method === "OPTIONS") {
    responseHeaders.set("allow", allowedMethods);
    return emptyResponse(204, responseHeaders);
  }

  if (publicAccessRoute) {
    if (publicAccessRoute.kind === "emoji") {
      if (method !== "POST") {
        responseHeaders.set("allow", allowedMethods);
        return errorResponse("method_not_allowed", 405, responseHeaders);
      }
      const emojiIds = await parsePublicAccessEmojiRequest(request);
      if (!emojiIds) return errorResponse("invalid_request", 400, responseHeaders);
      try {
        const repository = createPublicAccessRepository(env, publicAccessClock);
        const row = await repository.getByEmojiIds(emojiIds, publicAccessClock());
        if (!row) return errorResponse("not_found", 404, responseHeaders);
        return publicAccessJsonResponse(mapPublicAccessRow(row), 200, responseHeaders);
      } catch (error) {
        if (error instanceof PublicAccessUnavailableError) {
          return errorResponse("public_access_unavailable", 503, responseHeaders);
        }
        if (error instanceof PublicAccessConfigurationError) {
          return errorResponse("server_misconfigured", 500, responseHeaders);
        }
        if (error instanceof PublicAccessResponseTooLargeError || error instanceof PublicAccessUpstreamError) {
          return errorResponse("upstream_unavailable", 502, responseHeaders);
        }
        return errorResponse("upstream_unavailable", 502, responseHeaders);
      }
    }

    if (method !== "GET") {
      responseHeaders.set("allow", allowedMethods);
      return errorResponse("method_not_allowed", 405, responseHeaders);
    }

    try {
      const repository = createPublicAccessRepository(env, publicAccessClock);
      if (publicAccessRoute.kind === "short") {
        const shortId = parsePublicAccessPathValue(publicAccessRoute.rawValue);
        if (!shortId) return errorResponse("invalid_request", 400, responseHeaders);
        const row = await repository.getByShortId(shortId);
        if (!row) return errorResponse("not_found", 404, responseHeaders);
        return publicAccessJsonResponse(mapPublicAccessRow(row), 200, responseHeaders);
      }

      const licenseId = parsePublicAccessPathValue(publicAccessRoute.rawValue);
      if (!licenseId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(licenseId)) {
        return errorResponse("invalid_request", 400, responseHeaders);
      }
      const row = await repository.getPublicProfile(licenseId.toLowerCase(), publicAccessClock());
      if (!row) return errorResponse("not_found", 404, responseHeaders);
      return publicAccessJsonResponse(mapPublicProfileRow(row), 200, responseHeaders);
    } catch (error) {
      if (error instanceof PublicAccessUnavailableError) {
        return errorResponse("public_access_unavailable", 503, responseHeaders);
      }
      if (error instanceof PublicAccessConfigurationError) {
        return errorResponse("server_misconfigured", 500, responseHeaders);
      }
      if (error instanceof PublicAccessResponseTooLargeError || error instanceof PublicAccessUpstreamError) {
        return errorResponse("upstream_unavailable", 502, responseHeaders);
      }
      return errorResponse("upstream_unavailable", 502, responseHeaders);
    }
  }

  if (isEmojiCatalogRoute) {
    if (method !== "GET") {
      responseHeaders.set("allow", allowedMethods);
      return errorResponse("method_not_allowed", 405, responseHeaders);
    }
    const pageRequest = parseEmojiCatalogPageRequest(url);
    if (!pageRequest) return errorResponse("invalid_request", 400, responseHeaders);
    try {
      const repository = createEmojiMasterD1Repository(env);
      const page = await repository.readPage(pageRequest);
      return jsonResponse({ schemaVersion: 1, ...page }, 200, responseHeaders);
    } catch (error) {
      if (error instanceof EmojiCatalogUnavailableError) {
        return errorResponse("emoji_catalog_unavailable", 503, responseHeaders);
      }
      if (error instanceof EmojiCatalogConfigurationError) {
        return errorResponse("server_misconfigured", 500, responseHeaders);
      }
      if (error instanceof EmojiCatalogUpstreamError) {
        return errorResponse("upstream_unavailable", 502, responseHeaders);
      }
      return errorResponse("upstream_unavailable", 502, responseHeaders);
    }
  }

  if (isReferenceMasterApiRoute && referenceMasterRoute) {
    if (method !== "GET") {
      responseHeaders.set("allow", allowedMethods);
      return errorResponse("method_not_allowed", 405, responseHeaders);
    }
    try {
      const repository = createReferenceMasterD1Repository(env);
      return jsonResponse(await repository.readMaster(referenceMasterRoute), 200, responseHeaders);
    } catch (error) {
      if (error instanceof ReferenceMasterUnavailableError) {
        return errorResponse("reference_master_unavailable", 503, responseHeaders);
      }
      if (error instanceof ReferenceMasterConfigurationError) {
        return errorResponse("server_misconfigured", 500, responseHeaders);
      }
      if (error instanceof ReferenceMasterUpstreamError) {
        return errorResponse("upstream_unavailable", 502, responseHeaders);
      }
      return errorResponse("upstream_unavailable", 502, responseHeaders);
    }
  }

  if (isAvailabilityRoute) {
    if (method !== "POST") {
      responseHeaders.set("allow", allowedMethods);
      return errorResponse("method_not_allowed", 405, responseHeaders);
    }

    const emojiIds = await parseAvailabilityRequest(request);
    if (!emojiIds) return errorResponse("invalid_request", 400, responseHeaders);

    try {
      const repository = createAvailabilityRepository(env, outboundFetch, availabilityClock);
      const result = await repository.checkAvailability(emojiIds);
      return jsonResponse(
        { schemaVersion: 1, result: sanitizeAvailabilityResult(result) },
        200,
        responseHeaders,
      );
    } catch (error) {
      if (error instanceof AvailabilityConfigurationError) {
        return errorResponse("server_misconfigured", 500, responseHeaders);
      }
      if (error instanceof AvailabilityTimeoutError) {
        return errorResponse("upstream_timeout", 504, responseHeaders);
      }
      if (error instanceof AvailabilityUpstreamError) {
        return errorResponse("upstream_unavailable", 502, responseHeaders);
      }
      return errorResponse("upstream_unavailable", 502, responseHeaders);
    }
  }

  if (!isRecentRoute || method !== "GET") {
    responseHeaders.set("allow", allowedMethods);
    return errorResponse("method_not_allowed", 405, responseHeaders);
  }

  const limit = parseLimit(url);
  if (limit === null) return errorResponse("invalid_limit", 400, responseHeaders);

  try {
    const repository = createRecentFanmarksRepository(env, outboundFetch);
    const rows = await repository.listRecent(limit);
    return jsonResponse(mapRecentFanmarkRows(rows, limit), 200, responseHeaders);
  } catch (error) {
    if (error instanceof RecentFanmarksConfigurationError) {
      return errorResponse("server_misconfigured", 500, responseHeaders);
    }
    if (error instanceof RecentFanmarksTimeoutError) {
      return errorResponse("upstream_timeout", 504, responseHeaders);
    }
    if (error instanceof RecentFanmarksUpstreamError) {
      return errorResponse("upstream_unavailable", 502, responseHeaders);
    }
    return errorResponse("upstream_unavailable", 502, responseHeaders);
  }
}

const worker = {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const selectedJobs = new Set(selectScheduledJobs(controller.cron, env));
    const jobs: Promise<unknown>[] = [];
    if (selectedJobs.has("license-expiry")) {
      jobs.push(runScheduledLicenseExpiry({
        scheduledTime: controller.scheduledTime,
        env,
        database: selectD1Database(env, "business"),
      }).then((summary) => {
        const finalization = "graceFinalization" in summary ? summary.graceFinalization : undefined;
        console.log(JSON.stringify({
          job: "license-expiry-lifecycle",
          status: summary.status,
          runId: "runId" in summary ? summary.runId : undefined,
          candidateCount: "candidateCount" in summary ? summary.candidateCount : undefined,
          processed: "processed" in summary ? summary.processed : undefined,
          conflicts: "conflicts" in summary ? summary.conflicts : undefined,
          pagesProcessed: "pagesProcessed" in summary ? summary.pagesProcessed : undefined,
          graceFinalizationStatus: finalization?.status,
          graceFinalizationRunId: finalization && "runId" in finalization ? finalization.runId : undefined,
          graceFinalizationCandidates: finalization && "candidateCount" in finalization
            ? finalization.candidateCount
            : undefined,
          graceFinalizationProcessed: finalization && "processed" in finalization
            ? finalization.processed
            : undefined,
          graceFinalizationConflicts: finalization && "conflicts" in finalization
            ? finalization.conflicts
            : undefined,
          graceFinalizationPagesProcessed: finalization && "pagesProcessed" in finalization
            ? finalization.pagesProcessed
            : undefined,
        }));
      }).catch((error: unknown) => {
        const code = error instanceof ScheduledLicenseExpiryError
          ? error.code
          : "unexpected_error";
        console.error(JSON.stringify({ job: "license-expiry-lifecycle", status: "failed", code }));
        throw error;
      }));
    }
    if (selectedJobs.has("notification-events")) {
      jobs.push(runScheduledNotificationEvents({ env, scheduledTime: controller.scheduledTime })
        .then((summary) => {
          console.log(JSON.stringify({ job: "notification-events", ...summary }));
        }).catch((error: unknown) => {
          console.error(JSON.stringify({ job: "notification-events", status: "failed", code: "notification_processor_failed" }));
          throw error;
        }));
    }
    if (selectedJobs.has("stripe-webhook-dispatch")) {
      jobs.push(runScheduledStripeWebhookDispatches({ env, scheduledTime: controller.scheduledTime })
        .then((summary) => {
          console.log(JSON.stringify({ job: "stripe-webhook-dispatch", ...summary }));
        }).catch((error: unknown) => {
          console.error(JSON.stringify({ job: "stripe-webhook-dispatch", status: "failed", code: "stripe_dispatch_failed" }));
          throw error;
        }));
    }
    const completion = Promise.all(jobs);
    ctx.waitUntil(completion);
    await completion;
  },
} satisfies ExportedHandler<Env>;

export default worker;
