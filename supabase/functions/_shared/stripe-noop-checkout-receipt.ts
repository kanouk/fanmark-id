import type { DurableReceiptResult } from "./stripe-receipt-ingress/index.ts";

const CHECKOUT_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);

export interface StripeNoopCheckoutRpcClient {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export class StripeNoopCheckoutError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "StripeNoopCheckoutError";
  }
}

type NoopCheckoutResult =
  | { status: "ignored"; outcome: "ignored" }
  | { status: "retryable"; code: "checkout_dispatch_not_claimed" | "checkout_receipt_not_finalized" }
  | {
    status: "terminal";
    outcome: "duplicate_terminal";
    receipt_status: "ignored";
    dispatch_status: "completed";
  };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function oneRow(value: unknown, code: string): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new StripeNoopCheckoutError(code);
  }
  const row = asRecord(value[0]);
  if (row === null) throw new StripeNoopCheckoutError(code);
  return row;
}

function requireString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new StripeNoopCheckoutError("checkout_rpc_shape_invalid");
  }
  return value;
}

function requireGeneration(value: unknown): number | string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9][0-9]*$/u.test(value)) return value;
  throw new StripeNoopCheckoutError("checkout_rpc_shape_invalid");
}

function verifyNonExtensionCheckoutClaim(
  row: Record<string, unknown>,
  receipt: DurableReceiptResult,
  livemode: boolean,
): { leaseToken: string; claimGeneration: number | string } {
  if (
    requireString(row, "receipt_id") !== receipt.receipt_id ||
    requireString(row, "dispatch_id") !== receipt.dispatch_id ||
    row.livemode !== livemode ||
    typeof row.event_type !== "string" || !CHECKOUT_EVENT_TYPES.has(row.event_type) ||
    row.object_type !== "checkout.session" ||
    row.normalized_schema_version !== 1
  ) {
    throw new StripeNoopCheckoutError("checkout_rpc_shape_invalid");
  }

  const payload = asRecord(row.normalized_payload);
  const checkout = asRecord(payload?.checkout_session);
  const metadata = asRecord(checkout?.metadata);
  if (
    payload?.branch !== "checkout_session" ||
    typeof row.object_id !== "string" || checkout?.id !== row.object_id ||
    metadata?.type === "license_extension"
  ) {
    throw new StripeNoopCheckoutError("checkout_rpc_shape_invalid");
  }

  return {
    leaseToken: requireString(row, "lease_token"),
    claimGeneration: requireGeneration(row.claim_generation),
  };
}

export async function processAcceptedStripeNoopCheckoutReceipt(input: {
  client: StripeNoopCheckoutRpcClient;
  receipt: DurableReceiptResult;
  livemode: boolean;
}): Promise<NoopCheckoutResult> {
  if (typeof input.livemode !== "boolean" || input.receipt.receipt_id.length === 0
    || input.receipt.dispatch_id.length === 0) {
    throw new StripeNoopCheckoutError("checkout_runtime_options_invalid");
  }

  if (input.receipt.outcome === "duplicate_terminal") {
    if (input.receipt.receipt_status !== "ignored" || input.receipt.dispatch_status !== "completed") {
      throw new StripeNoopCheckoutError("checkout_terminal_state_invalid");
    }
    return {
      status: "terminal",
      outcome: "duplicate_terminal",
      receipt_status: "ignored",
      dispatch_status: "completed",
    };
  }

  const claimResponse = await input.client.rpc("claim_stripe_webhook_dispatch_by_id", {
    p_dispatch_id: input.receipt.dispatch_id,
    p_livemode: input.livemode,
    p_lease_seconds: 300,
  });
  if (claimResponse.error) throw new StripeNoopCheckoutError("checkout_dispatch_claim_failed");
  if (!Array.isArray(claimResponse.data) || claimResponse.data.length === 0) {
    return { status: "retryable", code: "checkout_dispatch_not_claimed" };
  }
  const claim = oneRow(claimResponse.data, "checkout_rpc_shape_invalid");
  const { leaseToken, claimGeneration } = verifyNonExtensionCheckoutClaim(
    claim,
    input.receipt,
    input.livemode,
  );

  const finishResponse = await input.client.rpc("ignore_stripe_non_extension_checkout_receipt", {
    p_receipt_id: input.receipt.receipt_id,
    p_dispatch_id: input.receipt.dispatch_id,
    p_livemode: input.livemode,
    p_lease_token: leaseToken,
    p_claim_generation: claimGeneration,
  });
  if (finishResponse.error) throw new StripeNoopCheckoutError("checkout_receipt_finalize_failed");
  if (!Array.isArray(finishResponse.data) || finishResponse.data.length === 0) {
    return { status: "retryable", code: "checkout_receipt_not_finalized" };
  }

  const result = oneRow(finishResponse.data, "checkout_rpc_shape_invalid");
  if (
    requireString(result, "receipt_id") !== input.receipt.receipt_id ||
    requireString(result, "dispatch_id") !== input.receipt.dispatch_id ||
    typeof result.finalized !== "boolean"
  ) {
    throw new StripeNoopCheckoutError("checkout_rpc_shape_invalid");
  }
  if (result.finalized !== true) {
    return { status: "retryable", code: "checkout_receipt_not_finalized" };
  }
  if (result.receipt_status !== "ignored" || result.dispatch_status !== "completed") {
    throw new StripeNoopCheckoutError("checkout_terminal_state_invalid");
  }
  return { status: "ignored", outcome: "ignored" };
}
