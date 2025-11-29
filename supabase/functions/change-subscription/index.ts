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
      .in('setting_key', ['creator_stripe_price_id', 'business_stripe_price_id']);

    if (settingsError) throw settingsError;

    const priceIdMap: Record<string, string> = {};
    settingsData?.forEach(({ setting_key, setting_value }) => {
      if (setting_key === 'creator_stripe_price_id') {
        priceIdMap['creator'] = setting_value;
      } else if (setting_key === 'business_stripe_price_id') {
        priceIdMap['business'] = setting_value;
      }
    });

    logStep("Stripe price IDs loaded", priceIdMap);

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Find Stripe customer
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (customers.data.length === 0) {
      throw new Error("No Stripe customer found for this user");
    }
    const customerId = customers.data[0].id;
    logStep("Found Stripe customer", { customerId });

    // Get current active subscription
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      throw new Error("No active subscription found");
    }

    const currentSubscription = subscriptions.data[0];
    logStep("Found active subscription", { subscriptionId: currentSubscription.id });

    // Determine if this is an upgrade or downgrade
    const planOrder: Record<string, number> = {
      free: 0,
      creator: 1,
      business: 2,
      enterprise: 3,
    };

    const isUpgrade = planOrder[new_plan_type] > planOrder[current_plan_type];
    logStep("Plan change type", { isUpgrade });

    if (isUpgrade) {
      // UPGRADE: Use subscriptions.update with proration
      const newPriceId = priceIdMap[new_plan_type];
      if (!newPriceId) {
        throw new Error(`No Stripe price ID configured for plan: ${new_plan_type}`);
      }

      logStep("Starting upgrade with proration", { newPriceId });

      const updatedSubscription = await stripe.subscriptions.update(
        currentSubscription.id,
        {
          items: [
            {
              id: currentSubscription.items.data[0].id,
              price: newPriceId,
            },
          ],
          proration_behavior: "always_invoice",
        }
      );

      logStep("Upgrade completed", { subscriptionId: updatedSubscription.id });

      // Update user_settings with new plan type
      const { error: updateError } = await supabaseClient
        .from('user_settings')
        .update({ plan_type: new_plan_type })
        .eq('user_id', user.id);

      if (updateError) {
        logStep("Warning: Failed to update user_settings", { error: updateError.message });
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Upgrade completed successfully",
          subscription_id: updatedSubscription.id 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else {
      // DOWNGRADE: Update subscription at period end to avoid payment issues
      logStep("Starting downgrade");

      if (new_plan_type === 'free') {
        // Downgrade to free - cancel at period end
        logStep("Downgrading to free - will cancel at period end");

        await stripe.subscriptions.update(currentSubscription.id, {
          cancel_at_period_end: true,
        });

        logStep("Subscription set to cancel at period end");

        // Update user_settings - actual plan change will happen via webhook
        const { error: updateError } = await supabaseClient
          .from('user_settings')
          .update({ plan_type: 'free' })
          .eq('user_id', user.id);

        if (updateError) {
          logStep("Warning: Failed to update user_settings", { error: updateError.message });
        }

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "Will downgrade to free plan at period end"
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      // Downgrade to a different paid plan - update subscription at period end
      const newPriceId = priceIdMap[new_plan_type];
      if (!newPriceId) {
        throw new Error(`No Stripe price ID configured for plan: ${new_plan_type}`);
      }

      logStep("Downgrading to paid plan - will change at period end", { newPriceId });

      const updatedSubscription = await stripe.subscriptions.update(
        currentSubscription.id,
        {
          items: [
            {
              id: currentSubscription.items.data[0].id,
              price: newPriceId,
            },
          ],
          proration_behavior: "none",
        }
      );

      logStep("Downgrade scheduled for period end", { subscriptionId: updatedSubscription.id });

      // Update user_settings with new plan type
      const { error: updateError } = await supabaseClient
        .from('user_settings')
        .update({ plan_type: new_plan_type })
        .eq('user_id', user.id);

      if (updateError) {
        logStep("Warning: Failed to update user_settings", { error: updateError.message });
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Downgrade scheduled for period end",
          subscription_id: updatedSubscription.id 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in change-subscription", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
