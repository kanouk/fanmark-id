import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  ReceiptIngressError,
  buildReceiptPersistenceInput,
  createSupabaseReceiptPersister,
  readStripeWebhookBody,
  type DurableReceiptResult,
} from "../_shared/stripe-receipt-ingress/index.ts";
import {
  createStripeInvoiceProjectionProvider,
  processAcceptedStripeInvoiceReceipt,
} from "../_shared/stripe-invoice-projection/index.ts";
import {
  createStripeSubscriptionApplicationProvider,
  processAcceptedStripeSubscriptionReceipt,
} from "../_shared/stripe-subscription-application/index.ts";
import {
  resolveStripeCustomerUserMapping,
  StripeCustomerUserMappingError,
  type StripeCustomerUserMappingRow,
} from "../_shared/stripe-customer-user-mapping.ts";
import type { StripePrivatePriceIdsByMode } from "../_shared/stripe-subscription-projection/index.ts";
import { processAcceptedStripeNoopCheckoutReceipt } from "../_shared/stripe-noop-checkout-receipt.ts";
import { validateStripeExtensionApplicationResult } from "../_shared/stripe-extension-application.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const withTimeout = async <T>(operation: PromiseLike<T>, timeoutMs = 5_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("database operation timed out")), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(operation), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const EXTENSION_CHECKOUT_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);

const INVOICE_EVENT_TYPES = new Set([
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.payment_succeeded",
]);

const SUBSCRIPTION_EVENT_TYPES = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

