import { useAuth } from './useAuth';
import { useProfile } from './useProfile';
import { useSystemSettings } from './useSystemSettings';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function useFanmarkLimit() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { settings, loading } = useSystemSettings();
  const [enterpriseSettings, setEnterpriseSettings] = useState<{ custom_fanmarks_limit?: number } | null>(null);
  const [enterpriseLoading, setEnterpriseLoading] = useState(false);

  // Note: enterprise plan has been removed
  useEffect(() => {
    // No longer checking for enterprise plan
  }, [profile?.plan_type, user]);

  // If not authenticated, return 0
  if (!user) {
    return { limit: 0, loading };
  }

  const userPlan = profile?.plan_type || 'free';

  // Calculate limit based on plan type
  let limit = 0;
  
  if (userPlan === 'admin') {
    limit = -1; // Unlimited for admin
  } else {
    // Plan-based limits from database settings
    const planLimits = {
      free: settings.max_fanmarks_per_user, // 3 fanmarks
      creator: settings.creator_fanmarks_limit, // 10 fanmarks  
      business: settings.business_fanmarks_limit, // 50 fanmarks
      enterprise: settings.enterprise_fanmarks_limit, // 100 fanmarks
      max: settings.max_fanmarks_limit, // 50 fanmarks (legacy)
    };
    limit = planLimits[userPlan as keyof typeof planLimits] || planLimits.free;
  }

  return { 
    limit, 
    loading: loading || enterpriseLoading,
    isUnlimited: limit === -1
  };
}