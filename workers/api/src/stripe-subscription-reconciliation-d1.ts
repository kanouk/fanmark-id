import { PINNED_STRIPE_API_VERSION } from "../../../supabase/functions/_shared/stripe-invoice-projection/index.ts";
import { StripeWebhookD1ApplicationError } from "./stripe-webhook-d1-application.ts";
import type { StripeWebhookD1Claim } from "./stripe-webhook-d1-dispatch.ts";

const FENCE_LEASE_SECONDS = 300;
const MAX_ACTIVE_SUBSCRIPTIONS = 100;
const MAX_STRIPE_SUBSCRIPTIONS = 1_000;
const MAX_GENERATION = Number.MAX_SAFE_INTEGER;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const HASH_RE = /^[0-9a-f]{64}$/u;
const SUBSCRIPTION_STATUSES = new Set([
  "incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused",
]);
const PLAN_ORDER = { creator: 1, max: 2, business: 3 } as const;
const PRICE_SETTING_KEYS = {
  creator: { test: "creator_stripe_price_id", live: "creator_stripe_price_id_live" },
  max: { test: "max_stripe_price_id", live: "max_stripe_price_id_live" },
  business: { test: "business_stripe_price_id", live: "business_stripe_price_id_live" },
} as const;

type PlanType = keyof typeof PLAN_ORDER;
type SubscriptionRecord = Record<string, unknown>;

export interface StripeSubscriptionReconciliationProvider {
  retrieveSubscription(subscriptionId: string): PromiseLike<unknown>;
  listActiveSubscriptions(customerId: string): PromiseLike<unknown[]>;
  retrieveCustomer(customerId: string): PromiseLike<unknown>;
}

export interface StripeSubscriptionApiClient {
  subscriptions: {
    retrieve(
      id: string,
      params: { expand: string[] },
      options: { apiVersion: typeof PINNED_STRIPE_API_VERSION },
    ): PromiseLike<unknown>;
    list(
      params: { customer: string; status: "active"; limit: number; starting_after?: string },
      options: { apiVersion: typeof PINNED_STRIPE_API_VERSION },
    ): PromiseLike<unknown>;
  };
  customers: {
    retrieve(
      id: string,
      params: Record<string, never>,
      options: { apiVersion: typeof PINNED_STRIPE_API_VERSION },
    ): PromiseLike<unknown>;
  };
}

export interface StripeSubscriptionD1ReconciliationResult {
  status: "applied" | "retryable" | "stale";
  code: string;
  applicationId?: string;
  effectivePlanType?: PlanType | "free";
  activeSubscriptionCount?: number;
}

interface ProjectedSubscription {
  id: string;
  customerId: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: number | null;
  productId: string;
  priceId: string;
  amount: number | null;
  currency: string | null;
  interval: string | null;
  intervalCount: number | null;
  planType: PlanType;
  rowId: string;
}

function asRecord(value: unknown): SubscriptionRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as SubscriptionRecord;
}

function requireText(value: unknown, code: string, maxBytes = 512): string {
  if (typeof value !== "string") throw new StripeWebhookD1ApplicationError(code);
  const result = value.trim();
  if (!result || new TextEncoder().encode(result).byteLength > maxBytes) {
    throw new StripeWebhookD1ApplicationError(code);
  }
  return result;
}

function requireUuid(value: unknown, code: string): string {
  const result = requireText(value, code, 36).toLowerCase();
  if (!UUID_RE.test(result)) throw new StripeWebhookD1ApplicationError(code);
  return result;
}

function requireIso(value: string, code: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new StripeWebhookD1ApplicationError(code);
  }
  return value;
}

function timestampFromSeconds(value: unknown, code: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new StripeWebhookD1ApplicationError(code);
  }
  const millis = value * 1000;
  if (!Number.isSafeInteger(millis) || Math.abs(millis) > 8_640_000_000_000_000) {
    throw new StripeWebhookD1ApplicationError(code);
  }
  return new Date(millis).toISOString();
}

function idFrom(value: unknown, code: string): string {
  if (typeof value === "string") return requireText(value, code, 255);
  const id = asRecord(value)?.id;
  return requireText(id, code, 255);
}

function requireMode(record: SubscriptionRecord, expected: boolean, code: string): void {
  if (typeof record.livemode !== "boolean" || record.livemode !== expected) {
    throw new StripeWebhookD1ApplicationError(code);
  }
}

function readSettingsRows<T>(result: D1Result<T> | undefined): T[] {
  if (!result?.success || !Array.isArray(result.results)) {
    throw new StripeWebhookD1ApplicationError("subscription_d1_read_failed");
  }
  return result.results;
}

function parsePriceSettings(rows: Array<{ setting_key: unknown; setting_value: unknown; is_public: unknown }>, livemode: boolean): Map<string, PlanType> {
  const settingToPlan = new Map<string, PlanType>();
  for (const plan of Object.keys(PRICE_SETTING_KEYS) as PlanType[]) {
    const key = PRICE_SETTING_KEYS[plan][livemode ? "live" : "test"];
    const matches = rows.filter((row) => row.setting_key === key);
    if (matches.length !== 1 || Number(matches[0].is_public) !== 0) {
      throw new StripeWebhookD1ApplicationError("subscription_price_configuration_review_required");
    }
    const priceId = requireText(matches[0].setting_value, "subscription_price_configuration_review_required", 255);
    if (!priceId.startsWith("price_")) {
      throw new StripeWebhookD1ApplicationError("subscription_price_configuration_review_required");
    }
    if ([...settingToPlan.keys()].includes(priceId)) {
      throw new StripeWebhookD1ApplicationError("subscription_price_configuration_conflict");
    }
    settingToPlan.set(priceId, plan);
  }
  return settingToPlan;
}

