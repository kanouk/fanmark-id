import { corsHeaders, requireAdminContext, logAdminAction } from "../_shared/admin-auth.ts";

interface ToggleStatusRequest {
  userId: string;
  suspend: boolean;
  reason?: string;
  bannedUntil?: string;
}

function computeBannedUntil(requested?: string): string {
  if (requested) {
    const parsed = new Date(requested);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  const farFuture = new Date();
  farFuture.setFullYear(farFuture.getFullYear() + 5);
  return farFuture.toISOString();
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

  let payload: ToggleStatusRequest;
  try {
    payload = await req.json();
  } catch (_error) {
    return new Response(
      JSON.stringify({ error: "Invalid JSON payload" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!payload?.userId) {
    return new Response(
      JSON.stringify({ error: "userId is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { userId, suspend, reason, bannedUntil } = payload;

  const updatePayload = suspend
    ? { ban_duration: computeBannedUntil(bannedUntil) }
    : { ban_duration: "none" };

  const { data, error } = await supabase.auth.admin.updateUserById(userId, updatePayload);

  if (error) {
    console.error("Failed to toggle user status:", error);
    return new Response(
      JSON.stringify({ error: "Failed to update user status" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  await logAdminAction(
    supabase,
    adminUser,
    suspend ? "ADMIN_SUSPEND_USER" : "ADMIN_RESTORE_USER",
    "user",
    userId,
    {
      reason: reason ?? null,
      bannedUntil: (data?.user as any)?.ban_duration ?? null,
    },
  );

  return new Response(
    JSON.stringify({
      success: true,
      userId,
      suspend,
      bannedUntil: (data?.user as any)?.ban_duration ?? null,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
