import { corsHeaders, requireAdminContext, logAdminAction } from "../_shared/admin-auth.ts";
import type { User } from "https://esm.sh/@supabase/supabase-js@2.57.4";

interface DetailRequest {
  userId: string;
}

interface LicenseSummary {
  active: number;
  grace: number;
  expired: number;
  total: number;
}

interface FanmarkRecord {
  licenseId: string;
  status: string;
  licenseEnd: string;
  graceExpiresAt: string | null;
  planExcluded: boolean;
  excludedAt: string | null;
  excludedFromPlan: string | null;
  fanmarkId: string;
  emoji: string;
  fanmarkName: string | null;
  accessType: string | null;
}

interface AuditLogEntry {
  id: string;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface UserDetailResponse {
  auth: {
    email: string | null;
    emailConfirmedAt: string | null;
    createdAt: string | null;
    lastSignInAt: string | null;
    phone: string | null;
    status: "active" | "suspended";
    bannedUntil: string | null;
    factors: { type: string; createdAt: string | null }[];
  };
  profile: {
    userId: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    planType: string;
    preferredLanguage: string;
    createdAt: string;
    updatedAt: string;
  };
  enterpriseSettings: {
    customFanmarksLimit: number | null;
    customPricing: number | null;
    notes: string | null;
    updatedAt: string | null;
  } | null;
  licenseSummary: LicenseSummary;
  recentFanmarks: FanmarkRecord[];
  recentAuditLogs: AuditLogEntry[];
}

function getStatus(user: User): "active" | "suspended" {
  if (!user?.ban_duration) return "active";
  try {
    const bannedUntil = new Date(user.ban_duration);
    return bannedUntil.getTime() > Date.now() ? "suspended" : "active";
  } catch (_err) {
    return "active";
  }
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

  let payload: DetailRequest;
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

  const { userId } = payload;

  const { data: authData, error: authError } = await supabase.auth.admin.getUserById(userId);
  if (authError || !authData?.user) {
    console.error("Failed to load auth user detail:", authError);
    return new Response(
      JSON.stringify({ error: "User not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const authUser = authData.user;

  const { data: profile, error: profileError } = await supabase
    .from("user_settings")
    .select("user_id, username, display_name, avatar_url, plan_type, preferred_language, created_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) {
    console.error("Failed to load user profile:", profileError);
    return new Response(
      JSON.stringify({ error: "Failed to load profile" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!profile) {
    return new Response(
      JSON.stringify({ error: "Profile not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { data: enterpriseSettings, error: enterpriseError } = await supabase
    .from("enterprise_user_settings")
    .select("custom_fanmarks_limit, custom_pricing, notes, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (enterpriseError) {
    console.error("Failed to load enterprise settings:", enterpriseError);
  }

  const { data: licenseRows, error: licenseError } = await supabase
    .from("fanmark_licenses")
    .select(`id, status, license_end, grace_expires_at, plan_excluded, excluded_at, excluded_from_plan,
             fanmark_id, fanmarks ( id, user_input_fanmark ),
             fanmark_basic_configs ( fanmark_name, access_type )`)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(25);

  if (licenseError) {
    console.error("Failed to load licenses:", licenseError);
  }

  const summary: LicenseSummary = { active: 0, grace: 0, expired: 0, total: 0 };
  const recentFanmarks: FanmarkRecord[] = [];

  for (const row of licenseRows ?? []) {
    summary.total += 1;
    if (row.status === "active") summary.active += 1;
    else if (row.status === "grace") summary.grace += 1;
    else if (row.status === "expired") summary.expired += 1;

    recentFanmarks.push({
      licenseId: row.id,
      status: row.status,
      licenseEnd: row.license_end,
      graceExpiresAt: row.grace_expires_at,
      planExcluded: row.plan_excluded ?? false,
      excludedAt: row.excluded_at ?? null,
      excludedFromPlan: row.excluded_from_plan ?? null,
      fanmarkId: row.fanmark_id,
      emoji: Array.isArray(row.fanmarks) ? row.fanmarks[0]?.user_input_fanmark ?? "" : row.fanmarks?.user_input_fanmark ?? "",
      fanmarkName: Array.isArray(row.fanmark_basic_configs) ? row.fanmark_basic_configs[0]?.fanmark_name ?? null : row.fanmark_basic_configs?.fanmark_name ?? null,
      accessType: Array.isArray(row.fanmark_basic_configs) ? row.fanmark_basic_configs[0]?.access_type ?? null : row.fanmark_basic_configs?.access_type ?? null,
    });
  }

  const { data: auditRows, error: auditError } = await supabase
    .from("audit_logs")
    .select("id, user_id, action, resource_type, resource_id, metadata, created_at")
    .or(`user_id.eq.${userId},resource_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(20);

  if (auditError) {
    console.error("Failed to load audit logs:", auditError);
  }

  const auditLogs: AuditLogEntry[] = (auditRows ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  }));

  const response: UserDetailResponse = {
    auth: {
      email: authUser.email ?? null,
      emailConfirmedAt: authUser.email_confirmed_at ?? null,
      createdAt: authUser.created_at ?? null,
      lastSignInAt: authUser.last_sign_in_at ?? null,
      phone: authUser.phone ?? null,
      status: getStatus(authUser),
      bannedUntil: authUser.ban_duration ?? null,
      factors: (authUser.factors ?? []).map((factor) => ({
        type: factor.factor_type,
        createdAt: factor.created_at ?? null,
      })),
    },
    profile: {
      userId: profile.user_id,
      username: profile.username,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
      planType: profile.plan_type,
      preferredLanguage: profile.preferred_language,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    },
    enterpriseSettings: enterpriseSettings
      ? {
        customFanmarksLimit: enterpriseSettings.custom_fanmarks_limit,
        customPricing: enterpriseSettings.custom_pricing,
        notes: enterpriseSettings.notes,
        updatedAt: enterpriseSettings.updated_at ?? null,
      }
      : null,
    licenseSummary: summary,
    recentFanmarks,
    recentAuditLogs: auditLogs,
  };

  await logAdminAction(
    supabase,
    adminUser,
    "ADMIN_VIEW_USER_DETAIL",
    "user",
    userId,
    { requestedUserId: userId },
  );

  return new Response(
    JSON.stringify(response),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
