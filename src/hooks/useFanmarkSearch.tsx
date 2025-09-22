import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from './useTranslation';

export interface FanmarkSearchResult {
  id: string;
  emoji_combination: string;
  normalized_emoji: string;
  short_id: string;
  is_premium: boolean;
  status: 'available' | 'taken' | 'premium' | 'payment_required' | 'invalid';
  price_yen?: number;
  price_usd?: number;
  emoji_count?: number;
  error?: string;
  owner?: {
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
  is_premium: boolean;
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
          is_premium,
          status,
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
        const fanmarksWithStatus: FanmarkSearchResult[] = data.map((fanmark) => ({
          id: fanmark.id,
          emoji_combination: fanmark.emoji_combination,
          normalized_emoji: fanmark.normalized_emoji,
          short_id: fanmark.short_id,
          is_premium: fanmark.is_premium,
          status: fanmark.is_premium ? 'premium' : 'taken',
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

  // Check pattern-based pricing using availability rules
  const checkPatternBasedPricing = async (normalizedEmoji: string, emojiCount: number): Promise<{ requiresPayment: boolean; priceUsd?: number; reason?: string; isAvailable: boolean }> => {
    try {
      // Get all active availability rules ordered by priority
      const { data: rules } = await supabase
        .from('fanmark_availability_rules')
        .select('rule_type, priority, rule_config, is_available, price_usd')
        .eq('is_available', true)
        .order('priority', { ascending: true });

      if (!rules) {
        return { requiresPayment: false, isAvailable: true };
      }

      // Check patterns in priority order (1=highest, 4=lowest)
      for (const rule of rules) {
        const config: AvailabilityRuleConfig = (rule.rule_config as AvailabilityRuleConfig) ?? {};
        
        switch (rule.rule_type) {
          case 'specific_pattern':
            if (config.patterns?.includes(normalizedEmoji)) {
              return {
                requiresPayment: true,
                priceUsd: rule.price_usd,
                reason: 'specific_pattern',
                isAvailable: rule.is_available
              };
            }
            break;

          case 'duplicate_pattern':
            if (config.enabled && hasDuplicateEmojis(normalizedEmoji)) {
              return {
                requiresPayment: true,
                priceUsd: rule.price_usd,
                reason: 'duplicate_pattern',
                isAvailable: rule.is_available
              };
            }
            break;

          case 'prefix_pattern':
            if (config.prefixes) {
              const firstEmoji = getFirstEmoji(normalizedEmoji);
              if (firstEmoji && config.prefixes[firstEmoji] !== undefined) {
                const prefixPrice = Number(config.prefixes[firstEmoji]);
                return {
                  requiresPayment: true,
                  priceUsd: Number.isNaN(prefixPrice) ? undefined : prefixPrice,
                  reason: 'prefix_pattern',
                  isAvailable: rule.is_available
                };
              }
            }
            break;

          case 'count_based': {
            const priceValue = config.pricing?.[emojiCount.toString()];
            if (priceValue !== undefined) {
              const price = typeof priceValue === 'number' ? priceValue : parseFloat(priceValue);
              return {
                requiresPayment: price > 0,
                priceUsd: price,
                reason: 'count_based',
                isAvailable: rule.is_available
              };
            }
            break;
          }
        }
      }

      return { requiresPayment: false, isAvailable: true };
    } catch (error) {
      console.error('Error checking pattern-based pricing:', error);
      return { requiresPayment: false, isAvailable: true };
    }
  };

  // Helper function to check for duplicate emojis
  const hasDuplicateEmojis = (emoji: string): boolean => {
    const emojiArray = [...emoji];
    let previousEmoji = '';
    
    for (const char of emojiArray) {
      const isEmoji = EMOJI_CHARACTER_REGEX.test(char);
      if (isEmoji && !SKIN_TONE_MODIFIER_REGEX.test(char) && !COMBINING_CHARACTERS.has(char)) {
        if (char === previousEmoji) {
          return true; // Found consecutive duplicate
        }
        previousEmoji = char;
      }
    }
    
    return false;
  };

  // Helper function to get first emoji
  const getFirstEmoji = (emoji: string): string | null => {
    const emojiArray = [...emoji];
    for (const char of emojiArray) {
      if (EMOJI_CHARACTER_REGEX.test(char) && !SKIN_TONE_MODIFIER_REGEX.test(char) && !COMBINING_CHARACTERS.has(char)) {
        return char;
      }
    }
    return null;
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
          status: 'invalid', // Set correct status for validation errors
          error: validation.error,
          emoji_count: validation.emojiCount,
        });
        setLoading(false);
        return;
      }

      const normalizedQuery = normalizeEmoji(query);
      const pricingInfo = await checkPatternBasedPricing(normalizedQuery, validation.emojiCount);

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
          .maybeSingle();

        // Fanmark is taken
        const status: 'premium' | 'taken' = existingFanmark.is_premium ? 'premium' : 'taken';
        setResult({
          id: existingFanmark.id,
          emoji_combination: existingFanmark.emoji_combination,
          normalized_emoji: existingFanmark.normalized_emoji,
          short_id: existingFanmark.short_id,
          is_premium: existingFanmark.is_premium,
          status,
          price_usd: pricingInfo.priceUsd,
          owner: ownerProfile
            ? {
                username: ownerProfile.username ?? '',
                display_name: ownerProfile.display_name ?? '',
              }
            : undefined,
        });
      } else if (!pricingInfo.isAvailable) {
        // Fanmark pattern is not available
        setResult({
          id: 'not_available',
          emoji_combination: query,
          normalized_emoji: normalizedQuery,
          short_id: '',
          is_premium: false,
          status: 'available', // Will show error message
          error: 'This emoji pattern is currently not available for registration',
          emoji_count: validation.emojiCount,
        });
      } else if (pricingInfo.requiresPayment) {
        // Fanmark requires payment
        setResult({
          id: 'payment_required',
          emoji_combination: query,
          normalized_emoji: normalizedQuery,
          short_id: '',
          is_premium: true,
          status: 'payment_required',
          price_usd: pricingInfo.priceUsd,
          emoji_count: validation.emojiCount,
        });
      } else {
        // Fanmark is available and free
        setResult({
          id: 'available',
          emoji_combination: query,
          normalized_emoji: normalizedQuery,
          short_id: '',
          is_premium: false,
          status: 'available',
          emoji_count: validation.emojiCount,
        });
      }
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
    getNormalizationInfo,
    setResult,
  };
}