function projectSubscription(
  value: unknown,
  args: { customerId: string; livemode: boolean; pricePlans: Map<string, PlanType>; rowId: string },
): ProjectedSubscription {
  const record = asRecord(value);
  if (!record || record.object !== "subscription") {
    throw new StripeWebhookD1ApplicationError("subscription_snapshot_invalid");
  }
  const id = requireText(record.id, "subscription_snapshot_invalid", 255);
  if (idFrom(record.customer, "subscription_customer_mismatch") !== args.customerId) {
    throw new StripeWebhookD1ApplicationError("subscription_customer_mismatch");
  }
  requireMode(record, args.livemode, "subscription_mode_mismatch");
  const status = requireText(record.status, "subscription_status_invalid", 32);
  if (!SUBSCRIPTION_STATUSES.has(status)) throw new StripeWebhookD1ApplicationError("subscription_status_invalid");
  const items = asRecord(record.items);
  const itemRows = items && Array.isArray(items.data) ? items.data : null;
  const firstItem = asRecord(itemRows?.[0]);
  const price = asRecord(firstItem?.price);
  const priceId = idFrom(firstItem?.price, "subscription_price_invalid");
  const productId = idFrom(price?.product, "subscription_product_invalid");
  const planType = args.pricePlans.get(priceId);
  if (!planType) throw new StripeWebhookD1ApplicationError("subscription_price_unmapped");
  const unitAmount = price?.unit_amount;
  const intervalCount = asRecord(price?.recurring)?.interval_count;
  if (unitAmount !== null && unitAmount !== undefined &&
      (typeof unitAmount !== "number" || !Number.isSafeInteger(unitAmount))) {
    throw new StripeWebhookD1ApplicationError("subscription_amount_invalid");
  }
  if (intervalCount !== null && intervalCount !== undefined &&
      (typeof intervalCount !== "number" || !Number.isSafeInteger(intervalCount))) {
    throw new StripeWebhookD1ApplicationError("subscription_interval_invalid");
  }
  const currency = price?.currency;
  const interval = asRecord(price?.recurring)?.interval;
  if (currency !== null && currency !== undefined && typeof currency !== "string") {
    throw new StripeWebhookD1ApplicationError("subscription_currency_invalid");
  }
  if (interval !== null && interval !== undefined && typeof interval !== "string") {
    throw new StripeWebhookD1ApplicationError("subscription_interval_invalid");
  }
  const cancelAtPeriodEnd = record.cancel_at_period_end;
  if (typeof cancelAtPeriodEnd !== "boolean") {
    throw new StripeWebhookD1ApplicationError("subscription_cancel_state_invalid");
  }
  return {
    id,
    customerId: args.customerId,
    status,
    currentPeriodStart: timestampFromSeconds(record.current_period_start, "subscription_period_invalid"),
    currentPeriodEnd: timestampFromSeconds(record.current_period_end, "subscription_period_invalid"),
    cancelAtPeriodEnd: cancelAtPeriodEnd ? 1 : 0,
    productId,
    priceId,
    amount: unitAmount === null || unitAmount === undefined ? null : unitAmount as number,
    currency: currency === null || currency === undefined ? null : currency as string,
    interval: interval === null || interval === undefined ? null : interval as string,
    intervalCount: intervalCount === null || intervalCount === undefined ? null : intervalCount as number,
    planType,
    rowId: args.rowId,
  };
}

function sameProjection(a: ProjectedSubscription, b: ProjectedSubscription): boolean {
  return a.id === b.id && a.customerId === b.customerId && a.status === b.status &&
    a.currentPeriodStart === b.currentPeriodStart && a.currentPeriodEnd === b.currentPeriodEnd &&
    a.cancelAtPeriodEnd === b.cancelAtPeriodEnd && a.productId === b.productId &&
    a.priceId === b.priceId && a.amount === b.amount && a.currency === b.currency &&
    a.interval === b.interval && a.intervalCount === b.intervalCount;
}

async function acquireFence(args: {
  database: D1Database;
  claim: StripeWebhookD1Claim;
  customerId: string;
  now: string;
  createFenceToken: () => string;
}): Promise<{ token: string; generation: number; leaseUntil: string } | null> {
  const leaseUntil = new Date(Date.parse(args.now) + FENCE_LEASE_SECONDS * 1000).toISOString();
  const token = requireText(args.createFenceToken(), "subscription_fence_token_invalid", 64);
  const row = await args.database.prepare(`
    INSERT INTO stripe_sync_fences (
      livemode, stripe_customer_id, owner_token, generation, lease_until, created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT (livemode, stripe_customer_id) DO UPDATE SET
      owner_token = excluded.owner_token,
      generation = stripe_sync_fences.generation + 1,
      lease_until = excluded.lease_until,
      last_error_code = NULL,
      updated_at = excluded.updated_at
    WHERE (stripe_sync_fences.lease_until IS NULL OR stripe_sync_fences.lease_until <= ?)
      AND stripe_sync_fences.generation < ?
    RETURNING owner_token, generation, lease_until
  `).bind(
    args.claim.livemode ? 1 : 0, args.customerId, token, leaseUntil, args.now, args.now,
    args.now, MAX_GENERATION,
  ).first<{ owner_token: unknown; generation: unknown; lease_until: unknown }>();
  if (!row) return null;
  if (row.owner_token !== token || typeof row.generation !== "number" || row.generation < 1 ||
      row.generation > MAX_GENERATION || row.lease_until !== leaseUntil) {
    throw new StripeWebhookD1ApplicationError("subscription_fence_shape_invalid");
  }
  return { token, generation: row.generation, leaseUntil };
}

async function releaseFence(args: {
  database: D1Database;
  claim: StripeWebhookD1Claim;
  customerId: string;
  fence: { token: string; generation: number };
  now: string;
  errorCode: string | null;
}): Promise<void> {
  await args.database.prepare(`
    UPDATE stripe_sync_fences
    SET owner_token = NULL, lease_until = NULL, last_error_code = ?, updated_at = ?
    WHERE livemode = ? AND stripe_customer_id = ? AND owner_token = ? AND generation = ?
      AND EXISTS (
        SELECT 1 FROM stripe_webhook_dispatches AS d
        WHERE d.id = ? AND d.receipt_id = ? AND d.livemode = ?
          AND d.status = 'processing' AND d.lease_token = ?
          AND d.claim_generation = ? AND d.lease_until > ?
      )
  `).bind(
    args.errorCode, args.now, args.claim.livemode ? 1 : 0, args.customerId,
    args.fence.token, args.fence.generation, args.claim.dispatchId, args.claim.receiptId,
    args.claim.livemode ? 1 : 0, args.claim.leaseToken, args.claim.claimGeneration, args.now,
  ).run();
}

