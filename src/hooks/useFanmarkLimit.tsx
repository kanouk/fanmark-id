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

  // Fetch enterprise settings if user has enterprise plan
  useEffect(() => {
    if (profile?.plan_type === 'enterprise' && user) {
      setEnterpriseLoading(true);
      supabase
        .from('enterprise_user_settings')
        .select('custom_fanmarks_limit')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!error) {
            setEnterpriseSettings(data);
          }
          setEnterpriseLoading(false);
        });
    }
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
  } else if (userPlan === 'enterprise') {
    limit = enterpriseSettings?.custom_fanmarks_limit || settings.enterprise_fanmarks_limit;
  } else {
    // Plan-based limits from database settings
    const planLimits = {
      free: settings.max_fanmarks_per_user, // 3 fanmarks
      creator: settings.creator_fanmarks_limit, // 10 fanmarks  
      business: settings.business_fanmarks_limit, // 50 fanmarks
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