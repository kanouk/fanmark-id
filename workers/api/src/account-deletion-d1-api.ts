import { selectD1Database, type Env } from "./repository";
import { FanmarkReturnApiError, returnAllActiveFanmarksForAccountDeletion } from "./fanmark-return-d1-api";
import { toUtcMicrosecondTimestamp } from "./utc-timestamp";
import { prepareLotteryCancellation } from "./lottery-cancellation-audit";

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
  deleteAuthUser(request: Request, password: string, env: Env, expectedUserId: string): Promise<{ success: boolean; setCookies?: string[] }>;
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

function json(body: unknown, status: number, headers?: HeadersInit, setCookies: string[] = []): Response {
  const resultHeaders = new Headers(headers);
  resultHeaders.set("cache-control", "no-store");
  resultHeaders.set("content-type", "application/json; charset=utf-8");
  resultHeaders.set("x-content-type-options", "nosniff");
  for (const cookie of setCookies) resultHeaders.append("set-cookie", cookie);
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

interface AccountDeletionBillingSnapshot {
  customerIds: string[];
  profiles: string;
  subscriptions: string;
}

async function readBillingLinks(database: D1Database, userId: string): Promise<AccountDeletionBillingSnapshot> {
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
  return { customerIds: [...customerIds].sort(), profiles: JSON.stringify(profile.results), subscriptions: JSON.stringify(subscriptions.results) };
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

async function cleanupBusinessRows(database: D1Database, userId: string, nowIso: string, billing: AccountDeletionBillingSnapshot): Promise<void> {
  const audits = await database.prepare(`
    SELECT id, metadata, created_at, request_id FROM audit_logs
    WHERE user_id = ? AND action = 'DELETE_ACCOUNT' AND resource_type = 'user' AND resource_id = ?
    LIMIT 2
  `).bind(userId, userId).all<{ id: string; metadata: string; created_at: string; request_id: string | null }>();
  if (!audits.success || audits.results.length > 1) throw new AccountDeletionApiError("account_delete_unavailable", 503);
  const existing = audits.results[0];
  if (existing) {
    let metadata: unknown;
    try { metadata = JSON.parse(existing.metadata) as unknown; } catch {
      throw new AccountDeletionApiError("account_delete_unavailable", 503);
    }
    if (typeof existing.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(existing.id) ||
        typeof existing.created_at !== "string" || !Number.isFinite(Date.parse(existing.created_at)) ||
        existing.request_id !== null || !isRecord(metadata) || Object.keys(metadata).length !== 2 ||
        metadata.deletion_method !== "user_initiated" || metadata.deleted_at !== existing.created_at) {
      throw new AccountDeletionApiError("account_delete_unavailable", 503);
    }
  }
  const auditId = existing?.id ?? crypto.randomUUID();
  const auditTime = existing?.created_at ?? nowIso;
  const auditMetadata = JSON.stringify({ deletion_method: "user_initiated", deleted_at: auditTime });
  const exactAudit = `id = ? AND user_id = ? AND action = 'DELETE_ACCOUNT'
    AND resource_type = 'user' AND resource_id = ? AND request_id IS NULL
    AND created_at = ? AND json(metadata) = json(?)`;
  const auditBindings = [auditId, userId, userId, auditTime, auditMetadata];
  const cancellation = await prepareLotteryCancellation(database, "user", userId, "user_request", nowIso);

  // Cross-database SET NULL references must retain their original rows. Merely
  // counting remaining owned rows would also accept a trigger deleting history.
  const retainedSpecs = [
    { table: "fanmark_availability_rules", column: "created_by", where: "created_by = ?", timed: true, fields: [] },
    { table: "notification_rules", column: "created_by", where: "created_by = ?", timed: true, fields: [] },
    { table: "user_roles", column: "created_by", where: "created_by = ? AND user_id <> ?", timed: false, fields: ["user_id", "role"] },
    { table: "fanmark_lottery_history", column: "winner_user_id", where: "winner_user_id = ?", timed: false, fields: [] },
    { table: "fanmark_licenses", column: "user_id", where: "user_id = ?", timed: true,
      fields: ["fanmark_id", "license_start", "license_end", "status", "grace_expires_at", "is_returned", "created_at"] },
  ] as const;
  const retained = await Promise.all(retainedSpecs.map(async spec => {
    const rows = await database.prepare(`SELECT id${spec.fields.map(field => `, ${field}`).join("")}
      FROM ${spec.table} WHERE ${spec.where} ORDER BY id`)
      .bind(...(spec.table === "user_roles" ? [userId, userId] : [userId])).all();
    if (!rows.success) throw new AccountDeletionApiError("account_delete_unavailable", 503);
    return { ...spec, snapshot: JSON.stringify(rows.results) };
  }));
  const retentionGuards = retained.map(spec => database.prepare(`SELECT CASE WHEN
    NOT EXISTS (SELECT 1 FROM json_each(?) AS item WHERE NOT EXISTS (
      SELECT 1 FROM ${spec.table} AS kept WHERE kept.id = json_extract(item.value, '$.id')
        AND kept.${spec.column} IS NULL ${spec.timed ? "AND kept.updated_at = ?" : ""}
        ${spec.fields.map(field => `AND kept.${field} IS json_extract(item.value, '$.${field}')`).join(" ")}
    )) THEN 1 ELSE json('account_delete_history_incomplete') END AS verified`
  ).bind(spec.snapshot, ...(spec.timed ? [nowIso] : [])));
  const statements = [
    database.prepare(`SELECT CASE WHEN
      (SELECT count(*) FROM audit_logs WHERE user_id = ? AND action = 'DELETE_ACCOUNT'
        AND resource_type = 'user' AND resource_id = ?) = ?
      ${existing ? `AND EXISTS (SELECT 1 FROM audit_logs WHERE ${exactAudit})` : ""}
      AND NOT EXISTS (SELECT 1 FROM broadcast_emails WHERE created_by = ?)
      THEN 1 ELSE json('account_delete_snapshot_changed') END AS verified`
    ).bind(userId, userId, existing ? 1 : 0, ...(existing ? auditBindings : []), userId),
    database.prepare(`SELECT CASE WHEN
      (SELECT count(*) FROM user_settings WHERE user_id = ?) = json_array_length(?)
      AND NOT EXISTS (SELECT 1 FROM json_each(?) AS item WHERE NOT EXISTS (
        SELECT 1 FROM user_settings WHERE user_id = ? AND stripe_customer_id IS json_extract(item.value, '$.stripe_customer_id')
      ))
      AND (SELECT count(*) FROM user_subscriptions WHERE user_id = ?) = json_array_length(?)
      AND NOT EXISTS (SELECT 1 FROM json_each(?) AS item WHERE NOT EXISTS (
        SELECT 1 FROM user_subscriptions WHERE user_id = ?
          AND stripe_customer_id = json_extract(item.value, '$.stripe_customer_id')
          AND stripe_subscription_id = json_extract(item.value, '$.stripe_subscription_id')
          AND status = json_extract(item.value, '$.status')
      ))
      AND NOT EXISTS (SELECT 1 FROM user_settings WHERE user_id <> ?
        AND stripe_customer_id IN (SELECT value FROM json_each(?)))
      AND NOT EXISTS (SELECT 1 FROM user_subscriptions WHERE user_id <> ?
        AND stripe_customer_id IN (SELECT value FROM json_each(?)))
      THEN 1 ELSE json('account_delete_billing_changed') END AS verified`
    ).bind(userId, billing.profiles, billing.profiles, userId,
      userId, billing.subscriptions, billing.subscriptions, userId,
      userId, JSON.stringify(billing.customerIds), userId, JSON.stringify(billing.customerIds)),
    cancellation.before,
    database.prepare("UPDATE fanmark_availability_rules SET created_by = NULL, updated_at = ? WHERE created_by = ?").bind(nowIso, userId),
    database.prepare("UPDATE notification_rules SET created_by = NULL, updated_at = ? WHERE created_by = ?").bind(nowIso, userId),
    database.prepare("UPDATE user_roles SET created_by = NULL WHERE created_by = ?").bind(userId),
    cancellation.insert,
    cancellation.update,
    database.prepare("UPDATE fanmark_lottery_history SET winner_user_id = NULL WHERE winner_user_id = ?").bind(userId),
    database.prepare("DELETE FROM notifications WHERE user_id = ?").bind(userId),
    database.prepare(`DELETE FROM notification_events
      WHERE status IN ('pending', 'processing') AND json_extract(payload, '$.user_id') = ?`).bind(userId),
    database.prepare("DELETE FROM notification_preferences WHERE user_id = ?").bind(userId),
    database.prepare("DELETE FROM fanmark_favorites WHERE user_id = ?").bind(userId),
    database.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(userId),
    database.prepare(`DELETE FROM user_settings WHERE user_id = ? AND EXISTS (
      SELECT 1 FROM json_each(?) AS item WHERE user_settings.stripe_customer_id IS json_extract(item.value, '$.stripe_customer_id')
    )`).bind(userId, billing.profiles),
    database.prepare("DELETE FROM enterprise_user_settings WHERE user_id = ?").bind(userId),
    database.prepare(`DELETE FROM user_subscriptions WHERE user_id = ? AND EXISTS (
      SELECT 1 FROM json_each(?) AS item
      WHERE user_subscriptions.stripe_customer_id = json_extract(item.value, '$.stripe_customer_id')
        AND user_subscriptions.stripe_subscription_id = json_extract(item.value, '$.stripe_subscription_id')
        AND user_subscriptions.status = json_extract(item.value, '$.status')
    )`).bind(userId, billing.subscriptions),
    database.prepare("UPDATE fanmark_licenses SET user_id = NULL, updated_at = ? WHERE user_id = ?").bind(nowIso, userId),
  ];
  if (!existing) statements.push(database.prepare(`
    INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata, created_at)
    VALUES (?, ?, 'DELETE_ACCOUNT', 'user', ?, ?, ?)
  `).bind(auditId, userId, userId, auditMetadata, auditTime));
  statements.push(cancellation.verify, ...retentionGuards,
    database.prepare(`SELECT CASE WHEN
      EXISTS (SELECT 1 FROM audit_logs WHERE ${exactAudit})
      AND (SELECT count(*) FROM audit_logs WHERE user_id = ? AND action = 'DELETE_ACCOUNT'
        AND resource_type = 'user' AND resource_id = ?) = 1
      AND NOT EXISTS (SELECT 1 FROM user_settings WHERE user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM fanmark_licenses WHERE user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM fanmark_favorites WHERE user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM notification_preferences WHERE user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = ? OR created_by = ?)
      AND NOT EXISTS (SELECT 1 FROM user_subscriptions WHERE user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM enterprise_user_settings WHERE user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM fanmark_lottery_entries WHERE user_id = ? AND entry_status = 'pending')
      AND NOT EXISTS (SELECT 1 FROM notification_events WHERE status IN ('pending', 'processing') AND json_extract(payload, '$.user_id') = ?)
      AND NOT EXISTS (SELECT 1 FROM fanmark_lottery_history WHERE winner_user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM fanmark_availability_rules WHERE created_by = ?)
      AND NOT EXISTS (SELECT 1 FROM notification_rules WHERE created_by = ?)
      AND NOT EXISTS (SELECT 1 FROM broadcast_emails WHERE created_by = ?)
      THEN 1 ELSE json('account_delete_cleanup_incomplete') END AS verified`
    ).bind(...auditBindings, ...Array.from({ length: 17 }, () => userId)));
  const results = await database.batch(statements);
  if (results.length !== statements.length || results.some(result => !result.success)) {
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
    const operationNowIso = toUtcMicrosecondTimestamp(operationNow);
    await preflightLicenseReturns(database, userId, operationNowIso);

    const billing = await readBillingLinks(database, userId);
    await dependencies.cancelCustomerSubscriptions(billing.customerIds, env);

    try {
      await returnAllActiveFanmarksForAccountDeletion(database, userId, operationNow);
    } catch (error) {
      if (error instanceof FanmarkReturnApiError) {
        return json({ error: error.code }, error.status === 404 ? 409 : error.status, headers);
      }
      return json({ error: "account_delete_unavailable" }, 503, headers);
    }

    await cleanupBusinessRows(database, userId, operationNowIso, billing);
    const deleted = await dependencies.deleteAuthUser(request, password, env, userId);
    if (!deleted.success) return json({ error: "auth_delete_failed" }, 503, headers);
    return json({ success: true, message: "Account deleted successfully" }, 200, headers, deleted.setCookies);
  } catch (error) {
    if (error instanceof AccountDeletionApiError) return json({ error: error.code }, error.status, headers);
    return json({ error: "account_delete_unavailable" }, 503, headers);
  }
}
