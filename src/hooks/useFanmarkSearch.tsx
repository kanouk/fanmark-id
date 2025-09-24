import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from './useTranslation';

export interface FanmarkSearchResult {
  id: string;
  emoji_combination: string;
  normalized_emoji: string;
  short_id: string;
  tier_level?: number;
  status: 'available' | 'not_available' | 'invalid';
  price_yen?: number;
  price_usd?: number;
  emoji_count?: number;
  error?: string;
  owner?: {
    user_id: string;
    username: string;
    display_name: string;
  };
}

type FanmarkStatusRaw = 'active' | 'inactive' | 'reserved' | 'archived' | 'pending';

interface FanmarkRow {
  id: string;
  emoji_combination: string;
  normalized_emoji: string;
  short_id: string;
  tier_level?: number;
  status: FanmarkStatusRaw;
  user_id: string;
}

type AvailabilityRuleType = 'specific_pattern' | 'duplicate_pattern' | 'prefix_pattern' | 'count_based';

type AvailabilityRuleConfig = {
  patterns?: string[];
  prefixes?: Record<string, number | string>;
  pricing?: Record<string, number | string>;
  enabled?: boolean;
};

interface AvailabilityRuleRecord {
  rule_type: AvailabilityRuleType;
  priority: number;
  rule_config: AvailabilityRuleConfig | null;
  is_available: boolean;
  price_usd: number | null;
}

interface ProfileRow {
  username: string | null;
  display_name: string | null;
}

interface RegisterFanmarkResponse {
  success: boolean;
  fanmark?: FanmarkRow;
  error?: string;
}

const SKIN_TONE_MODIFIER_REGEX = /\p{Emoji_Modifier}/u;
const SKIN_TONE_MODIFIER_GLOBAL_REGEX = /\p{Emoji_Modifier}/gu;
const EMOJI_CHARACTER_REGEX = /\p{Emoji}/u;
const COMBINING_CHARACTERS = new Set([
  String.fromCodePoint(0xfe0f),
  String.fromCodePoint(0x200d),
]);

