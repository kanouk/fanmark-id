import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.57.4";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export interface AdminContext {
  supabase: SupabaseClient;
  adminUser: User;
}

function unauthorized(message = "Unauthorized request"): Response {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

function forbidden(message = "Admin access required"): Response {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

export function getSupabaseServiceRoleClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceKey) {
    console.error("Missing Supabase service role environment variables");
    throw new Error("Service is not configured correctly");
  }

  return createClient(url, serviceKey);
}

async function isAdminUser(
  client: SupabaseClient,
  user: User,
): Promise<boolean> {
  const { data: roles, error } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (error) {
    console.error("Failed to check admin role:", error);
    return false;
  }

  return roles !== null;
}

export async function requireAdminContext(req: Request): Promise<AdminContext | Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return unauthorized("Missing bearer token");
  }

  const accessToken = authHeader.replace("Bearer ", "").trim();
  if (!accessToken) {
    return unauthorized("Invalid bearer token");
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);

  if (authError || !user) {
    console.error("Admin authentication failed:", authError);
    return unauthorized("Invalid or expired session");
  }

  const admin = await isAdminUser(supabase, user);
  if (!admin) {
    console.warn("Admin access denied for user:", user.id, user.email);
    return forbidden();
  }

  return { supabase, adminUser: user };
}

export async function logAdminAction(
  client: SupabaseClient,
  adminUser: User,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.from("audit_logs").insert({
    user_id: adminUser.id,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    metadata: {
      ...metadata,
      admin_email: adminUser.email ?? null,
      logged_at: new Date().toISOString(),
    },
  });

  if (error) {
    console.error("Failed to log admin action:", error);
  }
}
