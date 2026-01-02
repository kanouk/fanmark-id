import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { countActiveFanmarks, getUserFanmarkLimit } from "../_shared/plan-limits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-EXTENSION-CHECKOUT] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    
    if (!stripeKey) {
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
      throw new Error("No authorization header provided");
    }
    logStep("Authorization header found");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    const user = userData.user;
    if (!user?.id) throw new Error("User not authenticated");
    logStep("User authenticated", { userId: user.id });

    const body = await req.json();
    const { license_id, months } = body as { license_id?: string; months?: number };

    if (!license_id || typeof months !== "number") {
      throw new Error("Invalid request: license_id and months are required");
    }
    logStep("Request validated", { license_id, months });

    // Verify license ownership (must be active or grace status)
    const { data: licenseData, error: licenseError } = await supabaseClient
      .from("fanmark_licenses")
      .select("id, fanmark_id, status, license_end, fanmarks(tier_level)")
      .eq("id", license_id)
      .eq("user_id", user.id)
      .in("status", ["active", "grace"])
      .single();

    if (licenseError || !licenseData) {
      throw new Error("License not found or access denied");
    }

    const tierLevel = (licenseData.fanmarks as any)?.tier_level;
    if (!tierLevel) {
      throw new Error("Tier level not found for fanmark");
    }
    logStep("License verified", { license_id: licenseData.id, tier_level: tierLevel });

    if (licenseData.status === "grace") {
      const { limit, isUnlimited } = await getUserFanmarkLimit(supabaseClient, user.id);
      if (!isUnlimited) {
        const currentCount = await countActiveFanmarks(supabaseClient, user.id);
        if (currentCount >= limit) {
          return new Response(JSON.stringify({
            error: "fanmark_limit_exceeded",
            current: currentCount,
            limit,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          });
        }
      }
    }

    // Determine if using live or test mode based on Stripe key
    const isLiveMode = stripeKey.startsWith('sk_live_');
    logStep("Stripe mode detected", { isLiveMode });

    // Get price ID from database (select appropriate column based on mode)
    const { data: priceData, error: priceError } = await supabaseClient
      .from("fanmark_tier_extension_prices")
      .select("id, tier_level, months, price_yen, stripe_price_id, stripe_price_id_live, is_active")
      .eq("tier_level", tierLevel)
      .eq("months", months)
      .eq("is_active", true)
      .maybeSingle();

    logStep("Price query result", { priceError: priceError?.message, priceData });

    if (priceError || !priceData) {
      throw new Error(`Extension plan not found for ${months} months (tier_level=${tierLevel})`);
    }

    // Select price ID based on environment
    const priceId = isLiveMode ? priceData.stripe_price_id_live : priceData.stripe_price_id;
    if (!priceId) {
      throw new Error(`Price ID not configured for ${isLiveMode ? 'live' : 'test'} mode`);
    }
    logStep("Price ID retrieved", { priceId, months, price_yen: priceData.price_yen, mode: isLiveMode ? 'live' : 'test' });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const origin = req.headers.get("origin") || "http://localhost:3000";

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${origin}/dashboard?extension=success`,
      cancel_url: `${origin}/dashboard?extension=canceled`,
      metadata: {
        type: "license_extension",
        fanmark_id: licenseData.fanmark_id,
        license_id: licenseData.id,
        user_id: user.id,
        tier_level: String(tierLevel),
        months: String(months),
      },
    });

    logStep("Checkout session created", { session_id: session.id, url: session.url });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in create-extension-checkout", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
