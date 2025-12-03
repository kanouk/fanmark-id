import { corsHeaders, requireAdminContext, logAdminAction } from "../_shared/admin-auth.ts";

interface PasswordResetRequest {
  userId: string;
  redirectTo?: string;
  reason?: string;
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

  let payload: PasswordResetRequest;
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

  const { userId, redirectTo, reason } = payload;

  const { data: authData, error: authError } = await supabase.auth.admin.getUserById(userId);
  if (authError || !authData?.user?.email) {
    console.error("Failed to load auth user for password reset:", authError);
    return new Response(
      JSON.stringify({ error: "User email not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const email = authData.user.email;

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
    options: {
      redirectTo,
    },
  });

  if (linkError || !linkData?.properties?.action_link) {
    console.error("Failed to generate password reset link:", linkError);
    return new Response(
      JSON.stringify({ error: "Failed to generate password reset link" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  await logAdminAction(
    supabase,
    adminUser,
    "ADMIN_TRIGGER_PASSWORD_RESET",
    "user",
    userId,
    {
      email,
      redirectTo: redirectTo ?? null,
      reason: reason ?? null,
    },
  );

  return new Response(
    JSON.stringify({
      success: true,
      email,
      actionLink: linkData.properties.action_link,
      hashedToken: linkData.properties.hashed_token ?? null,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
