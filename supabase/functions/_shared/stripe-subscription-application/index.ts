/** Receipt-first Stripe subscription reconciliation for Issue #32. */

import {
  PINNED_STRIPE_API_VERSION,
  projectStripeSubscriptionSnapshot,
  type StripePrivatePriceIdsByMode,
  type StripeSubscriptionProjectionRecord,
} from "../stripe-subscription-projection/index.ts";
import type {
  ClaimedInvoiceDispatch,
  StripeInvoiceProjectionRpcClient,
} from "../stripe-invoice-projection/index.ts";
import type { DurableReceiptResult } from "../stripe-receipt-ingress/index.ts";

const RETRY_AFTER_SECONDS = 60;
const MAX_GENERATION = Number.MAX_SAFE_INTEGER;
type RecordValue = Record<string, unknown>;

export interface StripeSubscriptionApplicationClient
  extends StripeInvoiceProjectionRpcClient {}

export interface StripeSubscriptionApplicationProvider {
  retrieveSubscription(subscriptionId: string): PromiseLike<unknown>;
  listActiveSubscriptions(customerId: string): PromiseLike<unknown[]>;
  retrieveCustomer(customerId: string): PromiseLike<unknown>;
}

export interface StripeSubscriptionApplicationFence {
  stripe_customer_id: string;
  livemode: boolean;
  fence_generation: number | string;
  fence_token: string;
  lease_until: string;
}

export type StripeSubscriptionApplicationResult =
  | {
    status: "applied";
    outcome: string;
    effectivePlanType: string | null;
    activeSubscriptionCount: number;
  }
  | { status: "retryable"; code: string }
  | { status: "stale"; code: string };

export class StripeSubscriptionApplicationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "StripeSubscriptionApplicationError";
    this.code = code;
  }
}

function asRecord(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function requireText(value: unknown, code: string, maxBytes = 512): string {
  if (
    typeof value !== "string" || value.trim() !== value || value.length === 0 ||
    new TextEncoder().encode(value).byteLength > maxBytes
  ) {
    throw new StripeSubscriptionApplicationError(code);
  }
  return value;
}

function requireTimestamp(value: unknown, code: string): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return requireText(value, code, 64);
}

function parseGeneration(value: unknown): number | string {
  if (
    typeof value === "number" && Number.isSafeInteger(value) && value > 0 &&
    value <= MAX_GENERATION
  ) {
    return value;
  }
  if (
    typeof value === "string" && /^[1-9][0-9]*$/u.test(value) &&
    BigInt(value) <= BigInt(MAX_GENERATION)
  ) return value;
  throw new StripeSubscriptionApplicationError(
    "subscription_rpc_shape_invalid",
  );
}

function oneRow(rows: unknown[], code: string): RecordValue {
  if (rows.length !== 1 || asRecord(rows[0]) === null) {
    throw new StripeSubscriptionApplicationError(code);
  }
  return rows[0] as RecordValue;
}

