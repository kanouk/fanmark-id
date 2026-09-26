import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { UserSettings } from '@/lib/profile-utils';
import { checkOwnUsernameAvailability as checkWorkerUsernameAvailability, getOwnProfileBackend, loadOwnProfile, updateOwnProfile } from '@/lib/profile-api';

export const useProfile = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      if (getOwnProfileBackend() === 'worker') {
        const result = await loadOwnProfile();
        setProfile(result as UserSettings);
        return;
      }
      console.info('[useProfile] fetching profile', {
        userId: user?.id ?? null,
      });
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user?.id)
        .single();

      if (error) throw error;
      console.info('[useProfile] profile fetch success', {
        userId: data.user_id,
        planType: data.plan_type,
      });
      setProfile(data as UserSettings);
    } catch (error) {
      console.error('[useProfile] Error fetching profile:', {
        message: error instanceof Error ? error.message : String(error),
        userId: user?.id ?? null,
      });
    } finally {
      setLoading(false);
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
  useEffect(() => {
    if (!user || getOwnProfileBackend() === 'worker') return;

    const channel = supabase
      .channel('user-settings-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'user_settings', filter: `user_id=eq.${user.id}` },
        (payload) => {
          setProfile(payload.new as UserSettings);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const updateProfile = async (updates: Partial<Omit<UserSettings, 'user_id' | 'id'>>) => {
    if (!user || !profile) return;

    try {
      if (getOwnProfileBackend() === 'worker') {
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
        const saved = await updateOwnProfile(patch);
        setProfile(saved as UserSettings);
        return;
      }
      const { error } = await supabase
        .from('user_settings')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);

      if (error) throw error;
      
      // Update local state
      setProfile(prev => prev ? { ...prev, ...updates } : null);
    } catch (error) {
      console.error('Error updating profile:', error);
      throw error;
    }
  };

  const checkUsernameAvailability = async (username: string): Promise<boolean> => {
    if (!username) return false;
    
    try {
      if (getOwnProfileBackend() === 'worker') {
        return await checkWorkerUsernameAvailability(username);
      }
      const { data, error } = await supabase.rpc('check_username_availability_secure', {
        username_to_check: username,
        current_user_id: user?.id || null
      });

      if (error) throw error;
      return data === true;
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
