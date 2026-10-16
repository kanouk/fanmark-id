/**
 * Pure Stripe subscription snapshot normalisation for the later fenced
 * application transaction.
 *
 * This module deliberately has no Supabase or database dependency. The caller
 * supplies the current Subscription and active-subscription list through an
 * injected provider, together with the already selected private Price IDs for
 * both Stripe modes. The returned value is safe to pass to a later atomic
 * projection RPC only after that RPC has performed its own identity and lease
 * checks.
 */

export const PINNED_STRIPE_API_VERSION = "2025-08-27.basil" as const;

export const PAID_PLAN_ORDER = {
  creator: 1,
  max: 2,
  business: 3,
} as const;

export type StripePaidPlan = keyof typeof PAID_PLAN_ORDER;

const SUBSCRIPTION_STATUSES = new Set([
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
]);

const RECURRING_INTERVALS = new Set(["day", "week", "month", "year"]);
const MAX_ID_BYTES = 255;
const MAX_ACTIVE_SUBSCRIPTIONS = 100;
const MAX_LIST_SUBSCRIPTIONS = 1_000;

export interface StripeSubscriptionProjectionProvider {
  retrieveSubscription(subscriptionId: string): PromiseLike<unknown>;
  listActiveSubscriptions(customerId: string): PromiseLike<unknown[]>;
}

export interface StripeSubscriptionApiClient {
  subscriptions: {
    retrieve(
      id: string,
      params: { expand: string[] },
      options: { apiVersion: typeof PINNED_STRIPE_API_VERSION },
    ): PromiseLike<unknown>;
    list(
      params: {
        customer: string;
        status: "active";
        limit: number;
        expand: string[];
        starting_after?: string;
      },
      options: { apiVersion: typeof PINNED_STRIPE_API_VERSION },
    ): PromiseLike<unknown>;
  };
}

export interface StripePrivatePriceIds {
  creator: string;
  max: string;
  business: string;
}

export interface StripePrivatePriceIdsByMode {
  test: StripePrivatePriceIds;
  live: StripePrivatePriceIds;
}

export interface StripeSubscriptionProjectionInput {
  subscriptionId: string;
  customerId: string;
  livemode: boolean;
  privatePriceIds: StripePrivatePriceIdsByMode;
  provider: StripeSubscriptionProjectionProvider;
}

export interface StripeSubscriptionProjectionRecord {
  id: string;
  customerId: string;
  livemode: boolean;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  productId: string;
  priceId: string;
  amount: number | null;
  currency: string | null;
  interval: string | null;
  intervalCount: number | null;
  /** The configured plan represented by this subscription Price. */
  planType: StripePaidPlan;
  /** Entitlement is assigned only for an active subscription. */
  entitlementPlanType: StripePaidPlan | null;
}

export interface StripeSubscriptionProjection {
  current: StripeSubscriptionProjectionRecord;
  activeSubscriptions: StripeSubscriptionProjectionRecord[];
  activeSubscriptionCount: number;
  /** Highest active paid plan, or null when the customer has no active plan. */
  effectivePlanType: StripePaidPlan | null;
}

export class StripeSubscriptionProjectionError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = "StripeSubscriptionProjectionError";
    this.code = code;
  }
}

type StripeRecord = Record<string, unknown>;

function asRecord(value: unknown): StripeRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as StripeRecord;
}

function boundedText(value: unknown, code: string, maxBytes = 512): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new StripeSubscriptionProjectionError(code);
  }
  if (new TextEncoder().encode(value).byteLength > maxBytes) {
    throw new StripeSubscriptionProjectionError(code);
  }
  return value;
}

function idFrom(value: unknown, code: string): string {
  if (typeof value === "string") return boundedText(value, code, MAX_ID_BYTES);
  const record = asRecord(value);
  return boundedText(record?.id, code, MAX_ID_BYTES);
}

function requireMode(value: unknown, expected: boolean): void {
  if (typeof value !== "boolean" || value !== expected) {
    throw new StripeSubscriptionProjectionError("subscription_mode_mismatch");
  }
}

function nullableUnixTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value)) {
    throw new StripeSubscriptionProjectionError("subscription_period_invalid");
  }
  const millis = (value as number) * 1000;
  if (!Number.isSafeInteger(millis) || Math.abs(millis) > 8_640_000_000_000_000) {
    throw new StripeSubscriptionProjectionError("subscription_period_invalid");
  }
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) {
    throw new StripeSubscriptionProjectionError("subscription_period_invalid");
  }
  return date.toISOString();
}

function readBasilSubscriptionItemPeriods(
  subscription: StripeRecord,
  item: StripeRecord,
): { start: string; end: string } {
  // Basil removed these fields from Subscription. A non-null legacy field is
  // evidence that the caller supplied a mixed-version response, so do not
  // silently prefer it over the item-level period.
  if ((subscription.current_period_start !== null && subscription.current_period_start !== undefined)
    || (subscription.current_period_end !== null && subscription.current_period_end !== undefined)) {
    throw new StripeSubscriptionProjectionError("subscription_period_invalid");
  }
  const start = nullableUnixTimestamp(item.current_period_start);
  const end = nullableUnixTimestamp(item.current_period_end);
  if (start === null || end === null || end < start) {
    throw new StripeSubscriptionProjectionError("subscription_period_invalid");
  }
  return { start, end };
}

function nullableAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new StripeSubscriptionProjectionError("subscription_amount_invalid");
  }
  return value as number;
}

function nullableCurrency(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^[a-z]{3}$/u.test(value)) {
    throw new StripeSubscriptionProjectionError("subscription_currency_invalid");
  }
  return value;
}

function nullableInterval(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !RECURRING_INTERVALS.has(value)) {
    throw new StripeSubscriptionProjectionError("subscription_interval_invalid");
  }
  return value;
}

function nullableIntervalCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new StripeSubscriptionProjectionError("subscription_interval_invalid");
  }
  return value as number;
}

function validatePriceIds(input: StripePrivatePriceIdsByMode): StripePrivatePriceIdsByMode {
  if (input === null || typeof input !== "object") {
    throw new StripeSubscriptionProjectionError("subscription_price_configuration_review_required");
  }
  const modes = ["test", "live"] as const;
  const plans = Object.keys(PAID_PLAN_ORDER) as StripePaidPlan[];
  const result = {} as StripePrivatePriceIdsByMode;
  const allIds = new Set<string>();
  for (const mode of modes) {
    const source = input[mode];
    if (source === null || typeof source !== "object") {
      throw new StripeSubscriptionProjectionError("subscription_price_configuration_review_required");
    }
    const modeResult = {} as StripePrivatePriceIds;
    const modeIds = new Set<string>();
    for (const plan of plans) {
      const id = boundedText(source[plan], "subscription_price_configuration_review_required", MAX_ID_BYTES);
      if (!id.startsWith("price_") || modeIds.has(id) || allIds.has(id)) {
        throw new StripeSubscriptionProjectionError(
          modeIds.has(id) || allIds.has(id)
            ? "subscription_price_configuration_conflict"
            : "subscription_price_configuration_review_required",
        );
      }
      modeIds.add(id);
      allIds.add(id);
      modeResult[plan] = id;
    }
    result[mode] = modeResult;
  }
  return result;
}

