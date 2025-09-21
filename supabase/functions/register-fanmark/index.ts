import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RegisterFanmarkRequest {
  emoji: string; // Changed from emoji_combination for consistency with frontend
  accessType?: string;
  displayName?: string;
  targetUrl?: string;
  textContent?: string;
  createProfile?: boolean;
  isTransferable?: boolean;
}

// Normalize emoji by removing skin tone modifiers
function normalizeEmoji(emoji: string): string {
  // Remove skin tone modifiers (U+1F3FB-U+1F3FF)
  return emoji.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '');
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
  const segments = [...new Intl.Segmenter().segment(cleanEmoji)];
  const emojiCount = segments.filter(s => {
    // Count base emojis, excluding modifiers and variation selectors
    return s.segment.match(/\p{Emoji}/u) && 
           !s.segment.match(/[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/u);
  }).length;
  
  if (emojiCount < 1 || emojiCount > 5) {
    return { valid: false, error: 'Emoji combination must contain 1-5 emojis', emojiCount };
  }

  return { valid: true, emojiCount };
}

// Check for pattern-based pricing using availability rules
async function checkPatternBasedPricing(supabase: any, normalizedEmoji: string, emojiCount: number): Promise<{ requiresPayment: boolean; priceUsd?: number; reason?: string; isAvailable: boolean }> {
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
    const config = rule.rule_config || {};
    
    switch (rule.rule_type) {
      case 'specific_pattern':
        if (config.patterns && config.patterns.includes(normalizedEmoji)) {
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
          if (firstEmoji && config.prefixes[firstEmoji]) {
            return {
              requiresPayment: true,
              priceUsd: config.prefixes[firstEmoji],
              reason: 'prefix_pattern',
              isAvailable: rule.is_available
            };
          }
        }
        break;

      case 'count_based':
        if (config.pricing && config.pricing[emojiCount.toString()]) {
          return {
            requiresPayment: parseFloat(config.pricing[emojiCount.toString()]) > 0,
            priceUsd: parseFloat(config.pricing[emojiCount.toString()]),
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
  const segments = [...new Intl.Segmenter().segment(emoji)];
  const uniqueEmojis = new Set();
  let previousEmoji = '';
  
  for (const segment of segments) {
    if (segment.segment.match(/\p{Emoji}/u) && !segment.segment.match(/[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/u)) {
      if (segment.segment === previousEmoji) {
        return true; // Found consecutive duplicate
      }
      uniqueEmojis.add(segment.segment);
      previousEmoji = segment.segment;
    }
  }
  
  return false;
}

// Helper function to get first emoji
function getFirstEmoji(emoji: string): string | null {
  const segments = [...new Intl.Segmenter().segment(emoji)];
  for (const segment of segments) {
    if (segment.segment.match(/\p{Emoji}/u) && !segment.segment.match(/[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/u)) {
      return segment.segment;
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
    const supabase = createClient(
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
    const { emoji, accessType = 'inactive', displayName, targetUrl, textContent, createProfile = false, isTransferable = true } = body;

    // Validate emoji combination
    const validation = validateEmojiCombination(emoji);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize emoji for database storage
    const normalizedEmoji = normalizeEmoji(emoji);
    
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

    if (pricingInfo.requiresPayment) {
      return new Response(
        JSON.stringify({ 
          error: `This emoji requires payment (${pricingInfo.reason || 'pricing rule'})`,
          type: 'payment_required',
          price_usd: pricingInfo.priceUsd,
          emoji_count: validation.emojiCount,
          reason: pricingInfo.reason
        }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate unique short ID
    let shortId = generateShortId();
    let attempts = 0;
    while (attempts < 10) {
      const { data: existing } = await supabase
        .from('fanmarks')
        .select('id')
        .eq('short_id', shortId)
        .single();
      
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
      .from('profiles')
      .select('emoji_limit')
      .eq('user_id', user.id)
      .single();

    const { count: userFanmarkCount } = await supabase
      .from('fanmarks')
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
      .from('fanmarks')
      .insert({
        emoji_combination: emoji,
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
      .select()
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

    // Create emoji profile if requested
    if (createProfile) {
      const { error: profileError } = await supabase
        .from('emoji_profiles')
        .insert({
          fanmark_id: fanmark.id,
          user_id: user.id,
          bio: `Welcome to ${displayName || emoji}'s profile!`,
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
          emoji_combination: emoji,
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
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});