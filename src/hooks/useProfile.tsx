import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';

import { UserSettings } from '@/lib/profile-utils';
import { checkOwnUsernameAvailability as checkWorkerUsernameAvailability, loadOwnProfile, resolveOwnProfileAuth, subscribeToOwnProfileUpdates, updateOwnProfile } from '@/lib/profile-api';

export const useProfile = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (options: { silent?: boolean } = {}) => {
    try {
      if (!options.silent) setLoading(true);
      {
        const auth = await resolveOwnProfileAuth(user?.id);
        const result = await loadOwnProfile(auth);
        setProfile(result as UserSettings);
        return;
      }

    } catch (error) {
      console.error('[useProfile] Error fetching profile:', {
        message: error instanceof Error ? error.message : String(error),
        userId: user?.id ?? null,
      });
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchProfile();
    } else {
      setProfile(null);
      setLoading(false);
    }
  }, [user, fetchProfile]);

  // Realtime subscription to keep profile in sync across the app

  // Profile consumers share local update events and
  // a quiet refresh when this tab/window becomes active again.
  useEffect(() => {
    if (!user) return;

    const unsubscribe = subscribeToOwnProfileUpdates((updated) => {
      if (updated.user_id === user.id) setProfile(updated as UserSettings);
    });
    let lastRefreshAt = 0;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastRefreshAt < 1_500) return;
      lastRefreshAt = now;
      void fetchProfile({ silent: true });
    };

    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [user, fetchProfile]);

  const updateProfile = async (updates: Partial<Omit<UserSettings, 'user_id' | 'id'>>) => {
    if (!user || !profile) return;

    try {
      {
        if (updates.plan_type !== undefined && updates.plan_type !== profile.plan_type) {
          throw new Error('Plan changes require the billing workflow');
        }
        if (updates.username !== undefined && updates.username !== profile.username) {
          throw new Error('Username changes are unavailable');
        }
        const patch: { display_name?: string | null; avatar_url?: string | null; preferred_language?: string } = {};
        if (Object.prototype.hasOwnProperty.call(updates, 'display_name')) patch.display_name = updates.display_name ?? null;
        if (Object.prototype.hasOwnProperty.call(updates, 'avatar_url')) patch.avatar_url = updates.avatar_url ?? null;
        if (Object.prototype.hasOwnProperty.call(updates, 'preferred_language')) patch.preferred_language = updates.preferred_language;
        if (Object.keys(patch).length === 0) return;
        const auth = await resolveOwnProfileAuth(user.id);
        const saved = await updateOwnProfile(patch, auth);
        setProfile(saved as UserSettings);
        return;
      }

      // Update local state

    } catch (error) {
      console.error('Error updating profile:', error);
      throw error;
    }
  };

  const checkUsernameAvailability = async (username: string): Promise<boolean> => {
    if (!username) return false;

    try {
      {
        const auth = await resolveOwnProfileAuth(user?.id);
        return await checkWorkerUsernameAvailability(username, auth);
      }

    } catch (error) {
      console.error('Error checking username:', error);
      return false;
    }
  };

  return {
    profile,
    loading,
    updateProfile,
    checkUsernameAvailability,
    refetch: fetchProfile
  };
};
