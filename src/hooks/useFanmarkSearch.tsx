import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from './useTranslation';
import {
  canonicalizeEmojiString,
  convertEmojiSequenceToIdPair,
  resolveFanmarkDisplay,
  segmentEmojiSequence,
  stripSkinToneModifiers,
} from '@/lib/emojiConversion';

export interface FanmarkSearchResult {
  id: string;
  user_input_fanmark: string;
  fanmark?: string;
  emoji_ids?: string[];
  normalized_emoji: string;
  normalized_emoji_ids?: string[];
  short_id: string;
  tier_level?: number; // Deprecated - keeping for backward compatibility
  tier_display_name?: string | null;
  license_days?: number | null;
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
  available_at?: string | null;
  blocking_status?: string | null;
  is_blocked_for_registration?: boolean;
  lottery_entry_count?: number;
  has_user_lottery_entry?: boolean;
  user_lottery_entry_id?: string;
}

type FanmarkStatusRaw = 'active' | 'inactive' | 'reserved' | 'archived' | 'pending';

interface FanmarkRow {
  id: string;
  user_input_fanmark: string;
  emoji_ids?: string[];
  fanmark?: string;
  normalized_emoji: string;
  normalized_emoji_ids?: string[];
  short_id: string;
  tier_level?: number; // Deprecated - no longer exists in fanmarks table
  tier_display_name?: string | null;
  initial_license_days?: number | null;
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
  tier_level?: number;
  error?: string;
}

interface CheckFanmarkAvailabilityResponse {
  available?: boolean;
  fanmark_id?: string | null;
  reason?: string | null;
  tier_level?: number | null;
  tier_display_name?: string | null;
  price?: number | null;
  license_days?: number | null;
  available_at?: string | null;
  blocking_status?: string | null;
  lottery_entry_count?: number;
  has_user_lottery_entry?: boolean;
  user_lottery_entry_id?: string;
}

interface FanmarkCompleteDataRow {
  id: string;
  user_input_fanmark: string;
  emoji_ids?: string[];
  normalized_emoji: string;
  short_id: string;
  tier_level?: number;
  status: string;
  has_active_license: boolean;
  current_owner_id: string | null;
  current_license_status: string | null;
  current_grace_expires_at: string | null;
  is_blocked_for_registration: boolean;
  next_available_at: string | null;
  lottery_entry_count?: number;
  has_user_lottery_entry?: boolean;
  user_lottery_entry_id?: string;
}

const SKIN_TONE_MODIFIER_REGEX = /\p{Emoji_Modifier}/u;
const EMOJI_CHARACTER_REGEX = /\p{Emoji}/u;
const COMBINING_CHARACTERS = new Set([
  String.fromCodePoint(0xfe0f),
  String.fromCodePoint(0x200d),
]);

const MAX_QUERY_LENGTH = 5;

type UseFanmarkSearchOptions = {
  searchQuery: string;
  onSearchCompleted?: (query: string) => void;
};