async function loadCustomerUser(args: {
  database: D1Database;
  provider: StripeSubscriptionReconciliationProvider;
  customerId: string;
  livemode: boolean;
}): Promise<{ userId: string; needsCustomerLink: boolean }> {
  const customer = asRecord(await args.provider.retrieveCustomer(args.customerId));
  if (!customer || customer.deleted === true || idFrom(customer.id, "subscription_customer_invalid") !== args.customerId) {
    throw new StripeWebhookD1ApplicationError("subscription_customer_unavailable");
  }
  requireMode(customer, args.livemode, "subscription_mode_mismatch");
  const metadata = asRecord(customer.metadata);
  const metadataRaw = metadata?.user_id;
  const metadataUserId = metadataRaw === undefined || metadataRaw === null || metadataRaw === ""
    ? null
    : requireUuid(metadataRaw, "subscription_customer_metadata_invalid");
  const byCustomerRows = readSettingsRows(await args.database.prepare(`
    SELECT user_id, stripe_customer_id FROM user_settings
    WHERE stripe_customer_id = ? LIMIT 2
  `).bind(args.customerId).all<{ user_id: unknown; stripe_customer_id: unknown }>());
  if (byCustomerRows.length > 1) throw new StripeWebhookD1ApplicationError("subscription_customer_mapping_ambiguous");
  const directUserId = byCustomerRows.length === 1
    ? requireUuid(byCustomerRows[0].user_id, "subscription_customer_mapping_invalid")
    : null;
  if (directUserId && metadataUserId && directUserId !== metadataUserId) {
    throw new StripeWebhookD1ApplicationError("subscription_customer_mapping_conflict");
  }
  const userId = directUserId ?? metadataUserId;
  if (!userId) throw new StripeWebhookD1ApplicationError("subscription_customer_mapping_review_required");
  const userRows = readSettingsRows(await args.database.prepare(`
    SELECT user_id, stripe_customer_id FROM user_settings WHERE user_id = ? LIMIT 2
  `).bind(userId).all<{ user_id: unknown; stripe_customer_id: unknown }>());
  if (userRows.length !== 1 || requireUuid(userRows[0].user_id, "subscription_customer_mapping_invalid") !== userId) {
    throw new StripeWebhookD1ApplicationError("subscription_customer_mapping_review_required");
  }
  const linkedCustomerId = userRows[0].stripe_customer_id;
  if (linkedCustomerId !== null && linkedCustomerId !== undefined && linkedCustomerId !== args.customerId) {
    throw new StripeWebhookD1ApplicationError("subscription_customer_mapping_conflict");
  }
  return { userId, needsCustomerLink: linkedCustomerId === null || linkedCustomerId === undefined };
}

async function loadPricePlans(args: {
  database: D1Database;
  livemode: boolean;
}): Promise<{ byPriceId: Map<string, PlanType>; values: Map<PlanType, string> }> {
  const keys = (Object.keys(PRICE_SETTING_KEYS) as PlanType[]).map((plan) => PRICE_SETTING_KEYS[plan][args.livemode ? "live" : "test"]);
  const result = await args.database.prepare(`
    SELECT setting_key, setting_value, is_public FROM system_settings
    WHERE setting_key IN (?, ?, ?) ORDER BY setting_key
  `).bind(...keys).all<{ setting_key: unknown; setting_value: unknown; is_public: unknown }>();
  const rows = readSettingsRows(result);
  const byPriceId = parsePriceSettings(rows, args.livemode);
  const values = new Map<PlanType, string>();
  for (const plan of Object.keys(PRICE_SETTING_KEYS) as PlanType[]) {
    const key = PRICE_SETTING_KEYS[plan][args.livemode ? "live" : "test"];
    const row = rows.find((entry) => entry.setting_key === key);
    values.set(plan, requireText(row?.setting_value, "subscription_price_configuration_review_required", 255));
  }
  return { byPriceId, values };
}

function choosePlan(subscriptions: ProjectedSubscription[]): PlanType | null {
  const active = subscriptions.filter((subscription) => subscription.status === "active");
  if (!active.length) return null;
  return active.map((subscription) => subscription.planType)
    .sort((a, b) => PLAN_ORDER[b] - PLAN_ORDER[a])[0];
}

async function loadFreeReturnPolicy(database: D1Database, now: string): Promise<{
  freeLimit: number;
  graceExpiresAt: string;
}> {
  const rows = readSettingsRows(await database.prepare(`
    SELECT setting_key, setting_value FROM system_settings
    WHERE setting_key IN ('free_fanmarks_limit', 'grace_period_days')
  `).all<{ setting_key: unknown; setting_value: unknown }>());
  const readPositiveSetting = (key: string, fallback: number): number => {
    const matches = rows.filter((row) => row.setting_key === key);
    if (matches.length > 1) throw new StripeWebhookD1ApplicationError("subscription_return_setting_ambiguous");
    const raw = matches[0]?.setting_value;
    const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
  };
  const freeLimit = readPositiveSetting("free_fanmarks_limit", 3);
  const graceDays = readPositiveSetting("grace_period_days", 1);
  const graceBase = new Date(now);
  graceBase.setUTCDate(graceBase.getUTCDate() + graceDays);
  if (!Number.isFinite(graceBase.getTime())) {
    throw new StripeWebhookD1ApplicationError("subscription_return_grace_period_invalid");
  }
  if (graceBase.getUTCHours() || graceBase.getUTCMinutes() ||
      graceBase.getUTCSeconds() || graceBase.getUTCMilliseconds()) {
    graceBase.setUTCHours(0, 0, 0, 0);
    graceBase.setUTCDate(graceBase.getUTCDate() + 1);
  }
  if (!Number.isFinite(graceBase.getTime())) {
    throw new StripeWebhookD1ApplicationError("subscription_return_grace_period_invalid");
  }
  return { freeLimit, graceExpiresAt: graceBase.toISOString() };
}

