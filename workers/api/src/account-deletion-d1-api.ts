import { selectD1Database, type Env } from "./repository";
import { FanmarkReturnApiError, returnAllActiveFanmarksForAccountDeletion } from "./fanmark-return-d1-api";

const ACCOUNT_DELETION_PATH = "/api/me/account/delete";
const METHODS = "POST, OPTIONS";
const MAX_REQUEST_BYTES = 4 * 1024;
const MAX_PASSWORD_LENGTH = 256;
const MAX_SUBSCRIPTIONS = 1_000;
const MAX_ACTIVE_LICENSES = 1_000;
const CUSTOMER_ID = /^cus_[A-Za-z0-9]+$/u;
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]+$/u;
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired"]);

export interface AccountDeletionSubscription {
  subscriptionId: string;
  customerId: string;
  status: string;
}

export interface AccountDeletionDependencies {
  resolveUser(request: Request, env: Env): Promise<{ userId: string } | null>;
  verifyPassword(request: Request, password: string, env: Env): Promise<boolean>;
  cancelCustomerSubscriptions(customerIds: string[], env: Env): Promise<void>;
  deleteAuthUser(request: Request, password: string, env: Env): Promise<{ success: boolean; setCookie?: string }>;
}

export class AccountDeletionApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "AccountDeletionApiError";
    this.code = code;
    this.status = status;
  }
}

function json(body: unknown, status: number, headers?: HeadersInit, setCookie?: string): Response {
  const resultHeaders = new Headers(headers);
  resultHeaders.set("cache-control", "no-store");
  resultHeaders.set("content-type", "application/json; charset=utf-8");
  resultHeaders.set("x-content-type-options", "nosniff");
  if (setCookie) resultHeaders.append("set-cookie", setCookie);
  return new Response(JSON.stringify(body), { status, headers: resultHeaders });
}

function originHeaders(request: Request, env: Env): Headers | null {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (!origin) return headers;
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  if (!allowed.has(origin)) return null;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", METHODS);
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readDeleteConfirmation(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new AccountDeletionApiError("json_content_type_required", 415);
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) {
    throw new AccountDeletionApiError("request_too_large", 413);
  }
  if (!request.body) throw new AccountDeletionApiError("invalid_request", 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new AccountDeletionApiError("request_too_large", 413);
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
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new AccountDeletionApiError("invalid_json", 400);
  }
  if (!isRecord(value) || Object.keys(value).length !== 2 || value.confirmation !== "DELETE" ||
      typeof value.password !== "string" || value.password.length < 1 || value.password.length > MAX_PASSWORD_LENGTH) {
    throw new AccountDeletionApiError("invalid_request", 400);
  }
  return value.password;
}

async function readBillingLinks(database: D1Database, userId: string): Promise<string[]> {
  const [profile, subscriptions] = await Promise.all([
    database.prepare("SELECT stripe_customer_id FROM user_settings WHERE user_id = ? LIMIT 2")
      .bind(userId).all<{ stripe_customer_id: unknown }>(),
    database.prepare(`
      SELECT stripe_customer_id, stripe_subscription_id, status
      FROM user_subscriptions WHERE user_id = ? ORDER BY stripe_subscription_id LIMIT ?
    `).bind(userId, MAX_SUBSCRIPTIONS + 1).all<{
      stripe_customer_id: unknown;
      stripe_subscription_id: unknown;
      status: unknown;
    }>(),
  ]);
  if (!profile.success || profile.results.length > 1 || !subscriptions.success ||
      subscriptions.results.length > MAX_SUBSCRIPTIONS) {
    throw new AccountDeletionApiError("account_delete_unavailable", 503);
  }

  const customerIds = new Set<string>();
  for (const row of profile.results) {
    if (row.stripe_customer_id === null || row.stripe_customer_id === undefined || row.stripe_customer_id === "") continue;
    if (typeof row.stripe_customer_id !== "string" || !CUSTOMER_ID.test(row.stripe_customer_id)) {
      throw new AccountDeletionApiError("billing_identity_unavailable", 503);
    }
    customerIds.add(row.stripe_customer_id);
  }
  for (const row of subscriptions.results) {
    if (typeof row.stripe_customer_id !== "string" || !CUSTOMER_ID.test(row.stripe_customer_id) ||
        typeof row.stripe_subscription_id !== "string" || !SUBSCRIPTION_ID.test(row.stripe_subscription_id) ||
        typeof row.status !== "string" || row.status.length < 1 || row.status.length > 64) {
      throw new AccountDeletionApiError("billing_identity_unavailable", 503);
    }
    customerIds.add(row.stripe_customer_id);
  }
  if (customerIds.size > 10) throw new AccountDeletionApiError("billing_identity_unavailable", 503);

  for (const customerId of customerIds) {
    const [sharedProfile, sharedSubscription] = await Promise.all([
      database.prepare("SELECT 1 AS found FROM user_settings WHERE stripe_customer_id = ? AND user_id <> ? LIMIT 1")
        .bind(customerId, userId).first(),
      database.prepare("SELECT 1 AS found FROM user_subscriptions WHERE stripe_customer_id = ? AND user_id <> ? LIMIT 1")
        .bind(customerId, userId).first(),
    ]);
    if (sharedProfile || sharedSubscription) {
      throw new AccountDeletionApiError("billing_identity_shared", 409);
    }
  }
  return [...customerIds].sort();
}

