import { useState, useEffect, useCallback } from 'react';

import { createExtensionCouponThroughWorker, deleteExtensionCouponThroughWorker, listExtensionCouponUsagesThroughWorker, listExtensionCouponsThroughWorker, updateExtensionCouponThroughWorker } from '@/lib/extension-coupon-admin-api';

export interface ExtensionCouponRow {
  id: string;
  code: string;
  months: number;
  allowed_tier_levels: number[] | null;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExtensionCouponUsageRow {
  id: string;
  coupon_id: string;
  user_id: string;
  fanmark_id: string;
  license_id: string;
  used_at: string;
  fanmark_emoji?: string;
  user_display_name?: string;
}

export interface CreateCouponValues {
  code?: string;
  months: number;
  allowedTierLevels?: number[];
  maxUses: number;
  expiresAt?: string;
}

export const useExtensionCouponAdmin = () => {
  const [coupons, setCoupons] = useState<ExtensionCouponRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchCoupons = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      {
        setCoupons(await listExtensionCouponsThroughWorker());
        return;
      }

    } catch (err) {
      console.error('Failed to fetch extension coupons:', err);
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCoupons();
  }, [fetchCoupons]);

  const createCoupon = async (values: CreateCouponValues): Promise<{ success: boolean; code?: string; error?: Error }> => {
    try {
      const normalizedCode = values.code?.trim().toUpperCase() || null;
      let code: string;
      {
        const created = await createExtensionCouponThroughWorker({
          code: normalizedCode,
          months: values.months,
          allowedTierLevels: values.allowedTierLevels?.length ? values.allowedTierLevels : null,
          maxUses: values.maxUses,
          expiresAt: values.expiresAt || null,
        });
        code = created.code;
      }
      await fetchCoupons();
      return { success: true, code };
    } catch (err) {
      console.error('Failed to create extension coupon:', err);
      return { success: false, error: err instanceof Error ? err : new Error('Unknown error') };
    }
  };

  const updateCoupon = async (id: string, updates: Partial<ExtensionCouponRow>): Promise<{ success: boolean; error?: Error }> => {
    try {
      {
        const keys = Object.keys(updates);
        if (keys.length !== 1 || !Object.prototype.hasOwnProperty.call(updates, 'is_active') || typeof updates.is_active !== 'boolean') {
          throw new Error('Only coupon activation can be changed through this API');
        }
        const current = coupons.find((coupon) => coupon.id === id);
        if (!current) throw new Error('Coupon was not found in the current list');
        await updateExtensionCouponThroughWorker(id, {
          isActive: updates.is_active,
          expectedUpdatedAt: current.updated_at,
        });
      }
      await fetchCoupons();
      return { success: true };
    } catch (err) {
      console.error('Failed to update extension coupon:', err);
      return { success: false, error: err instanceof Error ? err : new Error('Unknown error') };
    }
  };

  const toggleActive = async (id: string, isActive: boolean): Promise<{ success: boolean; error?: Error }> => {
    return updateCoupon(id, { is_active: isActive });
  };

  const deleteCoupon = async (id: string): Promise<{ success: boolean; error?: Error }> => {
    try {
      {
        await deleteExtensionCouponThroughWorker(id);
      }
      await fetchCoupons();
      return { success: true };
    } catch (err) {
      console.error('Failed to delete extension coupon:', err);
      return { success: false, error: err instanceof Error ? err : new Error('Unknown error') };
    }
  };

  const fetchUsages = async (couponId: string): Promise<{ success: boolean; data?: ExtensionCouponUsageRow[]; error?: Error }> => {
    try {
      {
        return { success: true, data: await listExtensionCouponUsagesThroughWorker(couponId) };
      }

    } catch (err) {
      console.error('Failed to fetch coupon usages:', err);
      return { success: false, error: err instanceof Error ? err : new Error('Unknown error') };
    }
  };

  return {
    coupons,
    loading,
    error,
    refresh: fetchCoupons,
    createCoupon,
    updateCoupon,
    toggleActive,
    deleteCoupon,
    fetchUsages,
  };
};
