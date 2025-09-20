import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface FanmarkSearchResult {
  id: string;
  emoji_combination: string;
  normalized_emoji: string;
  short_id: string;
  is_premium: boolean;
  status: 'available' | 'taken' | 'premium' | 'payment_required';
  price_yen?: number;
  emoji_count?: number;
  error?: string;
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
          profiles(username, display_name)
        `)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(6);

      if (error) {
        console.error('Supabase error fetching recent fanmarks:', error);
        throw error;
      }

      if (data) {
        console.log('Fetched recent fanmarks data:', data);
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
        console.log('Recent fanmarks updated:', fanmarksWithStatus);
      }
    } catch (error) {
      console.error('Error fetching recent fanmarks:', error);
      setRecentFanmarks([]);
    }
  };

  // Normalize emoji by removing skin tone modifiers
  const normalizeEmoji = (emoji: string): string => {
    return emoji.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '');
  };

  // Validate emoji input - strict emoji-only validation
  const validateEmojiInput = (input: string): { valid: boolean; error?: string; emojiCount: number } => {
    if (!input || input.trim().length === 0) {
      return { valid: false, error: 'Emoji combination is required', emojiCount: 0 };
    }

    const cleanInput = input.replace(/\s/g, '');
    
    // Check if string contains only emojis
    const emojiRegex = /^[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\p{Emoji_Modifier_Base}\p{Emoji_Presentation}]+$/u;
    if (!emojiRegex.test(cleanInput)) {
      return { valid: false, error: 'Input must contain only emojis (no text, numbers, or symbols)', emojiCount: 0 };
    }

    // Count emoji characters - use simple array spread for better compatibility
    const emojiArray = [...cleanInput];
    const emojiCount = emojiArray.filter(char => {
      // Count characters that match emoji pattern but exclude modifiers
      return char.match(/\p{Emoji}/u) && 
             !char.match(/[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/u);
    }).length;
    
    if (emojiCount < 1 || emojiCount > 5) {
      return { valid: false, error: 'Emoji combination must contain 1-5 emojis', emojiCount };
    }

    return { valid: true, emojiCount };
  };

  // Get pricing info based on emoji count
  const getPricingInfo = (emojiCount: number): { requiresPayment: boolean; priceYen?: number } => {
    if (emojiCount === 1) {
      return { requiresPayment: true, priceYen: 500 }; // Premium price for single emoji
    } else if (emojiCount === 2) {
      return { requiresPayment: true, priceYen: 300 }; // Standard price for double emoji
    } else {
      return { requiresPayment: false }; // Free for 3+ emojis
    }
  };

  const searchFanmarks = async (query: string) => {
    setLoading(true);
    try {
      // Validate input first
      const validation = validateEmojiInput(query);
      if (!validation.valid) {
        setResult({
          id: 'invalid',
          emoji_combination: query,
          normalized_emoji: '',
          short_id: '',
          is_premium: false,
          status: 'available', // Show as available but will show error
          error: validation.error
        } as any);
        setLoading(false);
        return;
      }

      const normalizedQuery = normalizeEmoji(query);
      const pricingInfo = getPricingInfo(validation.emojiCount);

      // Check if emoji is reserved first
      const { data: reservedEmoji } = await supabase
        .from('reserved_emoji_patterns')
        .select('pattern, price_yen')
        .eq('pattern', normalizedQuery)
        .eq('is_active', true)
        .maybeSingle();

      // Check if fanmark already exists
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
        .eq('normalized_emoji', normalizedQuery)
        .eq('status', 'active')
        .maybeSingle();

      if (searchError) throw searchError;

      if (existingFanmark) {
        // Get owner profile separately
        const { data: ownerProfile } = await supabase
          .from('profiles')
          .select('username, display_name')
          .eq('user_id', existingFanmark.user_id)
          .single();

        // Fanmark is taken
        const status: 'premium' | 'taken' = existingFanmark.is_premium ? 'premium' : 'taken';
        setResult({
          ...existingFanmark,
          status,
          price_yen: reservedEmoji?.price_yen || pricingInfo.priceYen,
          owner: ownerProfile ? {
            username: ownerProfile.username,
            display_name: ownerProfile.display_name
          } : undefined
        });
      } else if (pricingInfo.requiresPayment || reservedEmoji) {
        // Fanmark requires payment
        setResult({
          id: 'payment_required',
          emoji_combination: query,
          normalized_emoji: normalizedQuery,
          short_id: '',
          is_premium: true,
          status: 'payment_required',
          price_yen: reservedEmoji?.price_yen || pricingInfo.priceYen,
          emoji_count: validation.emojiCount
        } as any);
      } else {
        // Fanmark is available and free
        setResult({
          id: 'available',
          emoji_combination: query,
          normalized_emoji: normalizedQuery,
          short_id: '',
          is_premium: false,
          status: 'available',
          emoji_count: validation.emojiCount
        } as any);
      }
    } catch (error) {
      console.error('Error searching fanmarks:', error);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const registerFanmark = async (emoji: string): Promise<{ success: boolean; error?: string; fanmark?: any }> => {
    try {
      const response = await supabase.functions.invoke('register-fanmark', {
        body: { emoji_combination: emoji }
      });

      if (response.error) {
        return { success: false, error: response.error.message };
      }

      return { success: true, fanmark: response.data.fanmark };
    } catch (error) {
      return { success: false, error: 'Registration failed' };
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
    registerFanmark,
    refetchRecent: fetchRecentFanmarks,
  };
}