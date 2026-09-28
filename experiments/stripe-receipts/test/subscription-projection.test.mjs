import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PINNED_STRIPE_API_VERSION,
  StripeSubscriptionProjectionError,
  createStripeSubscriptionProjectionProvider,
  projectStripeSubscriptionSnapshot,
} from "../../../supabase/functions/_shared/stripe-subscription-projection/index.ts";

const CUSTOMER_ID = "cus_projection_adapter";
const PRICE_IDS = {
  test: {
    creator: "price_test_creator",
    max: "price_test_max",
    business: "price_test_business",
  },
  live: {
    creator: "price_live_creator",
    max: "price_live_max",
    business: "price_live_business",
  },
};

function priceFor(plan, livemode = true, overrides = {}) {
  return {
    object: "price",
    id: PRICE_IDS[livemode ? "live" : "test"][plan],
    product: `prod_${plan}`,
    unit_amount: 1000,
    currency: "jpy",
    recurring: { interval: "month", interval_count: 1 },
    ...overrides,
  };
}

function subscription({
  id = "sub_current",
  customerId = CUSTOMER_ID,
  livemode = true,
  status = "active",
  plan = "creator",
  items = null,
  ...overrides
} = {}) {
  const resolvedItems = items ?? [{
    current_period_start: 1_750_000_000,
    current_period_end: 1_752_592_000,
    price: priceFor(plan, livemode),
  }];
  return {
    object: "subscription",
    id,
    customer: customerId,
    livemode,
    status,
    cancel_at_period_end: false,
    items: { object: "list", data: resolvedItems },
    ...overrides,
  };
}

function provider(current, activeSubscriptions) {
  return {
    retrieveSubscription: async () => current,
    listActiveSubscriptions: async () => activeSubscriptions,
  };
}

async function project({ current, active = [current], livemode = true, privatePriceIds = PRICE_IDS, subscriptionId = current.id } = {}) {
  return projectStripeSubscriptionSnapshot({
    subscriptionId,
    customerId: CUSTOMER_ID,
    livemode,
    privatePriceIds,
    provider: provider(current, active),
  });
}

async function rejectsWithCode(operation, code) {
  await assert.rejects(operation, (error) =>
    error instanceof StripeSubscriptionProjectionError && error.code === code);
}

test("projects current state and chooses the highest active plan deterministically", async () => {
  const current = subscription({ id: "sub_z_current", plan: "creator" });
  const business = subscription({ id: "sub_a_business", plan: "business" });
  const result = await project({ current, active: [current, business] });

  assert.equal(result.current.id, "sub_z_current");
  assert.equal(result.current.planType, "creator");
  assert.equal(result.current.entitlementPlanType, "creator");
  assert.equal(result.activeSubscriptionCount, 2);
  assert.deepEqual(result.activeSubscriptions.map(({ id }) => id), [
    "sub_a_business",
    "sub_z_current",
  ]);
  assert.equal(result.effectivePlanType, "business");
  assert.equal(result.current.currentPeriodStart, "2025-06-15T15:06:40.000Z");
  assert.equal(result.current.currentPeriodEnd, "2025-07-15T15:06:40.000Z");
  assert.equal(result.current.cancelAtPeriodEnd, false);
});

test("non-active current state has no entitlement while current active plans still determine the effective plan", async () => {
  const current = subscription({ id: "sub_past_due", status: "past_due", plan: "business" });
  const creator = subscription({ id: "sub_creator", plan: "creator" });
  const max = subscription({ id: "sub_max", plan: "max" });
  const result = await project({ current, active: [creator, max] });

  assert.equal(result.current.planType, "business");
  assert.equal(result.current.entitlementPlanType, null);
  assert.equal(result.effectivePlanType, "max");
  assert.equal(result.activeSubscriptionCount, 2);
});

test("the injected Stripe adapter pins Basil and expands subscription prices across pages", async () => {
  const calls = [];
  const adapter = createStripeSubscriptionProjectionProvider({
    subscriptions: {
      retrieve: async (...args) => {
        calls.push(["retrieve", ...args]);
        return subscription({ id: "sub_provider" });
      },
      list: async (...args) => {
        calls.push(["list", ...args]);
        if (args[0].starting_after === undefined) {
          return { object: "list", data: [subscription({ id: "sub_page_1" })], has_more: true };
        }
        return { object: "list", data: [subscription({ id: "sub_page_2" })], has_more: false };
      },
    },
  });

  const current = await adapter.retrieveSubscription("sub_provider");
  const active = await adapter.listActiveSubscriptions(CUSTOMER_ID);
  assert.equal(current.id, "sub_provider");
  assert.deepEqual(active.map(({ id }) => id), ["sub_page_1", "sub_page_2"]);
  assert.deepEqual(calls, [
    ["retrieve", "sub_provider", { expand: ["items.data.price"] }, { apiVersion: PINNED_STRIPE_API_VERSION }],
    ["list", {
      customer: CUSTOMER_ID,
      status: "active",
      limit: 100,
      expand: ["data.items.data.price"],
    }, { apiVersion: PINNED_STRIPE_API_VERSION }],
    ["list", {
      customer: CUSTOMER_ID,
      status: "active",
      limit: 100,
      expand: ["data.items.data.price"],
      starting_after: "sub_page_1",
    }, { apiVersion: PINNED_STRIPE_API_VERSION }],
  ]);
});

test("rejects a current subscription whose customer or mode does not match", async () => {
  await rejectsWithCode(
    project({ current: subscription({ customerId: "cus_other" }) }),
    "subscription_customer_mismatch",
  );
  await rejectsWithCode(
    project({ current: subscription({ livemode: false }), livemode: true }),
    "subscription_mode_mismatch",
  );
  await rejectsWithCode(
    project({ current: subscription({ id: "sub_other" }), active: [subscription({ id: "sub_other" })], subscriptionId: "sub_requested" }),
    "subscription_id_mismatch",
  );
});

