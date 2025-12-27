import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CHANGE-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id, email: user.email });

    const { current_plan_type, new_plan_type } = await req.json();
    if (!current_plan_type || !new_plan_type) {
      throw new Error("Missing required parameters: current_plan_type and new_plan_type");
    }
    logStep("Request received", { current_plan_type, new_plan_type });

    // Get Stripe price IDs from system settings
    const { data: settingsData, error: settingsError } = await supabaseClient
      .from('system_settings')
      .select('setting_key, setting_value')
      .in('setting_key', ['creator_stripe_price_id', 'max_stripe_price_id', 'business_stripe_price_id']);

    if (settingsError) throw settingsError;

    const priceIdMap: Record<string, string> = {};
    settingsData?.forEach(({ setting_key, setting_value }) => {
      if (setting_key === 'creator_stripe_price_id') {
        priceIdMap['creator'] = setting_value;
      } else if (setting_key === 'max_stripe_price_id') {
        priceIdMap['max'] = setting_value;
      } else if (setting_key === 'business_stripe_price_id') {
        priceIdMap['business'] = setting_value;
      }
    });

    logStep("Stripe price IDs loaded", priceIdMap);

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    let customerId: string | undefined;

    const { data: stripeSettingsRow, error: settingsLookupError } = await supabaseClient
      .from("user_settings")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (settingsLookupError) {
      logStep("WARNING: Failed to read stripe_customer_id", { error: settingsLookupError.message });
    }

    if (stripeSettingsRow?.stripe_customer_id) {
      customerId = stripeSettingsRow.stripe_customer_id;
      logStep("Using stored Stripe customer ID", { customerId });
    } else {
      const customers = await stripe.customers.list({ email: user.email, limit: 1 });
      if (customers.data.length === 0) {
        throw new Error("No Stripe customer found for this user");
      }
      customerId = customers.data[0].id;
      logStep("Found Stripe customer by email", { customerId });

      const { error: settingsUpdateError } = await supabaseClient
        .from("user_settings")
        .update({ stripe_customer_id: customerId })
        .eq("user_id", user.id);

      if (settingsUpdateError) {
        logStep("WARNING: Failed to store stripe_customer_id", { error: settingsUpdateError.message });
      }
    }

    // Resolve current plan using Stripe price IDs instead of trusting client input.
    const priceIdToPlanType = new Map<string, string>(
      Object.entries(priceIdMap).map(([planType, priceId]) => [priceId, planType])
    );

    const { data: planSettingsRow, error: settingsPlanError } = await supabaseClient
      .from("user_settings")
      .select("plan_type")
      .eq("user_id", user.id)
      .maybeSingle();

    if (settingsPlanError) {
      logStep("WARNING: Failed to read user_settings.plan_type", { error: settingsPlanError.message });
    }

    // Get current active subscription
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 10,
    });

    if (subscriptions.data.length === 0) {
      throw new Error("No active subscription found");
    }

    interface SubscriptionEntry {
      sub: Stripe.Subscription;
      priceId: string | null;
      planType: string | null;
    }

    const subscriptionsWithPlan: SubscriptionEntry[] = subscriptions.data.map((sub: Stripe.Subscription) => {
      const priceId = sub.items?.data?.[0]?.price?.id ?? null;
      const planType = priceId ? priceIdToPlanType.get(priceId) ?? null : null;
      return { sub, priceId, planType };
    });

    const requestedCurrentPlanType = priceIdMap[current_plan_type] ? current_plan_type : null;
    const storedPlanType = planSettingsRow?.plan_type ?? null;

    const matchingSubscription =
      (requestedCurrentPlanType
        ? subscriptionsWithPlan.find((entry: SubscriptionEntry) => entry.planType === requestedCurrentPlanType)
        : null) ??
      (storedPlanType
        ? subscriptionsWithPlan.find((entry: SubscriptionEntry) => entry.planType === storedPlanType)
        : null) ??
      (subscriptionsWithPlan.length === 1 ? subscriptionsWithPlan[0] : null);

    if (!matchingSubscription?.sub) {
      throw new Error("Unable to determine active subscription for plan change");
    }

    const currentSubscription = matchingSubscription.sub;
    const currentPlanType = matchingSubscription.planType ?? "free";

    logStep("Found active subscription", {
      subscriptionId: currentSubscription.id,
      derivedPlanType: currentPlanType,
    });

    // Determine if this is an upgrade or downgrade
    const planOrder: Record<string, number> = {
      free: 0,
      creator: 1,
      max: 2,
      business: 3,
      enterprise: 4,
    };

    const isUpgrade = planOrder[new_plan_type] > planOrder[currentPlanType];
    logStep("Plan change type", { isUpgrade });

    if (isUpgrade) {
      // UPGRADE: Update subscription price with proration
      const newPriceId = priceIdMap[new_plan_type];
      if (!newPriceId) {
        throw new Error(`No Stripe price ID configured for plan: ${new_plan_type}`);
      }

      const currentItem = currentSubscription.items?.data?.[0];
      if (!currentItem) {
        throw new Error("No subscription items found");
      }

      logStep("Starting upgrade - updating subscription", { newPriceId });

      const updatedSubscription = await stripe.subscriptions.update(currentSubscription.id, {
        cancel_at_period_end: false,
        items: [
          {
            id: currentItem.id,
            price: newPriceId,
          },
        ],
        proration_behavior: "create_prorations",
        billing_cycle_anchor: "now",
        payment_behavior: "default_incomplete",
        expand: ["latest_invoice.payment_intent"],
      });

      const paymentIntent = (updatedSubscription.latest_invoice as Stripe.Invoice | null)
        ?.payment_intent as Stripe.PaymentIntent | null;

      if (updatedSubscription.status !== "active" || paymentIntent?.status === "requires_action") {
        const origin = req.headers.get("origin") || "http://localhost:3000";
        const portalSession = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: `${origin}/plans`,
        });

        logStep("Upgrade requires action; redirecting to portal", {
          subscriptionId: currentSubscription.id,
          status: updatedSubscription.status,
          paymentIntentStatus: paymentIntent?.status,
        });

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "Subscription update requires action",
            pending: true,
            portal_url: portalSession.url
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      logStep("Subscription updated for upgrade", { subscriptionId: currentSubscription.id });

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Subscription updated for upgrade",
          updated: true
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // DOWNGRADE
    logStep("Starting downgrade");

    if (new_plan_type === 'free') {
      // Downgrade to free - cancel subscription and let webhook handle DB updates
      logStep("Downgrading to free - cancelling subscription");

      await stripe.subscriptions.cancel(currentSubscription.id);

      logStep("Stripe subscription cancelled - webhook will update user_settings and user_subscriptions");

      // NOTE: user_settings.plan_type update is handled by handle-stripe-webhook
      // when it receives the customer.subscription.deleted event from Stripe.
      // This ensures DB state is only updated after Stripe confirms the cancellation.

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Subscription cancellation initiated. Plan will update shortly.",
          pending: true
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const newPriceId = priceIdMap[new_plan_type];
    if (!newPriceId) {
      throw new Error(`No Stripe price ID configured for plan: ${new_plan_type}`);
    }

    const currentItem = currentSubscription.items?.data?.[0];
    if (!currentItem) {
      throw new Error("No subscription items found");
    }

    logStep("Downgrading to paid plan - updating subscription", { newPriceId });

    const updatedSubscription = await stripe.subscriptions.update(currentSubscription.id, {
      cancel_at_period_end: false,
      items: [
        {
          id: currentItem.id,
          price: newPriceId,
        },
      ],
      proration_behavior: "none",
      billing_cycle_anchor: "now",
      payment_behavior: "default_incomplete",
      expand: ["latest_invoice.payment_intent"],
    });

    const paymentIntent = (updatedSubscription.latest_invoice as Stripe.Invoice | null)
      ?.payment_intent as Stripe.PaymentIntent | null;

    if (updatedSubscription.status !== "active" || paymentIntent?.status === "requires_action") {
      const origin = req.headers.get("origin") || "http://localhost:3000";
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${origin}/plans`,
      });

      logStep("Downgrade requires action; redirecting to portal", {
        subscriptionId: currentSubscription.id,
        status: updatedSubscription.status,
        paymentIntentStatus: paymentIntent?.status,
      });

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Subscription update requires action",
          pending: true,
          portal_url: portalSession.url
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    logStep("Subscription updated for downgrade", { subscriptionId: currentSubscription.id });

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Subscription updated for downgrade",
        updated: true
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in change-subscription", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
