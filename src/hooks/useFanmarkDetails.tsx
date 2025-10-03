import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface FanmarkDetails {
  fanmark_id: string;
  emoji_combination: string;
  normalized_emoji: string;
  short_id: string;
  fanmark_created_at: string;
  current_license_id?: string;
  current_owner_username?: string;
  current_owner_display_name?: string;
  current_license_start?: string;
  current_license_end?: string;
  current_license_status?: string;
  is_currently_active: boolean;
  first_acquired_date?: string;
  first_owner_username?: string;
  first_owner_display_name?: string;
  license_history: LicenseHistoryItem[];
  is_favorited: boolean;
}

export interface LicenseHistoryItem {
  license_start: string;
  license_end: string;
  grace_expires_at?: string | null;
  excluded_at?: string | null;
  username?: string;
  display_name?: string;
  status: string;
  is_initial_license: boolean;
}

export const useFanmarkDetails = (shortId: string | undefined) => {
  const { user } = useAuth();
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
        setError('Fanmark not found');
        setDetails(null);
      } else {
        const fanmarkData = data[0];
        setDetails({
          ...fanmarkData,
          license_history: Array.isArray(fanmarkData.license_history) 
            ? fanmarkData.license_history.map((item: any) => ({
                license_start: item.license_start,
                license_end: item.license_end,
                grace_expires_at: item.grace_expires_at ?? null,
                excluded_at: item.excluded_at ?? null,
                username: item.username,
                display_name: item.display_name,
                status: item.status,
                is_initial_license: item.is_initial_license
              }))
            : []
        } as FanmarkDetails);
      }
    } catch (err) {
      console.error('Error fetching fanmark details:', err);
      setError('Failed to load fanmark details');
      setDetails(null);
    } finally {
      setLoading(false);
    }
  };

  const toggleFavorite = async () => {
    if (!details || !user) return false;

    try {
      const { data, error } = await supabase.rpc('toggle_fanmark_favorite', {
        fanmark_uuid: details.fanmark_id
      });

      if (error) throw error;

      setDetails(prev => prev ? { ...prev, is_favorited: data } : null);
      return data;
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