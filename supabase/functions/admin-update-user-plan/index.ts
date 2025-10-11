import { corsHeaders, requireAdminContext, logAdminAction } from "../_shared/admin-auth.ts";

type PlanType = "free" | "creator" | "business" | "enterprise" | "admin";

interface UpdatePlanRequest {
  userId: string;
  newPlanType: PlanType;
  reason?: string;
  enterpriseOverrides?: {
    customFanmarksLimit?: number | null;
    customPricing?: number | null;
    notes?: string | null;
  };
}

const PLAN_TYPES: PlanType[] = ["free", "creator", "business", "enterprise", "admin"];

function isValidPlan(plan: string): plan is PlanType {
  return PLAN_TYPES.includes(plan as PlanType);
}

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

Deno.serve(async (req) => {
  const context = await requireAdminContext(req);
  if (context instanceof Response) {
    return context;
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { supabase, adminUser } = context;

  let payload: UpdatePlanRequest;
  try {
    payload = await req.json();
  } catch (_error) {
    return new Response(
      JSON.stringify({ error: "Invalid JSON payload" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!payload?.userId || !payload?.newPlanType) {
    return new Response(
      JSON.stringify({ error: "userId and newPlanType are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!isValidPlan(payload.newPlanType)) {
    return new Response(
      JSON.stringify({ error: "Invalid plan type" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { userId, newPlanType, enterpriseOverrides, reason } = payload;

  const { data: profile, error: profileError } = await supabase
    .from("user_settings")
    .select("plan_type")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) {
    console.error("Failed to load profile for plan update:", profileError);
    return new Response(
      JSON.stringify({ error: "Failed to load user profile" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!profile) {
    return new Response(
      JSON.stringify({ error: "User profile not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const nowIso = new Date().toISOString();
  const updates = {
    plan_type: newPlanType,
    updated_at: nowIso,
  };

  const { error: updateError } = await supabase
    .from("user_settings")
    .update(updates)
    .eq("user_id", userId);

  if (updateError) {
    console.error("Failed to update plan type:", updateError);
    return new Response(
      JSON.stringify({ error: "Failed to update plan" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let enterpriseResult: Record<string, unknown> | null = null;
  if (newPlanType === "enterprise") {
    const overrides = enterpriseOverrides ?? {};
    const customFanmarksLimit = normalizeNumber(overrides.customFanmarksLimit);
    const customPricing = normalizeNumber(overrides.customPricing);
    const notes = overrides.notes ?? null;

    const { data: result, error: upsertError } = await supabase
      .from("enterprise_user_settings")
      .upsert({
        user_id: userId,
        custom_fanmarks_limit: customFanmarksLimit,
        custom_pricing: customPricing,
        notes,
        created_by: adminUser.id,
        updated_at: nowIso,
      }, { onConflict: "user_id" })
      .select("id, custom_fanmarks_limit, custom_pricing, notes")
      .maybeSingle();

    if (upsertError) {
      console.error("Failed to upsert enterprise overrides:", upsertError);
      return new Response(
        JSON.stringify({ error: "Plan updated, but enterprise settings failed to save" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    enterpriseResult = result ?? null;
  } else {
    const { error: deleteError } = await supabase
      .from("enterprise_user_settings")
      .delete()
      .eq("user_id", userId);

    if (deleteError) {
      console.error("Failed to clean enterprise overrides:", deleteError);
    }
  }

  await logAdminAction(
    supabase,
    adminUser,
    "ADMIN_UPDATE_PLAN",
    "user",
    userId,
    {
      previousPlan: profile.plan_type,
      newPlan: newPlanType,
      reason: reason ?? null,
      enterpriseOverrides: enterpriseResult,
    },
  );

  return new Response(
    JSON.stringify({
      success: true,
      newPlanType,
      enterpriseOverrides: enterpriseResult,
      updatedAt: nowIso,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
