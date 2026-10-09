import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useFavoriteFanmarks, useInvalidateFavoriteFanmarks } from './useFavoriteFanmarks';
import { getFavoritesBackend } from '@/lib/favorites-api';
import { addFavoriteFanmark, removeFavoriteFanmark } from '@/lib/favorites-backend';
import { convertEmojiSequenceToIdPair } from '@/lib/emojiConversion';
import { fetchFanmarkDetailsFromWorker, FanmarkDetailsApiError, getFanmarkDetailsBackend } from '@/lib/fanmark-details-api';

export interface FanmarkDetails {
  fanmark_id: string;
  user_input_fanmark: string;
  display_fanmark: string;
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
  history_available: boolean;
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
  const { user, loading: authLoading } = useAuth();
  const workerDetailsEnabled = getFanmarkDetailsBackend() === 'worker';
  const invalidateFavorites = useInvalidateFavoriteFanmarks();
  const workerFavoritesEnabled = getFavoritesBackend() === 'worker';
  const { favorites, isLoading: favoritesLoading, isError: favoritesError } = useFavoriteFanmarks({
    enabled: Boolean(user) && workerFavoritesEnabled,
  });
  const [details, setDetails] = useState<FanmarkDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailsSourceKey, setDetailsSourceKey] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const fetchDetails = useCallback(async () => {
    const requestId = ++requestSequence.current;
    const sourceKey = `${shortId ?? ''}:${user?.id ?? 'anonymous'}`;
    if (!shortId) {
      setLoading(false);
      return;
    }

    if (workerDetailsEnabled && authLoading) return;

    setLoading(true);
    setError(null);

    try {
      if (workerDetailsEnabled) {
        const data = await fetchFanmarkDetailsFromWorker(shortId);
        if (requestId !== requestSequence.current) return;
        setDetailsSourceKey(sourceKey);
        if (!data) {
          setError('not-found');
          setDetails(null);
        } else {
          setDetails(data as unknown as FanmarkDetails);
        }
      } else {
        const { data, error } = await supabase.rpc('get_fanmark_details_by_short_id', {
          shortid_param: shortId
        });
        if (requestId !== requestSequence.current) return;
        if (error) throw error;
        if (!data || data.length === 0) {
          setError('not-found');
          setDetails(null);
        } else {
        const fanmarkData = data[0];
        const emojiIds = Array.isArray(fanmarkData.emoji_ids)
          ? (fanmarkData.emoji_ids as (string | null)[]).filter((value): value is string => Boolean(value))
          : [];
        const displayFanmark = fanmarkData.display_fanmark ?? '';
        const normalizedDisplay = fanmarkData.normalized_emoji ?? '';

        // Determine if current user is the owner
        const isCurrentOwner = user ? user.id === fanmarkData.current_owner_id : false;
        
        // Check if current user has pending lottery (only relevant if user is owner and in grace period)
        const hasPendingLottery = isCurrentOwner && 
          fanmarkData.current_license_status === 'grace' && 
          fanmarkData.has_user_lottery_entry === true;

        setDetails({
          ...fanmarkData,
          emoji_ids: emojiIds,
          display_fanmark: displayFanmark,
          fanmark: normalizedDisplay,
          license_history: Array.isArray(fanmarkData.license_history)
            ? (fanmarkData.license_history as unknown as LicenseHistoryItem[]).map((item) => ({
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
          history_available: true,
          has_pending_lottery: hasPendingLottery,
          is_current_owner: isCurrentOwner,
        } as FanmarkDetails);
        }
      }
    } catch (err) {
      if (requestId !== requestSequence.current) return;
      if (workerDetailsEnabled && err instanceof FanmarkDetailsApiError && err.kind === 'auth_required') {
        setError('sign-in-required');
        setDetails(null);
        setDetailsSourceKey(sourceKey);
        return;
      }
      console.error('Error fetching fanmark details:', err);
      setError('load-failed');
      setDetails(null);
      if (workerDetailsEnabled) setDetailsSourceKey(sourceKey);
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [authLoading, shortId, user, workerDetailsEnabled]);

  const toggleFavorite = async () => {
    if (!details || !user) return false;
    const emojiIds = Array.isArray(details.emoji_ids) ? details.emoji_ids : [];
    if (emojiIds.length === 0) {
      console.warn('toggleFavorite skipped: missing emoji_ids');
      return details.is_favorited;
    }

    try {
      if (details.is_favorited) {
        const removed = await removeFavoriteFanmark(emojiIds);
        if (removed) {
          setDetails(prev => prev ? { ...prev, is_favorited: false } : null);
          invalidateFavorites();
        }
        return false;
      } else {
        const added = await addFavoriteFanmark(emojiIds, details.display_fanmark);
        if (added) {
          setDetails(prev => prev ? { ...prev, is_favorited: true } : null);
          invalidateFavorites();
        }
        return added;
      }
    } catch (err) {
      console.error('Error toggling favorite:', err);
      return details.is_favorited;
    }
  };

  useEffect(() => {
    if (!workerFavoritesEnabled || !user || !details || favoritesLoading || favoritesError) return;
    const normalizedIds = convertEmojiSequenceToIdPair(details.normalized_emoji || details.display_fanmark).normalizedEmojiIds;
    if (normalizedIds.length === 0) return;
    const normalizedKey = normalizedIds.join(',');
    const isFavorited = favorites.some((favorite) => favorite.normalizedEmojiIds.join(',') === normalizedKey);
    setDetails((current) => current && current.is_favorited !== isFavorited ? { ...current, is_favorited: isFavorited } : current);
  }, [details, favorites, favoritesError, favoritesLoading, user, workerFavoritesEnabled]);

  useEffect(() => {
    void fetchDetails();
  }, [fetchDetails]);

  return {
    details,
    loading: loading || (workerDetailsEnabled && (authLoading || detailsSourceKey !== `${shortId ?? ''}:${user?.id ?? 'anonymous'}`)),
    error,
    toggleFavorite,
    refetch: fetchDetails,
  };
};
