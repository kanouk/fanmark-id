import { supabase } from '@/integrations/supabase/client';
import { resolveFanmarkDisplay } from '@/lib/emojiConversion';

export type PlanType = 'free' | 'creator' | 'business' | 'enterprise' | 'admin';

export interface ActiveFanmark {
  id: string;
  user_input_fanmark: string;
  emoji_ids: string[];
  fanmark: string;
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
    user_input_fanmark: string;
    emoji_ids: (string | null)[] | null;
  } | null;
  fanmark_basic_configs: {
    fanmark_name: string | null;
    access_type: string | null;
  } | null;
}

export async function fetchActiveFanmarks(userId: string): Promise<ActiveFanmark[]> {
  const nowIso = new Date().toISOString();

  const { data: licenses, error } = await supabase
    .from('fanmark_licenses')
    .select(`
      id,
      fanmark_id,
      license_end,
      fanmarks (
        id,
        user_input_fanmark,
        emoji_ids
      ),
      fanmark_basic_configs (
        fanmark_name,
        access_type
      )
    `)
    .eq('user_id', userId)
    .in('status', ['active', 'grace'])
    .gt('license_end', nowIso)
    .order('license_end', { ascending: true });

  if (error) throw error;

  console.log('[fetchActiveFanmarks] Found licenses:', licenses?.length || 0);

  return (
    (licenses as LicenseQueryResult[] | null)?.map(license => {
      const userInput = license.fanmarks?.user_input_fanmark ?? '';
      const emojiIds = Array.isArray(license.fanmarks?.emoji_ids)
        ? (license.fanmarks?.emoji_ids as (string | null)[]).filter((value): value is string => Boolean(value))
        : [];
      const displayFanmark = resolveFanmarkDisplay(userInput, emojiIds);

      return {
        id: license.fanmark_id,
        user_input_fanmark: userInput,
        emoji_ids: emojiIds,
        fanmark: displayFanmark,
        fanmark_name: (license.fanmark_basic_configs?.fanmark_name ?? displayFanmark ?? userInput) || null,
        license_id: license.id,
        license_end: license.license_end,
        access_type: license.fanmark_basic_configs?.access_type ?? null,
      };
    }) || []
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

  console.log('[evaluatePlanDowngrade] Plan change:', {
    currentPlanType,
    newPlanType,
    currentLimit,
    newPlanLimit,
    userId: userId ? 'present' : 'missing'
  });

  if (!userId || newPlanType === 'admin' || newPlanLimit >= currentLimit) {
    console.log('[evaluatePlanDowngrade] Skipping selection - not a downgrade');
    return { requiresSelection: false, fanmarks: [], newPlanLimit };
  }

  const fanmarks = await fetchActiveFanmarks(userId);
  const filteredFanmarks = fanmarks.filter(fm => {
    const licenseEndTime = new Date(fm.license_end).getTime();
    const nowTime = Date.now();
    return licenseEndTime > nowTime;
  });
  const requiresSelection = filteredFanmarks.length > newPlanLimit;

  console.log('[evaluatePlanDowngrade] Result:', {
    fanmarksCount: filteredFanmarks.length,
    newPlanLimit,
    requiresSelection
  });

  return { requiresSelection, fanmarks: filteredFanmarks, newPlanLimit };
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
