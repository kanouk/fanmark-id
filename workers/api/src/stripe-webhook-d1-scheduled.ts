import { applyStripeExtensionReceiptInD1, StripeWebhookD1ApplicationError } from "./stripe-webhook-d1-application.ts";
import Stripe from "stripe";
import {
  createStripeInvoiceProjectionProvider,
  PINNED_STRIPE_API_VERSION,
  type StripeInvoiceApiClient,
  type StripeInvoiceProjectionProvider,
} from "../../../supabase/functions/_shared/stripe-invoice-projection/index.ts";
import { applyStripeInvoiceReceiptInD1 } from "./stripe-invoice-projection-d1.ts";
import {
  claimStripeWebhookDispatchesFromD1,
  deadLetterStripeWebhookDispatchInD1,
  retryStripeWebhookDispatchInD1,
  type StripeWebhookD1Claim,
  type StripeWebhookD1LeaseIdentity,
} from "./stripe-webhook-d1-dispatch.ts";
import { selectD1Database, type Env } from "./repository.ts";

const EXTENSION_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);
const INVOICE_EVENTS = new Set([
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.payment_succeeded",
]);
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MAX_ATTEMPTS = 8;

export interface StripeWebhookD1ScheduledSummary {
  status: "disabled" | "completed";
  claimed: number;
  applied: number;
  ignored: number;
  deadLettered: number;
  retryable: number;
  leaseLost: number;
}

function configuredPositiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^[1-9][0-9]*$/u.test(value.trim())) throw new Error("stripe_dispatch_configuration_invalid");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw new Error("stripe_dispatch_configuration_invalid");
  return parsed;
}

function identity(claim: StripeWebhookD1Claim): StripeWebhookD1LeaseIdentity {
  return {
    receiptId: claim.receiptId,
    dispatchId: claim.dispatchId,
    livemode: claim.livemode,
    leaseToken: claim.leaseToken,
    claimGeneration: claim.claimGeneration,
  };
}

function retryDelaySeconds(attemptCount: number): number {
  return Math.min(3600, 30 * (2 ** Math.min(Math.max(0, attemptCount - 1), 7)));
}

export async function dispatchStripeWebhookBatchInD1(args: {
  database: D1Database;
  livemode: boolean;
  now: string;
  batchSize?: number;
  maxAttempts?: number;
  applyReceipt?: typeof applyStripeExtensionReceiptInD1;
  invoiceProvider?: StripeInvoiceProjectionProvider;
  getNow?: () => string;
}): Promise<Omit<StripeWebhookD1ScheduledSummary, "status">> {
  const batchSize = configuredPositiveInteger(args.batchSize?.toString(), DEFAULT_BATCH_SIZE, 100);
  const maxAttempts = configuredPositiveInteger(args.maxAttempts?.toString(), DEFAULT_MAX_ATTEMPTS, 100);
  const claims = await claimStripeWebhookDispatchesFromD1({
    database: args.database,
    livemode: args.livemode,
    batchSize,
    leaseSeconds: 300,
    now: args.now,
  });
  const summary = {
    claimed: claims.length,
    applied: 0,
    ignored: 0,
    deadLettered: 0,
    retryable: 0,
    leaseLost: 0,
  };
  const applyReceipt = args.applyReceipt ?? applyStripeExtensionReceiptInD1;
  for (const claim of claims) {
    const lease = identity(claim);
    if (!EXTENSION_EVENTS.has(claim.eventType) && !INVOICE_EVENTS.has(claim.eventType)) {
      const result = await deadLetterStripeWebhookDispatchInD1({
        database: args.database,
        identity: lease,
        now: args.now,
        errorCode: "stripe_event_handler_unavailable",
      });
      if (result) summary.deadLettered += 1;
      else summary.leaseLost += 1;
      continue;
    }
    try {
      if (INVOICE_EVENTS.has(claim.eventType)) {
        if (!args.invoiceProvider) throw new StripeWebhookD1ApplicationError("stripe_invoice_provider_unavailable");
        const result = await applyStripeInvoiceReceiptInD1({
          database: args.database,
          claim,
          now: args.now,
          getNow: args.getNow,
          provider: args.invoiceProvider,
        });
        if (result.status === "applied") summary.applied += 1;
        else if (result.status === "retryable") summary.retryable += 1;
        else summary.leaseLost += 1;
        continue;
      }
      const result = await applyReceipt({ database: args.database, identity: lease, now: args.now });
      if (result.receiptStatus === "applied") summary.applied += 1;
      else if (result.receiptStatus === "ignored") summary.ignored += 1;
      else if (result.receiptStatus === "dead_letter") summary.deadLettered += 1;
      else throw new Error("stripe_application_nonterminal_result");
    } catch (error) {
      const code = error instanceof StripeWebhookD1ApplicationError ? error.code : "stripe_application_failed";
      if (claim.attemptCount >= maxAttempts) {
        const result = await deadLetterStripeWebhookDispatchInD1({
          database: args.database,
          identity: lease,
          now: args.now,
          errorCode: code,
        });
        if (result) summary.deadLettered += 1;
        else summary.leaseLost += 1;
        continue;
      }
      const result = await retryStripeWebhookDispatchInD1({
        database: args.database,
        identity: lease,
        now: args.now,
        retryAfterSeconds: retryDelaySeconds(claim.attemptCount),
        errorCode: code,
      });
      if (result) summary.retryable += 1;
      else summary.leaseLost += 1;
    }
  }
  return summary;
}

