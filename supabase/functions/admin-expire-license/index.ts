import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  corsHeaders,
  logAdminAction,
  requireAdminContext,
} from "../_shared/admin-auth.ts";

interface ExpireRequestBody {
  licenseId: string;
  reason?: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ctx = await requireAdminContext(req);
  if (ctx instanceof Response) return ctx;

  try {
    const { licenseId, reason }: ExpireRequestBody = await req.json();

    if (!licenseId) {
      return new Response(JSON.stringify({ error: "licenseId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: license, error: licenseError } = await ctx.supabase
      .from("fanmark_licenses")
      .select(
        `id, status, user_id, fanmark_id, license_end, display_fanmark,
         fanmarks ( user_input_fanmark, short_id )`
      )
      .eq("id", licenseId)
      .maybeSingle();

    if (licenseError) {
      console.error("Failed to fetch license:", licenseError);
      throw new Error("Failed to fetch license");
    }

    if (!license) {
      return new Response(JSON.stringify({ error: "License not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (license.status === "expired") {
      return new Response(JSON.stringify({ success: true, alreadyExpired: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const nowIso = new Date().toISOString();

    const { error: updateError } = await ctx.supabase
      .from("fanmark_licenses")
      .update({
        status: "expired",
        license_end: nowIso,
        grace_expires_at: nowIso,
        excluded_at: nowIso,
      })
      .eq("id", licenseId);

    if (updateError) {
      console.error("Failed to expire license:", updateError);
      throw new Error("Failed to expire license");
    }

    const configDeleteErrors: Record<string, string | null> = {
      basic: null,
      redirect: null,
      messageboard: null,
      password: null,
    };

    const { error: basicConfigDeleteError } = await ctx.supabase
      .from("fanmark_basic_configs")
      .delete()
      .eq("license_id", licenseId);

    const { error: redirectConfigDeleteError } = await ctx.supabase
      .from("fanmark_redirect_configs")
      .delete()
      .eq("license_id", licenseId);

    const { error: messageConfigDeleteError } = await ctx.supabase
      .from("fanmark_messageboard_configs")
      .delete()
      .eq("license_id", licenseId);

    const { error: passwordConfigDeleteError } = await ctx.supabase
      .from("fanmark_password_configs")
      .delete()
      .eq("license_id", licenseId);

    configDeleteErrors.basic = basicConfigDeleteError?.message ?? null;
    configDeleteErrors.redirect = redirectConfigDeleteError?.message ?? null;
    configDeleteErrors.messageboard = messageConfigDeleteError?.message ?? null;
    configDeleteErrors.password = passwordConfigDeleteError?.message ?? null;

    const fanmarkData = license.fanmarks as { user_input_fanmark: string; short_id: string } | null;
    const displayFanmark =
      license.display_fanmark ?? fanmarkData?.user_input_fanmark ?? "";

    await ctx.supabase.from("audit_logs").insert({
      user_id: license.user_id,
      action: "license_expired",
      resource_type: "fanmark_license",
      resource_id: license.id,
      metadata: {
        fanmark_id: license.fanmark_id,
        expired_at: nowIso,
        license_end: license.license_end,
        admin_user_id: ctx.adminUser.id,
        admin_email: ctx.adminUser.email ?? null,
        reason: reason ?? null,
        config_deletion_errors: configDeleteErrors,
      },
    });

    await ctx.supabase.rpc("create_notification_event", {
      event_type_param: "license_expired",
      payload_param: {
        user_id: license.user_id,
        fanmark_id: license.fanmark_id,
        fanmark_name: displayFanmark,
        expired_at: nowIso,
        license_end: license.license_end,
      },
      source_param: "admin_action",
      dedupe_key_param: `admin_expired_${license.id}_${Date.now()}`,
    });

    await logAdminAction(ctx.supabase, ctx.adminUser, "admin_expire_license", "fanmark_license", license.id, {
      fanmark_id: license.fanmark_id,
      target_user_id: license.user_id,
      previous_status: license.status,
      reason: reason ?? null,
    });

    return new Response(
      JSON.stringify({
        success: true,
        licenseId,
        configDeleteErrors,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Unexpected error in admin-expire-license:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
