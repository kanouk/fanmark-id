import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface FanmarkSearchResult {
  id: string;
  emoji_combination: string;
  normalized_emoji: string;
  short_id: string;
  is_premium: boolean;
  status: 'available' | 'taken' | 'premium';
  owner?: {
    username: string;
    display_name: string;
  };
}

export function useFanmarkSearch() {
  const [searchQuery, setSearchQuery] = useState('');
  const [result, setResult] = useState<FanmarkSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [recentFanmarks, setRecentFanmarks] = useState<FanmarkSearchResult[]>([]);

  // Fetch recent fanmarks on mount
  useEffect(() => {
    fetchRecentFanmarks();
  }, []);

  // Search when query changes
  useEffect(() => {
    if (searchQuery.trim()) {
      searchFanmarks(searchQuery);
    } else {
      setResult(null);
    }
  }, [searchQuery]);

  const fetchRecentFanmarks = async () => {
    try {
      const { data, error } = await supabase
        .from('fanmarks')
        .select(`
          id,
          emoji_combination,
          normalized_emoji,
          short_id,
          is_premium,
          status,
          user_id,
          profiles!fanmarks_user_id_fkey(username, display_name)
        `)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(6);

      if (error) throw error;

      if (data) {
        const fanmarksWithStatus: FanmarkSearchResult[] = data.map((fanmark: any) => {
          const status: 'premium' | 'taken' = fanmark.is_premium ? 'premium' : 'taken';
          return { 
            ...fanmark, 
            status,
            owner: fanmark.profiles ? {
              username: fanmark.profiles.username,
              display_name: fanmark.profiles.display_name
            } : undefined
          };
        });
        setRecentFanmarks(fanmarksWithStatus);
      }
    } catch (error) {
      console.error('Error fetching recent fanmarks:', error);
    }
  };

  const searchFanmarks = async (query: string) => {
    setLoading(true);
    try {
      // Check if the exact query exists
      const { data: existingFanmark, error: searchError } = await supabase
        .from('fanmarks')
        .select(`
          id,
          emoji_combination,
          normalized_emoji,
          short_id,
          is_premium,
          status,
          user_id
        `)
        .eq('normalized_emoji', query)
        .eq('status', 'active')
        .maybeSingle();

      if (searchError) throw searchError;

      if (existingFanmark) {
        // Fanmark is taken
        const status: 'premium' | 'taken' = existingFanmark.is_premium ? 'premium' : 'taken';
        setResult({
          ...existingFanmark,
          status,
        });
      } else {
        // Fanmark is available
        setResult({
          id: 'available',
          emoji_combination: query,
          normalized_emoji: query,
          short_id: '',
          is_premium: false,
          status: 'available',
        });
      }
    } catch (error) {
      console.error('Error searching fanmarks:', error);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const checkAvailability = async (emoji: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from('fanmarks')
        .select('id')
        .eq('normalized_emoji', emoji)
        .eq('status', 'active')
        .maybeSingle();

      if (error) throw error;
      return !data; // Available if no data found
    } catch (error) {
      console.error('Error checking availability:', error);
      return false;
    }
  };

  return {
    searchQuery,
    setSearchQuery,
    result,
    loading,
    recentFanmarks,
    checkAvailability,
    refetchRecent: fetchRecentFanmarks,
  };
}