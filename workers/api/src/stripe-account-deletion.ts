import Stripe from "stripe";
import { PINNED_STRIPE_API_VERSION } from "../../../supabase/functions/_shared/stripe-invoice-projection/index.ts";
import type { Env } from "./repository";

const CUSTOMER_ID = /^cus_[A-Za-z0-9]+$/u;
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]+$/u;
const TERMINAL_STATUSES = new Set(["canceled", "incomplete_expired"]);
const MAX_SUBSCRIPTIONS_PER_CUSTOMER = 1_000;

interface StripeCustomerLike {
  id?: unknown;
  deleted?: unknown;
  livemode?: unknown;
}

interface StripeSubscriptionLike {
  id?: unknown;
  customer?: unknown;
  livemode?: unknown;
  status?: unknown;
}

interface StripeClientLike {
  customers: {
    retrieve(id: string): Promise<StripeCustomerLike>;
  };
  subscriptions: {
    retrieve(id: string): Promise<StripeSubscriptionLike>;
    list(params: { customer: string; status: "all"; limit: number; starting_after?: string }): Promise<{
      data: StripeSubscriptionLike[];
      has_more: boolean;
    }>;
    cancel(id: string): Promise<StripeSubscriptionLike>;
  };
}

export class StripeAccountDeletionError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "StripeAccountDeletionError";
    this.code = code;
  }
}

function stripeKey(value: string | undefined, livemode: boolean): string {
  const key = value?.trim() ?? "";
  const prefix = livemode ? "sk_live_" : "sk_test_";
  if (!key.startsWith(prefix) || key.length <= prefix.length) {
    throw new StripeAccountDeletionError("stripe_account_deletion_not_configured");
  }
  return key;
}

function createStripeClient(secret: string): StripeClientLike {
  return new Stripe(secret, {
    apiVersion: PINNED_STRIPE_API_VERSION,
    timeout: 10_000,
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(),
  }) as unknown as StripeClientLike;
}

function isMissingResource(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; statusCode?: unknown };
  return candidate.code === "resource_missing" || candidate.statusCode === 404;
}

function stripeCustomerId(value: unknown): string | null {
  const id = typeof value === "string" ? value :
    value && typeof value === "object" ? (value as { id?: unknown }).id : null;
  return typeof id === "string" && CUSTOMER_ID.test(id) ? id : null;
}

function isValidCustomer(customer: StripeCustomerLike, customerId: string, livemode: boolean): boolean {
  return customer.id === customerId && customer.livemode === livemode;
}

function isValidSubscription(subscription: StripeSubscriptionLike, customerId: string, livemode: boolean): boolean {
  return typeof subscription.id === "string" && SUBSCRIPTION_ID.test(subscription.id) &&
    stripeCustomerId(subscription.customer) === customerId && subscription.livemode === livemode &&
    typeof subscription.status === "string";
}

async function readAllSubscriptions(client: StripeClientLike, customerId: string, livemode: boolean): Promise<StripeSubscriptionLike[]> {
  const subscriptions: StripeSubscriptionLike[] = [];
  let startingAfter: string | undefined;
  for (let pageCount = 0; pageCount < 10; pageCount += 1) {
    const page = await client.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    if (!Array.isArray(page.data) || typeof page.has_more !== "boolean" ||
        page.data.some((row) => !isValidSubscription(row, customerId, livemode))) {
      throw new StripeAccountDeletionError("stripe_account_deletion_unavailable");
    }
    subscriptions.push(...page.data);
    if (subscriptions.length > MAX_SUBSCRIPTIONS_PER_CUSTOMER) {
      throw new StripeAccountDeletionError("stripe_subscription_limit_exceeded");
    }
    if (!page.has_more) return subscriptions;
    const lastId = page.data.at(-1)?.id;
    if (typeof lastId !== "string" || lastId === startingAfter) {
      throw new StripeAccountDeletionError("stripe_account_deletion_unavailable");
    }
    startingAfter = lastId;
  }
  throw new StripeAccountDeletionError("stripe_subscription_limit_exceeded");
}

export async function cancelLinkedStripeSubscriptionsForAccountDeletion(
  customerIds: string[],
  env: Env,
  createClient: (secret: string) => StripeClientLike = createStripeClient,
): Promise<void> {
  if (customerIds.length === 0) return;
  if (new Set(customerIds).size !== customerIds.length || customerIds.some((id) => !CUSTOMER_ID.test(id))) {
    throw new StripeAccountDeletionError("billing_identity_unavailable");
  }

  const modes = [
    { livemode: false, client: createClient(stripeKey(env.STRIPE_SECRET_KEY_TEST, false)) },
    { livemode: true, client: createClient(stripeKey(env.STRIPE_SECRET_KEY_LIVE, true)) },
  ];

  for (const customerId of customerIds) {
    const lookups = await Promise.allSettled(modes.map(async (mode) => {
      const customer = await mode.client.customers.retrieve(customerId);
      if (isValidCustomer(customer, customerId, mode.livemode)) {
        return { ...mode, deleted: customer.deleted === true };
      }
      if (customer.id === customerId) throw new StripeAccountDeletionError("stripe_billing_identity_mismatch");
      return null;
    }));
    const matches: Array<{ livemode: boolean; client: StripeClientLike; deleted: boolean }> = [];
    for (const lookup of lookups) {
      if (lookup.status === "fulfilled") {
        if (lookup.value) matches.push(lookup.value);
      } else if (!isMissingResource(lookup.reason)) {
        if (lookup.reason instanceof StripeAccountDeletionError) throw lookup.reason;
        throw new StripeAccountDeletionError("stripe_account_deletion_unavailable");
      }
    }
    if (matches.length !== 1) throw new StripeAccountDeletionError("stripe_billing_identity_unavailable");

    const { livemode, client, deleted } = matches[0];
    if (deleted) continue;
    const subscriptions = await readAllSubscriptions(client, customerId, livemode);
    for (const subscription of subscriptions) {
      if (TERMINAL_STATUSES.has(String(subscription.status))) continue;
      const subscriptionId = subscription.id as string;
      let cancelled: StripeSubscriptionLike;
      try {
        cancelled = await client.subscriptions.cancel(subscriptionId);
      } catch (error) {
        if (!isMissingResource(error)) {
          // Stripe may have committed a prior cancellation while the response
          // was lost. A fresh read establishes the terminal state before retry.
          try {
            cancelled = await client.subscriptions.retrieve(subscriptionId) as StripeSubscriptionLike;
          } catch {
            throw new StripeAccountDeletionError("stripe_subscription_cancel_failed");
          }
        } else {
          throw new StripeAccountDeletionError("stripe_subscription_cancel_failed");
        }
      }
      if (!isValidSubscription(cancelled, customerId, livemode) || cancelled.id !== subscriptionId || cancelled.status !== "canceled") {
        throw new StripeAccountDeletionError("stripe_subscription_cancel_failed");
      }
    }
  }
}
