import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from './useTranslation';
import {
  fetchPublicEmojiProfile,
  getPublicAccessReadBackend,
  type PublicProfileThemeSettings,
} from '@/lib/public-access-api';
import {
  getFanmarkProfileBackend,
  getOwnerFanmarkProfileContext,
  updateOwnerFanmarkProfile,
} from '@/lib/fanmark-profile-api';

export interface EmojiProfile {
  id: string;
  license_id: string;
  display_name?: string | null;
  bio?: string | null;
  social_links?: Record<string, string>;
  theme_settings?: PublicProfileThemeSettings;
  is_public?: boolean;
  created_at: string;
  updated_at: string;
}

export type EmojiProfileUpdates = Partial<Pick<
  EmojiProfile,
  'display_name' | 'bio' | 'social_links' | 'theme_settings' | 'is_public'
>>;

// Public interface for emoji profile (without user_id and id for security)
export interface PublicEmojiProfile {
  license_id: string;
  display_name?: string | null;
  bio?: string | null;
  social_links?: Record<string, string>;
  theme_settings?: PublicProfileThemeSettings;
  created_at: string;
  updated_at: string;
}

// Function to get public emoji profile data securely
export const getPublicEmojiProfile = async (licenseId: string): Promise<PublicEmojiProfile | null> => {
  try {
    if (getPublicAccessReadBackend() === 'worker') {
      return await fetchPublicEmojiProfile(licenseId);
    }

    const { data, error } = await supabase.rpc('get_public_emoji_profile', {
      profile_license_id: licenseId
    });

    if (error) throw error;

    if (!data) {
      return null;
    }

    const profileRecord = Array.isArray(data) ? data[0] : data;

    return (profileRecord ?? null) as PublicEmojiProfile | null;
  } catch (error) {
    console.error('Error fetching public emoji profile:', error);
    return null;
  }
};

// Function for owners to get their own profile (regardless of public status) - for preview purposes
export const getOwnerEmojiProfile = async (licenseId: string): Promise<EmojiProfile | null> => {
  try {
    const { data, error } = await supabase
      .from('fanmark_profiles')
      .select('*')
      .eq('license_id', licenseId)
      .maybeSingle();

    if (error) throw error;
    return data as EmojiProfile;
  } catch (error) {
    console.error('Error fetching owner emoji profile:', error);
    return null;
  }
};

export const useEmojiProfile = (licenseId: string | null, fanmarkId?: string | null) => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [profile, setProfile] = useState<EmojiProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    let backend: 'supabase' | 'worker';
    try {
      backend = getFanmarkProfileBackend();
    } catch (error) {
      console.error('Invalid fanmark profile backend configuration:', error);
      setLoading(false);
      return;
    }
    if (!user || (backend === 'worker' ? !fanmarkId : !licenseId)) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    try {
      if (backend === 'worker') {
        const context = await getOwnerFanmarkProfileContext(fanmarkId!);
        setProfile(context.profile);
        return;
      }

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
  }, [user, licenseId, fanmarkId]);

  const updateProfile = useCallback(async (updates: EmojiProfileUpdates) => {
    const backend = getFanmarkProfileBackend();
    if (!user || (backend === 'worker' ? !fanmarkId : !licenseId)) throw new Error(t('common.userNotAuthenticated'));

    try {
      if (backend === 'worker') {
        const context = await updateOwnerFanmarkProfile(fanmarkId!, updates);
        if (!context.profile) throw new Error('fanmark profile was not returned');
        setProfile(context.profile);
        return context.profile;
      }

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
  }, [user, licenseId, fanmarkId, t]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  return {
    profile,
    loading,
    updateProfile,
    refetch: fetchProfile,
  };
};