async function preflightLicenseReturns(database: D1Database, userId: string, nowIso: string): Promise<void> {
  const licenses = await database.prepare(`
    SELECT id
    FROM fanmark_licenses
    WHERE user_id = ? AND status = 'active'
      AND (license_end IS NULL OR license_end > ?)
    ORDER BY CASE WHEN license_end IS NULL THEN 1 ELSE 0 END ASC,
             license_end DESC, id ASC
    LIMIT ?
  `).bind(userId, nowIso, MAX_ACTIVE_LICENSES + 1).all<{ id: unknown }>();
  if (!licenses.success || licenses.results.length > MAX_ACTIVE_LICENSES ||
      licenses.results.some((row) => typeof row.id !== "string")) {
    throw new AccountDeletionApiError("account_delete_unavailable", 503);
  }

  const activeTransfer = await database.prepare(`
    SELECT 1 AS found
    FROM fanmark_transfer_codes AS transfer
    JOIN fanmark_licenses AS license ON license.id = transfer.license_id
    WHERE license.user_id = ? AND license.status = 'active'
      AND (license.license_end IS NULL OR license.license_end > ?)
      AND transfer.status IN ('active', 'applied')
    LIMIT 1
  `).bind(userId, nowIso).first();
  if (activeTransfer) throw new AccountDeletionApiError("transfer_in_progress", 409);
}

