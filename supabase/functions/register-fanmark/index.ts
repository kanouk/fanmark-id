import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RegisterFanmarkRequest {
  input_emoji_combination: string; // Semantic parameter name for incoming emoji combination
  accessType?: string;
  displayName?: string;
  targetUrl?: string;
  textContent?: string;
  createProfile?: boolean;
  isTransferable?: boolean;
}

type DatabaseClient = SupabaseClient<unknown, unknown, unknown>;

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

interface FanmarkRow {
  id: string;
  short_id: string;
  emoji_combination: string;
  normalized_emoji: string;
  user_id: string;
}

const SKIN_TONE_MODIFIER_REGEX = /\p{Emoji_Modifier}/u;
const SKIN_TONE_MODIFIER_GLOBAL_REGEX = /\p{Emoji_Modifier}/gu;
const EMOJI_CHARACTER_REGEX = /\p{Emoji}/u;
const COMBINING_CHARACTERS = new Set([
  String.fromCodePoint(0xfe0f),
  String.fromCodePoint(0x200d),
]);

function getGraphemes(text: string): string[] {
  if (typeof (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (segment) => segment.segment);
  }
  return Array.from(text);
}

const isBaseEmoji = (char: string): boolean =>
  EMOJI_CHARACTER_REGEX.test(char) &&
  !SKIN_TONE_MODIFIER_REGEX.test(char) &&
  !COMBINING_CHARACTERS.has(char);

// Normalize emoji by removing skin tone modifiers
function normalizeEmoji(emoji: string): string {
  // Remove skin tone modifiers (U+1F3FB-U+1F3FF)
  return emoji.replace(SKIN_TONE_MODIFIER_GLOBAL_REGEX, '');
}

// Generate short ID for fanmark
function generateShortId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Validate emoji combination - strict emoji-only validation
function validateEmojiCombination(emoji: string): { valid: boolean; error?: string; emojiCount: number } {
  if (!emoji || emoji.trim().length === 0) {
    return { valid: false, error: 'Emoji combination is required', emojiCount: 0 };
  }

  // Remove all whitespace for validation
  const cleanEmoji = emoji.replace(/\s/g, '');
  
  // Check if string contains only emojis
  const emojiRegex = /^[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\p{Emoji_Modifier_Base}\p{Emoji_Presentation}]+$/u;
  if (!emojiRegex.test(cleanEmoji)) {
    return { valid: false, error: 'Input must contain only emojis (no text, numbers, or symbols)', emojiCount: 0 };
  }

  // Count actual emoji characters (excluding modifiers)
  const segments = getGraphemes(cleanEmoji);
  const emojiCount = segments.filter(isBaseEmoji).length;
  
  if (emojiCount < 1 || emojiCount > 5) {
    return { valid: false, error: 'Emoji combination must contain 1-5 emojis', emojiCount };
  }

  return { valid: true, emojiCount };
}

// Check for pattern-based pricing using availability rules
async function checkPatternBasedPricing(
  supabase: DatabaseClient,
  normalizedEmoji: string,
  emojiCount: number,
): Promise<{ requiresPayment: boolean; priceUsd?: number; reason?: string; isAvailable: boolean }> {
  // Get all active availability rules ordered by priority
  const { data: rules } = await supabase
    .from<AvailabilityRuleRecord>('fanmark_availability_rules')
    .select('rule_type, priority, rule_config, is_available, price_usd')
    .eq('is_available', true)
    .order('priority', { ascending: true });

  if (!rules) {
    return { requiresPayment: false, isAvailable: true };
  }

  // Check patterns in priority order (1=highest, 4=lowest)
  for (const rule of rules) {
    const config: AvailabilityRuleConfig = rule.rule_config ?? {};
    
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
          const prefixPrice = firstEmoji ? config.prefixes[firstEmoji] : undefined;
          if (firstEmoji && prefixPrice !== undefined) {
            const parsedPrice = typeof prefixPrice === 'number' ? prefixPrice : Number(prefixPrice);
            return {
              requiresPayment: true,
              priceUsd: Number.isNaN(parsedPrice) ? undefined : parsedPrice,
              reason: 'prefix_pattern',
              isAvailable: rule.is_available
            };
          }
        }
        break;

      case 'count_based':
        if (config.pricing && config.pricing[emojiCount.toString()] !== undefined) {
          const priceValue = config.pricing[emojiCount.toString()];
          const parsedPrice = typeof priceValue === 'number' ? priceValue : Number(priceValue);
          return {
            requiresPayment: parsedPrice > 0,
            priceUsd: parsedPrice,
            reason: 'count_based',
            isAvailable: rule.is_available
          };
        }
        break;
    }
  }

  return { requiresPayment: false, isAvailable: true };
}

// Helper function to check for duplicate emojis
function hasDuplicateEmojis(emoji: string): boolean {
  const segments = getGraphemes(emoji);
  let previousEmoji = '';
  
  for (const segment of segments) {
    if (isBaseEmoji(segment)) {
      if (segment === previousEmoji) {
        return true; // Found consecutive duplicate
      }
      previousEmoji = segment;
    }
  }
  
  return false;
}

