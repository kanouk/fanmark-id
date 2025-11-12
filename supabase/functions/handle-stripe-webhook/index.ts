import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

const logStep = (step: string, details?: any) => {
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

    const body = await req.text();
    logStep("Verifying webhook signature");

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
      logStep("Webhook signature verified", { type: event.type });
    } catch (err) {
      logStep("Webhook signature verification failed", { error: err.message });
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Handle subscription events
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        logStep(`Processing ${event.type}`, { subscriptionId: subscription.id });

        // Get customer email to find user_id
        const customer = await stripe.customers.retrieve(subscription.customer as string);
        if (customer.deleted) {
          throw new Error("Customer has been deleted");
        }

        const customerEmail = customer.email;
        if (!customerEmail) {
          throw new Error("Customer has no email");
        }

        // Find user by email
        const { data: userData, error: userError } = await supabaseClient.auth.admin.listUsers();
        if (userError) throw userError;

        const user = userData.users.find(u => u.email === customerEmail);
        if (!user) {
          logStep("User not found for email", { email: customerEmail });
          throw new Error("User not found");
        }

        const firstItem = subscription.items?.data?.[0];
        const priceId = typeof firstItem?.price?.id === "string" ? firstItem.price.id : null;
        const productId = typeof firstItem?.price?.product === "string" ? firstItem.price.product as string : null;

        if (!firstItem || !priceId || !productId) {
          throw new Error("Subscription items missing price/product information");
        }

        logStep("Price & product extracted", { priceId, productId });

        const requiredKeys = ["creator_stripe_price_id", "business_stripe_price_id"];
        const { data: settingsData, error: priceSettingsError } = await supabaseClient
          .from("system_settings")
          .select("setting_key, setting_value")
          .in("setting_key", requiredKeys);

        if (priceSettingsError) {
          throw priceSettingsError;
        }

        const settingsEntries = (settingsData ?? []).map((row) => [row.setting_key, row.setting_value] as const);
        const settingsMap = new Map(settingsEntries);
        const creatorPriceId = settingsMap.get("creator_stripe_price_id");
        const businessPriceId = settingsMap.get("business_stripe_price_id");

        if (!creatorPriceId || !businessPriceId) {
          throw new Error("Stripe Price IDs are not configured in system_settings");
        }

        let planType: "free" | "creator" | "business" = "free";
        if (priceId === creatorPriceId) {
          planType = "creator";
        } else if (priceId === businessPriceId) {
          planType = "business";
        } else {
          throw new Error(`Received Stripe price_id (${priceId}) that does not match configured plans`);
        }

        logStep("Plan type mapping", { priceId, planType });

        const toIsoString = (unixSeconds?: number | null) => {
          if (typeof unixSeconds !== "number" || Number.isNaN(unixSeconds)) {
            return null;
          }
          try {
            return new Date(unixSeconds * 1000).toISOString();
          } catch (dateError) {
            console.warn("[STRIPE-WEBHOOK] Unable to convert timestamp", {
              unixSeconds,
              error: dateError instanceof Error ? dateError.message : dateError,
            });
            return null;
          }
        };

        const periodStartIso = toIsoString(subscription.current_period_start);
        const periodEndIso = toIsoString(subscription.current_period_end);
        const unitAmount = firstItem.price?.unit_amount ?? null;
        const currency = firstItem.price?.currency ?? null;
        const interval = firstItem.price?.recurring?.interval ?? null;
        const intervalCount = firstItem.price?.recurring?.interval_count ?? null;

        // Upsert subscription data
        logStep("Attempting upsert", { 
          user_id: user.id,
          price_id: priceId,
          product_id: productId,
          status: subscription.status 
        });

        const { error: upsertError } = await supabaseClient
          .from("user_subscriptions")
          .upsert({
            user_id: user.id,
            stripe_customer_id: subscription.customer as string,
            stripe_subscription_id: subscription.id,
            product_id: productId,
            price_id: priceId,
            status: subscription.status,
            current_period_start: periodStartIso,
            current_period_end: periodEndIso,
            cancel_at_period_end: subscription.cancel_at_period_end,
            amount: unitAmount,
            currency,
            interval,
            interval_count: intervalCount,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: "user_id,stripe_subscription_id"
          });

        if (upsertError) {
          logStep("Database upsert failed", { error: upsertError });
          throw upsertError;
        }

        // Update user's plan_type in user_settings table
        const { error: profileError } = await supabaseClient
          .from("user_settings")
          .update({ plan_type: planType })
          .eq("user_id", user.id);

        if (profileError) {
          logStep("Profile update failed", { error: profileError });
          throw profileError;
        }

        logStep("Subscription and profile updated in database", { userId: user.id, status: subscription.status, planType });
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        logStep("Processing subscription deletion", { subscriptionId: subscription.id });

        // Get user_id before deleting
        const { data: subData } = await supabaseClient
          .from("user_subscriptions")
          .select("user_id")
          .eq("stripe_subscription_id", subscription.id)
          .single();

        const { error: deleteError } = await supabaseClient
          .from("user_subscriptions")
          .delete()
          .eq("stripe_subscription_id", subscription.id);

        if (deleteError) {
          logStep("Database delete failed", { error: deleteError });
          throw deleteError;
        }

        // Update user's plan_type to 'free' when subscription is deleted
        if (subData?.user_id) {
          const { error: profileError } = await supabaseClient
            .from("user_settings")
            .update({ plan_type: 'free' })
            .eq("user_id", subData.user_id);

          if (profileError) {
            logStep("Profile update failed", { error: profileError });
            throw profileError;
          }

          logStep("Profile updated to free plan", { userId: subData.user_id });
        }

        logStep("Subscription deleted from database");
        break;
      }

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
