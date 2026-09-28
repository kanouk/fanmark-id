import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveStripeCustomerUserMapping,
  StripeCustomerUserMappingError,
} from "../../../supabase/functions/_shared/stripe-customer-user-mapping.ts";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_ID = "33333333-3333-4333-8333-333333333333";
const CUSTOMER_ID = "cus_exact_mapping";

function setup({
  customer = { id: CUSTOMER_ID, livemode: false, metadata: {} },
  customerRows = [],
  userRows = [],
  linkResult = false,
} = {}) {
  const calls = [];
  const repository = {
    async findByStripeCustomerId(customerId) {
      calls.push(["findByStripeCustomerId", customerId]);
      return customerRows;
    },
    async findByUserId(userId) {
      calls.push(["findByUserId", userId]);
      return userRows;
    },
    async linkIfUnbound(userId, customerId) {
      calls.push(["linkIfUnbound", userId, customerId]);
      return linkResult;
    },
  };
  const provider = {
    async retrieveCustomer(customerId) {
      calls.push(["retrieveCustomer", customerId]);
      return customer;
    },
  };
  return { repository, provider, calls };
}

async function resolve(state, overrides = {}) {
  return resolveStripeCustomerUserMapping({
    repository: state.repository,
    provider: state.provider,
    customerId: CUSTOMER_ID,
    livemode: false,
    ...overrides,
  });
}

test("uses an exact persisted Stripe customer mapping", async () => {
  const state = setup({
    customer: { id: CUSTOMER_ID, livemode: false, metadata: { user_id: USER_ID } },
    customerRows: [{ userId: USER_ID, stripeCustomerId: CUSTOMER_ID }],
    userRows: [{ userId: USER_ID, stripeCustomerId: CUSTOMER_ID }],
  });

  assert.equal(await resolve(state), USER_ID);
  assert.equal(state.calls.some(([name]) => name === "linkIfUnbound"), false);
});

test("uses verified Customer metadata and links only an unbound existing user", async () => {
  const state = setup({
    customer: { id: CUSTOMER_ID, livemode: false, metadata: { user_id: USER_ID } },
    userRows: [{ userId: USER_ID, stripeCustomerId: null }],
    linkResult: true,
  });

  assert.equal(await resolve(state), USER_ID);
  assert.deepEqual(state.calls.at(-1), ["linkIfUnbound", USER_ID, CUSTOMER_ID]);
});

test("email-only identity never links a Stripe customer", async () => {
  const state = setup({
    customer: { id: CUSTOMER_ID, livemode: false, email: "person@example.test", metadata: {} },
  });

  await assert.rejects(resolve(state), (error) =>
    error instanceof StripeCustomerUserMappingError &&
    error.message === "stripe_customer_mapping_review_required");
  assert.deepEqual(state.calls.map(([name]) => name), [
    "retrieveCustomer",
    "findByStripeCustomerId",
  ]);
});

test("rejects conflicting direct and Customer metadata identities", async () => {
  const state = setup({
    customer: { id: CUSTOMER_ID, livemode: false, metadata: { user_id: OTHER_USER_ID } },
    customerRows: [{ userId: USER_ID, stripeCustomerId: CUSTOMER_ID }],
  });

  await assert.rejects(resolve(state), /stripe_customer_mapping_conflict/u);
  assert.equal(state.calls.some(([name]) => name === "findByUserId"), false);
});

test("rejects metadata identities already bound to a different customer", async () => {
  const state = setup({
    customer: { id: CUSTOMER_ID, livemode: false, metadata: { user_id: USER_ID } },
    userRows: [{ userId: USER_ID, stripeCustomerId: "cus_other" }],
  });

  await assert.rejects(resolve(state), /stripe_customer_mapping_conflict/u);
  assert.equal(state.calls.some(([name]) => name === "linkIfUnbound"), false);
});

test("rejects ambiguous customer mappings and wrong Stripe mode", async () => {
  const ambiguous = setup({
    customerRows: [
      { userId: USER_ID, stripeCustomerId: CUSTOMER_ID },
      { userId: OTHER_USER_ID, stripeCustomerId: CUSTOMER_ID },
    ],
  });
  await assert.rejects(resolve(ambiguous), /stripe_customer_mapping_ambiguous/u);

  const wrongMode = setup({
    customer: { id: CUSTOMER_ID, livemode: true, metadata: { user_id: USER_ID } },
    userRows: [{ userId: USER_ID, stripeCustomerId: null }],
  });
  await assert.rejects(resolve(wrongMode), /stripe_customer_mode_mismatch/u);
});

test("a concurrent link succeeds only when the exact customer mapping appears", async () => {
  const state = setup({
    customer: { id: CUSTOMER_ID, livemode: false, metadata: { user_id: USER_ID } },
    userRows: [{ userId: USER_ID, stripeCustomerId: null }],
    linkResult: false,
  });
  let reads = 0;
  state.repository.findByStripeCustomerId = async (customerId) => {
    state.calls.push(["findByStripeCustomerId", customerId]);
    reads += 1;
    return reads === 1 ? [] : [{ userId: USER_ID, stripeCustomerId: CUSTOMER_ID }];
  };

  assert.equal(await resolve(state), USER_ID);
  assert.deepEqual(state.calls.at(-1), ["findByStripeCustomerId", CUSTOMER_ID]);
});
