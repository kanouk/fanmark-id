import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { resolveFanmarkDisplay } from '@/lib/emojiConversion';
import { useAuth } from './useAuth';
import { useInvalidateFavoriteFanmarks } from './useFavoriteFanmarks';

export interface FanmarkDetails {
  fanmark_id: string;
  user_input_fanmark: string;
  emoji_ids: string[];
  fanmark: string;
  normalized_emoji: string;
  short_id: string;
  fanmark_created_at: string;
  current_license_id?: string;
  current_owner_username?: string;
  current_owner_display_name?: string;
  current_license_start?: string;
  current_license_end?: string;
  current_license_status?: string;
  current_grace_expires_at?: string;
  current_is_returned?: boolean;
  is_currently_active: boolean;
  first_acquired_date?: string;
  first_owner_username?: string;
  first_owner_display_name?: string;
  license_history: LicenseHistoryItem[];
  is_favorited: boolean;
  has_pending_lottery?: boolean;
  is_current_owner?: boolean;
  current_owner_id?: string;
  lottery_entry_count?: number;
  has_user_lottery_entry?: boolean;
  user_lottery_entry_id?: string;
}

export interface LicenseHistoryItem {
  license_start: string;
  license_end: string;
  grace_expires_at?: string | null;
  excluded_at?: string | null;
  is_returned?: boolean;
  username?: string;
  display_name?: string;
  status: string;
  is_initial_license: boolean;
}

export const useFanmarkDetails = (shortId: string | undefined) => {
  const { user } = useAuth();
  const invalidateFavorites = useInvalidateFavoriteFanmarks();
  const [details, setDetails] = useState<FanmarkDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetails = async () => {
    if (!shortId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase.rpc('get_fanmark_details_by_short_id', {
        shortid_param: shortId
      });

      if (error) throw error;

      if (!data || data.length === 0) {
        setError('not-found');
        setDetails(null);
      } else {
        const fanmarkData = data[0];
        const emojiIds = Array.isArray(fanmarkData.emoji_ids)
          ? (fanmarkData.emoji_ids as (string | null)[]).filter((value): value is string => Boolean(value))
          : [];
        const displayFanmark = resolveFanmarkDisplay(fanmarkData.user_input_fanmark ?? '', emojiIds);

        // Determine if current user is the owner
        const isCurrentOwner = user ? user.id === fanmarkData.current_owner_id : false;
        
        // Check if current user has pending lottery (only relevant if user is owner and in grace period)
        const hasPendingLottery = isCurrentOwner && 
          fanmarkData.current_license_status === 'grace' && 
          fanmarkData.has_user_lottery_entry === true;

        setDetails({
          ...fanmarkData,
          emoji_ids: emojiIds,
          fanmark: displayFanmark,
          license_history: Array.isArray(fanmarkData.license_history)
            ? fanmarkData.license_history.map((item: any) => ({
                license_start: item.license_start,
                license_end: item.license_end,
                grace_expires_at: item.grace_expires_at ?? null,
                excluded_at: item.excluded_at ?? null,
                is_returned: item.is_returned ?? false,
                username: item.username,
                display_name: item.display_name,
                status: item.status,
                is_initial_license: item.is_initial_license
              }))
            : [],
          has_pending_lottery: hasPendingLottery,
          is_current_owner: isCurrentOwner,
        } as FanmarkDetails);
      }
    } catch (err) {
      console.error('Error fetching fanmark details:', err);
      setError('load-failed');
      setDetails(null);
    } finally {
      setLoading(false);
    }
  };

  const toggleFavorite = async () => {
    if (!details || !user) return false;
    const emojiIds = Array.isArray(details.emoji_ids) ? details.emoji_ids : [];
    if (emojiIds.length === 0) {
      console.warn('toggleFavorite skipped: missing emoji_ids');
      return details.is_favorited;
    }

    try {
      if (details.is_favorited) {
        const { data, error } = await supabase.rpc('remove_fanmark_favorite', {
          input_emoji_ids: emojiIds,
        });
        if (error) throw error;
        if (data) {
          setDetails(prev => prev ? { ...prev, is_favorited: false } : null);
          invalidateFavorites();
        }
        return false;
      } else {
        const { data, error } = await supabase.rpc('add_fanmark_favorite', {
          input_emoji_ids: emojiIds,
        });
        if (error) throw error;
        if (data) {
          setDetails(prev => prev ? { ...prev, is_favorited: true } : null);
          invalidateFavorites();
        }
        return data;
      }
    } catch (err) {
      console.error('Error toggling favorite:', err);
      return details.is_favorited;
    }
  };

  useEffect(() => {
    fetchDetails();
  }, [shortId]);

  return {
    details,
    loading,
    error,
    toggleFavorite,
    refetch: fetchDetails,
  };
};