function buildFreePlanReturnStatements(args: {
  database: D1Database;
  applicationId: string;
  userId: string;
  freeLimit: number;
  now: string;
  graceExpiresAt: string;
}): D1PreparedStatement[] {
  return [
    args.database.prepare(`
      INSERT INTO stripe_subscription_return_batches (
        application_id, local_user_id, free_limit, active_license_count,
        returned_license_count, returned_at, grace_expires_at, created_at
      )
      SELECT ?, ?, ?, COUNT(*),
        CASE WHEN COUNT(*) > ? THEN COUNT(*) - ? ELSE 0 END, ?, ?, ?
      FROM fanmark_licenses AS l
      WHERE l.user_id = ? AND l.status = 'active'
        AND (l.license_end IS NULL OR l.license_end > ?)
        AND EXISTS (
          SELECT 1 FROM stripe_subscription_applications
          WHERE id = ? AND status = 'applying'
        )
    `).bind(
      args.applicationId, args.userId, args.freeLimit, args.freeLimit, args.freeLimit,
      args.now, args.graceExpiresAt, args.now, args.userId, args.now, args.applicationId,
    ),
    args.database.prepare(`
      WITH eligible AS (
        SELECT l.id AS license_id, l.fanmark_id, l.user_id, l.display_fanmark,
          f.short_id,
          ROW_NUMBER() OVER (ORDER BY l.license_start DESC, l.created_at DESC, l.id DESC) AS newest_rank
        FROM fanmark_licenses AS l
        JOIN fanmarks AS f ON f.id = l.fanmark_id
        WHERE l.user_id = ? AND l.status = 'active'
          AND (l.license_end IS NULL OR l.license_end > ?)
      )
      INSERT INTO stripe_subscription_return_items (
        application_id, license_id, fanmark_id, user_id, display_fanmark,
        short_id, returned_at, grace_expires_at
      )
      SELECT b.application_id, e.license_id, e.fanmark_id, e.user_id,
        e.display_fanmark, e.short_id, b.returned_at, b.grace_expires_at
      FROM eligible AS e
      JOIN stripe_subscription_return_batches AS b
        ON b.application_id = ? AND e.newest_rank <= b.returned_license_count
      WHERE EXISTS (
        SELECT 1 FROM stripe_subscription_applications
        WHERE id = b.application_id AND status = 'applying'
      )
    `).bind(args.userId, args.now, args.applicationId),
    args.database.prepare(`
      UPDATE fanmark_licenses
      SET status = 'grace',
        license_end = (
          SELECT ri.returned_at FROM stripe_subscription_return_items AS ri
          WHERE ri.license_id = fanmark_licenses.id
          ORDER BY ri.application_id LIMIT 1
        ),
        grace_expires_at = (
          SELECT ri.grace_expires_at FROM stripe_subscription_return_items AS ri
          WHERE ri.license_id = fanmark_licenses.id
          ORDER BY ri.application_id LIMIT 1
        ),
        is_returned = 1, excluded_at = NULL, updated_at = (
          SELECT ri.returned_at FROM stripe_subscription_return_items AS ri
          WHERE ri.license_id = fanmark_licenses.id
          ORDER BY ri.application_id LIMIT 1
        )
      WHERE status = 'active'
        AND EXISTS (
          SELECT 1 FROM stripe_subscription_return_items AS ri
          JOIN stripe_subscription_applications AS a ON a.id = ri.application_id
            AND a.status = 'applying'
          WHERE ri.license_id = fanmark_licenses.id
            AND ri.user_id = fanmark_licenses.user_id
            AND ri.fanmark_id = fanmark_licenses.fanmark_id
            AND (fanmark_licenses.license_end IS NULL OR fanmark_licenses.license_end > ri.returned_at)
            AND NOT EXISTS (
              SELECT 1 FROM fanmark_transfer_codes AS tc
              WHERE tc.license_id = ri.license_id AND tc.status IN ('active', 'applied')
            )
        )
    `),
    args.database.prepare(`
      INSERT INTO audit_logs (
        user_id, action, resource_type, resource_id, request_id, metadata, created_at
      )
      SELECT ri.user_id, 'return_fanmark', 'fanmark', ri.fanmark_id,
        ri.application_id || ':' || ri.license_id,
        json_object(
          'user_input_fanmark', COALESCE(ri.display_fanmark, ''),
          'returned_at', ri.returned_at,
          'grace_expires_at', ri.grace_expires_at
        ),
        ri.returned_at
      FROM stripe_subscription_return_items AS ri
      JOIN stripe_subscription_applications AS a ON a.id = ri.application_id
        AND a.status = 'applying'
    `),
    args.database.prepare(`
      INSERT OR IGNORE INTO notification_events (
        event_type, event_version, source, payload, trigger_at,
        dedupe_key, status, created_at, updated_at
      )
      SELECT 'fanmark_returned_owner', 1, 'edge_function',
        json_object(
          'user_id', ri.user_id,
          'fanmark_id', ri.fanmark_id,
          'fanmark_name', COALESCE(NULLIF(trim(ri.display_fanmark), ''), 'ファンマーク'),
          'fanmark_short_id', COALESCE(ri.short_id, ''),
          'grace_expires_at', ri.grace_expires_at,
          'link', CASE WHEN COALESCE(ri.short_id, '') <> '' THEN '/f/' || ri.short_id ELSE NULL END
        ),
        ri.returned_at,
        'fanmark_returned_owner_' || ri.fanmark_id || '_' || ri.user_id,
        'pending', ri.returned_at, ri.returned_at
      FROM stripe_subscription_return_items AS ri
      JOIN stripe_subscription_applications AS a ON a.id = ri.application_id
        AND a.status = 'applying'
    `),
    args.database.prepare(`
      INSERT OR IGNORE INTO notification_events (
        event_type, event_version, source, payload, trigger_at,
        dedupe_key, status, created_at, updated_at
      )
      SELECT 'favorite_fanmark_available', 1, 'edge_function',
        json_object(
          'user_id', fav.user_id,
          'fanmark_id', ri.fanmark_id,
          'fanmark_name', COALESCE(fav.display_fanmark, ''),
          'fanmark_short_id', COALESCE(ri.short_id, ''),
          'grace_expires_at', ri.grace_expires_at,
          'link', CASE WHEN COALESCE(ri.short_id, '') <> '' THEN '/f/' || ri.short_id ELSE NULL END
        ),
        ri.returned_at,
        'favorite_available_' || ri.fanmark_id || '_' || fav.user_id,
        'pending', ri.returned_at, ri.returned_at
      FROM stripe_subscription_return_items AS ri
      JOIN stripe_subscription_applications AS a ON a.id = ri.application_id
        AND a.status = 'applying'
      JOIN fanmark_favorites AS fav ON fav.fanmark_id = ri.fanmark_id
        AND fav.user_id <> ri.user_id
    `),
  ];
}

