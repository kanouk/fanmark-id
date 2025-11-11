import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { UserSettings } from '@/lib/profile-utils';

export const useProfile = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchProfile();
    } else {
      setProfile(null);
      setLoading(false);
    }
  }, [user]);

  // Realtime subscription to keep profile in sync across the app
  useEffect(() => {
    if (!user) return;

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

  const fetchProfile = async () => {
    try {
      setLoading(true);
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
  };

  const updateProfile = async (updates: Partial<Omit<UserSettings, 'user_id' | 'id'>>) => {
    if (!user || !profile) return;

    try {
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
