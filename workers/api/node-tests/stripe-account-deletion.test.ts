import assert from "node:assert/strict";
import test from "node:test";
import { cancelLinkedStripeSubscriptionsForAccountDeletion } from "../src/stripe-account-deletion.ts";

const customerId = "cus_syntheticcustomer";
const subscriptionId = "sub_syntheticsubscription";
const env = { STRIPE_SECRET_KEY_TEST: "sk_test_synthetic", STRIPE_SECRET_KEY_LIVE: "sk_live_synthetic" };

function stripeCustomer(livemode: boolean) {
  return { id: customerId, livemode };
}

function stripeSubscription(status: string, livemode = true) {
  return { id: subscriptionId, customer: customerId, status, livemode };
}

test("no Stripe customer linkage needs no Stripe secret or network call", async () => {
  await cancelLinkedStripeSubscriptionsForAccountDeletion([], {}, () => {
    throw new Error("client must not be constructed without linked customers");
  });
});

test("cancels every nonterminal subscription only in the exact customer mode", async () => {
  const calls: string[] = [];
  await cancelLinkedStripeSubscriptionsForAccountDeletion([customerId], env, (secret) => {
    const livemode = secret.startsWith("sk_live_");
    return {
      customers: {
        async retrieve(id: string) {
          calls.push(`customer:${livemode}:${id}`);
          if (!livemode) throw Object.assign(new Error("missing"), { code: "resource_missing", statusCode: 404 });
          return stripeCustomer(true);
        },
      },
      subscriptions: {
        async list(input: { customer: string; status: "all"; limit: number }) {
          assert.equal(input.customer, customerId);
          assert.equal(input.status, "all");
          calls.push(`list:${livemode}`);
          return { data: [stripeSubscription("active")], has_more: false };
        },
        async retrieve(id: string) {
          calls.push(`retrieve:${id}`);
          return stripeSubscription("canceled");
        },
        async cancel(id: string) {
          calls.push(`cancel:${id}`);
          return stripeSubscription("canceled");
        },
      },
    };
  });
  assert.deepEqual(calls, [
    `customer:false:${customerId}`,
    `customer:true:${customerId}`,
    "list:true",
    `cancel:${subscriptionId}`,
  ]);
});

test("rejects ambiguous customer mode, incomplete key custody, and unverified cancellation", async () => {
  await assert.rejects(
    cancelLinkedStripeSubscriptionsForAccountDeletion([customerId], {}, () => { throw new Error("unreachable"); }),
    /stripe_account_deletion_not_configured/u,
  );

  await assert.rejects(
    cancelLinkedStripeSubscriptionsForAccountDeletion([customerId], env, (secret) => {
      const livemode = secret.startsWith("sk_live_");
      return {
      customers: { async retrieve() { return stripeCustomer(livemode); } },
      subscriptions: {
        async list() { return { data: [], has_more: false }; },
        async retrieve() { return stripeSubscription("canceled"); },
        async cancel() { return stripeSubscription("canceled"); },
      },
    }; }),
    /stripe_billing_identity_unavailable/u,
  );

  await assert.rejects(
    cancelLinkedStripeSubscriptionsForAccountDeletion([customerId], env, (secret) => {
      const livemode = secret.startsWith("sk_live_");
      return {
        customers: { async retrieve() { return stripeCustomer(livemode); } },
        subscriptions: {
          async list() { return { data: [stripeSubscription("active")], has_more: false }; },
          async retrieve() { return stripeSubscription("active"); },
          async cancel() { return stripeSubscription("active"); },
        },
      };
    }),
    /stripe_billing_identity_unavailable/u,
  );
});

test("confirms a cancellation whose first response was lost by re-reading Stripe", async () => {
  const calls: string[] = [];
  await cancelLinkedStripeSubscriptionsForAccountDeletion([customerId], env, (secret) => {
      const livemode = secret.startsWith("sk_live_");
      return {
        customers: {
        async retrieve() {
          if (!livemode) throw Object.assign(new Error("missing"), { code: "resource_missing", statusCode: 404 });
          return stripeCustomer(true);
        },
      },
      subscriptions: {
        async list() { return { data: [stripeSubscription("active")], has_more: false }; },
        async retrieve() {
          calls.push("retrieve-after-cancel-error");
          return stripeSubscription("canceled");
        },
        async cancel() {
          calls.push("cancel");
          throw new Error("response lost after Stripe commit");
        },
      },
    };
  });
  assert.deepEqual(calls, ["cancel", "retrieve-after-cancel-error"]);
});
