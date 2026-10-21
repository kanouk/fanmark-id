import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/hooks/useAuth';
import { loadOwnUnreadNotificationCount } from '@/lib/notifications-api';

export const useUnreadNotifications = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['unread-notification-count', user?.id],
    queryFn: async () => {
      if (!user) return 0;

      {
        return loadOwnUnreadNotificationCount();
      }

    },
    enabled: !!user,
    refetchInterval: 30000, // Refetch every 30 seconds
  });
};
