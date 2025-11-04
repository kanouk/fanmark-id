import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function getSupabaseServiceRoleClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceKey) {
    console.error("Missing Supabase service role environment variables");
    throw new Error("Service is not configured correctly");
  }

  return createClient(url, serviceKey);
}

async function roundUpToNextUtcMidnight(input: Date): Promise<Date> {
  const copy = new Date(input);
  copy.setUTCHours(0, 0, 0, 0);
  copy.setUTCDate(copy.getUTCDate() + 1);
  return copy;
}

async function fetchGracePeriodDays(supabase: any): Promise<number> {
  const { data, error } = await supabase
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", "grace_period_days")
    .maybeSingle();

  if (error) {
    console.warn("Failed to fetch grace_period_days:", error);
    return 7; // default
  }

  const parsed = parseInt(data?.setting_value ?? "7", 10);
  return isNaN(parsed) ? 7 : parsed;
}

async function returnUserFanmarks(supabase: any, userId: string): Promise<void> {
  console.log("Starting fanmark return process for user:", userId);

  // Fetch all active licenses for the user
  const { data: licenses, error: licensesError } = await supabase
    .from("fanmark_licenses")
    .select(`
      id,
      fanmark_id,
      fanmarks(user_input_fanmark, short_id)
    `)
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("license_end", new Date().toISOString());

  if (licensesError) {
    console.error("Failed to fetch user licenses:", licensesError);
    throw new Error("Failed to fetch user licenses");
  }

  if (!licenses || licenses.length === 0) {
    console.log("No active licenses found for user:", userId);
    return;
  }

  console.log(`Found ${licenses.length} active licenses to return`);

  const gracePeriodDays = await fetchGracePeriodDays(supabase);
  const nowIso = new Date().toISOString();
  const graceExpiresAt = await roundUpToNextUtcMidnight(new Date());
  graceExpiresAt.setUTCDate(graceExpiresAt.getUTCDate() + gracePeriodDays);
  const graceExpiresAtIso = graceExpiresAt.toISOString();

  // Return each license to grace state
  for (const license of licenses) {
    try {
      // Update license to grace status
      const { error: updateError } = await supabase
        .from("fanmark_licenses")
        .update({
          status: "grace",
          grace_expires_at: graceExpiresAtIso,
          is_returned: true,
          updated_at: nowIso,
        })
        .eq("id", license.id);

      if (updateError) {
        console.error(`Failed to update license ${license.id}:`, updateError);
        throw new Error(`Failed to update license ${license.id}`);
      }

      // Log the return action
      const { error: logError } = await supabase
        .from("audit_logs")
        .insert({
          user_id: userId,
          action: "FANMARK_RETURNED_ON_ACCOUNT_DELETE",
          resource_type: "fanmark_license",
          resource_id: license.id,
          metadata: {
            fanmark_id: license.fanmark_id,
            fanmark_name: license.fanmarks?.user_input_fanmark,
            short_id: license.fanmarks?.short_id,
            grace_expires_at: graceExpiresAtIso,
            returned_at: nowIso,
          },
        });

      if (logError) {
        console.warn(`Failed to log return action for license ${license.id}:`, logError);
      }

      // Notify favorites about return
      const { error: notifyError } = await supabase.rpc("create_notification_event", {
        event_type_param: "fanmark_available",
        payload_param: {
          fanmark_id: license.fanmark_id,
          fanmark_name: license.fanmarks?.user_input_fanmark,
          short_id: license.fanmarks?.short_id,
        },
        source_param: "edge_function",
      });

      if (notifyError) {
        console.warn(`Failed to notify favorites for fanmark ${license.fanmark_id}:`, notifyError);
      }

      console.log(`Successfully returned license ${license.id}`);
    } catch (error) {
      console.error(`Error processing license ${license.id}:`, error);
      throw error;
    }
  }

  console.log("All fanmarks returned successfully");
}