function normalizeSubscription(
  value: unknown,
  args: {
    customerId: string;
    livemode: boolean;
    priceIds: StripePrivatePriceIds;
  },
): StripeSubscriptionProjectionRecord {
  const record = asRecord(value);
  if (record === null || record.object !== "subscription") {
    throw new StripeSubscriptionProjectionError("subscription_snapshot_invalid");
  }
  const id = boundedText(record.id, "subscription_snapshot_invalid", MAX_ID_BYTES);
  if (idFrom(record.customer, "subscription_customer_mismatch") !== args.customerId) {
    throw new StripeSubscriptionProjectionError("subscription_customer_mismatch");
  }
  requireMode(record.livemode, args.livemode);

  const status = boundedText(record.status, "subscription_status_invalid", 32);
  if (!SUBSCRIPTION_STATUSES.has(status)) {
    throw new StripeSubscriptionProjectionError("subscription_status_invalid");
  }

  const items = asRecord(record.items);
  if (items === null || !Array.isArray(items.data)) {
    throw new StripeSubscriptionProjectionError("subscription_items_invalid");
  }
  if (items.data.length !== 1) {
    throw new StripeSubscriptionProjectionError("subscription_items_ambiguous");
  }
  const item = asRecord(items.data[0]);
  const price = asRecord(item?.price);
  if (item === null || price === null) {
    throw new StripeSubscriptionProjectionError("subscription_price_invalid");
  }
  const periods = readBasilSubscriptionItemPeriods(record, item);
  const priceId = idFrom(price.id, "subscription_price_invalid");
  const productId = idFrom(price.product, "subscription_product_invalid");
  const planType = (Object.keys(args.priceIds) as StripePaidPlan[]).find(
    (plan) => args.priceIds[plan] === priceId,
  );
  if (planType === undefined) {
    throw new StripeSubscriptionProjectionError("subscription_price_unmapped");
  }

  const recurring = asRecord(price.recurring);
  const amount = nullableAmount(price.unit_amount);
  const currency = nullableCurrency(price.currency);
  const interval = nullableInterval(recurring?.interval);
  const intervalCount = nullableIntervalCount(recurring?.interval_count);
  if ((interval === null) !== (intervalCount === null)) {
    throw new StripeSubscriptionProjectionError("subscription_interval_invalid");
  }

  if (typeof record.cancel_at_period_end !== "boolean") {
    throw new StripeSubscriptionProjectionError("subscription_cancel_state_invalid");
  }
  return {
    id,
    customerId: args.customerId,
    livemode: args.livemode,
    status,
    currentPeriodStart: periods.start,
    currentPeriodEnd: periods.end,
    cancelAtPeriodEnd: record.cancel_at_period_end,
    productId,
    priceId,
    amount,
    currency,
    interval,
    intervalCount,
    planType,
    entitlementPlanType: status === "active" ? planType : null,
  };
}

function sameSubscription(
  left: StripeSubscriptionProjectionRecord,
  right: StripeSubscriptionProjectionRecord,
): boolean {
  return left.id === right.id
    && left.customerId === right.customerId
    && left.livemode === right.livemode
    && left.status === right.status
    && left.currentPeriodStart === right.currentPeriodStart
    && left.currentPeriodEnd === right.currentPeriodEnd
    && left.cancelAtPeriodEnd === right.cancelAtPeriodEnd
    && left.productId === right.productId
    && left.priceId === right.priceId
    && left.amount === right.amount
    && left.currency === right.currency
    && left.interval === right.interval
    && left.intervalCount === right.intervalCount
    && left.planType === right.planType;
}

export function chooseStripePlan(
  subscriptions: readonly StripeSubscriptionProjectionRecord[],
): StripePaidPlan | null {
  let selected: StripePaidPlan | null = null;
  for (const subscription of subscriptions) {
    if (subscription.status !== "active") continue;
    const plan = subscription.entitlementPlanType;
    if (plan === null) {
      throw new StripeSubscriptionProjectionError("subscription_active_plan_invalid");
    }
    if (selected === null || PAID_PLAN_ORDER[plan] > PAID_PLAN_ORDER[selected]) {
      selected = plan;
    }
  }
  return selected;
}

/**
 * Retrieve and normalize current Stripe state. This does not mutate any local
 * state and does not trust the event snapshot beyond the requested IDs/mode.
 */
