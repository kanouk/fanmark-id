import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assessCheckoutExtensionPayment,
  buildPaidExtensionPriceMetadata,
} from "../../../supabase/functions/_shared/stripe-receipt-ingress/index.ts";

const expectedMetadata = {
  expected_total_yen: "1200",
  allow_zero_total: "false",
};

test("paid extension checkout metadata pins a positive yen total and disables free Stripe checkout", () => {
  assert.deepEqual(buildPaidExtensionPriceMetadata(1200), {
    expected_total_yen: "1200",
    allow_zero_total: "false",
  });
  assert.throws(() => buildPaidExtensionPriceMetadata(0), /price_must_be_positive/);
  assert.throws(() => buildPaidExtensionPriceMetadata(1.5), /price_must_be_positive/);
});

function session(overrides = {}) {
  return {
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    amount_total: 1200,
    currency: "jpy",
    metadata: { ...expectedMetadata },
    ...overrides,
  };
}

test("paid completed checkout can fulfill an extension with the expected total", () => {
  assert.deepEqual(
    assessCheckoutExtensionPayment("checkout.session.completed", session()),
    { outcome: "grant", reason: "paid" },
  );
});

test("delayed payment completion waits for its later success event", () => {
  assert.deepEqual(
    assessCheckoutExtensionPayment(
      "checkout.session.completed",
      session({ payment_status: "unpaid" }),
    ),
    { outcome: "awaiting_payment_confirmation", reason: "checkout_completed_unpaid" },
  );
});

test("async payment success is eligible only after Stripe reports paid", () => {
  assert.deepEqual(
    assessCheckoutExtensionPayment(
      "checkout.session.async_payment_succeeded",
      session(),
    ),
    { outcome: "grant", reason: "paid" },
  );
  assert.equal(
    assessCheckoutExtensionPayment(
      "checkout.session.async_payment_succeeded",
      session({ payment_status: "unpaid" }),
    ).outcome,
    "reject",
  );
});

test("zero-total completion never grants through the paid extension flow", () => {
  for (const freeSession of [
    session({ payment_status: "no_payment_required", amount_total: 0, metadata: {} }),
    session({
      payment_status: "no_payment_required",
      amount_total: 0,
      metadata: { expected_total_yen: "0", allow_zero_total: "true" },
    }),
  ]) {
    assert.equal(
      assessCheckoutExtensionPayment("checkout.session.completed", freeSession).outcome,
      "reject",
    );
  }
});

test("a changed amount, currency, or incomplete expectation fails closed", () => {
  for (const invalid of [
    session({ amount_total: 1199 }),
    session({ currency: "usd" }),
    session({ metadata: { expected_total_yen: "1200" } }),
    session({ mode: "subscription" }),
    session({ status: "open" }),
  ]) {
    assert.equal(
      assessCheckoutExtensionPayment("checkout.session.completed", invalid).outcome,
      "reject",
    );
  }
});

test("failed or expired async checkout events never grant an extension", () => {
  assert.deepEqual(
    assessCheckoutExtensionPayment(
      "checkout.session.async_payment_failed",
      session({ payment_status: "paid" }),
    ),
    { outcome: "no_grant", reason: "async_payment_failed" },
  );
  assert.deepEqual(
    assessCheckoutExtensionPayment(
      "checkout.session.expired",
      session({ payment_status: "paid" }),
    ),
    { outcome: "no_grant", reason: "checkout_expired" },
  );
});