async function rpcRows(
  client: StripeSubscriptionApplicationClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<unknown[]> {
  let response: { data: unknown; error: unknown };
  try {
    response = await client.rpc(functionName, args);
  } catch {
    throw new StripeSubscriptionApplicationError(
      "subscription_rpc_unavailable",
    );
  }
  if (response.error !== null && response.error !== undefined) {
    const errorRecord = asRecord(response.error);
    const code = errorRecord?.code;
    if (code === "P0002") {
      throw new StripeSubscriptionApplicationError(
        "subscription_customer_mapping_review_required",
      );
    }
    if (code === "P0003") {
      throw new StripeSubscriptionApplicationError(
        "subscription_row_ownership_conflict",
      );
    }
    throw new StripeSubscriptionApplicationError("subscription_rpc_failed");
  }
  if (response.data === null || response.data === undefined) return [];
  if (!Array.isArray(response.data)) {
    throw new StripeSubscriptionApplicationError(
      "subscription_rpc_shape_invalid",
    );
  }
  return response.data;
}

function parseDispatch(
  row: unknown,
  receipt: DurableReceiptResult,
  livemode: boolean,
): ClaimedInvoiceDispatch {
  const value = asRecord(row);
  if (!value) {
    throw new StripeSubscriptionApplicationError(
      "subscription_dispatch_shape_invalid",
    );
  }
  const payload = asRecord(value.normalized_payload);
  const generation = parseGeneration(value.claim_generation);
  const dispatch = {
    receipt_id: requireText(
      value.receipt_id,
      "subscription_dispatch_shape_invalid",
    ),
    dispatch_id: requireText(
      value.dispatch_id,
      "subscription_dispatch_shape_invalid",
    ),
    stripe_event_id: requireText(
      value.stripe_event_id,
      "subscription_dispatch_shape_invalid",
    ),
    livemode: value.livemode,
    event_type: requireText(
      value.event_type,
      "subscription_dispatch_shape_invalid",
    ),
    object_type: typeof value.object_type === "string"
      ? value.object_type
      : null,
    object_id: typeof value.object_id === "string" ? value.object_id : null,
    api_version: typeof value.api_version === "string"
      ? value.api_version
      : null,
    normalized_schema_version: value.normalized_schema_version,
    normalized_payload: payload,
    normalized_payload_sha256: requireText(
      value.normalized_payload_sha256,
      "subscription_dispatch_shape_invalid",
      64,
    ),
    raw_payload_sha256: requireText(
      value.raw_payload_sha256,
      "subscription_dispatch_shape_invalid",
      64,
    ),
    attempt_count: value.attempt_count,
    claim_generation: generation,
    lease_token: requireText(
      value.lease_token,
      "subscription_dispatch_shape_invalid",
      64,
    ),
    lease_until: requireTimestamp(
      value.lease_until,
      "subscription_dispatch_shape_invalid",
    ),
  } as ClaimedInvoiceDispatch;
  if (
    dispatch.receipt_id !== receipt.receipt_id ||
    dispatch.dispatch_id !== receipt.dispatch_id ||
    dispatch.stripe_event_id.length === 0 || dispatch.livemode !== livemode ||
    typeof dispatch.normalized_schema_version !== "number" ||
    !Number.isSafeInteger(dispatch.normalized_schema_version) ||
    dispatch.normalized_schema_version !== 1 || payload === null ||
    !/^[0-9a-f]{64}$/u.test(dispatch.normalized_payload_sha256) ||
    !/^[0-9a-f]{64}$/u.test(dispatch.raw_payload_sha256) ||
    typeof dispatch.attempt_count !== "number" ||
    !Number.isSafeInteger(dispatch.attempt_count) ||
    dispatch.attempt_count < 1
  ) {
    throw new StripeSubscriptionApplicationError(
      "subscription_dispatch_shape_invalid",
    );
  }
  return dispatch;
}

function parseFence(row: unknown): StripeSubscriptionApplicationFence {
  const value = asRecord(row);
  if (!value || typeof value.livemode !== "boolean") {
    throw new StripeSubscriptionApplicationError(
      "subscription_fence_shape_invalid",
    );
  }
  return {
    stripe_customer_id: requireText(
      value.stripe_customer_id,
      "subscription_fence_shape_invalid",
      255,
    ),
    livemode: value.livemode,
    fence_generation: parseGeneration(value.fence_generation),
    fence_token: requireText(
      value.fence_token,
      "subscription_fence_shape_invalid",
      64,
    ),
    lease_until: requireTimestamp(
      value.lease_until,
      "subscription_fence_shape_invalid",
    ),
  };
}

function sourceIdentity(
  dispatch: ClaimedInvoiceDispatch,
): { subscriptionId: string; customerId: string } {
  const payload = dispatch.normalized_payload;
  const event = asRecord(payload.event);
  const object = asRecord(payload.object);
  const subscription = asRecord(payload.subscription);
  if (
    payload.branch !== "subscription" || !event || !object || !subscription ||
    event.id !== dispatch.stripe_event_id ||
    event.type !== dispatch.event_type ||
    event.livemode !== dispatch.livemode || object.type !== "subscription" ||
    object.id !== dispatch.object_id || subscription.id !== dispatch.object_id
  ) {
    throw new StripeSubscriptionApplicationError(
      "subscription_receipt_shape_invalid",
    );
  }
  if (
    ![
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ].includes(dispatch.event_type)
  ) {
    throw new StripeSubscriptionApplicationError(
      "subscription_event_unsupported",
    );
  }
  return {
    subscriptionId: requireText(
      subscription.id,
      "subscription_receipt_shape_invalid",
      255,
    ),
    customerId: requireText(
      subscription.customer_id,
      "subscription_receipt_customer_missing",
      255,
    ),
  };
}

function applicationProjection(
  record: StripeSubscriptionProjectionRecord,
): Record<string, unknown> {
  return {
    id: record.id,
    customer_id: record.customerId,
    status: record.status,
    current_period_start: record.currentPeriodStart,
    current_period_end: record.currentPeriodEnd,
    cancel_at_period_end: record.cancelAtPeriodEnd,
    product_id: record.productId,
    price_id: record.priceId,
    amount: record.amount,
    currency: record.currency,
    recurring_interval: record.interval,
    interval_count: record.intervalCount,
    plan_type: record.planType,
  };
}

export async function processAcceptedStripeSubscriptionReceipt(input: {
  client: StripeSubscriptionApplicationClient;
  provider: StripeSubscriptionApplicationProvider;
  loadPriceIds(): PromiseLike<StripePrivatePriceIdsByMode>;
  resolveUser(
    customerId: string,
    livemode: boolean,
  ): PromiseLike<{ userId: string; needsCustomerLink: boolean }>;
  receipt: DurableReceiptResult;
  livemode: boolean;
}): Promise<StripeSubscriptionApplicationResult> {
  if (input.receipt.outcome === "duplicate_terminal") {
    return {
      status: "applied",
      outcome: "duplicate_terminal",
      effectivePlanType: null,
      activeSubscriptionCount: 0,
    };
  }
  if (!input.receipt.dispatch_id || typeof input.livemode !== "boolean") {
    throw new StripeSubscriptionApplicationError(
      "subscription_runtime_options_invalid",
    );
  }

  const dispatchRows = await rpcRows(
    input.client,
    "claim_stripe_webhook_dispatch_by_id",
    {
      p_dispatch_id: input.receipt.dispatch_id,
      p_livemode: input.livemode,
      p_lease_seconds: 300,
    },
  );
  if (!dispatchRows.length) {
    return { status: "retryable", code: "subscription_dispatch_not_claimed" };
  }
  const dispatch = parseDispatch(
    oneRow(dispatchRows, "subscription_dispatch_shape_invalid"),
    input.receipt,
    input.livemode,
  );

  let customerId: string | null = null;
  let fence: StripeSubscriptionApplicationFence | null = null;
  try {
    const source = sourceIdentity(dispatch);
    customerId = source.customerId;
    const fenceRows = await rpcRows(
      input.client,
      "acquire_stripe_customer_fence",
      {
        p_receipt_id: dispatch.receipt_id,
        p_dispatch_id: dispatch.dispatch_id,
        p_livemode: dispatch.livemode,
        p_lease_token: dispatch.lease_token,
        p_claim_generation: dispatch.claim_generation,
        p_stripe_customer_id: source.customerId,
        p_lease_seconds: 300,
      },
    );
    if (!fenceRows.length) {
      return await retryDispatch(
        input.client,
        dispatch,
        "subscription_customer_fence_busy",
        null,
        null,
      );
    }
    fence = parseFence(oneRow(fenceRows, "subscription_fence_shape_invalid"));
    if (
      fence.stripe_customer_id !== source.customerId ||
      fence.livemode !== dispatch.livemode
    ) {
      throw new StripeSubscriptionApplicationError(
        "subscription_fence_identity_mismatch",
      );
    }

    const [priceIds, mapping] = await Promise.all([
      input.loadPriceIds(),
      input.resolveUser(source.customerId, dispatch.livemode),
    ]);
    const projection = await projectStripeSubscriptionSnapshot({
      subscriptionId: source.subscriptionId,
      customerId: source.customerId,
      livemode: dispatch.livemode,
      privatePriceIds: priceIds,
      provider: input.provider,
    });
    const current = projection.current;
    if (current.id !== source.subscriptionId) {
      throw new StripeSubscriptionApplicationError("subscription_id_mismatch");
    }
    if (
      current.currentPeriodStart === null || current.currentPeriodEnd === null
    ) {
      throw new StripeSubscriptionApplicationError(
        "subscription_period_invalid",
      );
    }
    const records = new Map(
      projection.activeSubscriptions.map((row) => [row.id, row]),
    );
    records.set(current.id, current);
    const effectivePlanType = projection.effectivePlanType ??
      (dispatch.event_type === "customer.subscription.deleted" ? "free" : null);
    const appliedRows = await rpcRows(
      input.client,
      "apply_stripe_subscription_projection",
      {
        p_receipt_id: dispatch.receipt_id,
        p_dispatch_id: dispatch.dispatch_id,
        p_livemode: dispatch.livemode,
        p_lease_token: dispatch.lease_token,
        p_claim_generation: dispatch.claim_generation,
        p_stripe_customer_id: source.customerId,
        p_local_user_id: mapping.userId,
        p_link_customer: mapping.needsCustomerLink,
        p_current_subscription_id: current.id,
        p_subscriptions: [...records.values()].map(applicationProjection),
        p_effective_plan_type: effectivePlanType,
        p_fence_token: fence.fence_token,
        p_fence_generation: fence.fence_generation,
      },
    );
    const applied = oneRow(appliedRows, "subscription_rpc_shape_invalid");
    const duplicateApplied = applied.outcome === "duplicate_applied";
    const activeSubscriptionCount = applied.active_subscription_count;
    const returnedPlan: string | null | undefined =
      applied.effective_plan_type === null
        ? null
        : typeof applied.effective_plan_type === "string"
        ? applied.effective_plan_type
        : undefined;
    if (
      (applied.outcome !== "applied" && !duplicateApplied) ||
      applied.ledger_status !== "applied" ||
      applied.receipt_status !== "applied" ||
      applied.dispatch_status !== "completed" ||
      applied.receipt_id !== dispatch.receipt_id ||
      applied.dispatch_id !== dispatch.dispatch_id ||
      applied.local_user_id !== mapping.userId ||
      returnedPlan === undefined ||
      typeof activeSubscriptionCount !== "number" ||
      !Number.isSafeInteger(activeSubscriptionCount) ||
      activeSubscriptionCount < 0 || activeSubscriptionCount > 100 ||
      (!duplicateApplied && (returnedPlan !== effectivePlanType ||
        activeSubscriptionCount !== projection.activeSubscriptionCount ||
        String(applied.fence_generation) !== String(fence.fence_generation)))
    ) {
      throw new StripeSubscriptionApplicationError(
        "subscription_rpc_shape_invalid",
      );
    }
    const resultPlan = returnedPlan;
    fence = null;
    return {
      status: "applied",
      outcome: String(applied.outcome),
      effectivePlanType: resultPlan,
      activeSubscriptionCount,
    };
  } catch (error) {
    const code = error instanceof StripeSubscriptionApplicationError
      ? error.code
      : error instanceof Error &&
          error.name === "StripeCustomerUserMappingError"
      ? "subscription_customer_mapping_review_required"
      : "subscription_reconciliation_retryable";
    return await retryDispatch(input.client, dispatch, code, fence, customerId);
  }
}

async function retryDispatch(
  client: StripeSubscriptionApplicationClient,
  dispatch: ClaimedInvoiceDispatch,
  errorCode: string,
  fence: StripeSubscriptionApplicationFence | null,
  customerId: string | null,
): Promise<StripeSubscriptionApplicationResult> {
  if (fence && customerId) {
    try {
      await rpcRows(client, "release_stripe_customer_fence", {
        p_receipt_id: dispatch.receipt_id,
        p_dispatch_id: dispatch.dispatch_id,
        p_livemode: dispatch.livemode,
        p_lease_token: dispatch.lease_token,
        p_claim_generation: dispatch.claim_generation,
        p_stripe_customer_id: customerId,
        p_fence_token: fence.fence_token,
        p_fence_generation: fence.fence_generation,
      });
    } catch {
      // The fence remains generation-protected and expires if release fails.
    }
  }
  try {
    const rows = await rpcRows(client, "retry_stripe_webhook_dispatch", {
      p_receipt_id: dispatch.receipt_id,
      p_dispatch_id: dispatch.dispatch_id,
      p_livemode: dispatch.livemode,
      p_lease_token: dispatch.lease_token,
      p_claim_generation: dispatch.claim_generation,
      p_retry_after_seconds: RETRY_AFTER_SECONDS,
      p_error_code: errorCode,
      p_error_message: "Subscription reconciliation requires retry or review",
    });
    if (rows.length !== 1) {
      return { status: "stale", code: "subscription_dispatch_lease_stale" };
    }
    const retry = rows[0] as RecordValue;
    if (
      retry.receipt_id !== dispatch.receipt_id ||
      retry.dispatch_id !== dispatch.dispatch_id ||
      retry.stripe_event_id !== dispatch.stripe_event_id ||
      retry.receipt_status !== "retryable" ||
      retry.dispatch_status !== "retryable" ||
      String(retry.claim_generation) !== String(dispatch.claim_generation) ||
      !retry.available_at
    ) {
      return { status: "stale", code: "subscription_dispatch_lease_stale" };
    }
    return { status: "retryable", code: errorCode };
  } catch {
    return {
      status: "retryable",
      code: "subscription_retry_persistence_failed",
    };
  }
}

export function createStripeSubscriptionApplicationProvider(stripe: {
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
  customers: {
    retrieve(
      id: string,
      params: Record<string, never>,
      options: { apiVersion: typeof PINNED_STRIPE_API_VERSION },
    ): PromiseLike<unknown>;
  };
}): StripeSubscriptionApplicationProvider {
  return {
    retrieveSubscription(id) {
      return stripe.subscriptions.retrieve(id, {
        expand: ["items.data.price.product"],
      }, {
        apiVersion: PINNED_STRIPE_API_VERSION,
      });
    },
    async listActiveSubscriptions(customerId) {
      const values: unknown[] = [];
      let startingAfter: string | undefined;
      while (true) {
        const page = asRecord(
          await stripe.subscriptions.list({
            customer: customerId,
            status: "active",
            limit: 100,
            expand: ["data.items.data.price.product"],
            ...(startingAfter ? { starting_after: startingAfter } : {}),
          }, { apiVersion: PINNED_STRIPE_API_VERSION }),
        );
        const rows = page && Array.isArray(page.data) ? page.data : null;
        if (!rows || typeof page?.has_more !== "boolean" || rows.length > 100) {
          throw new StripeSubscriptionApplicationError(
            "subscription_list_shape_invalid",
          );
        }
        values.push(...rows);
        if (values.length > 1_000) {
          throw new StripeSubscriptionApplicationError(
            "subscription_list_limit_exceeded",
          );
        }
        if (!page.has_more) return values;
        const last = asRecord(rows.at(-1));
        startingAfter = requireText(
          last?.id,
          "subscription_list_shape_invalid",
          255,
        );
      }
    },
    retrieveCustomer(id) {
      return stripe.customers.retrieve(id, {}, {
        apiVersion: PINNED_STRIPE_API_VERSION,
      });
    },
  };
}
