import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from './useTranslation';

export interface FanmarkSearchResult {
  id: string;
  emoji_combination: string;
  normalized_emoji: string;
  short_id: string;
  tier_level?: number; // Deprecated - keeping for backward compatibility
  status: 'available' | 'taken' | 'not_available' | 'invalid';
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
  tier_level?: number; // Deprecated - no longer exists in fanmarks table
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

interface CheckFanmarkAvailabilityResponse {
  available?: boolean;
  fanmark_id?: string | null;
  reason?: string | null;
  tier_level?: number | null;
  price?: number | null;
  license_days?: number | null;
}

interface FanmarkCompleteDataRow {
  id: string;
  emoji_combination: string;
  normalized_emoji: string;
  short_id: string;
  status: string;
  has_active_license: boolean;
  current_owner_id: string | null;
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
          status
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
          tier_level: 1, // Default value since removed from schema
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

  // Split text into proper grapheme clusters (complex emojis as single units)
  const splitGraphemes = (text: string): string[] => {
    if (!text) return [];
    
    // Use Intl.Segmenter for accurate grapheme cluster splitting if available
    if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
      const segmenter = new (Intl as any).Segmenter('en', { granularity: 'grapheme' });
      return Array.from(segmenter.segment(text), (segment: any) => segment.segment);
    }
    
    // Fallback: Advanced regex for complex emoji support
    const complexEmojiRegex = /\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F|\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}))*|\p{Regional_Indicator}{2}|./gu;
    return text.match(complexEmojiRegex) || [];
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

    // Count emojis using proper grapheme segmentation
    const emojiGraphemes = splitGraphemes(cleanInput);
    const emojiCount = emojiGraphemes.filter((grapheme) => {
      // Check if the grapheme contains emoji characters
      return /\p{Emoji}/u.test(grapheme);
    }).length;
    
    if (emojiCount < 1 || emojiCount > 5) {
      return { valid: false, error: t('search.emojiCountError'), emojiCount };
    }

    return { valid: true, emojiCount };
  };

   const searchFanmarks = async (query: string) => {
    setLoading(true);
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      const validation = validateEmojiInput(query);
      if (!validation.valid) {
        setResult({
          id: 'invalid',
          emoji_combination: query,
          normalized_emoji: '',
          short_id: '',
          tier_level: 1, // Default value
          status: 'invalid',
          error: validation.error,
          emoji_count: validation.emojiCount,
        });
        return;
      }
  
      const normalizedQuery = normalizeEmoji(query);
  
      const { data: availabilityRaw, error: availabilityError } = await supabase
        .rpc('check_fanmark_availability', { input_emoji: normalizedQuery } as { input_emoji: string });

      if (availabilityError) {
        console.error('Error checking availability:', availabilityError);
        throw availabilityError;
      }

      const availability = (availabilityRaw ?? null) as CheckFanmarkAvailabilityResponse | null;

      if (!availability || typeof availability.available !== 'boolean') {
        throw new Error('Failed to determine fanmark availability');
      }

      // 未登録のファンマークは即座に available 扱い
      if (!availability.fanmark_id) {
        setResult({
          id: '',
          emoji_combination: query,
          normalized_emoji: normalizedQuery,
          short_id: '',
          tier_level: 1,
          status: 'available',
          emoji_count: validation.emojiCount,
        });
        return;
      }

      const { data: fanmarkDetails, error: fanmarkDetailsError } = await supabase
        .rpc('get_fanmark_complete_data', { fanmark_id_param: availability.fanmark_id } as { fanmark_id_param: string });

      if (fanmarkDetailsError) {
        console.error('Error fetching fanmark details:', fanmarkDetailsError);
        throw fanmarkDetailsError;
      }

      const fanmarkData = Array.isArray(fanmarkDetails) && fanmarkDetails.length > 0
        ? (fanmarkDetails[0] as unknown as FanmarkCompleteDataRow)
        : null;

      if (!fanmarkData) {
        throw new Error('Failed to load fanmark details');
      }

      const currentUserId = user?.id || null;
      const isOwnedByCurrentUser = !!(currentUserId && fanmarkData.current_owner_id === currentUserId);

      // ステータスが active でないものは利用不可として扱う
      if (fanmarkData.status !== 'active') {
        setResult({
          id: fanmarkData.id,
          emoji_combination: fanmarkData.emoji_combination,
          normalized_emoji: fanmarkData.normalized_emoji,
          short_id: fanmarkData.short_id,
          tier_level: 1,
          status: 'invalid',
          error: 'This emoji pattern is not allowed or not active.',
          emoji_count: validation.emojiCount,
        });
        return;
      }

      if (!fanmarkData.has_active_license) {
        setResult({
          id: fanmarkData.id,
          emoji_combination: fanmarkData.emoji_combination,
          normalized_emoji: fanmarkData.normalized_emoji,
          short_id: fanmarkData.short_id,
          tier_level: 1,
          status: 'available',
          emoji_count: validation.emojiCount,
        });
        return;
      }

      if (isOwnedByCurrentUser) {
        setResult({
          id: fanmarkData.id,
          emoji_combination: fanmarkData.emoji_combination,
          normalized_emoji: fanmarkData.normalized_emoji,
          short_id: fanmarkData.short_id,
          tier_level: 1,
          status: 'taken',
          emoji_count: validation.emojiCount,
          owner: {
            user_id: currentUserId,
            username: '',
            display_name: '',
          },
        });
        return;
      }

      setResult({
        id: fanmarkData.id,
        emoji_combination: fanmarkData.emoji_combination,
        normalized_emoji: fanmarkData.normalized_emoji,
        short_id: fanmarkData.short_id,
        tier_level: 1,
        status: 'not_available',
        emoji_count: validation.emojiCount,
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
      const normalizedEmoji = normalizeEmoji(emoji);
      const { data: availabilityRaw, error } = await supabase
        .rpc('check_fanmark_availability', { input_emoji: normalizedEmoji } as { input_emoji: string });

      if (error) throw error;

      const availability = (availabilityRaw ?? null) as CheckFanmarkAvailabilityResponse | null;

      if (!availability || typeof availability.available !== 'boolean') {
        return false;
      }

      if (!availability.available && availability.fanmark_id) {
        // 詳細を参照して status を確認し、非アクティブ状態の場合は取得不可とする
        const { data: fanmarkDetails } = await supabase
          .rpc('get_fanmark_complete_data', { fanmark_id_param: availability.fanmark_id } as { fanmark_id_param: string });

        const fanmarkData = Array.isArray(fanmarkDetails) && fanmarkDetails.length > 0
          ? (fanmarkDetails[0] as unknown as FanmarkCompleteDataRow)
          : null;

        if (fanmarkData && fanmarkData.status !== 'active') {
          return false;
        }
      }

      return availability.available === true;
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
