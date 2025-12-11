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

const roundUpToNextUtcMidnight = (input: Date) => {
  const copy = new Date(input);
  const isMidnight =
    copy.getUTCHours() === 0 &&
    copy.getUTCMinutes() === 0 &&
    copy.getUTCSeconds() === 0 &&
    copy.getUTCMilliseconds() === 0;

  if (isMidnight) return copy;

  copy.setUTCHours(0, 0, 0, 0);
  copy.setUTCDate(copy.getUTCDate() + 1);
  return copy;
};

const addMonths = (base: Date, months: number) => {
  const result = new Date(base.getTime());
  const originalDate = result.getDate();
  result.setMonth(result.getMonth() + months);
  if (result.getDate() !== originalDate) {
    result.setDate(0);
  }
  return result;
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
      logStep("Webhook signature verification failed", { error: (err as Error).message });
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

    // Handle subscription and checkout events
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        logStep("Processing checkout.session.completed", { sessionId: session.id });

        // Check if this is a license extension payment
        if (session.metadata?.type === "license_extension") {
          const { fanmark_id, license_id, user_id, months } = session.metadata;
          
          if (!fanmark_id || !license_id || !user_id || !months) {
            throw new Error("Missing metadata for license extension");
          }

          logStep("Processing license extension", { fanmark_id, license_id, months });

          // Get current license
          const { data: currentLicense, error: licenseError } = await supabaseClient
            .from("fanmark_licenses")
            .select("license_end, status, fanmark_id, grace_expires_at, is_returned, excluded_at, excluded_from_plan")
            .eq("id", license_id)
            .eq("user_id", user_id)
            .single();

          if (licenseError || !currentLicense) {
            throw new Error("License not found or access denied");
          }

          // Calculate new license_end (month-safe and round to next UTC midnight)
          const now = new Date();
          const monthsToAdd = parseInt(months, 10);
          if (!Number.isFinite(monthsToAdd) || monthsToAdd <= 0) {
            throw new Error(`Invalid months value in metadata: ${months}`);
          }
          const currentEnd = currentLicense.license_end ? new Date(currentLicense.license_end) : null;
          const baseDate = currentEnd && !Number.isNaN(currentEnd.getTime()) && currentEnd > now ? currentEnd : now;
          const extended = addMonths(baseDate, monthsToAdd);
          const roundedEnd = roundUpToNextUtcMidnight(extended);

          // Update license (reset is_returned and grace_expires_at in case extending from grace status)
          const { error: updateError } = await supabaseClient
            .from("fanmark_licenses")
            .update({
              status: "active",
              license_end: roundedEnd.toISOString(),
              grace_expires_at: null,
              is_returned: false,
              excluded_at: null,
              excluded_from_plan: null,
              updated_at: now.toISOString(),
              is_returned: false,
              grace_expires_at: null,
              excluded_at: null,
            })
            .eq("id", license_id);

          if (updateError) {
            throw updateError;
          }

          logStep("License extended successfully", { 
            license_id, 
            old_end: currentLicense.license_end,
            new_end: roundedEnd.toISOString(),
            grace_cleared: true,
            is_returned_before: currentLicense.is_returned,
            grace_expires_at_before: currentLicense.grace_expires_at,
          });

          // Cancel any pending lottery entries for this fanmark
          const { data: lotteryEntries } = await supabaseClient
            .from("fanmark_lottery_entries")
            .select("id, user_id")
            .eq("fanmark_id", fanmark_id)
            .eq("entry_status", "pending");

          if (lotteryEntries && lotteryEntries.length > 0) {
            const { error: cancelError } = await supabaseClient
              .from("fanmark_lottery_entries")
              .update({
                entry_status: "cancelled",
                cancellation_reason: "license_extended",
                cancelled_at: now.toISOString(),
                updated_at: now.toISOString(),
              })
              .eq("fanmark_id", fanmark_id)
              .eq("entry_status", "pending");

            if (cancelError) {
              logStep("Failed to cancel lottery entries", { error: cancelError });
            } else {
              logStep("Cancelled pending lottery entries", { count: lotteryEntries.length });
            }
          }

          // Create audit log
          await supabaseClient.from("audit_logs").insert({
            user_id,
            action: "LICENSE_EXTENDED",
            resource_type: "fanmark_license",
            resource_id: license_id,
            metadata: {
              fanmark_id,
              months: monthsToAdd,
              payment_session_id: session.id,
              new_license_end: roundedEnd.toISOString(),
              grace_cleared: true,
            },
          });
        }
        break;
      }

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
