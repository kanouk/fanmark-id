import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { countActiveFanmarks, getUserFanmarkLimit } from "../_shared/plan-limits.ts";
import { fetchCloudflareExtensionPrice } from "../_shared/cloudflare-reference-master.ts";
import { buildPaidExtensionPriceMetadata } from "../_shared/stripe-receipt-ingress/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ExtensionCheckoutIntentRow = {
  intent_id?: string;
  stripe_checkout_session_id?: string | null;
  intent_status?: string;
  can_create_session?: boolean;
  intent_price_id?: string;
  intent_expected_total_yen?: number | string;
};

function readIntentRow(rows: unknown): ExtensionCheckoutIntentRow | undefined {
  return Array.isArray(rows) ? rows[0] as ExtensionCheckoutIntentRow | undefined : undefined;
}

const logStep = (step: string, details?: unknown) => {
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
    logStep("User authenticated");

    const body = await req.json();
    const { license_id, months, request_id } = body as {
      license_id?: string;
      months?: number;
      request_id?: string;
    };

    if (!license_id || typeof months !== "number" || !Number.isInteger(months) || months < 1 || months > 12) {
      throw new Error("Invalid request: license_id and a supported months value are required");
    }
    if (typeof request_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(request_id)) {
      throw new Error("Invalid request: request_id must be a UUID");
    }
    logStep("Request validated");

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

    const fanmarkTier = licenseData.fanmarks as unknown as
      | { tier_level?: number | null }
      | { tier_level?: number | null }[]
      | null;
    const tierLevel = Array.isArray(fanmarkTier)
      ? fanmarkTier[0]?.tier_level
      : fanmarkTier?.tier_level;
    if (!tierLevel) {
      throw new Error("Tier level not found for fanmark");
    }
    logStep("License verified", { tier_level: tierLevel });

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

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const origin = req.headers.get("origin") || "http://localhost:3000";

    const intentArgs = {
      p_request_id: request_id,
      p_user_id: user.id,
      p_license_id: licenseData.id,
      p_months: months,
      p_tier_level: tierLevel,
      p_livemode: isLiveMode,
    };
    const { data: existingIntentRows, error: existingIntentError } = await supabaseClient.rpc(
      "begin_stripe_extension_checkout_intent",
      {
        ...intentArgs,
        p_stripe_price_id: null,
        p_expected_total_yen: null,
      },
    );
    if (existingIntentError) throw new Error("Could not read extension checkout intent");
    let intent = readIntentRow(existingIntentRows);

    const respondWithExistingSession = async (sessionId: string): Promise<Response> => {
      const existingSession = await stripe.checkout.sessions.retrieve(sessionId);
      if (existingSession.status === "open" && existingSession.url) {
        return new Response(JSON.stringify({ url: existingSession.url }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }
      return new Response(JSON.stringify({ error: "checkout_session_not_open" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 409,
      });
    };

    if (intent?.stripe_checkout_session_id) {
      return await respondWithExistingSession(intent.stripe_checkout_session_id);
    }
    if (intent && !intent.can_create_session) {
      return new Response(JSON.stringify({ error: "checkout_intent_reconciliation_required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 409,
      });
    }

    let checkoutPriceId: string;
    let checkoutPriceYen: number;
    if (intent) {
      checkoutPriceId = intent.intent_price_id ?? "";
      checkoutPriceYen = Number(intent.intent_expected_total_yen);
    } else {
      const configuredPricingBackend = Deno.env.get("REFERENCE_MASTER_PRICING_BACKEND")?.trim() || "supabase";
      let configuredPriceId: string | null = null;
      let configuredPriceYen: number | null = null;
      let configuredPriceIsActive = false;

      if (configuredPricingBackend === "cloudflare") {
        const price = await fetchCloudflareExtensionPrice({
          apiBaseUrl: Deno.env.get("CLOUDFLARE_API_URL") ?? "",
          secret: Deno.env.get("REFERENCE_MASTER_SERVICE_SECRET") ?? "",
          tierLevel,
          months,
          mode: isLiveMode ? "live" : "test",
        });
        configuredPriceId = price.stripePriceId;
        configuredPriceYen = price.priceYen;
        configuredPriceIsActive = price.isActive;
      } else if (configuredPricingBackend === "supabase") {
        const { data: priceData, error: priceError } = await supabaseClient
          .from("fanmark_tier_extension_prices")
          .select("tier_level, months, price_yen, stripe_price_id, stripe_price_id_live, is_active")
          .eq("tier_level", tierLevel)
          .eq("months", months)
          .maybeSingle();
        if (priceError) throw new Error("Extension pricing is unavailable");
        if (priceData) {
          configuredPriceId = isLiveMode ? priceData.stripe_price_id_live : priceData.stripe_price_id;
          configuredPriceYen = priceData.price_yen;
          configuredPriceIsActive = priceData.is_active;
        }
        logStep("Price query completed", { found: Boolean(priceData) });
      } else {
        throw new Error("REFERENCE_MASTER_PRICING_BACKEND is invalid");
      }

      if (configuredPriceYen === null) {
        throw new Error(`Extension plan not found for ${months} months (tier_level=${tierLevel})`);
      }
      if (!configuredPriceIsActive) throw new Error("Extension plan is not active");
      if (!configuredPriceId) {
        throw new Error(`Price ID not configured for ${isLiveMode ? 'live' : 'test'} mode`);
      }

      const { data: intentRows, error: intentError } = await supabaseClient.rpc(
        "begin_stripe_extension_checkout_intent",
        {
          ...intentArgs,
          p_stripe_price_id: configuredPriceId,
          p_expected_total_yen: configuredPriceYen,
        },
      );
      if (intentError) throw new Error("Could not record extension checkout intent");
      intent = readIntentRow(intentRows);
      if (!intent?.intent_id) throw new Error("Extension checkout intent response is invalid");
      if (intent.stripe_checkout_session_id) {
        return await respondWithExistingSession(intent.stripe_checkout_session_id);
      }
      if (!intent.can_create_session) {
        return new Response(JSON.stringify({ error: "checkout_intent_reconciliation_required" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 409,
        });
      }
      checkoutPriceId = intent.intent_price_id ?? "";
      checkoutPriceYen = Number(intent.intent_expected_total_yen);
    }

    if (!intent?.intent_id || !checkoutPriceId || !Number.isSafeInteger(checkoutPriceYen) || checkoutPriceYen <= 0) {
      throw new Error("Extension checkout intent has invalid price terms");
    }
    const checkoutPriceMetadata = buildPaidExtensionPriceMetadata(checkoutPriceYen);
    logStep("Extension pricing resolved", { tier_level: tierLevel, months, mode: isLiveMode ? "live" : "test" });

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price: checkoutPriceId,
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
        billing_intent_id: intent.intent_id,
        price_id: checkoutPriceId,
        ...checkoutPriceMetadata,
      },
    }, { idempotencyKey: `fanmark-extension-checkout:${intent.intent_id}` });

    const { error: attachError } = await supabaseClient.rpc(
      "attach_stripe_extension_checkout_session",
      {
        p_intent_id: intent.intent_id,
        p_stripe_checkout_session_id: session.id,
      },
    );
    if (attachError) {
      logStep("Checkout Session created but intent attachment failed", {
        intent_id: intent.intent_id,
        session_id: session.id,
      });
      throw new Error("Could not bind Checkout Session to its intent; retry the same request");
    }

    logStep("Checkout session created");

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
