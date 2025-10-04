import { supabase } from '@/integrations/supabase/client';

export type PlanType = 'free' | 'creator' | 'business' | 'enterprise' | 'admin';

export interface ActiveFanmark {
  id: string;
  emoji_combination: string;
  fanmark_name: string | null;
  license_id: string;
  license_end: string;
  access_type: string | null;
}

const PLAN_LIMITS: Record<PlanType, number> = {
  free: 3,
  creator: 10,
  business: 50,
  enterprise: 100,
  admin: -1,
};

export function getPlanLimit(planType: PlanType): number {
  return PLAN_LIMITS[planType] ?? PLAN_LIMITS.free;
}

interface LicenseQueryResult {
  id: string;
  fanmark_id: string;
  license_end: string;
  fanmarks: {
    id: string;
    emoji_combination: string;
  } | null;
  fanmark_basic_configs: {
    fanmark_name: string | null;
    access_type: string | null;
  } | null;
}

export async function fetchActiveFanmarks(userId: string): Promise<ActiveFanmark[]> {
  const { data: licenses, error } = await supabase
    .from('fanmark_licenses')
    .select(`
      id,
      fanmark_id,
      license_end,
      fanmarks (
        id,
        emoji_combination
      ),
      fanmark_basic_configs (
        fanmark_name,
        access_type
      )
    `)
    .eq('user_id', userId)
    .eq('status', 'active')
    .gt('license_end', new Date().toISOString());

  if (error) throw error;

  return (
    (licenses as LicenseQueryResult[] | null)?.map(license => ({
      id: license.fanmark_id,
      emoji_combination: license.fanmarks?.emoji_combination ?? '',
      fanmark_name: license.fanmark_basic_configs?.fanmark_name ?? null,
      license_id: license.id,
      license_end: license.license_end,
      access_type: license.fanmark_basic_configs?.access_type ?? null,
    })) || []
  );
}

export interface PlanDowngradeEvaluation {
  requiresSelection: boolean;
  fanmarks: ActiveFanmark[];
  newPlanLimit: number;
}

export async function evaluatePlanDowngrade(
  userId: string | null | undefined,
  currentPlanType: PlanType,
  newPlanType: PlanType
): Promise<PlanDowngradeEvaluation> {
  const currentLimit = getPlanLimit(currentPlanType);
  const newPlanLimit = getPlanLimit(newPlanType);

  if (!userId || newPlanType === 'admin' || newPlanLimit >= currentLimit) {
    return { requiresSelection: false, fanmarks: [], newPlanLimit };
  }

  const fanmarks = await fetchActiveFanmarks(userId);
  const requiresSelection = fanmarks.length > newPlanLimit;

  return { requiresSelection, fanmarks, newPlanLimit };
}

export function formatPlanPrice(planType: PlanType): string {
  switch (planType) {
    case 'free':
      return '¥0';
    case 'creator':
      return '¥1,000';
    case 'business':
      return '¥2,000';
    default:
      return '';
  }
}

export function planDisplayOrder(planType: PlanType): number {
  switch (planType) {
    case 'free':
      return 0;
    case 'creator':
      return 1;
    case 'business':
      return 2;
    case 'enterprise':
      return 3;
    case 'admin':
      return 4;
    default:
      return 5;
  }
}

export async function excludeFanmarksFromPlan(licenseIds: string[], previousPlan: PlanType) {
  if (licenseIds.length === 0) return;

  const { error } = await supabase
    .from('fanmark_licenses')
    .update({
      plan_excluded: true,
      excluded_at: new Date().toISOString(),
      excluded_from_plan: previousPlan,
    })
    .in('id', licenseIds);

  if (error) throw error;
}
