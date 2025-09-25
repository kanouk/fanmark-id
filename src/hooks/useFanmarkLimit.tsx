import { useAuth } from './useAuth';
import { useProfile } from './useProfile';
import { useSystemSettings } from './useSystemSettings';

export function useFanmarkLimit() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { settings, loading } = useSystemSettings();

  // If not authenticated, return 0
  if (!user) {
    return { limit: 0, loading };
  }

  // Plan-based limits from database settings
  const planLimits = {
    free: settings.max_fanmarks_per_user, // 3 fanmarks
    creator: settings.creator_fanmarks_limit, // 10 fanmarks  
    max: settings.max_fanmarks_limit, // 50 fanmarks
  };

  const userPlan = profile?.plan_type || 'free';
  const limit = planLimits[userPlan] || planLimits.free;

  return { limit, loading };
}