async function cancelUserLotteryEntries(supabase: any, userId: string): Promise<void> {
  console.log("Cancelling lottery entries for user:", userId);

  const { error: cancelError } = await supabase
    .from("fanmark_lottery_entries")
    .update({
      entry_status: "cancelled",
      cancellation_reason: "user_deleted",
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("entry_status", "pending");

  if (cancelError) {
    console.error("Failed to cancel lottery entries:", cancelError);
    throw new Error("Failed to cancel lottery entries");
  }

  console.log("Lottery entries cancelled successfully");
}

async function logAccountDeletion(supabase: any, userId: string, userEmail: string | null): Promise<void> {
  try {
    await supabase.from("audit_logs").insert({
      user_id: userId,
      action: "DELETE_ACCOUNT",
      resource_type: "user",
      resource_id: userId,
      metadata: {
        timestamp: new Date().toISOString(),
        email: userEmail,
        deletion_method: "user_initiated",
      },
    });
  } catch (error) {
    console.warn("Failed to log account deletion:", error);
  }
}

async function cleanupUserData(supabase: any, userId: string): Promise<void> {
  console.log("Starting comprehensive data cleanup for user:", userId);
  const nowIso = new Date().toISOString();

  try {
    // 1. Set all fanmark_licenses.user_id to NULL (preserve license history)
    console.log("Nullifying user_id in fanmark_licenses...");
    const { error: licensesError } = await supabase
      .from("fanmark_licenses")
      .update({ user_id: null, updated_at: nowIso })
      .eq("user_id", userId);
    
    if (licensesError) {
      console.error("Failed to nullify fanmark_licenses.user_id:", licensesError);
      throw new Error("Failed to cleanup fanmark_licenses");
    }
    console.log("✓ fanmark_licenses cleaned");

    // 2. Delete fanmark_favorites
    console.log("Deleting fanmark_favorites...");
    const { error: favoritesError } = await supabase
      .from("fanmark_favorites")
      .delete()
      .eq("user_id", userId);
    
    if (favoritesError) {
      console.error("Failed to delete fanmark_favorites:", favoritesError);
      throw new Error("Failed to cleanup fanmark_favorites");
    }
    console.log("✓ fanmark_favorites cleaned");

    // 3. Delete fanmark_lottery_entries (already cancelled in previous step)
    console.log("Deleting fanmark_lottery_entries...");
    const { error: lotteryError } = await supabase
      .from("fanmark_lottery_entries")
      .delete()
      .eq("user_id", userId);
    
    if (lotteryError) {
      console.error("Failed to delete fanmark_lottery_entries:", lotteryError);
      throw new Error("Failed to cleanup fanmark_lottery_entries");
    }
    console.log("✓ fanmark_lottery_entries cleaned");

    // 4. Delete notifications
    console.log("Deleting notifications...");
    const { error: notificationsError } = await supabase
      .from("notifications")
      .delete()
      .eq("user_id", userId);
    
    if (notificationsError) {
      console.error("Failed to delete notifications:", notificationsError);
      throw new Error("Failed to cleanup notifications");
    }
    console.log("✓ notifications cleaned");

    // 5. Delete notification_preferences
    console.log("Deleting notification_preferences...");
    const { error: preferencesError } = await supabase
      .from("notification_preferences")
      .delete()
      .eq("user_id", userId);
    
    if (preferencesError) {
      console.error("Failed to delete notification_preferences:", preferencesError);
      throw new Error("Failed to cleanup notification_preferences");
    }
    console.log("✓ notification_preferences cleaned");

    // 6. Delete user_roles
    console.log("Deleting user_roles...");
    const { error: rolesError } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId);
    
    if (rolesError) {
      console.error("Failed to delete user_roles:", rolesError);
      throw new Error("Failed to cleanup user_roles");
    }
    console.log("✓ user_roles cleaned");

    // 7. Nullify created_by in fanmark_availability_rules
    console.log("Nullifying created_by in fanmark_availability_rules...");
    const { error: rulesError } = await supabase
      .from("fanmark_availability_rules")
      .update({ created_by: null, updated_at: nowIso })
      .eq("created_by", userId);
    
    if (rulesError) {
      console.error("Failed to nullify fanmark_availability_rules.created_by:", rulesError);
      throw new Error("Failed to cleanup fanmark_availability_rules");
    }
    console.log("✓ fanmark_availability_rules cleaned");

    // 8. Nullify created_by in notification_rules
    console.log("Nullifying created_by in notification_rules...");
    const { error: notifRulesError } = await supabase
      .from("notification_rules")
      .update({ created_by: null, updated_at: nowIso })
      .eq("created_by", userId);
    
    if (notifRulesError) {
      console.error("Failed to nullify notification_rules.created_by:", notifRulesError);
      throw new Error("Failed to cleanup notification_rules");
    }
    console.log("✓ notification_rules cleaned");

    // 9. Nullify created_by in user_roles (for roles created by this user)
    console.log("Nullifying created_by in user_roles...");
    const { error: rolesCreatedError } = await supabase
      .from("user_roles")
      .update({ created_by: null })
      .eq("created_by", userId);
    
    if (rolesCreatedError) {
      console.error("Failed to nullify user_roles.created_by:", rolesCreatedError);
      throw new Error("Failed to cleanup user_roles.created_by");
    }
    console.log("✓ user_roles.created_by cleaned");

    // 10. Delete user_settings (last, as it's the primary user record)
    console.log("Deleting user_settings...");
    const { error: settingsError } = await supabase
      .from("user_settings")
      .delete()
      .eq("user_id", userId);
    
    if (settingsError) {
      console.error("Failed to delete user_settings:", settingsError);
      throw new Error("Failed to cleanup user_settings");
    }
    console.log("✓ user_settings cleaned");

    console.log("✓ All user data cleaned successfully");
  } catch (error) {
    console.error("Error during data cleanup:", error);
    throw error;
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get authenticated user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const accessToken = authHeader.replace("Bearer ", "").trim();
    const supabase = getSupabaseServiceRoleClient();

    // Verify user authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);

    if (authError || !user) {
      console.error("Authentication failed:", authError);
      return new Response(
        JSON.stringify({ error: "Invalid or expired session" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Processing account deletion for user:", user.id);

    // Step 1: Return all active fanmarks to grace state
    await returnUserFanmarks(supabase, user.id);

    // Step 2: Cancel all pending lottery entries
    await cancelUserLotteryEntries(supabase, user.id);

    // Step 3: Log account deletion (before cleanup)
    await logAccountDeletion(supabase, user.id, user.email ?? null);

    // Step 4: Comprehensive data cleanup (explicit deletion/nullification)
    await cleanupUserData(supabase, user.id);

    // Step 5: Delete user from auth.users (should now succeed without FK/RLS issues)
    const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);

    if (deleteError) {
      console.error("Failed to delete user from auth:", deleteError);
      return new Response(
        JSON.stringify({ 
          error: "Failed to delete account from authentication system",
          details: deleteError.message 
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Account deleted successfully:", user.id);

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Account deleted successfully" 
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Error in delete-user-account:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    
    return new Response(
      JSON.stringify({ 
        error: "Failed to delete account",
        details: message 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