export async function runScheduledStripeWebhookDispatches(args: {
  env: Env;
  scheduledTime: number;
}): Promise<StripeWebhookD1ScheduledSummary> {
  const backend = args.env.STRIPE_DISPATCH_BACKEND?.trim();
  if (!backend) {
    return { status: "disabled", claimed: 0, applied: 0, ignored: 0, deadLettered: 0, retryable: 0, leaseLost: 0 };
  }
  if (backend !== "d1" || args.env.STRIPE_WEBHOOK_BACKEND?.trim() !== "d1" ||
      !args.env.STRIPE_WEBHOOK_SECRET?.trim() || !args.env.STRIPE_SECRET_KEY?.trim()) {
    throw new Error("stripe_dispatch_configuration_invalid");
  }
  const database = selectD1Database(args.env, "business");
  if (!database || args.env.D1_TOPOLOGY?.trim() !== "split") {
    throw new Error("stripe_dispatch_d1_unavailable");
  }
  const batchSize = configuredPositiveInteger(args.env.STRIPE_DISPATCH_BATCH_SIZE, DEFAULT_BATCH_SIZE, 100);
  const maxAttempts = configuredPositiveInteger(args.env.STRIPE_DISPATCH_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 100);
  const now = new Date(args.scheduledTime).toISOString();
  const stripe = new Stripe(args.env.STRIPE_SECRET_KEY.trim(), {
    apiVersion: PINNED_STRIPE_API_VERSION,
    timeout: 10_000,
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(),
  });
  const invoiceProvider = createStripeInvoiceProjectionProvider(stripe as unknown as StripeInvoiceApiClient);
  const test = await dispatchStripeWebhookBatchInD1({
    database, livemode: false, now, batchSize, maxAttempts, invoiceProvider,
  });
  const live = await dispatchStripeWebhookBatchInD1({
    database, livemode: true, now, batchSize, maxAttempts, invoiceProvider,
  });
  return {
    status: "completed",
    claimed: test.claimed + live.claimed,
    applied: test.applied + live.applied,
    ignored: test.ignored + live.ignored,
    deadLettered: test.deadLettered + live.deadLettered,
    retryable: test.retryable + live.retryable,
    leaseLost: test.leaseLost + live.leaseLost,
  };
}