function freePlanReturnGuardSql(): string {
  return `EXISTS (
    SELECT 1 FROM stripe_subscription_return_batches AS b
    WHERE b.application_id = ? AND b.local_user_id = ?
      AND b.returned_license_count = CASE
        WHEN b.active_license_count > b.free_limit THEN b.active_license_count - b.free_limit
        ELSE 0 END
      AND (SELECT COUNT(*) FROM stripe_subscription_return_items AS ri
        WHERE ri.application_id = b.application_id) = b.returned_license_count
      AND (SELECT COUNT(*) FROM fanmark_licenses AS l
        JOIN stripe_subscription_return_items AS ri ON ri.application_id = b.application_id
          AND ri.license_id = l.id AND ri.user_id = l.user_id AND ri.fanmark_id = l.fanmark_id
        WHERE l.status = 'grace' AND l.license_end = ri.returned_at
          AND l.grace_expires_at = ri.grace_expires_at AND l.is_returned = 1
          AND l.excluded_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM fanmark_transfer_codes AS tc
            WHERE tc.license_id = ri.license_id AND tc.status IN ('active', 'applied'))
      ) = b.returned_license_count
      AND (SELECT COUNT(*) FROM fanmark_licenses AS l
        WHERE l.user_id = b.local_user_id AND l.status = 'active'
          AND (l.license_end IS NULL OR l.license_end > b.returned_at)
      ) = b.active_license_count - b.returned_license_count
      AND NOT EXISTS (
        SELECT 1 FROM stripe_subscription_return_items AS ri
        WHERE ri.application_id = b.application_id
          AND NOT EXISTS (
            SELECT 1 FROM audit_logs AS al
            WHERE al.request_id = ri.application_id || ':' || ri.license_id
              AND al.user_id = ri.user_id AND al.action = 'return_fanmark'
              AND al.resource_type = 'fanmark' AND al.resource_id = ri.fanmark_id
              AND json_extract(al.metadata, '$.returned_at') = ri.returned_at
              AND json_extract(al.metadata, '$.grace_expires_at') = ri.grace_expires_at
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM stripe_subscription_return_items AS ri
        WHERE ri.application_id = b.application_id
          AND NOT EXISTS (
            SELECT 1 FROM notification_events AS ne
            WHERE ne.event_type = 'fanmark_returned_owner'
              AND ne.dedupe_key = 'fanmark_returned_owner_' || ri.fanmark_id || '_' || ri.user_id
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM stripe_subscription_return_items AS ri
        JOIN fanmark_favorites AS fav ON fav.fanmark_id = ri.fanmark_id
          AND fav.user_id <> ri.user_id
        WHERE ri.application_id = b.application_id
          AND NOT EXISTS (
            SELECT 1 FROM notification_events AS ne
            WHERE ne.event_type = 'favorite_fanmark_available'
              AND ne.dedupe_key = 'favorite_available_' || ri.fanmark_id || '_' || fav.user_id
          )
      )
  )`;
}

function requireSubscriptionEvent(claim: StripeWebhookD1Claim): { subscriptionId: string; customerId: string } {
  const payload = claim.normalizedPayload;
  const event = asRecord(payload.event);
  const object = asRecord(payload.object);
  const subscription = asRecord(payload.subscription);
  if (payload.branch !== "subscription" || !event || !object || !subscription ||
      event.id !== claim.stripeEventId || event.type !== claim.eventType || event.livemode !== claim.livemode ||
      object.type !== "subscription" || object.id !== claim.objectId ||
      subscription.id !== claim.objectId || !requireText(claim.leaseToken, "subscription_event_shape_invalid", 64) ||
      !HASH_RE.test(claim.normalizedPayloadSha256)) {
    throw new StripeWebhookD1ApplicationError("subscription_event_shape_invalid");
  }
  const subscriptionId = requireText(subscription.id, "subscription_event_shape_invalid", 255);
  const customerId = requireText(subscription.customer_id, "subscription_event_customer_missing", 255);
  return { subscriptionId, customerId };
}

function buildSubscriptionWrites(args: {
  database: D1Database;
  claim: StripeWebhookD1Claim;
  appId: string;
  userId: string;
  customerId: string;
  fence: { token: string; generation: number };
  now: string;
  subscriptions: ProjectedSubscription[];
}): D1PreparedStatement[] {
  const livemode = args.claim.livemode ? 1 : 0;
  return args.subscriptions.map((subscription) => args.database.prepare(`
    INSERT INTO user_subscriptions (
      id, user_id, stripe_customer_id, stripe_subscription_id, product_id, status,
      current_period_start, current_period_end, cancel_at_period_end, created_at,
      updated_at, price_id, amount, currency, interval, interval_count
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM stripe_subscription_applications WHERE id = ? AND status = 'applying')
      AND EXISTS (SELECT 1 FROM stripe_sync_fences WHERE livemode = ? AND stripe_customer_id = ?
        AND owner_token = ? AND generation = ? AND lease_until > ?)
      AND EXISTS (SELECT 1 FROM stripe_webhook_dispatches WHERE id = ? AND receipt_id = ?
        AND livemode = ? AND status = 'processing' AND lease_token = ?
        AND claim_generation = ? AND lease_until > ?)
    ON CONFLICT (stripe_subscription_id) DO UPDATE SET
      stripe_customer_id = excluded.stripe_customer_id,
      product_id = excluded.product_id,
      status = excluded.status,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      updated_at = excluded.updated_at,
      price_id = excluded.price_id,
      amount = excluded.amount,
      currency = excluded.currency,
      interval = excluded.interval,
      interval_count = excluded.interval_count
    WHERE user_subscriptions.user_id = excluded.user_id
      AND user_subscriptions.stripe_customer_id = excluded.stripe_customer_id
  `).bind(
    subscription.rowId, args.userId, args.customerId, subscription.id, subscription.productId,
    subscription.status, subscription.currentPeriodStart, subscription.currentPeriodEnd,
    subscription.cancelAtPeriodEnd, args.now, args.now, subscription.priceId,
    subscription.amount, subscription.currency, subscription.interval, subscription.intervalCount,
    args.appId, livemode, args.customerId, args.fence.token, args.fence.generation, args.now,
    args.claim.dispatchId, args.claim.receiptId, livemode, args.claim.leaseToken,
    args.claim.claimGeneration, args.now));
}