const SUBSCRIPTION_PRICE_KEYS = {
  creator: { test: "creator_stripe_price_id", live: "creator_stripe_price_id_live" },
  max: { test: "max_stripe_price_id", live: "max_stripe_price_id_live" },
  business: { test: "business_stripe_price_id", live: "business_stripe_price_id_live" },
} as const;

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[STRIPE-WEBHOOK] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Webhook received");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    
    if (!stripeKey || !webhookSecret) {
      throw new Error("Missing Stripe configuration");
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const signature = req.headers.get("stripe-signature");
    
    if (!signature) {
      throw new Error("Missing stripe-signature header");
    }

    let rawBody: Uint8Array;
    try {
      rawBody = await readStripeWebhookBody(req);
    } catch (bodyError) {
      if (bodyError instanceof ReceiptIngressError && bodyError.kind === "body_too_large") {
        return jsonResponse(413, { error: "Request body too large" });
      }
      if (bodyError instanceof ReceiptIngressError && bodyError.kind === "body_timeout") {
        return jsonResponse(408, { error: "Request body read timed out" });
      }
      return jsonResponse(400, { error: "Invalid request body" });
    }
    logStep("Verifying webhook signature");

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
      logStep("Webhook signature verified", { type: event.type });
    } catch (err) {
      logStep("Webhook signature verification failed", { error: (err as Error).message });
      return jsonResponse(400, { error: "Invalid signature" });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    if (SUBSCRIPTION_EVENT_TYPES.has(event.type)) {
      let durable: DurableReceiptResult;
      try {
        const input = await buildReceiptPersistenceInput(event, rawBody);
        durable = await withTimeout(createSupabaseReceiptPersister(supabaseClient)(input));
      } catch (receiptError) {
        const kind = receiptError instanceof ReceiptIngressError ? receiptError.kind : "persistence";
        logStep("Subscription receipt was not durably accepted", { kind });
        return jsonResponse(kind === "invalid_event" ? 400 : 503, {
          error: kind === "invalid_event" ? "Invalid event" : "Receipt persistence unavailable",
        });
      }

      if (durable.outcome === "duplicate_terminal") {
        return jsonResponse(200, {
          received: true,
          outcome: durable.outcome,
          receipt_status: durable.receipt_status,
          dispatch_status: durable.dispatch_status,
        });
      }

      try {
        const subscriptionProvider = createStripeSubscriptionApplicationProvider(new Stripe(stripeKey, {
          apiVersion: "2025-08-27.basil",
          timeout: 10_000,
          maxNetworkRetries: 0,
        }));
        const result = await withTimeout(processAcceptedStripeSubscriptionReceipt({
          client: supabaseClient,
          receipt: durable,
          livemode: event.livemode,
          provider: subscriptionProvider,
          async loadPriceIds(): Promise<StripePrivatePriceIdsByMode> {
            const requiredKeys = Object.values(SUBSCRIPTION_PRICE_KEYS)
              .flatMap((byMode) => [byMode.test, byMode.live]);
            const { data, error } = await supabaseClient.from("system_settings")
              .select("setting_key, setting_value, is_public")
              .in("setting_key", requiredKeys);
            if (error || !Array.isArray(data)) {
              throw new Error("subscription_price_configuration_unavailable");
            }
            const readMode = (mode: "test" | "live") => {
              const result = {} as Record<keyof typeof SUBSCRIPTION_PRICE_KEYS, string>;
              const used = new Set<string>();
              for (const plan of Object.keys(SUBSCRIPTION_PRICE_KEYS) as Array<keyof typeof SUBSCRIPTION_PRICE_KEYS>) {
                const key = SUBSCRIPTION_PRICE_KEYS[plan][mode];
                const matches = data.filter((row) => row.setting_key === key);
                const priceId = matches[0]?.setting_value;
                if (matches.length !== 1 || matches[0].is_public !== false
                  || typeof priceId !== "string" || !priceId.startsWith("price_") || used.has(priceId)) {
                  throw new Error("subscription_price_configuration_review_required");
                }
                used.add(priceId);
                result[plan] = priceId;
              }
              return result;
            };
            const test = readMode("test");
            const live = readMode("live");
            if (new Set([...Object.values(test), ...Object.values(live)]).size !== 6) {
              throw new Error("subscription_price_configuration_conflict");
            }
            return { test, live };
          },
          async resolveUser(customerId, livemode) {
            let needsCustomerLink = false;
            const userId = await resolveStripeCustomerUserMapping({
              customerId,
              livemode,
              persistLink: false,
              provider: { retrieveCustomer: (id) => subscriptionProvider.retrieveCustomer(id) },
              repository: {
                async findByStripeCustomerId(id): Promise<StripeCustomerUserMappingRow[]> {
                  const { data, error } = await supabaseClient.from("user_settings")
                    .select("user_id, stripe_customer_id").eq("stripe_customer_id", id).limit(2);
                  if (error || !Array.isArray(data)) {
                    throw new StripeCustomerUserMappingError("stripe_customer_mapping_read_failed");
                  }
                  return data.map((row) => ({
                    userId: row.user_id,
                    stripeCustomerId: row.stripe_customer_id,
                  }));
                },
                async findByUserId(id): Promise<StripeCustomerUserMappingRow[]> {
                  const { data, error } = await supabaseClient.from("user_settings")
                    .select("user_id, stripe_customer_id").eq("user_id", id).limit(2);
                  if (error || !Array.isArray(data)) {
                    throw new StripeCustomerUserMappingError("stripe_customer_mapping_read_failed");
                  }
                  const rows = data.map((row) => ({
                    userId: row.user_id,
                    stripeCustomerId: row.stripe_customer_id,
                  }));
                  needsCustomerLink = rows.length === 1 && rows[0].stripeCustomerId === null;
                  return rows;
                },
                linkIfUnbound() {
                  return Promise.resolve(false);
                },
              },
            });
            return { userId, needsCustomerLink };
          },
        }), 20_000);
        if (result.status !== "applied") {
          logStep("Subscription receipt remains retryable", { code: result.code });
          return jsonResponse(503, { error: "Subscription processing pending" });
        }
        return jsonResponse(200, {
          received: true,
          outcome: result.outcome,
          effective_plan_type: result.effectivePlanType,
          active_subscription_count: result.activeSubscriptionCount,
          receipt_status: "applied",
          dispatch_status: "completed",
        });
      } catch {
        logStep("Subscription receipt could not be completed");
        return jsonResponse(503, { error: "Subscription processing pending" });
      }
    }

    if (INVOICE_EVENT_TYPES.has(event.type)) {
      let durable: DurableReceiptResult;
      try {
        const input = await buildReceiptPersistenceInput(event, rawBody);
        durable = await withTimeout(createSupabaseReceiptPersister(supabaseClient)(input));
      } catch (receiptError) {
        const kind = receiptError instanceof ReceiptIngressError ? receiptError.kind : "persistence";
        logStep("Invoice receipt was not durably accepted", { kind });
        return jsonResponse(kind === "invalid_event" ? 400 : 503, {
          error: kind === "invalid_event" ? "Invalid event" : "Receipt persistence unavailable",
        });
      }

      if (durable.outcome === "duplicate_terminal") {
        return jsonResponse(200, {
          received: true,
          outcome: durable.outcome,
          receipt_status: durable.receipt_status,
          dispatch_status: durable.dispatch_status,
        });
      }

      try {
        const projection = await processAcceptedStripeInvoiceReceipt({
          client: supabaseClient,
          receipt: durable,
          livemode: event.livemode,
          provider: createStripeInvoiceProjectionProvider(new Stripe(stripeKey, {
            apiVersion: "2025-08-27.basil",
            timeout: 10_000,
            maxNetworkRetries: 0,
          })),
        });
        if (projection.status !== "applied") {
          logStep("Invoice projection remains retryable", { code: projection.code });
          return jsonResponse(503, { error: "Invoice processing pending" });
        }
        return jsonResponse(200, {
          received: true,
          outcome: projection.outcome,
          receipt_status: "applied",
          dispatch_status: "completed",
        });
      } catch {
        logStep("Invoice projection could not be completed");
        return jsonResponse(503, { error: "Invoice processing pending" });
      }
    }

    if (EXTENSION_CHECKOUT_EVENT_TYPES.has(event.type)) {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.type === "license_extension") {
        let durable: DurableReceiptResult;
        try {
          const input = await buildReceiptPersistenceInput(event, rawBody);
          durable = await withTimeout(createSupabaseReceiptPersister(supabaseClient)(input));
        } catch (receiptError) {
          const kind = receiptError instanceof ReceiptIngressError ? receiptError.kind : "persistence";
          logStep("License extension receipt was not durably accepted", { kind });
          return jsonResponse(kind === "invalid_event" ? 400 : 503, {
            error: kind === "invalid_event" ? "Invalid event" : "Receipt persistence unavailable",
          });
        }

        if (durable.outcome === "duplicate_terminal") {
          return jsonResponse(200, {
            received: true,
            outcome: durable.outcome,
            receipt_status: durable.receipt_status,
            dispatch_status: durable.dispatch_status,
          });
        }

        let applicationResponse: { data: unknown; error: unknown };
        try {
          applicationResponse = await withTimeout(supabaseClient.rpc(
            "apply_stripe_extension_receipt",
            { p_receipt_id: durable.receipt_id },
          ));
        } catch {
          logStep("License extension application transaction failed");
          return jsonResponse(503, { error: "License extension application unavailable" });
        }
        const { data, error } = applicationResponse;
        if (error) {
          logStep("License extension application transaction failed");
          return jsonResponse(503, { error: "License extension application unavailable" });
        }

        let applied;
        try {
          applied = validateStripeExtensionApplicationResult(durable.receipt_id, data);
        } catch {
          logStep("License extension application returned an invalid result");
          return jsonResponse(503, { error: "License extension application unavailable" });
        }

        logStep("License extension receipt reached a terminal state", {
          outcome: applied.outcome,
          receiptStatus: applied.receipt_status,
          dispatchStatus: applied.dispatch_status,
        });
        return jsonResponse(200, {
          received: true,
          outcome: applied.outcome,
          receipt_status: applied.receipt_status,
          dispatch_status: applied.dispatch_status,
        });
      }

      let durable: DurableReceiptResult;
      try {
        const input = await buildReceiptPersistenceInput(event, rawBody);
        durable = await withTimeout(createSupabaseReceiptPersister(supabaseClient)(input));
      } catch (receiptError) {
        const kind = receiptError instanceof ReceiptIngressError ? receiptError.kind : "persistence";
        logStep("Non-extension Checkout receipt was not durably accepted", { kind });
        return jsonResponse(kind === "invalid_event" ? 400 : 503, {
          error: kind === "invalid_event" ? "Invalid event" : "Receipt persistence unavailable",
        });
      }

      try {
        const result = await withTimeout(processAcceptedStripeNoopCheckoutReceipt({
          client: supabaseClient,
          receipt: durable,
          livemode: event.livemode,
        }));
        if (result.status === "retryable") {
          logStep("Non-extension Checkout receipt remains retryable", { code: result.code });
          return jsonResponse(503, { error: "Checkout receipt processing pending" });
        }
        const receiptStatus = result.status === "ignored" ? "ignored" : result.receipt_status;
        const dispatchStatus = result.status === "ignored" ? "completed" : result.dispatch_status;
        return jsonResponse(200, {
          received: true,
          outcome: result.outcome,
          receipt_status: receiptStatus,
          dispatch_status: dispatchStatus,
        });
      } catch {
        logStep("Non-extension Checkout receipt could not be finalized");
        return jsonResponse(503, { error: "Checkout receipt processing pending" });
      }
    }

    // Events handled above are receipt-backed transactions; everything else
    // currently has no billing side effect in this webhook.
    switch (event.type) {
      default:
        logStep("Unhandled event type", { type: event.type });
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in webhook handler", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