export function useFanmarkSearch({ searchQuery, onSearchCompleted }: UseFanmarkSearchOptions) {
  const { t } = useTranslation();
  const [result, setResult] = useState<FanmarkSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [recentFanmarks, setRecentFanmarks] = useState<FanmarkSearchResult[]>([]);

  const normalizedQuery = useMemo(() => {
    const canonical = canonicalizeEmojiString(searchQuery);
    const limited = segmentEmojiSequence(canonical).slice(0, MAX_QUERY_LENGTH).join('');
    return limited.trim();
  }, [searchQuery]);

  // Fetch recent fanmarks on mount
  useEffect(() => {
    fetchRecentFanmarks();
  }, []);

  // Search when query changes
  useEffect(() => {
    if (normalizedQuery) {
      searchFanmarks(normalizedQuery);
    } else {
      setResult(null);
    }
  }, [normalizedQuery]);

  const fetchRecentFanmarks = async () => {
    try {
      const { data, error } = await supabase
        .from('fanmarks')
        .select(`
          id,
          user_input_fanmark,
          emoji_ids,
          normalized_emoji_ids,
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
        const fanmarksWithStatus: FanmarkSearchResult[] = (data as any[]).map((fanmark: any) => {
          const ids = Array.isArray(fanmark.emoji_ids)
            ? (fanmark.emoji_ids as (string | null)[]).filter((value): value is string => Boolean(value))
            : [];
          return {
            id: fanmark.id,
            user_input_fanmark: fanmark.user_input_fanmark,
            fanmark: resolveFanmarkDisplay(fanmark.user_input_fanmark, ids),
            emoji_ids: ids,
            normalized_emoji_ids: Array.isArray(fanmark.normalized_emoji_ids)
              ? (fanmark.normalized_emoji_ids as (string | null)[]).filter((value): value is string => Boolean(value))
              : [],
            normalized_emoji: fanmark.normalized_emoji,
            short_id: fanmark.short_id,
            tier_level: 1, // Default value since removed from schema
            status: 'not_available', // All recent fanmarks are already taken
            price_yen: undefined,
            price_usd: undefined,
            emoji_count: undefined,
            error: undefined,
            owner: undefined,
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
  const normalizeEmoji = (emoji: string): string => stripSkinToneModifiers(emoji);

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
  const validateEmojiInput = (
    input: string,
  ): { valid: boolean; error?: string; emojiCount: number; pair?: { emojiIds: string[]; normalizedEmojiIds: string[] } } => {
    if (!input || input.trim().length === 0) {
      return { valid: false, error: t('search.emojiRequired'), emojiCount: 0 };
    }

    const cleanInput = canonicalizeEmojiString(input);

    try {
      const pair = convertEmojiSequenceToIdPair(cleanInput);
      const emojiCount = pair.emojiIds.length;
      if (emojiCount < 1 || emojiCount > 5) {
        return { valid: false, error: t('search.emojiCountError'), emojiCount };
      }
      if (process.env.NODE_ENV === 'development') {
        console.log('[useFanmarkSearch.validateEmojiInput] canonical', {
          input,
          canonical: cleanInput,
          emojiIds: pair.emojiIds,
          normalizedEmojiIds: pair.normalizedEmojiIds,
        });
      }
      return { valid: true, emojiCount, pair };
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : t('search.validationError');
      return { valid: false, error: message, emojiCount: 0 };
    }
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
          user_input_fanmark: query,
          fanmark: query,
          normalized_emoji: '',
          short_id: '',
          tier_level: 1, // Default value
          status: 'invalid',
          error: validation.error,
          emoji_count: validation.emojiCount,
        });
        return;
      }
 
      const compactQuery = canonicalizeEmojiString(query);
      const normalizedQuery = normalizeEmoji(compactQuery);
      const pair = validation.pair;
      if (!pair) {
        throw new Error('emoji conversion pair missing');
      }

      const emojiIds = pair.emojiIds;
      const normalizedEmojiIds = pair.normalizedEmojiIds;

      const { data: availabilityRaw, error: availabilityError } = await supabase
        .rpc('check_fanmark_availability', { input_emoji_ids: normalizedEmojiIds } as { input_emoji_ids: string[] });

      if (availabilityError) {
        console.error('Error checking availability:', availabilityError);
        throw availabilityError;
      }

      const availability = (availabilityRaw ?? null) as CheckFanmarkAvailabilityResponse | null;

      if (!availability || typeof availability.available !== 'boolean') {
        throw new Error('Failed to determine fanmark availability');
      }

      const availabilityTierLevel = availability.tier_level ?? null;
      const availabilityTierDisplayName = availability.tier_display_name ?? undefined;

      onSearchCompleted?.(normalizedQuery);

      try {
        await supabase.rpc('record_fanmark_search', { input_emoji_ids: emojiIds });
      } catch (searchRecordError) {
        console.warn('Failed to record fanmark search:', searchRecordError);
      }

      // 未登録のファンマークは即座に available 扱い
      if (!availability.fanmark_id) {
        const derivedTierLevel = availabilityTierLevel ?? 1;
        setResult({
          id: '',
          user_input_fanmark: query,
          fanmark: resolveFanmarkDisplay(query, emojiIds),
          emoji_ids: emojiIds,
          normalized_emoji_ids: normalizedEmojiIds,
          normalized_emoji: normalizedQuery,
          short_id: '',
          tier_level: derivedTierLevel,
          tier_display_name: availabilityTierDisplayName,
          status: 'available',
          emoji_count: validation.emojiCount,
          license_days: availability.license_days ?? undefined,
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
      const ownerInfo = fanmarkData.current_owner_id
        ? {
            user_id: fanmarkData.current_owner_id,
            username: '',
            display_name: '',
          }
        : undefined;
      const blockingStatus = fanmarkData.current_license_status ?? availability.blocking_status ?? null;
      const nextAvailableAt = fanmarkData.next_available_at ?? availability.available_at ?? null;
      const isBlockedForRegistration = fanmarkData.is_blocked_for_registration === true;

      // ステータスが active でないものは利用不可として扱う
      if (fanmarkData.status !== 'active') {
        setResult({
          id: fanmarkData.id,
          user_input_fanmark: fanmarkData.user_input_fanmark,
          fanmark: resolveFanmarkDisplay(fanmarkData.user_input_fanmark, fanmarkData.emoji_ids),
          emoji_ids: fanmarkData.emoji_ids,
          normalized_emoji_ids: normalizedEmojiIds,
          normalized_emoji: fanmarkData.normalized_emoji,
          short_id: fanmarkData.short_id,
          tier_level: fanmarkData.tier_level ?? availabilityTierLevel ?? 1,
          tier_display_name: availabilityTierDisplayName,
          status: 'invalid',
          error: 'This emoji pattern is not allowed or not active.',
          emoji_count: validation.emojiCount,
          available_at: nextAvailableAt,
          blocking_status: blockingStatus,
          is_blocked_for_registration: isBlockedForRegistration,
        });
        return;
      }

      if (isBlockedForRegistration) {
        setResult({
          id: fanmarkData.id,
          user_input_fanmark: fanmarkData.user_input_fanmark,
          fanmark: resolveFanmarkDisplay(fanmarkData.user_input_fanmark, fanmarkData.emoji_ids),
          emoji_ids: fanmarkData.emoji_ids,
          normalized_emoji_ids: normalizedEmojiIds,
          normalized_emoji: fanmarkData.normalized_emoji,
          short_id: fanmarkData.short_id,
          tier_level: fanmarkData.tier_level ?? availabilityTierLevel ?? 1,
          tier_display_name: availabilityTierDisplayName,
          status: 'not_available',
          emoji_count: validation.emojiCount,
          owner: ownerInfo,
          available_at: nextAvailableAt,
          blocking_status: blockingStatus,
          is_blocked_for_registration: true,
          lottery_entry_count: fanmarkData.lottery_entry_count ?? 0,
          has_user_lottery_entry: fanmarkData.has_user_lottery_entry ?? false,
          user_lottery_entry_id: fanmarkData.user_lottery_entry_id,
        });
        return;
      }

      if (!fanmarkData.has_active_license) {
        setResult({
          id: fanmarkData.id,
          user_input_fanmark: fanmarkData.user_input_fanmark,
          fanmark: resolveFanmarkDisplay(fanmarkData.user_input_fanmark, fanmarkData.emoji_ids),
          emoji_ids: fanmarkData.emoji_ids,
          normalized_emoji_ids: normalizedEmojiIds,
          normalized_emoji: fanmarkData.normalized_emoji,
          short_id: fanmarkData.short_id,
          tier_level: fanmarkData.tier_level ?? availabilityTierLevel ?? 1,
          tier_display_name: availabilityTierDisplayName,
          status: 'available',
          emoji_count: validation.emojiCount,
          available_at: nextAvailableAt,
          blocking_status: blockingStatus,
          is_blocked_for_registration: false,
          lottery_entry_count: fanmarkData.lottery_entry_count ?? 0,
          has_user_lottery_entry: fanmarkData.has_user_lottery_entry ?? false,
          user_lottery_entry_id: fanmarkData.user_lottery_entry_id,
        });
        return;
      }

      if (isOwnedByCurrentUser) {
        setResult({
          id: fanmarkData.id,
          user_input_fanmark: fanmarkData.user_input_fanmark,
          fanmark: resolveFanmarkDisplay(fanmarkData.user_input_fanmark, fanmarkData.emoji_ids),
          emoji_ids: fanmarkData.emoji_ids,
          normalized_emoji_ids: normalizedEmojiIds,
          normalized_emoji: fanmarkData.normalized_emoji,
          short_id: fanmarkData.short_id,
          tier_level: fanmarkData.tier_level ?? availabilityTierLevel ?? 1,
          tier_display_name: availabilityTierDisplayName,
          status: 'taken',
          emoji_count: validation.emojiCount,
          owner: {
            user_id: currentUserId,
            username: '',
            display_name: '',
          },
          available_at: nextAvailableAt,
          blocking_status: blockingStatus,
          is_blocked_for_registration: false,
        });
        return;
      }

      setResult({
        id: fanmarkData.id,
        user_input_fanmark: fanmarkData.user_input_fanmark,
        fanmark: resolveFanmarkDisplay(fanmarkData.user_input_fanmark, fanmarkData.emoji_ids),
        emoji_ids: fanmarkData.emoji_ids,
        normalized_emoji_ids: normalizedEmojiIds,
        normalized_emoji: fanmarkData.normalized_emoji,
        short_id: fanmarkData.short_id,
        tier_level: fanmarkData.tier_level ?? availabilityTierLevel ?? 1,
        tier_display_name: availabilityTierDisplayName,
        status: 'not_available',
        emoji_count: validation.emojiCount,
        owner: ownerInfo,
        available_at: nextAvailableAt,
        blocking_status: blockingStatus,
        is_blocked_for_registration: false,
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
      const compactEmoji = emoji.replace(/\s/g, '');
      let emojiIds: string[] = [];
      let normalizedEmojiIds: string[] = [];
      try {
        const pair = convertEmojiSequenceToIdPair(compactEmoji);
        emojiIds = pair.emojiIds;
        normalizedEmojiIds = pair.normalizedEmojiIds;
      } catch (conversionError) {
        return {
          success: false,
          error: conversionError instanceof Error ? conversionError.message : 'Invalid emoji sequence',
        };
      }

      const response = await supabase.functions.invoke<RegisterFanmarkResponse>('register-fanmark', {
        body: { 
          user_input_fanmark: emoji, 
          emoji_ids: emojiIds, 
          normalized_emoji_ids: normalizedEmojiIds,
          defaultFanmarkName: t('fanmarkSettings.summary.defaultName'),
        }
      });

      if (response.error) {
        return { success: false, error: response.error.message };
      }

      if (response.data?.fanmark) {
        const fanmarkRecord = response.data.fanmark;
        return {
          success: true,
          fanmark: {
            ...fanmarkRecord,
            fanmark: resolveFanmarkDisplay(fanmarkRecord.user_input_fanmark, fanmarkRecord.emoji_ids),
          },
        };
      }
      return { success: false, error: response.data?.error ?? 'Registration failed' };
    } catch (error) {
      return { success: false, error: 'Registration failed' };
    }
  };

  const checkAvailability = async (emoji: string): Promise<boolean> => {
    try {
      const compactEmoji = emoji.replace(/\s/g, '');
      let normalizedEmojiIds: string[];
      try {
        const pair = convertEmojiSequenceToIdPair(compactEmoji);
        normalizedEmojiIds = pair.normalizedEmojiIds;
      } catch (conversionError) {
        console.error('Error converting emoji to ids:', conversionError);
        return false;
      }

      if (normalizedEmojiIds.length === 0) {
        return false;
      }

      const { data: availabilityRaw, error } = await supabase
        .rpc('check_fanmark_availability', { input_emoji_ids: normalizedEmojiIds } as { input_emoji_ids: string[] });

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