test("rejects duplicate active IDs and inconsistent current-active state", async () => {
  const current = subscription({ id: "sub_same", plan: "creator" });
  await rejectsWithCode(
    project({ current, active: [current, subscription({ id: "sub_same", plan: "max" })] }),
    "subscription_active_list_invalid",
  );

  await rejectsWithCode(
    project({ current, active: [subscription({ id: "sub_other", plan: "creator" })] }),
    "subscription_current_list_changed",
  );

  const nonActive = subscription({ id: "sub_nonactive", status: "canceled" });
  await rejectsWithCode(
    project({ current: nonActive, active: [subscription({ id: "sub_nonactive", status: "active" })] }),
    "subscription_current_list_changed",
  );

  await rejectsWithCode(
    project({
      current,
      active: [subscription({ id: current.id, plan: "max" })],
    }),
    "subscription_current_list_changed",
  );
});

test("reads billing periods from the sole Basil SubscriptionItem and rejects legacy or malformed shapes", async () => {
  const valid = await project({ current: subscription() });
  assert.equal(valid.current.currentPeriodStart, "2025-06-15T15:06:40.000Z");
  assert.equal(valid.current.currentPeriodEnd, "2025-07-15T15:06:40.000Z");

  await rejectsWithCode(
    project({ current: subscription({ current_period_start: 1_750_000_000 }) }),
    "subscription_period_invalid",
  );
  await rejectsWithCode(
    project({
      current: subscription({
        items: [{
          current_period_end: 1_752_592_000,
          price: priceFor("creator"),
        }],
      }),
    }),
    "subscription_period_invalid",
  );
  await rejectsWithCode(
    project({
      current: subscription({
        items: [{
          current_period_start: 1_752_592_000,
          current_period_end: 1_750_000_000,
          price: priceFor("creator"),
        }],
      }),
    }),
    "subscription_period_invalid",
  );
});

test("rejects multiple billable items instead of silently selecting one", async () => {
  const current = subscription({
    items: [
      { price: priceFor("creator") },
      { price: priceFor("max") },
    ],
  });
  await rejectsWithCode(project({ current }), "subscription_items_ambiguous");
});

test("uses exact mode-specific private Price IDs", async () => {
  await rejectsWithCode(
    project({
      current: subscription({ items: [{
        current_period_start: 1_750_000_000,
        current_period_end: 1_752_592_000,
        price: priceFor("creator", false),
      }] }),
    }),
    "subscription_price_unmapped",
  );

  await rejectsWithCode(
    project({
      current: subscription({ livemode: false, items: [{
        current_period_start: 1_750_000_000,
        current_period_end: 1_752_592_000,
        price: priceFor("creator", true),
      }] }),
      active: [subscription({ livemode: false, items: [{
        current_period_start: 1_750_000_000,
        current_period_end: 1_752_592_000,
        price: priceFor("creator", true),
      }] })],
      livemode: false,
    }),
    "subscription_price_unmapped",
  );

  await rejectsWithCode(
    project({
      current: subscription(),
      privatePriceIds: {
        ...PRICE_IDS,
        live: { ...PRICE_IDS.live, max: PRICE_IDS.live.creator },
      },
    }),
    "subscription_price_configuration_conflict",
  );

  await rejectsWithCode(
    project({
      current: subscription(),
      privatePriceIds: {
        ...PRICE_IDS,
        live: { ...PRICE_IDS.live, creator: "public_creator" },
      },
    }),
    "subscription_price_configuration_review_required",
  );
});

test("validates status, periods, cancellation, amount, currency, and recurring fields", async () => {
  const invalidCases = [
    ["subscription_status_invalid", { status: "unknown" }],
    ["subscription_cancel_state_invalid", { cancel_at_period_end: "false" }],
    ["subscription_amount_invalid", { items: [{ current_period_start: 1_750_000_000, current_period_end: 1_752_592_000, price: priceFor("creator", true, { unit_amount: -1 }) }] }],
    ["subscription_amount_invalid", { items: [{ current_period_start: 1_750_000_000, current_period_end: 1_752_592_000, price: priceFor("creator", true, { unit_amount: 1.5 }) }] }],
    ["subscription_currency_invalid", { items: [{ current_period_start: 1_750_000_000, current_period_end: 1_752_592_000, price: priceFor("creator", true, { currency: "JPY" }) }] }],
    ["subscription_interval_invalid", { items: [{ current_period_start: 1_750_000_000, current_period_end: 1_752_592_000, price: priceFor("creator", true, { recurring: { interval: "hour", interval_count: 1 } }) }] }],
    ["subscription_interval_invalid", { items: [{ current_period_start: 1_750_000_000, current_period_end: 1_752_592_000, price: priceFor("creator", true, { recurring: { interval: "month", interval_count: 0 } }) }] }],
    ["subscription_interval_invalid", { items: [{ current_period_start: 1_750_000_000, current_period_end: 1_752_592_000, price: priceFor("creator", true, { recurring: { interval: "month" } }) }] }],
  ];
  for (const [code, overrides] of invalidCases) {
    const current = subscription(overrides);
    await rejectsWithCode(project({ current }), code);
  }
});

test("rejects malformed active list entries even when the current object is valid", async () => {
  const current = subscription();
  await rejectsWithCode(
    project({ current, active: [subscription({ id: "sub_other", status: "past_due" })] }),
    "subscription_active_list_invalid",
  );
  await rejectsWithCode(
    project({ current, active: [subscription({ id: "sub_other", customerId: "cus_other" })] }),
    "subscription_customer_mismatch",
  );
});
