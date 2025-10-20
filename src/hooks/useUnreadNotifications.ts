import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export const useUnreadNotifications = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['unread-notification-count', user?.id],
    queryFn: async () => {
      if (!user) return 0;

      const { data, error } = await supabase.rpc('get_unread_notification_count', {
        user_id_param: user.id
      });

      if (error) {
        console.error('Error fetching unread notification count:', error);
        return 0;
      }

      return data || 0;
    },
    enabled: !!user,
    refetchInterval: 30000, // Refetch every 30 seconds
  });
};