async function cleanupBusinessRows(database: D1Database, userId: string, nowIso: string): Promise<void> {
  const existingDeletionAudit = await database.prepare(`
    SELECT id FROM audit_logs
    WHERE user_id = ? AND action = 'DELETE_ACCOUNT' AND resource_type = 'user' AND resource_id = ?
    LIMIT 1
  `).bind(userId, userId).first();
  const statements = [
    database.prepare("UPDATE fanmark_availability_rules SET created_by = NULL, updated_at = ? WHERE created_by = ?").bind(nowIso, userId),
    database.prepare("UPDATE notification_rules SET created_by = NULL, updated_at = ? WHERE created_by = ?").bind(nowIso, userId),
    database.prepare("UPDATE user_roles SET created_by = NULL WHERE created_by = ?").bind(userId),
    database.prepare(`
      UPDATE fanmark_lottery_entries
      SET entry_status = 'cancelled', cancelled_at = ?, cancellation_reason = 'user_request', updated_at = ?
      WHERE user_id = ? AND entry_status = 'pending'
    `).bind(nowIso, nowIso, userId),
    database.prepare("UPDATE fanmark_lottery_history SET winner_user_id = NULL WHERE winner_user_id = ?").bind(userId),
    database.prepare("DELETE FROM notifications WHERE user_id = ?").bind(userId),
    database.prepare(`
      DELETE FROM notification_events
      WHERE status IN ('pending', 'processing') AND json_extract(payload, '$.user_id') = ?
    `).bind(userId),
    database.prepare("DELETE FROM notification_preferences WHERE user_id = ?").bind(userId),
    database.prepare("DELETE FROM fanmark_favorites WHERE user_id = ?").bind(userId),
    database.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(userId),
    database.prepare("DELETE FROM user_settings WHERE user_id = ?").bind(userId),
    database.prepare("DELETE FROM enterprise_user_settings WHERE user_id = ?").bind(userId),
    database.prepare("DELETE FROM user_subscriptions WHERE user_id = ?").bind(userId),
    database.prepare("UPDATE fanmark_licenses SET user_id = NULL, updated_at = ? WHERE user_id = ?").bind(nowIso, userId),
  ];
  if (!existingDeletionAudit) {
    statements.push(database.prepare(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata, created_at)
      VALUES (?, 'DELETE_ACCOUNT', 'user', ?, ?, ?)
    `).bind(userId, userId, JSON.stringify({ deletion_method: "user_initiated", deleted_at: nowIso }), nowIso));
  }

  const results = await database.batch(statements);
  if (results.length !== statements.length || results.some((result) => !result.success)) {
    throw new AccountDeletionApiError("account_delete_unavailable", 503);
  }
  const verification = await database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM user_settings WHERE user_id = ?) AS settings,
      (SELECT COUNT(*) FROM fanmark_licenses WHERE user_id = ?) AS licenses,
      (SELECT COUNT(*) FROM fanmark_favorites WHERE user_id = ?) AS favorites,
      (SELECT COUNT(*) FROM notifications WHERE user_id = ?) AS notifications,
      (SELECT COUNT(*) FROM notification_preferences WHERE user_id = ?) AS preferences,
      (SELECT COUNT(*) FROM user_roles WHERE user_id = ?) AS roles,
      (SELECT COUNT(*) FROM user_subscriptions WHERE user_id = ?) AS subscriptions,
      (SELECT COUNT(*) FROM enterprise_user_settings WHERE user_id = ?) AS enterprise_settings,
      (SELECT COUNT(*) FROM fanmark_lottery_entries WHERE user_id = ? AND entry_status = 'pending') AS pending_lottery_entries,
      (SELECT COUNT(*) FROM notification_events WHERE status IN ('pending', 'processing') AND json_extract(payload, '$.user_id') = ?) AS pending_user_notifications
  `).bind(userId, userId, userId, userId, userId, userId, userId, userId, userId, userId)
    .first<Record<string, unknown>>();
  if (!verification || Object.values(verification).some((value) => value !== 0)) {
    throw new AccountDeletionApiError("account_delete_unavailable", 503);
  }
}

export function isAccountDeletionPath(pathname: string): boolean {
  return pathname === ACCOUNT_DELETION_PATH;
}

export async function handleAccountDeletionRequest(
  request: Request,
  env: Env,
  dependencies: AccountDeletionDependencies,
  clock: () => Date = () => new Date(),
): Promise<Response> {
  const headers = originHeaders(request, env);
  if (!headers) return json({ error: "origin_not_allowed" }, 403);
  if (request.method === "OPTIONS") {
    const requestedMethod = request.headers.get("access-control-request-method")?.toUpperCase();
    if (requestedMethod && requestedMethod !== "POST") {
      headers.set("allow", METHODS);
      return json({ error: "method_not_allowed" }, 405, headers);
    }
    headers.set("allow", METHODS);
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") {
    headers.set("allow", METHODS);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  if (env.ACCOUNT_DELETION_BACKEND?.trim() !== "d1") return json({ error: "account_delete_unavailable" }, 503, headers);
  if (env.AUTH_BACKEND?.trim() !== "better-auth" || env.D1_TOPOLOGY?.trim() !== "split") {
    return json({ error: "server_misconfigured" }, 503, headers);
  }
  const database = selectD1Database(env, "business");
  if (!database) return json({ error: "server_misconfigured" }, 503, headers);

  let password: string;
  try {
    password = await readDeleteConfirmation(request);
  } catch (error) {
    const failure = error instanceof AccountDeletionApiError ? error : new AccountDeletionApiError("invalid_request", 400);
    return json({ error: failure.code }, failure.status, headers);
  }

  let currentUser: { userId: string } | null;
  try {
    currentUser = await dependencies.resolveUser(request, env);
  } catch {
    return json({ error: "auth_unavailable" }, 503, headers);
  }
  if (!currentUser || typeof currentUser.userId !== "string" || currentUser.userId.length < 1 || currentUser.userId.length > 128) {
    return json({ error: "unauthenticated" }, 401, headers);
  }
  const userId = currentUser.userId;

  try {
    const passwordValid = await dependencies.verifyPassword(request, password, env);
    if (!passwordValid) return json({ error: "invalid_credentials" }, 401, headers);

    // Supabase's source FK is NO ACTION. Reject before cancelling Stripe or
    // returning licenses so this account cannot be left half deleted.
    const authoredBroadcast = await database.prepare(
      "SELECT 1 AS found FROM broadcast_emails WHERE created_by = ? LIMIT 1",
    ).bind(userId).first();
    if (authoredBroadcast) return json({ error: "account_delete_blocked" }, 409, headers);

    const operationNow = clock();
    await preflightLicenseReturns(database, userId, operationNow.toISOString());

    const customerIds = await readBillingLinks(database, userId);
    await dependencies.cancelCustomerSubscriptions(customerIds, env);

    try {
      await returnAllActiveFanmarksForAccountDeletion(database, userId, operationNow);
    } catch (error) {
      if (error instanceof FanmarkReturnApiError) {
        return json({ error: error.code }, error.status === 404 ? 409 : error.status, headers);
      }
      return json({ error: "account_delete_unavailable" }, 503, headers);
    }

    await cleanupBusinessRows(database, userId, operationNow.toISOString());
    const deleted = await dependencies.deleteAuthUser(request, password, env);
    if (!deleted.success) return json({ error: "auth_delete_failed" }, 503, headers);
    return json({ success: true, message: "Account deleted successfully" }, 200, headers, deleted.setCookie);
  } catch (error) {
    if (error instanceof AccountDeletionApiError) return json({ error: error.code }, error.status, headers);
    return json({ error: "account_delete_unavailable" }, 503, headers);
  }
}
