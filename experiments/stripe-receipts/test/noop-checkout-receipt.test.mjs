import assert from "node:assert/strict";
import { test } from "node:test";
import { processAcceptedStripeNoopCheckoutReceipt } from "../../../supabase/functions/_shared/stripe-noop-checkout-receipt.ts";

const receipt = {
  receipt_id: "receipt-1",
  dispatch_id: "dispatch-1",
  outcome: "accepted",
  receipt_status: "received",
  dispatch_status: "pending",
  delivery_count: 1,
};

const claimedDispatch = (overrides = {}) => ({
  receipt_id: receipt.receipt_id,
  dispatch_id: receipt.dispatch_id,
  stripe_event_id: "evt-1",
  livemode: true,
  event_type: "checkout.session.completed",
  object_type: "checkout.session",
  object_id: "cs-1",
  api_version: "2025-08-27.basil",
  normalized_schema_version: 1,
  normalized_payload: {
    branch: "checkout_session",
    checkout_session: { id: "cs-1", metadata: { type: "plan_subscription" } },
  },
  normalized_payload_sha256: "a".repeat(64),
  raw_payload_sha256: "b".repeat(64),
  attempt_count: 1,
  claim_generation: "1",
  lease_token: "lease-1",
  lease_until: "2026-09-29T00:00:00.000Z",
  ...overrides,
});

function rpcClient({ claim = [claimedDispatch()], finish = [] } = {}) {
  const calls = [];
  return {
    calls,
    rpc(functionName, args) {
      calls.push({ functionName, args });
      if (functionName === "claim_stripe_webhook_dispatch_by_id") {
        return Promise.resolve({ data: claim, error: null });
      }
      if (functionName === "ignore_stripe_non_extension_checkout_receipt") {
        return Promise.resolve({ data: finish, error: null });
      }
      throw new Error(`unexpected RPC ${functionName}`);
    },
  };
}

test("claims and terminalizes an accepted non-extension checkout receipt", async () => {
  const client = rpcClient({
    finish: [{
      receipt_id: receipt.receipt_id,
      dispatch_id: receipt.dispatch_id,
      receipt_status: "ignored",
      dispatch_status: "completed",
      finalized: true,
    }],
  });

  const result = await processAcceptedStripeNoopCheckoutReceipt({ client, receipt, livemode: true });

  assert.deepEqual(result, { status: "ignored", outcome: "ignored" });
  assert.deepEqual(client.calls.map((call) => call.functionName), [
    "claim_stripe_webhook_dispatch_by_id",
    "ignore_stripe_non_extension_checkout_receipt",
  ]);
  assert.deepEqual(client.calls[1].args, {
    p_receipt_id: receipt.receipt_id,
    p_dispatch_id: receipt.dispatch_id,
    p_livemode: true,
    p_lease_token: "lease-1",
    p_claim_generation: "1",
  });
});

test("a duplicate terminal non-extension checkout skips RPC calls", async () => {
  const client = rpcClient();
  const result = await processAcceptedStripeNoopCheckoutReceipt({
    client,
    receipt: {
      ...receipt,
      outcome: "duplicate_terminal",
      receipt_status: "ignored",
      dispatch_status: "completed",
    },
    livemode: true,
  });

  assert.deepEqual(result, {
    status: "terminal",
    outcome: "duplicate_terminal",
    receipt_status: "ignored",
    dispatch_status: "completed",
  });
  assert.equal(client.calls.length, 0);
});

test("an actively leased dispatch is retried and not finalized", async () => {
  const client = rpcClient({ claim: [] });
  const result = await processAcceptedStripeNoopCheckoutReceipt({ client, receipt, livemode: true });
  assert.deepEqual(result, { status: "retryable", code: "checkout_dispatch_not_claimed" });
  assert.equal(client.calls.length, 1);
});

test("the TypeScript guard refuses an extension receipt before finalization", async () => {
  const client = rpcClient({
    claim: [claimedDispatch({
      normalized_payload: {
        branch: "checkout_session",
        checkout_session: { id: "cs-1", metadata: { type: "license_extension" } },
      },
    })],
  });

  await assert.rejects(
    processAcceptedStripeNoopCheckoutReceipt({ client, receipt, livemode: true }),
    /checkout_rpc_shape_invalid/u,
  );
  assert.equal(client.calls.length, 1);
});

test("a lost finalization fence remains retryable", async () => {
  const client = rpcClient({
    finish: [{
      receipt_id: receipt.receipt_id,
      dispatch_id: receipt.dispatch_id,
      receipt_status: "processing",
      dispatch_status: "processing",
      finalized: false,
    }],
  });
  const result = await processAcceptedStripeNoopCheckoutReceipt({ client, receipt, livemode: true });
  assert.deepEqual(result, { status: "retryable", code: "checkout_receipt_not_finalized" });
});
