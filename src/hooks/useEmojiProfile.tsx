import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from './useTranslation';

export interface EmojiProfile {
  id: string;
  fanmark_id: string;
  user_id: string;
  bio?: string;
  social_links?: Record<string, any>;
  theme_settings?: Record<string, any>;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

// Public interface for emoji profile (without user_id for security)
export interface PublicEmojiProfile {
  id: string;
  fanmark_id: string;
  bio?: string;
  social_links?: any;
  theme_settings?: any;
  created_at: string;
  updated_at: string;
}

// Function to get public emoji profile data securely
export const getPublicEmojiProfile = async (fanmarkId: string): Promise<PublicEmojiProfile | null> => {
  try {
    const { data, error } = await supabase.rpc('get_public_emoji_profile', {
      profile_fanmark_id: fanmarkId
    });
    
    if (error) throw error;
    return data?.[0] || null;
  } catch (error) {
    console.error('Error fetching public emoji profile:', error);
    return null;
  }
};

export const useEmojiProfile = (fanmarkId: string) => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [profile, setProfile] = useState<EmojiProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async () => {
    if (!user || !fanmarkId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('emoji_profiles')
        .select('*')
        .eq('fanmark_id', fanmarkId)
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      setProfile(data as EmojiProfile);
    } catch (error) {
      console.error('Error fetching emoji profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateProfile = async (updates: Partial<Omit<EmojiProfile, 'id' | 'fanmark_id' | 'user_id' | 'created_at' | 'updated_at'>>) => {
    if (!user || !fanmarkId) throw new Error(t('common.userNotAuthenticated'));

    try {
      const profileData = {
        fanmark_id: fanmarkId,
        user_id: user.id,
        ...updates,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('emoji_profiles')
        .upsert(profileData, {
          onConflict: 'fanmark_id,user_id'
        })
        .select()
        .single();

      if (error) throw error;

      setProfile(data as EmojiProfile);
      return data;
    } catch (error) {
      console.error('Error updating emoji profile:', error);
      throw error;
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [user, fanmarkId]);

  return {
    profile,
    loading,
    updateProfile,
    refetch: fetchProfile,
  };
};