// Helper function to get first emoji
function getFirstEmoji(emoji: string): string | null {
  const segments = getGraphemes(emoji);
  for (const segment of segments) {
    if (isBaseEmoji(segment)) {
      return segment;
    }
  }
  return null;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase: DatabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: RegisterFanmarkRequest = await req.json();
    console.log('Received request body:', body);
    const { input_emoji_combination, accessType = 'inactive', displayName, targetUrl, textContent, createProfile = false, isTransferable = true } = body;

    // Validate emoji combination
    console.log('Validating emoji combination:', input_emoji_combination);
    const validation = validateEmojiCombination(input_emoji_combination);
    if (!validation.valid) {
      console.error('Validation failed:', validation.error);
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize emoji for database storage
    const normalizedEmoji = normalizeEmoji(input_emoji_combination);
    console.log('Normalized emoji:', normalizedEmoji);
    
    // Check pattern-based pricing using new availability rules system
    const pricingInfo = await checkPatternBasedPricing(supabase, normalizedEmoji, validation.emojiCount);
    
    // If not available or requires payment
    if (!pricingInfo.isAvailable) {
      return new Response(
        JSON.stringify({ 
          error: 'This emoji pattern is currently not available for registration',
          type: 'not_available',
          reason: pricingInfo.reason
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Payment checks disabled: proceed without requiring payment


    // Generate unique short ID
    let shortId = generateShortId();
    let attempts = 0;
    while (attempts < 10) {
      const { data: existing } = await supabase
        .from<Pick<FanmarkRow, 'id'>>('fanmarks')
        .select('id')
        .eq('short_id', shortId)
        .maybeSingle();

      if (!existing) break;
      shortId = generateShortId();
      attempts++;
    }

    if (attempts >= 10) {
      return new Response(
        JSON.stringify({ error: 'Failed to generate unique ID' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate URL if redirect type
    if (accessType === 'redirect' && targetUrl) {
      try {
        const url = new URL(targetUrl);
        if (!['http:', 'https:'].includes(url.protocol)) {
          return new Response(
            JSON.stringify({ error: 'Only HTTP and HTTPS URLs are allowed' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } catch {
        return new Response(
          JSON.stringify({ error: 'Invalid URL format' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Check user's fanmark limit
    const { data: userProfile } = await supabase
      .from<{ emoji_limit: number | null }>('profiles')
      .select('emoji_limit')
      .eq('user_id', user.id)
      .single();

    const { count: userFanmarkCount } = await supabase
      .from<FanmarkRow>('fanmarks')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'active');

    const limit = userProfile?.emoji_limit || 10;
    if (userFanmarkCount && userFanmarkCount >= limit) {
      return new Response(
        JSON.stringify({ error: `You have reached your limit of ${limit} fanmarks` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert fanmark with conflict handling
    const { data: fanmark, error: insertError } = await supabase
      .from<FanmarkRow>('fanmarks')
      .insert({
        emoji_combination: input_emoji_combination,
        normalized_emoji: normalizedEmoji,
        short_id: shortId,
        user_id: user.id,
        status: 'active',
        is_premium: pricingInfo.requiresPayment,
        access_type: accessType,
        target_url: targetUrl || null,
        text_content: textContent || null,
        display_name: displayName || null,
        is_transferable: isTransferable
      })
      .select('id, emoji_combination, short_id')
      .single();

    if (insertError) {
      if (insertError.code === '23505') { // Unique constraint violation
        return new Response(
          JSON.stringify({ error: 'This emoji combination is already taken' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw insertError;
    }

    if (!fanmark) {
      return new Response(
        JSON.stringify({ error: 'Failed to create fanmark' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create emoji profile if requested
    if (createProfile) {
      const { error: profileError } = await supabase
        .from('emoji_profiles')
        .insert({
          fanmark_id: fanmark.id,
          user_id: user.id,
          bio: `Welcome to ${displayName || input_emoji_combination}'s profile!`,
          is_public: true
        });

      if (profileError) {
        console.error('Failed to create emoji profile:', profileError);
        // Don't fail the whole registration for this
      }
    }

    // Log the registration
    const requestId = crypto.randomUUID();
    await supabase
      .from('audit_logs')
      .insert({
        user_id: user.id,
        action: 'register_fanmark',
        resource_type: 'fanmark',
        resource_id: fanmark.id,
        request_id: requestId,
        metadata: {
          emoji_combination: input_emoji_combination,
          normalized_emoji: normalizedEmoji,
          short_id: shortId,
          access_type: accessType,
          display_name: displayName,
          create_profile: createProfile
        }
      });

    return new Response(
      JSON.stringify({
        success: true,
        fanmark: {
          id: fanmark.id,
          emoji_combination: fanmark.emoji_combination,
          short_id: fanmark.short_id,
          canonical_url: `/e/${fanmark.short_id}`,
          display_url: `/emoji/${encodeURIComponent(fanmark.emoji_combination)}`
        }
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error registering fanmark:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