function identityPredicates(subscriptions: ProjectedSubscription[], userId: string, customerId: string): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const conditions = subscriptions.map((subscription) => {
    values.push(subscription.id, userId, customerId, subscription.productId, subscription.status,
      subscription.currentPeriodStart, subscription.currentPeriodEnd, subscription.cancelAtPeriodEnd,
      subscription.priceId, subscription.amount, subscription.currency, subscription.interval,
      subscription.intervalCount);
    return `(stripe_subscription_id = ? AND user_id = ? AND stripe_customer_id = ? AND product_id = ? AND status = ?
      AND current_period_start IS ? AND current_period_end IS ? AND cancel_at_period_end IS ? AND price_id IS ?
      AND amount IS ? AND currency IS ? AND interval IS ? AND interval_count IS ?)`;
  });
  return { sql: conditions.join(" OR "), values };
}

export function createStripeSubscriptionReconciliationProvider(client: StripeSubscriptionApiClient): StripeSubscriptionReconciliationProvider {
  return {
    retrieveSubscription(subscriptionId) {
      return client.subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice"] }, {
        apiVersion: PINNED_STRIPE_API_VERSION,
      });
    },
    async listActiveSubscriptions(customerId) {
      const data: unknown[] = [];
      let startingAfter: string | undefined;
      while (true) {
        const page = asRecord(await client.subscriptions.list({
          customer: customerId,
          status: "active",
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        }, { apiVersion: PINNED_STRIPE_API_VERSION }));
        const rows = page && Array.isArray(page.data) ? page.data : null;
        if (!rows || typeof page?.has_more !== "boolean" || rows.length > 100) {
          throw new StripeWebhookD1ApplicationError("subscription_list_shape_invalid");
        }
        data.push(...rows);
        if (data.length > MAX_STRIPE_SUBSCRIPTIONS) {
          throw new StripeWebhookD1ApplicationError("subscription_list_limit_exceeded");
        }
        if (!page.has_more) return data;
        const last = asRecord(rows.at(-1));
        startingAfter = requireText(last?.id, "subscription_list_shape_invalid", 255);
      }
    },
    retrieveCustomer(customerId) {
      return client.customers.retrieve(customerId, {}, { apiVersion: PINNED_STRIPE_API_VERSION });
    },
  };
}

