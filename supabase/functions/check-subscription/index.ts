import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CHECK-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      logStep("ERROR: STRIPE_SECRET_KEY is not set");
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    logStep("Stripe key verified");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      logStep("ERROR: No authorization header");
      throw new Error("No authorization header provided");
    }
    logStep("Authorization header found");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError) {
      logStep("ERROR: Authentication failed", { error: userError.message });
      throw new Error(`Authentication error: ${userError.message}`);
    }
    
    const user = userData.user;
    if (!user?.email) {
      logStep("ERROR: User not authenticated or email not available");
      throw new Error("User not authenticated or email not available");
    }
    logStep("User authenticated", { userId: user.id, email: user.email });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    
    let customerId: string | undefined;

    const { data: settingsRow, error: settingsLookupError } = await supabaseClient
      .from("user_settings")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (settingsLookupError) {
      logStep("WARNING: Failed to read stripe_customer_id", { error: settingsLookupError.message });
    }

    if (settingsRow?.stripe_customer_id) {
      customerId = settingsRow.stripe_customer_id;
      logStep("Using stored Stripe customer ID", { customerId });
    } else {
      const customers = await stripe.customers.list({ email: user.email, limit: 1 });
      
      if (customers.data.length === 0) {
        logStep("No customer found, updating unsubscribed state");
        return new Response(JSON.stringify({ 
          subscribed: false,
          product_id: null,
          subscription_end: null
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
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

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });
    
    const hasActiveSub = subscriptions.data.length > 0;
    let productId = null;
    let subscriptionEnd = null;

    if (hasActiveSub) {
      const subscription = subscriptions.data[0];
      const item = subscription.items.data[0];
      
      // Get period dates from subscription or fallback to item
      const periodEnd = subscription.current_period_end ?? (item as any)?.current_period_end;
      const periodStart = subscription.current_period_start ?? (item as any)?.current_period_start;
      
      logStep("Period data sources", { 
        subscriptionPeriodEnd: subscription.current_period_end,
        itemPeriodEnd: (item as any)?.current_period_end,
        resolvedPeriodEnd: periodEnd,
        resolvedPeriodStart: periodStart
      });
      
      if (periodEnd) {
        subscriptionEnd = new Date(periodEnd * 1000).toISOString();
      }
      const subscriptionStart = periodStart 
        ? new Date(periodStart * 1000).toISOString() 
        : null;
      
      logStep("Active subscription found", { subscriptionId: subscription.id, endDate: subscriptionEnd, startDate: subscriptionStart });
      
      productId = item.price.product as string;
      logStep("Determined product ID", { productId });

      // Sync subscription data to database for reliability
      try {
        // Check if record exists
        const { data: existingRecord, error: selectError } = await supabaseClient
          .from('user_subscriptions')
          .select('id')
          .eq('user_id', user.id)
          .eq('stripe_subscription_id', subscription.id)
          .maybeSingle();

        if (selectError) {
          logStep("ERROR: Failed to check existing record", { error: selectError.message });
        }

        const subscriptionData: Record<string, any> = {
          product_id: productId,
          price_id: item.price.id,
          status: subscription.status,
          current_period_end: subscriptionEnd,
          cancel_at_period_end: subscription.cancel_at_period_end || false,
          amount: item.price.unit_amount || null,
          currency: item.price.currency || null,
          interval: item.price.recurring?.interval || null,
          interval_count: item.price.recurring?.interval_count || null,
          updated_at: new Date().toISOString(),
        };
        
        // Only set current_period_start if we have a valid value
        if (subscriptionStart) {
          subscriptionData.current_period_start = subscriptionStart;
        }

        if (existingRecord) {
          // Update existing record
          logStep("Updating existing subscription record", { recordId: existingRecord.id });
          const { error: updateError } = await supabaseClient
            .from('user_subscriptions')
            .update(subscriptionData)
            .eq('id', existingRecord.id);

          if (updateError) {
            logStep("ERROR: Failed to update subscription", { error: updateError.message });
          } else {
            logStep("Successfully updated subscription in database");
          }
        } else {
          // Insert new record
          logStep("Inserting new subscription record");
          const { error: insertError } = await supabaseClient
            .from('user_subscriptions')
            .insert({
              user_id: user.id,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscription.id,
              ...subscriptionData
            });

          if (insertError) {
            logStep("ERROR: Failed to insert subscription", { error: insertError.message });
          } else {
            logStep("Successfully inserted subscription in database");
          }
        }
      } catch (syncError) {
        logStep("ERROR: Exception during database sync", { 
          error: syncError instanceof Error ? syncError.message : String(syncError) 
        });
      }
    } else {
      logStep("No active subscription found");
    }

    return new Response(JSON.stringify({
      subscribed: hasActiveSub,
      product_id: productId,
      subscription_end: subscriptionEnd
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in check-subscription", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
