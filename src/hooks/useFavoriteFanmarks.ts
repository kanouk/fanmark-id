import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const FAVORITE_FANMARKS_QUERY_KEY = ['favoriteFanmarks'];

export interface FavoriteFanmark {
  favoriteId: string;
  discoveryId: string;
  favoritedAt: string;
  fanmarkId: string | null;
  emojiIds: string[];
  fanmark: string;
  normalizedEmojiIds: string[];
  sequenceKey: string;
  availabilityStatus: string;
  searchCount: number;
  favoriteCount: number;
  shortId: string | null;
  fanmarkName: string | null;
  accessType: string | null;
  currentLicenseStatus: string | null;
  currentLicenseStart: string | null;
  currentLicenseEnd: string | null;
  currentOwnerUsername: string | null;
  currentOwnerDisplayName: string | null;
  targetUrl: string | null;
  textContent: string | null;
  isPasswordProtected: boolean;
}

const fetchFavoriteFanmarks = async (): Promise<FavoriteFanmark[]> => {
  const { data, error } = await supabase.rpc('get_favorite_fanmarks');

  if (error) {
    console.error('Failed to load favorite fanmarks:', error);
    throw error;
  }

  if (!data) {
    return [];
  }

  return data.map((item) => {
    const rawEmojiIds = Array.isArray(item.emoji_ids)
      ? (item.emoji_ids as (string | null)[]).filter((value): value is string => Boolean(value))
      : [];
    const normalizedIds = Array.isArray(item.normalized_emoji_ids)
      ? (item.normalized_emoji_ids as (string | null)[]).filter((value): value is string => Boolean(value))
      : [];
    const displayFanmark = item.display_fanmark ?? '';

    return {
      favoriteId: item.favorite_id,
      discoveryId: item.discovery_id,
      favoritedAt: item.favorited_at,
      fanmarkId: item.fanmark_id,
      emojiIds: rawEmojiIds,
      fanmark: displayFanmark,
      normalizedEmojiIds: normalizedIds,
      sequenceKey: item.sequence_key,
      availabilityStatus: item.availability_status,
      searchCount: item.search_count,
      favoriteCount: item.favorite_count,
      shortId: item.short_id,
      fanmarkName: item.fanmark_name,
      accessType: item.access_type,
      currentLicenseStatus: item.current_license_status,
      currentLicenseStart: item.current_license_start,
      currentLicenseEnd: item.current_license_end,
      currentOwnerUsername: item.current_owner_username,
      currentOwnerDisplayName: item.current_owner_display_name,
      targetUrl: item.target_url,
      textContent: item.text_content,
      isPasswordProtected: item.is_password_protected,
    };
  });
};

export interface UseFavoriteFanmarksOptions {
  enabled?: boolean;
}

export const useFavoriteFanmarks = (options?: UseFavoriteFanmarksOptions) => {
  const query = useQuery({
    queryKey: FAVORITE_FANMARKS_QUERY_KEY,
    queryFn: fetchFavoriteFanmarks,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  });

  const count = useMemo(() => (query.data ? query.data.length : 0), [query.data]);

  return {
    ...query,
    favorites: query.data ?? [],
    count,
  };
};

export const useInvalidateFavoriteFanmarks = () => {
  const queryClient = useQueryClient();

  return () => queryClient.invalidateQueries({ queryKey: FAVORITE_FANMARKS_QUERY_KEY });
};
