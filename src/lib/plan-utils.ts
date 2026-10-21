import { loadOwnedFanmarks } from './owned-fanmarks-api';
import { mapActiveOwnedFanmarks } from './owned-fanmarks-plan-projection';
import type { ActiveFanmark } from './owned-fanmarks-plan-projection';

export type { ActiveFanmark } from './owned-fanmarks-plan-projection';

export type PlanType = 'free' | 'creator' | 'max' | 'business' | 'enterprise' | 'admin';

export interface PlanLimits {
  free: number;
  creator: number;
  max: number;
  business: number;
  enterprise: number;
  admin: number;
}

export interface PlanPricing {
  creator: number;
  max: number;
  business: number;
  enterprise: number;
}

export function getPlanLimit(planType: PlanType, planLimits: PlanLimits): number {
  return planLimits[planType] ?? planLimits.free;
}

interface LicenseQueryResult {
  id: string;
  fanmark_id: string;
  license_end: string | null;
  display_fanmark: string | null;
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
  {
    return mapActiveOwnedFanmarks(await loadOwnedFanmarks());
  }

  // Fetch active licenses where:
  // - status is 'active' (not grace or expired)
  // - license_end is NULL (perpetual) OR license_end > now (not expired)

}

export interface PlanDowngradeEvaluation {
  requiresSelection: boolean;
  fanmarks: ActiveFanmark[];
  newPlanLimit: number;
}

export async function evaluatePlanDowngrade(
  userId: string | null | undefined,
  currentPlanType: PlanType,
  newPlanType: PlanType,
  planLimits: PlanLimits
): Promise<PlanDowngradeEvaluation> {
  const currentLimit = getPlanLimit(currentPlanType, planLimits);
  const newPlanLimit = getPlanLimit(newPlanType, planLimits);

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
  // Filter fanmarks: include perpetual licenses (null) and those not yet expired
  const filteredFanmarks = fanmarks.filter(fm => {
    // Perpetual licenses (license_end is null) are always valid
    if (fm.license_end === null) return true;
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

const formatYen = (amount: number): string => {
  return `¥${amount.toLocaleString('ja-JP')}`;
};

export function formatPlanPrice(planType: PlanType, planPricing: PlanPricing): string {
  switch (planType) {
    case 'free':
      return '¥0';
    case 'creator':
      return formatYen(planPricing.creator);
    case 'max':
      return formatYen(planPricing.max);
    case 'business':
      return formatYen(planPricing.business);
    case 'enterprise':
      return formatYen(planPricing.enterprise);
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
    case 'max':
      return 2;
    case 'business':
      return 3;
    case 'enterprise':
      return 4;
    case 'admin':
      return 5;
    default:
      return 6;
  }
}

export function isUpgrade(currentPlanType: PlanType, newPlanType: PlanType): boolean {
  return planDisplayOrder(newPlanType) > planDisplayOrder(currentPlanType);
}