export function useFanmarkSearch() {
  const { t } = useTranslation();
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
          tier_level,
          status,
          current_license_id,
          user_id
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
        const fanmarksWithStatus: FanmarkSearchResult[] = (data as any[]).map((fanmark: any) => ({
          id: fanmark.id,
          emoji_combination: fanmark.emoji_combination,
          normalized_emoji: fanmark.normalized_emoji,
          short_id: fanmark.short_id,
          tier_level: fanmark.tier_level,
          status: 'not_available', // All recent fanmarks are already taken
          price_yen: undefined,
          price_usd: undefined,
          emoji_count: undefined,
          error: undefined,
          owner: undefined,
        }));
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
    return emoji.replace(SKIN_TONE_MODIFIER_GLOBAL_REGEX, '');
  };

  // Check if emoji has skin tone modifiers
  const hasSkinToneModifiers = (emoji: string): boolean => {
    return SKIN_TONE_MODIFIER_REGEX.test(emoji);
  };

  // Get normalization info for display
  const getNormalizationInfo = (original: string) => {
    const normalized = normalizeEmoji(original);
    return {
      original,
      normalized,
      hasSkinTones: hasSkinToneModifiers(original),
      isNormalized: original !== normalized
    };
  };

  // Validate emoji input - strict emoji-only validation
  const validateEmojiInput = (input: string): { valid: boolean; error?: string; emojiCount: number } => {
    if (!input || input.trim().length === 0) {
      return { valid: false, error: t('search.emojiRequired'), emojiCount: 0 };
    }

    const cleanInput = input.replace(/\s/g, '');
    
    // Check if string contains only emojis
    const emojiRegex = /^[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\p{Emoji_Modifier_Base}\p{Emoji_Presentation}]+$/u;
    if (!emojiRegex.test(cleanInput)) {
      return { valid: false, error: t('search.validationError'), emojiCount: 0 };
    }

    // Count emoji characters - use simple array spread for better compatibility
    const emojiArray = [...cleanInput];
    const emojiCount = emojiArray.filter((char) => {
      if (!EMOJI_CHARACTER_REGEX.test(char)) {
        return false;
      }
      if (SKIN_TONE_MODIFIER_REGEX.test(char)) {
        return false;
      }
      return !COMBINING_CHARACTERS.has(char);
    }).length;
    
    if (emojiCount < 1 || emojiCount > 5) {
      return { valid: false, error: t('search.emojiCountError'), emojiCount };
    }

    return { valid: true, emojiCount };
  };

   const searchFanmarks = async (query: string) => {
    setLoading(true);
    try {
      const validation = validateEmojiInput(query);
      if (!validation.valid) {
        setResult({
          id: 'invalid',
          emoji_combination: query,
          normalized_emoji: '',
          short_id: '',
          tier_level: undefined,
          status: 'invalid',
          error: validation.error,
          emoji_count: validation.emojiCount,
        });
        return;
      }
  
      const normalizedQuery = normalizeEmoji(query);
  
      const { data: fanmark, error: searchError } = await supabase
        .from('fanmarks')
        .select(`
          id,
          emoji_combination,
          normalized_emoji,
          short_id,
          tier_level,
          status,
          user_id,
          current_license_id
        `)
        .eq('normalized_emoji', normalizedQuery)
        .maybeSingle();
  
      if (searchError) throw searchError;
  
      // レコードなし → 登録可能
      if (!fanmark) {
        setResult({
          id: '',
          emoji_combination: query,
          normalized_emoji: normalizedQuery,
          short_id: '',
          tier_level: undefined,
          status: 'available',
          emoji_count: validation.emojiCount,
        });
        return;
      }
  
      // レコードありだが active 以外 → invalid（禁止/保留など）
      if (fanmark.status !== 'active') {
      setResult({
        id: fanmark.id,
        emoji_combination: fanmark.emoji_combination,
        normalized_emoji: fanmark.normalized_emoji,
        short_id: fanmark.short_id,
        tier_level: 1, // Default tier level since removed from fanmarks table
        status: 'invalid',
        error: 'This emoji pattern is not allowed or not active.',
        emoji_count: validation.emojiCount,
      });
        return;
      }
  
      // Check if fanmark has active license
      const { data: licenses } = await supabase
        .from('fanmark_licenses')
        .select('id, user_id, status')
        .eq('fanmark_id', fanmark.id)
        .eq('status', 'active')
        .gt('license_end', new Date().toISOString());

      const isTaken = !!licenses && licenses.length > 0;
      let ownerUserId: string | null = null;

      if (isTaken) {
        ownerUserId = 'hidden_for_privacy';
      }
  
      // For privacy protection, we no longer expose owner profile details
      // Users can only see if a fanmark is taken or available
      let ownerProfile: { username: string | null; display_name: string | null } | null = null;
  
      setResult({
        id: fanmark.id,
        emoji_combination: fanmark.emoji_combination,
        normalized_emoji: fanmark.normalized_emoji,
        short_id: fanmark.short_id,
        tier_level: 1, // Default tier level since removed from fanmarks table
        status: isTaken ? 'not_available' : 'available',
        // For privacy protection, we no longer expose owner details
        owner: undefined,
      });
    } catch (error) {
      console.error('Error searching fanmarks:', error);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };  
  
  const registerFanmark = async (emoji: string): Promise<{ success: boolean; error?: string; fanmark?: FanmarkRow }> => {
    try {
      const response = await supabase.functions.invoke<RegisterFanmarkResponse>('register-fanmark', {
        body: { input_emoji_combination: emoji }
      });

      if (response.error) {
        return { success: false, error: response.error.message };
      }

      if (response.data?.fanmark) {
        return { success: true, fanmark: response.data.fanmark };
      }
      return { success: false, error: response.data?.error ?? 'Registration failed' };
    } catch (error) {
      return { success: false, error: 'Registration failed' };
    }
  };

  const checkAvailability = async (emoji: string): Promise<boolean> => {
    try {
      const { data: fanmark, error } = await supabase
        .from('fanmarks')
        .select('id, status, current_license_id')
        .eq('normalized_emoji', emoji)
        .maybeSingle();
  
      if (error) throw error;
  
      if (!fanmark) return true;                // レコードなし → available
      if (fanmark.status !== 'active') return false; // 禁止/無効 →取得不可
      return !fanmark.current_license_id;       // 空きなら取得可
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
    getNormalizationInfo,
    setResult,
  };
}
