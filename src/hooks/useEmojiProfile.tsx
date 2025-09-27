import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from './useTranslation';

export interface EmojiProfile {
  id: string;
  license_id: string;
  display_name?: string;
  bio?: string;
  social_links?: Record<string, any>;
  theme_settings?: Record<string, any>;
  is_public?: boolean;
  created_at: string;
  updated_at: string;
}

// Public interface for emoji profile (without user_id and id for security)
export interface PublicEmojiProfile {
  license_id: string;
  display_name?: string;
  bio?: string;
  social_links?: any;
  theme_settings?: any;
  created_at: string;
  updated_at: string;
}

// Function to get public emoji profile data securely
export const getPublicEmojiProfile = async (licenseId: string): Promise<PublicEmojiProfile | null> => {
  try {
    const { data, error } = await supabase.rpc('get_public_emoji_profile', {
      profile_license_id: licenseId
    });
    
    if (error) throw error;
    return (data as unknown) as PublicEmojiProfile || null;
  } catch (error) {
    console.error('Error fetching public emoji profile:', error);
    return null;
  }
};

export const useEmojiProfile = (licenseId: string) => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [profile, setProfile] = useState<EmojiProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async () => {
    if (!user || !licenseId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('fanmark_profiles')
        .select('*')
        .eq('license_id', licenseId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching emoji profile:', error);
        throw error;
      }

      setProfile(data as EmojiProfile);
    } catch (error) {
      console.error('Error fetching emoji profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateProfile = async (updates: Partial<Omit<EmojiProfile, 'id' | 'license_id' | 'created_at' | 'updated_at'>>) => {
    if (!user || !licenseId) throw new Error(t('common.userNotAuthenticated'));

    try {
      const profileData = {
        license_id: licenseId,
        ...updates,
        updated_at: new Date().toISOString(),
      };

      console.log('Updating emoji profile with data:', profileData);

      const { data, error } = await supabase
        .from('fanmark_profiles')
        .upsert(profileData, {
          onConflict: 'license_id'
        })
        .select()
        .single();

      if (error) {
        console.error('Error updating emoji profile:', error);
        throw error;
      }

      console.log('Successfully updated emoji profile:', data);

      setProfile(data as EmojiProfile);
      return data;
    } catch (error) {
      console.error('Error updating emoji profile:', error);
      throw error;
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [user, licenseId]);

  return {
    profile,
    loading,
    updateProfile,
    refetch: fetchProfile,
  };
};