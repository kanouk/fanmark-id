import { corsHeaders, requireAdminContext, logAdminAction } from "../_shared/admin-auth.ts";
import type { User } from "https://esm.sh/@supabase/supabase-js@2.57.4";

interface ListUsersRequest {
  search?: string;
  plans?: string[];
  status?: "active" | "suspended";
  page?: number;
  pageSize?: number;
}

interface LicenseCount {
  active: number;
  grace: number;
  expired: number;
}

interface EnterpriseSettings {
  custom_fanmarks_limit: number | null;
  custom_pricing: number | null;
  notes: string | null;
}

interface ListedUser {
  userId: string;
  email: string | null;
  emailConfirmedAt: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  status: "active" | "suspended";
  bannedUntil: string | null;
  displayName: string | null;
  username: string;
  planType: string;
  preferredLanguage: string;
  profileUpdatedAt: string;
  licenseCounts: LicenseCount;
  enterpriseSettings: EnterpriseSettings | null;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_FETCH = 1000;

function normalizeSearch(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function userStatus(user: User): "active" | "suspended" {
  if (!user?.ban_duration) return "active";
  try {
    const bannedUntil = new Date(user.ban_duration);
    return bannedUntil.getTime() > Date.now() ? "suspended" : "active";
  } catch (_err) {
    return "active";
  }
}

function matchesStatusFilter(user: User, status?: "active" | "suspended"): boolean {
  if (!status) return true;
  return userStatus(user) === status;
}

function matchesEmailSearch(user: User, search: string | null): boolean {
  if (!search) return true;
  const email = user.email ?? "";
  return email.toLowerCase().includes(search.toLowerCase());
}

function pickLicenseCounts(rows: Array<{ user_id: string; status: string }>): Record<string, LicenseCount> {
  const counts: Record<string, LicenseCount> = {};
  for (const row of rows) {
    if (!counts[row.user_id]) {
      counts[row.user_id] = { active: 0, grace: 0, expired: 0 };
    }
    if (row.status === "active") counts[row.user_id].active += 1;
    else if (row.status === "grace") counts[row.user_id].grace += 1;
    else if (row.status === "expired") counts[row.user_id].expired += 1;
  }
  return counts;
}

function pickEnterpriseSettings(rows: Array<{ user_id: string; custom_fanmarks_limit: number | null; custom_pricing: number | null; notes: string | null }>): Record<string, EnterpriseSettings> {
  const map: Record<string, EnterpriseSettings> = {};
  for (const row of rows) {
    map[row.user_id] = {
      custom_fanmarks_limit: row.custom_fanmarks_limit,
      custom_pricing: row.custom_pricing,
      notes: row.notes,
    };
  }
  return map;
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

  let payload: ListUsersRequest = {};
  try {
    payload = await req.json();
  } catch (_error) {
    // ignore, payload stays empty
  }

  const search = normalizeSearch(payload.search);
  const statusFilter = payload.status;
  const planFilter = Array.isArray(payload.plans) && payload.plans.length > 0 ? payload.plans : null;
  const pageSize = Math.min(Math.max(payload.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = Math.max(payload.page ?? 1, 1);

  let query = supabase
    .from("user_settings")
    .select("user_id, username, display_name, plan_type, preferred_language, updated_at, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(MAX_FETCH);

  if (planFilter) {
    query = query.in("plan_type", planFilter);
  }

  if (search) {
    query = query.or(`display_name.ilike.%${search}%,username.ilike.%${search}%`);
  }

  const { data: userSettings, count, error: settingsError } = await query;
  if (settingsError) {
    console.error("Failed to fetch user settings:", settingsError);
    return new Response(
      JSON.stringify({ error: "Failed to load user list" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!userSettings || userSettings.length === 0) {
    return new Response(
      JSON.stringify({
        data: [],
        pagination: {
          page,
          pageSize,
          totalCount: 0,
          totalPages: 0,
        },
        filters: {
          search,
          plans: planFilter,
          status: statusFilter ?? null,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const userIds = userSettings.map((row) => row.user_id);

  const authUsers = new Map<string, User>();
  for (const userId of userIds) {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error) {
      console.error("Failed to load auth user:", userId, error);
      continue;
    }
    if (data?.user) {
      authUsers.set(userId, data.user);
    }
  }

  const filteredSettingRows = userSettings.filter((row) => {
    const authUser = authUsers.get(row.user_id);
    if (!authUser) return false;
    if (!matchesStatusFilter(authUser, statusFilter)) {
      return false;
    }
    if (search && !matchesEmailSearch(authUser, search)) {
      // if search term is present but the email does not match, drop
      if (!(row.display_name ?? "").toLowerCase().includes(search.toLowerCase()) &&
        !(row.username ?? "").toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
    }
    return true;
  });

  const filteredUserIds = filteredSettingRows.map((row) => row.user_id);

  if (filteredUserIds.length === 0) {
    return new Response(
      JSON.stringify({
        data: [],
        pagination: {
          page,
          pageSize,
          totalCount: 0,
          totalPages: 0,
        },
        filters: {
          search,
          plans: planFilter,
          status: statusFilter ?? null,
        },
        meta: {
          totalMatchedBeforeStatus: count ?? null,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { data: licenseRows, error: licenseError } = await supabase
    .from("fanmark_licenses")
    .select("user_id, status")
    .in("user_id", filteredUserIds);

  if (licenseError) {
    console.error("Failed to fetch license counts:", licenseError);
  }

  const licenseCounts = pickLicenseCounts(licenseRows ?? []);

  const { data: enterpriseRows, error: enterpriseError } = await supabase
    .from("enterprise_user_settings")
    .select("user_id, custom_fanmarks_limit, custom_pricing, notes")
    .in("user_id", filteredUserIds);

  if (enterpriseError) {
    console.error("Failed to fetch enterprise settings:", enterpriseError);
  }

  const enterpriseSettings = pickEnterpriseSettings(enterpriseRows ?? []);

  const assembledUsers: ListedUser[] = filteredSettingRows.map((row) => {
    const authUser = authUsers.get(row.user_id)!;
    const status = userStatus(authUser);
    const counts = licenseCounts[row.user_id] ?? { active: 0, grace: 0, expired: 0 };

    return {
      userId: row.user_id,
      email: authUser.email ?? null,
      emailConfirmedAt: authUser.email_confirmed_at ?? null,
      createdAt: authUser.created_at ?? null,
      lastSignInAt: authUser.last_sign_in_at ?? null,
      status,
      bannedUntil: authUser.ban_duration ?? null,
      displayName: row.display_name,
      username: row.username,
      planType: row.plan_type,
      preferredLanguage: row.preferred_language,
      profileUpdatedAt: row.updated_at,
      licenseCounts: counts,
      enterpriseSettings: enterpriseSettings[row.user_id] ?? null,
    };
  });

  const totalFiltered = assembledUsers.length;
  const totalPages = Math.ceil(totalFiltered / pageSize);
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pagedUsers = assembledUsers.slice(start, end);

  await logAdminAction(
    supabase,
    adminUser,
    "ADMIN_LIST_USERS",
    "user",
    null,
    {
      search,
      plans: planFilter,
      status: statusFilter ?? null,
      page,
      pageSize,
      returned: pagedUsers.length,
      totalFiltered,
      totalMatchedBeforeStatus: count ?? null,
    },
  );

  return new Response(
    JSON.stringify({
      data: pagedUsers,
      pagination: {
        page,
        pageSize,
        totalCount: totalFiltered,
        totalPages,
      },
      filters: {
        search,
        plans: planFilter,
        status: statusFilter ?? null,
      },
      meta: {
        totalMatchedBeforeStatus: count ?? null,
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