export async function projectStripeSubscriptionSnapshot(
  input: StripeSubscriptionProjectionInput,
): Promise<StripeSubscriptionProjection> {
  const subscriptionId = boundedText(input.subscriptionId, "subscription_input_invalid", MAX_ID_BYTES);
  const customerId = boundedText(input.customerId, "subscription_input_invalid", MAX_ID_BYTES);
  if (typeof input.livemode !== "boolean" || input.provider === null || typeof input.provider !== "object") {
    throw new StripeSubscriptionProjectionError("subscription_input_invalid");
  }
  const validatedPriceIds = validatePriceIds(input.privatePriceIds);
  const mode = input.livemode ? "live" : "test";
  const [currentValue, activeValues] = await Promise.all([
    input.provider.retrieveSubscription(subscriptionId),
    input.provider.listActiveSubscriptions(customerId),
  ]);
  if (!Array.isArray(activeValues)) {
    throw new StripeSubscriptionProjectionError("subscription_active_list_invalid");
  }
  if (activeValues.length > MAX_LIST_SUBSCRIPTIONS) {
    throw new StripeSubscriptionProjectionError("subscription_list_limit_exceeded");
  }

  const current = normalizeSubscription(currentValue, {
    customerId,
    livemode: input.livemode,
    priceIds: validatedPriceIds[mode],
  });
  if (current.id !== subscriptionId) {
    throw new StripeSubscriptionProjectionError("subscription_id_mismatch");
  }

  const activeSubscriptions = activeValues.map((value) => normalizeSubscription(value, {
    customerId,
    livemode: input.livemode,
    priceIds: validatedPriceIds[mode],
  }));
  if (activeSubscriptions.length > MAX_ACTIVE_SUBSCRIPTIONS
    || activeSubscriptions.some((subscription) => subscription.status !== "active")) {
    throw new StripeSubscriptionProjectionError("subscription_active_list_invalid");
  }
  const ids = new Set(activeSubscriptions.map((subscription) => subscription.id));
  if (ids.size !== activeSubscriptions.length) {
    throw new StripeSubscriptionProjectionError("subscription_active_list_invalid");
  }

  const activeCurrent = activeSubscriptions.find((subscription) => subscription.id === current.id);
  if ((current.status === "active") !== (activeCurrent !== undefined)
    || (activeCurrent !== undefined && !sameSubscription(current, activeCurrent))) {
    throw new StripeSubscriptionProjectionError("subscription_current_list_changed");
  }

  const sortedActiveSubscriptions = [...activeSubscriptions].sort((left, right) =>
    left.id.localeCompare(right.id));
  return {
    current,
    activeSubscriptions: sortedActiveSubscriptions,
    activeSubscriptionCount: sortedActiveSubscriptions.length,
    effectivePlanType: chooseStripePlan(sortedActiveSubscriptions),
  };
}

/**
 * Adapter for Stripe SDK clients. Pagination and response shape are bounded;
 * every request uses the same pinned Basil version and expands the Price so
 * product and billing fields can be validated locally.
 */
export function createStripeSubscriptionProjectionProvider(
  client: StripeSubscriptionApiClient,
): StripeSubscriptionProjectionProvider {
  return {
    retrieveSubscription(subscriptionId) {
      return client.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price"] }, {
        apiVersion: PINNED_STRIPE_API_VERSION,
      });
    },
    async listActiveSubscriptions(customerId) {
      const rows: unknown[] = [];
      let startingAfter: string | undefined;
      while (true) {
        const page = asRecord(await client.subscriptions.list({
          customer: customerId,
          status: "active",
          limit: 100,
          expand: ["data.items.data.price"],
          ...(startingAfter === undefined ? {} : { starting_after: startingAfter }),
        }, { apiVersion: PINNED_STRIPE_API_VERSION }));
        if (page === null || !Array.isArray(page.data) || typeof page.has_more !== "boolean") {
          throw new StripeSubscriptionProjectionError("subscription_list_shape_invalid");
        }
        if (page.data.length > 100 || rows.length + page.data.length > MAX_LIST_SUBSCRIPTIONS) {
          throw new StripeSubscriptionProjectionError("subscription_list_limit_exceeded");
        }
        rows.push(...page.data);
        if (!page.has_more) return rows;
        const last = page.data.at(-1);
        const lastId = idFrom(asRecord(last)?.id, "subscription_list_shape_invalid");
        startingAfter = lastId;
      }
    },
  };
}
