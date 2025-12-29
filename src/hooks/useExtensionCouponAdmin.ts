import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
      const { data, error: fetchError } = await supabase
        .from('extension_coupons')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      setCoupons((data as ExtensionCouponRow[]) || []);
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
      const code = values.code?.trim().toUpperCase() || generateCouponCode();
      
      const { error: insertError } = await supabase
        .from('extension_coupons')
        .insert({
          code,
          months: values.months,
          allowed_tier_levels: values.allowedTierLevels && values.allowedTierLevels.length > 0 ? values.allowedTierLevels : null,
          max_uses: values.maxUses,
          expires_at: values.expiresAt || null,
        });

      if (insertError) throw insertError;

      await fetchCoupons();
      return { success: true, code };
    } catch (err) {
      console.error('Failed to create extension coupon:', err);
      return { success: false, error: err instanceof Error ? err : new Error('Unknown error') };
    }
  };

  const updateCoupon = async (id: string, updates: Partial<ExtensionCouponRow>): Promise<{ success: boolean; error?: Error }> => {
    try {
      const { error: updateError } = await supabase
        .from('extension_coupons')
        .update(updates)
        .eq('id', id);

      if (updateError) throw updateError;

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
      const { error: deleteError } = await supabase
        .from('extension_coupons')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      await fetchCoupons();
      return { success: true };
    } catch (err) {
      console.error('Failed to delete extension coupon:', err);
      return { success: false, error: err instanceof Error ? err : new Error('Unknown error') };
    }
  };

  const fetchUsages = async (couponId: string): Promise<{ success: boolean; data?: ExtensionCouponUsageRow[]; error?: Error }> => {
    try {
      const { data, error: fetchError } = await supabase
        .from('extension_coupon_usages')
        .select(`
          id,
          coupon_id,
          user_id,
          fanmark_id,
          license_id,
          used_at
        `)
        .eq('coupon_id', couponId)
        .order('used_at', { ascending: false });

      if (fetchError) throw fetchError;

      // Fetch fanmark emojis and user display names separately
      const usages = data || [];
      const enrichedUsages: ExtensionCouponUsageRow[] = [];

      for (const usage of usages) {
        let fanmarkEmoji = '';
        let userDisplayName = '';

        // Fetch fanmark emoji
        const { data: fanmarkData } = await supabase
          .from('fanmarks')
          .select('user_input_fanmark')
          .eq('id', usage.fanmark_id)
          .maybeSingle();

        if (fanmarkData) {
          fanmarkEmoji = fanmarkData.user_input_fanmark;
        }

        // Fetch user display name
        const { data: userData } = await supabase
          .from('user_settings')
          .select('display_name, username')
          .eq('user_id', usage.user_id)
          .maybeSingle();

        if (userData) {
          userDisplayName = userData.display_name || userData.username || '';
        }

        enrichedUsages.push({
          ...usage,
          fanmark_emoji: fanmarkEmoji,
          user_display_name: userDisplayName,
        });
      }

      return { success: true, data: enrichedUsages };
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

function generateCouponCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'EXT';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