export async function applyStripeSubscriptionReceiptInD1(args: {
  database: D1Database;
  claim: StripeWebhookD1Claim;
  now: string;
  getNow?: () => string;
  provider: StripeSubscriptionReconciliationProvider;
  createId?: () => string;
  createFenceToken?: () => string;
}): Promise<StripeSubscriptionD1ReconciliationResult> {
  const initialNow = requireIso(args.now, "subscription_timestamp_invalid");
  if (args.claim.eventType !== "customer.subscription.created" &&
      args.claim.eventType !== "customer.subscription.updated" &&
      args.claim.eventType !== "customer.subscription.deleted") {
    throw new StripeWebhookD1ApplicationError("subscription_event_unsupported");
  }
  const { subscriptionId, customerId } = requireSubscriptionEvent(args.claim);
  const fence = await acquireFence({
    database: args.database,
    claim: args.claim,
    customerId,
    now: initialNow,
    createFenceToken: args.createFenceToken ?? (() => crypto.randomUUID()),
  });
  if (!fence) return { status: "stale", code: "subscription_customer_fence_busy" };

  let released = false;
  try {
    const [priceConfig, localMapping, currentValue, activeValues] = await Promise.all([
      loadPricePlans({ database: args.database, livemode: args.claim.livemode }),
      loadCustomerUser({
        database: args.database,
        provider: args.provider,
        customerId,
        livemode: args.claim.livemode,
      }),
      args.provider.retrieveSubscription(subscriptionId),
      args.provider.listActiveSubscriptions(customerId),
    ]);
    const current = projectSubscription(currentValue, {
      customerId,
      livemode: args.claim.livemode,
      pricePlans: priceConfig.byPriceId,
      rowId: (args.createId ?? (() => crypto.randomUUID()))().toLowerCase(),
    });
    if (current.id !== subscriptionId) throw new StripeWebhookD1ApplicationError("subscription_id_mismatch");
    const activeRecords = activeValues.map((value, index) => projectSubscription(value, {
      customerId,
      livemode: args.claim.livemode,
      pricePlans: priceConfig.byPriceId,
      rowId: (args.createId ?? (() => crypto.randomUUID()))().toLowerCase(),
    }));
    if (activeRecords.length > MAX_ACTIVE_SUBSCRIPTIONS) {
      throw new StripeWebhookD1ApplicationError("subscription_active_list_limit_exceeded");
    }
    if (activeRecords.some((record) => record.status !== "active") ||
        new Set(activeRecords.map((record) => record.id)).size !== activeRecords.length) {
      throw new StripeWebhookD1ApplicationError("subscription_active_list_invalid");
    }
    const activeCurrent = activeRecords.find((record) => record.id === current.id);
    if ((current.status === "active") !== Boolean(activeCurrent) ||
        (activeCurrent && !sameProjection(current, activeCurrent))) {
      throw new StripeWebhookD1ApplicationError("subscription_current_list_changed");
    }
    const projected = new Map(activeRecords.map((record) => [record.id, record]));
    projected.set(current.id, current);
    const subscriptions = [...projected.values()];
    const paidPlanType = choosePlan(subscriptions);
    const transitionsToFree = args.claim.eventType === "customer.subscription.deleted" && paidPlanType === null;
    const effectivePlanType = paidPlanType ?? (transitionsToFree ? "free" : null);
    const ledgerPlanType = effectivePlanType === "free" ? null : effectivePlanType;
    const now = requireIso(args.getNow?.() ?? new Date().toISOString(), "subscription_timestamp_invalid");
    const freeReturnPolicy = transitionsToFree ? await loadFreeReturnPolicy(args.database, now) : null;
    const applicationId = requireUuid((args.createId ?? (() => crypto.randomUUID()))(), "subscription_application_id_invalid");
    const guardId = `subscription-guard:${applicationId}`;
    const livemode = args.claim.livemode ? 1 : 0;
    const identity = identityPredicates(subscriptions, localMapping.userId, customerId);
    const priceKeys = (Object.keys(PRICE_SETTING_KEYS) as PlanType[]).map((plan) => PRICE_SETTING_KEYS[plan][args.claim.livemode ? "live" : "test"]);
    const priceValues = (Object.keys(PRICE_SETTING_KEYS) as PlanType[]).map((plan) => priceConfig.values.get(plan) as string);
    const applicationInsert = args.database.prepare(`
      INSERT INTO stripe_subscription_applications (
        id, receipt_id, dispatch_id, stripe_event_id, livemode, effect_key,
        stripe_customer_id, stripe_subscription_id, local_user_id, fence_generation,
        input_hash, effective_plan_type, active_subscription_count, status,
        created_at, updated_at, applied_at
      )
      SELECT ?, r.id, d.id, r.stripe_event_id, r.livemode, ?, ?, ?, ?, ?,
        r.normalized_payload_sha256, ?, ?, 'applying', ?, ?, NULL
      FROM stripe_webhook_receipts AS r
      JOIN stripe_webhook_dispatches AS d ON d.id = ? AND d.receipt_id = r.id
        AND d.livemode = r.livemode AND d.stripe_event_id = r.stripe_event_id
      JOIN stripe_sync_fences AS f ON f.livemode = r.livemode AND f.stripe_customer_id = ?
        AND f.owner_token = ? AND f.generation = ? AND f.lease_until > ?
      WHERE r.id = ? AND r.livemode = ? AND r.status = 'processing'
        AND r.event_type = ? AND r.object_type = 'subscription' AND r.object_id = ?
        AND r.normalized_payload_sha256 = ?
        AND json_extract(r.normalized_payload, '$.branch') = 'subscription'
        AND json_extract(r.normalized_payload, '$.subscription.id') = ?
        AND json_extract(r.normalized_payload, '$.subscription.customer_id') = ?
        AND d.status = 'processing' AND d.lease_token = ? AND d.claim_generation = ? AND d.lease_until > ?
        AND (SELECT COUNT(*) FROM user_settings WHERE stripe_customer_id = ?) <= 1
        AND EXISTS (SELECT 1 FROM user_settings WHERE user_id = ? AND
          (stripe_customer_id IS NULL OR stripe_customer_id = ?))
        AND NOT EXISTS (SELECT 1 FROM stripe_subscription_applications
          WHERE livemode = ? AND stripe_event_id = ?)
        AND NOT EXISTS (SELECT 1 FROM system_settings WHERE setting_key IN (?, ?, ?)
          GROUP BY setting_key HAVING COUNT(*) > 1)
      RETURNING id
    `).bind(
      applicationId, `subscription-reconcile:${args.claim.stripeEventId}`, customerId, subscriptionId,
      localMapping.userId, fence.generation, ledgerPlanType, activeRecords.length, now, now,
      args.claim.dispatchId, customerId, fence.token, fence.generation, now,
      args.claim.receiptId, livemode, args.claim.eventType, subscriptionId,
      args.claim.normalizedPayloadSha256, subscriptionId, customerId, args.claim.leaseToken,
      args.claim.claimGeneration, now, customerId, localMapping.userId, customerId,
      livemode, args.claim.stripeEventId, ...priceKeys,
    );
    const statements: D1PreparedStatement[] = [applicationInsert];
    if (localMapping.needsCustomerLink) {
      statements.push(args.database.prepare(`
        UPDATE user_settings SET stripe_customer_id = ?, updated_at = ?
        WHERE user_id = ? AND stripe_customer_id IS NULL
          AND EXISTS (SELECT 1 FROM stripe_subscription_applications WHERE id = ? AND status = 'applying')
      `).bind(customerId, now, localMapping.userId, applicationId));
    }
    statements.push(...buildSubscriptionWrites({
      database: args.database,
      claim: args.claim,
      appId: applicationId,
      userId: localMapping.userId,
      customerId,
      fence,
      now,
      subscriptions,
    }));
    if (current.status === "active") {
      statements.push(args.database.prepare(`
        UPDATE user_subscriptions
        SET payment_failure_at = NULL, next_payment_attempt = NULL,
          payment_failure_type = NULL, updated_at = ?
        WHERE user_id = ? AND stripe_customer_id = ? AND stripe_subscription_id = ?
          AND EXISTS (SELECT 1 FROM stripe_subscription_applications WHERE id = ? AND status = 'applying')
          AND EXISTS (SELECT 1 FROM stripe_sync_fences WHERE livemode = ? AND stripe_customer_id = ?
            AND owner_token = ? AND generation = ? AND lease_until > ?)
          AND EXISTS (SELECT 1 FROM stripe_webhook_dispatches WHERE id = ? AND receipt_id = ?
            AND livemode = ? AND status = 'processing' AND lease_token = ?
            AND claim_generation = ? AND lease_until > ?)
      `).bind(
        now, localMapping.userId, customerId, current.id, applicationId,
        livemode, customerId, fence.token, fence.generation, now,
        args.claim.dispatchId, args.claim.receiptId, livemode, args.claim.leaseToken,
        args.claim.claimGeneration, now,
      ));
    }
    if (freeReturnPolicy) {
      statements.push(...buildFreePlanReturnStatements({
        database: args.database,
        applicationId,
        userId: localMapping.userId,
        freeLimit: freeReturnPolicy.freeLimit,
        now,
        graceExpiresAt: freeReturnPolicy.graceExpiresAt,
      }));
    }
    statements.push(args.database.prepare(`
      INSERT INTO stripe_subscription_transaction_guards (id, passed)
      SELECT ?, CASE WHEN
        (SELECT COUNT(*) FROM stripe_subscription_applications WHERE id = ? AND status = 'applying') = 1
        AND (SELECT COUNT(*) FROM user_settings WHERE user_id = ? AND stripe_customer_id = ?) = 1
        AND (SELECT COUNT(*) FROM user_subscriptions WHERE ${identity.sql}) = ?
        AND ${transitionsToFree ? freePlanReturnGuardSql() : "1 = 1"}
        AND ${current.status === "active"
          ? `(SELECT COUNT(*) FROM user_subscriptions WHERE user_id = ? AND stripe_customer_id = ?
              AND stripe_subscription_id = ? AND payment_failure_at IS NULL
              AND next_payment_attempt IS NULL AND payment_failure_type IS NULL) = 1`
          : "1 = 1"}
        AND (SELECT COUNT(*) FROM system_settings WHERE
          (setting_key = ? AND setting_value = ? AND is_public = 0) OR
          (setting_key = ? AND setting_value = ? AND is_public = 0) OR
          (setting_key = ? AND setting_value = ? AND is_public = 0)) = 3
        AND EXISTS (SELECT 1 FROM stripe_sync_fences WHERE livemode = ? AND stripe_customer_id = ?
          AND owner_token = ? AND generation = ? AND lease_until > ?)
        AND EXISTS (SELECT 1 FROM stripe_webhook_dispatches WHERE id = ? AND receipt_id = ?
          AND livemode = ? AND status = 'processing' AND lease_token = ?
          AND claim_generation = ? AND lease_until > ?)
      THEN 1 ELSE 0 END
    `).bind(
      guardId, applicationId, localMapping.userId, customerId, ...identity.values, subscriptions.length,
      ...(transitionsToFree ? [applicationId, localMapping.userId] : []),
      ...(current.status === "active" ? [localMapping.userId, customerId, current.id] : []),
      priceKeys[0], priceValues[0], priceKeys[1], priceValues[1], priceKeys[2], priceValues[2],
      livemode, customerId, fence.token, fence.generation, now,
      args.claim.dispatchId, args.claim.receiptId, livemode, args.claim.leaseToken,
      args.claim.claimGeneration, now,
    ));
    if (effectivePlanType) {
      statements.push(args.database.prepare(`
        UPDATE user_settings SET plan_type = ?, updated_at = ?
        WHERE user_id = ? AND stripe_customer_id = ?
          AND EXISTS (SELECT 1 FROM stripe_subscription_transaction_guards WHERE id = ? AND passed = 1)
      `).bind(effectivePlanType, now, localMapping.userId, customerId, guardId));
      statements.push(args.database.prepare(`
        UPDATE stripe_subscription_transaction_guards
        SET passed = CASE WHEN EXISTS (SELECT 1 FROM user_settings WHERE user_id = ?
          AND stripe_customer_id = ? AND plan_type = ?) THEN 1 ELSE 0 END
        WHERE id = ?
      `).bind(localMapping.userId, customerId, effectivePlanType, guardId));
    }
    statements.push(args.database.prepare(`
      UPDATE stripe_subscription_applications
      SET status = 'applied', applied_at = ?, updated_at = ?
      WHERE id = ? AND status = 'applying'
        AND EXISTS (SELECT 1 FROM stripe_subscription_transaction_guards WHERE id = ? AND passed = 1)
    `).bind(now, now, applicationId, guardId));
    statements.push(args.database.prepare(`
      UPDATE stripe_sync_fences
      SET owner_token = NULL, lease_until = NULL, last_reconciled_at = ?,
        last_error_code = NULL, updated_at = ?
      WHERE livemode = ? AND stripe_customer_id = ? AND owner_token = ? AND generation = ?
        AND EXISTS (SELECT 1 FROM stripe_subscription_applications WHERE id = ? AND status = 'applied')
    `).bind(now, now, livemode, customerId, fence.token, fence.generation, applicationId));
    statements.push(args.database.prepare(`
      UPDATE stripe_webhook_dispatches
      SET status = 'completed', claimed_at = NULL, lease_until = NULL, lease_token = NULL,
        completed_at = ?, last_error_code = NULL, last_error_message = NULL, updated_at = ?
      WHERE id = ? AND receipt_id = ? AND livemode = ? AND status = 'processing'
        AND lease_token = ? AND claim_generation = ? AND lease_until > ?
        AND EXISTS (SELECT 1 FROM stripe_subscription_applications WHERE id = ? AND status = 'applied')
    `).bind(
      now, now, args.claim.dispatchId, args.claim.receiptId, livemode, args.claim.leaseToken,
      args.claim.claimGeneration, now, applicationId,
    ));
    statements.push(args.database.prepare(`
      UPDATE stripe_webhook_receipts
      SET status = 'applied', terminal_at = ?, last_error_code = NULL,
        last_error_message = NULL, updated_at = ?
      WHERE id = ? AND livemode = ? AND status = 'processing'
        AND EXISTS (SELECT 1 FROM stripe_subscription_applications WHERE id = ? AND status = 'applied')
        AND EXISTS (SELECT 1 FROM stripe_webhook_dispatches WHERE id = ? AND status = 'completed')
    `).bind(now, now, args.claim.receiptId, livemode, applicationId, args.claim.dispatchId));
    statements.push(args.database.prepare(`
      UPDATE stripe_subscription_transaction_guards
      SET passed = CASE WHEN
        EXISTS (SELECT 1 FROM stripe_subscription_applications WHERE id = ? AND status = 'applied')
        AND EXISTS (SELECT 1 FROM stripe_sync_fences WHERE livemode = ? AND stripe_customer_id = ?
          AND owner_token IS NULL AND lease_until IS NULL AND generation = ?)
        AND EXISTS (SELECT 1 FROM stripe_webhook_dispatches WHERE id = ? AND status = 'completed')
        AND EXISTS (SELECT 1 FROM stripe_webhook_receipts WHERE id = ? AND status = 'applied')
      THEN 1 ELSE 0 END
      WHERE id = ?
    `).bind(
      applicationId, livemode, customerId, fence.generation,
      args.claim.dispatchId, args.claim.receiptId, guardId,
    ));
    statements.push(args.database.prepare(`DELETE FROM stripe_subscription_transaction_guards WHERE id = ?`).bind(guardId));
    await args.database.batch(statements);
    released = true;
    return {
      status: "applied",
      code: "subscription_reconciled",
      applicationId,
      ...(effectivePlanType ? { effectivePlanType } : {}),
      activeSubscriptionCount: activeRecords.length,
    };
  } catch (error) {
    if (!released) {
      const now = requireIso(args.getNow?.() ?? new Date().toISOString(), "subscription_timestamp_invalid");
      await releaseFence({
        database: args.database,
        claim: args.claim,
        customerId,
        fence,
        now,
        errorCode: error instanceof StripeWebhookD1ApplicationError ? error.code : "subscription_reconciliation_failed",
      }).catch(() => undefined);
    }
    throw error;
  }
}
