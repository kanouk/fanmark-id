import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface RecentFanmark {
  id: string;
  emoji: string;
  created_at: string;
}

/** Shared public data for the original ticker and the optional 3D hero. */
export function useRecentFanmarks(enabled = true) {
  return useQuery({
    queryKey: ['public-recent-fanmarks', 20],
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<RecentFanmark[]> => {
      const { data, error } = await supabase.rpc('list_recent_fanmarks', { p_limit: 20 });
      if (error) throw error;
      return (data ?? []).map(item => ({
        id: item.license_id || item.fanmark_id,
        emoji: item.display_emoji || '❓',
        created_at: item.license_created_at,
      }));
    },
  });
}
