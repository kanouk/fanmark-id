import { useState, useEffect, useCallback, useRef } from 'react';

import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from './useTranslation';
import { fetchPublicEmojiProfile, type PublicProfileThemeSettings } from '@/lib/public-access-api';
import { getOwnerFanmarkProfileContext, updateOwnerFanmarkProfile } from '@/lib/fanmark-profile-api';

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
    {
      return await fetchPublicEmojiProfile(licenseId);
    }

  } catch (error) {
    console.error('Error fetching public emoji profile:', error);
    return null;
  }
};

export const useEmojiProfile = (licenseId: string | null, fanmarkId?: string | null) => {
  const { user, loading: authLoading } = useAuth();
  const { t } = useTranslation();
  const [profile, setProfile] = useState<EmojiProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const readGeneration = useRef(0);

  const fetchProfile = useCallback(async () => {
    const generation = ++readGeneration.current;
    setProfile(null);
    setError(null);
    if (authLoading) {
      setLoading(true);
      return;
    }
    if (!user || (!fanmarkId)) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      {
        const context = await getOwnerFanmarkProfileContext(fanmarkId!);
        if (generation === readGeneration.current) setProfile(context.profile);
        return;
      }

    } catch (error) {
      console.error('Error fetching emoji profile:', error);
      if (generation === readGeneration.current) {
        setProfile(null);
        setError(error instanceof Error ? error : new Error('Profile read failed'));
      }
    } finally {
      if (generation === readGeneration.current) setLoading(false);
    }
  }, [authLoading, user, fanmarkId]);

  const updateProfile = useCallback(async (updates: EmojiProfileUpdates) => {
        if (!user || (!fanmarkId)) throw new Error(t('common.userNotAuthenticated'));

    try {
      {
        const context = await updateOwnerFanmarkProfile(fanmarkId!, updates);
        if (!context.profile) throw new Error('fanmark profile was not returned');
        setProfile(context.profile);
        return context.profile;
      }

    } catch (error) {
      console.error('Error updating emoji profile:', error);
      throw error;
    }
  }, [user, fanmarkId, t]);

  useEffect(() => {
    void fetchProfile();
    return () => { readGeneration.current += 1; };
  }, [fetchProfile]);

  return {
    profile,
    loading,
    error,
    updateProfile,
    refetch: fetchProfile,
  };
};
