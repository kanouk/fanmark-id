import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { UserSettings } from '@/lib/profile-utils';
import { ownerQueryKey } from '@/lib/owner-query';
import { checkOwnUsernameAvailability, loadOwnProfile, resolveOwnProfileAuth, subscribeToOwnProfileUpdates, updateOwnProfile } from '@/lib/profile-api';

export const useProfile = () => {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ownerQueryKey('profile', userId),
    enabled: Boolean(userId),
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }): Promise<UserSettings> => {
      const auth = await resolveOwnProfileAuth(userId);
      const profile = await loadOwnProfile(auth);
      if (signal.aborted) throw new Error('Profile request cancelled');
      return profile;
    },
  });
  const profile = userId ? query.data ?? null : null;

  useEffect(() => {
    if (!userId) return;
    return subscribeToOwnProfileUpdates(updated => {
      if (updated.user_id === userId) queryClient.setQueryData(ownerQueryKey('profile', userId), updated);
    });
  }, [queryClient, userId]);

  const { refetch } = query;
  const fetchProfile = useCallback(async (_options: { silent?: boolean } = {}) => {
    if (!userId) return;
    await refetch();
  }, [refetch, userId]);

  const updateProfile = async (updates: Partial<Omit<UserSettings, 'user_id' | 'id'>>) => {
    if (!userId || !profile) return;
    if (updates.plan_type !== undefined && updates.plan_type !== profile.plan_type) throw new Error('Plan changes require the billing workflow');
    if (updates.username !== undefined && updates.username !== profile.username) throw new Error('Username changes are unavailable');
    const patch: { display_name?: string | null; avatar_url?: string | null; preferred_language?: UserSettings["preferred_language"] } = {};
    if (Object.prototype.hasOwnProperty.call(updates, 'display_name')) patch.display_name = updates.display_name ?? null;
    if (Object.prototype.hasOwnProperty.call(updates, 'avatar_url')) patch.avatar_url = updates.avatar_url ?? null;
    if (Object.prototype.hasOwnProperty.call(updates, 'preferred_language')) patch.preferred_language = updates.preferred_language;
    if (!Object.keys(patch).length) return;
    const saved = await updateOwnProfile(patch, await resolveOwnProfileAuth(userId));
    // The API checks expectedUserId and publishes the same saved row to all consumers.
    queryClient.setQueryData(ownerQueryKey('profile', userId), saved);
  };

  const checkUsernameAvailability = async (username: string): Promise<boolean> => {
    if (!username || !userId) return false;
    try { return await checkOwnUsernameAvailability(username, await resolveOwnProfileAuth(userId)); }
    catch { return false; }
  };

  return { profile, loading: Boolean(userId) && query.isPending, error: query.error, updateProfile, checkUsernameAvailability, refetch: fetchProfile };
};
