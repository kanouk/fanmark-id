import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const PLAN_LIMIT_KEYS: Record<string, string> = {
  free: "free_fanmarks_limit",
  creator: "creator_fanmarks_limit",
  business: "business_fanmarks_limit",
  enterprise: "enterprise_fanmarks_limit",
  max: "max_fanmarks_limit",
};

const DEFAULT_LIMITS: Record<string, number> = {
  free: 3,
  creator: 10,
  business: 50,
  enterprise: 100,
  max: 500,
};

export async function getUserFanmarkLimit(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ planType: string; limit: number; isUnlimited: boolean }> {
  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select("plan_type")
    .eq("user_id", userId)
    .maybeSingle();

  if (settingsError) {
    throw new Error("Failed to fetch user settings");
  }

  const planType = settings?.plan_type ?? "free";
  if (planType === "admin") {
    return { planType, limit: -1, isUnlimited: true };
  }

  const settingKey = PLAN_LIMIT_KEYS[planType] ?? PLAN_LIMIT_KEYS.free;
  const { data: limitSetting, error: limitError } = await supabase
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", settingKey)
    .maybeSingle();

  if (limitError) {
    throw new Error("Failed to fetch plan limit");
  }

  const limit = limitSetting?.setting_value
    ? parseInt(limitSetting.setting_value, 10)
    : (DEFAULT_LIMITS[planType] ?? DEFAULT_LIMITS.free);

  return { planType, limit, isUnlimited: false };
}

export async function countActiveFanmarks(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const nowIso = new Date().toISOString();
  const { count, error } = await supabase
    .from("fanmark_licenses")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "active")
    .or(`license_end.is.null,license_end.gt.${nowIso}`);

  if (error) {
    throw new Error("Failed to count active fanmarks");
  }

  return count ?? 0;
}
