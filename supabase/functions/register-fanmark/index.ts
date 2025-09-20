import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RegisterFanmarkRequest {
  emoji_combination: string;
  access_type?: string;
  target_url?: string;
  text_content?: string;
  display_name?: string;
  is_transferable?: boolean;
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

// Determine pricing based on emoji count
function getPricingInfo(emojiCount: number): { requiresPayment: boolean; priceYen?: number } {
  if (emojiCount === 1) {
    return { requiresPayment: true, priceYen: 500 }; // Premium price for single emoji
  } else if (emojiCount === 2) {
    return { requiresPayment: true, priceYen: 300 }; // Standard price for double emoji
  } else {
    return { requiresPayment: false }; // Free for 3+ emojis
  }
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
    const { emoji_combination, access_type = 'inactive', target_url, text_content, display_name, is_transferable = true } = body;

    // Validate emoji combination
    const validation = validateEmojiCombination(emoji_combination);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize emoji for database storage
    const normalizedEmoji = normalizeEmoji(emoji_combination);
    
    // Get pricing info based on emoji count
    const pricingInfo = getPricingInfo(validation.emojiCount);
    
    // Check if emoji is reserved (admin-defined patterns)
    const { data: reservedEmoji } = await supabase
      .from('reserved_emoji_patterns')
      .select('pattern, price_yen')
      .eq('pattern', normalizedEmoji)
      .eq('is_active', true)
      .single();

    // If requires payment (by count-based pricing or reserved pattern)
    if (pricingInfo.requiresPayment || reservedEmoji) {
      const priceYen = reservedEmoji?.price_yen || pricingInfo.priceYen;
      return new Response(
        JSON.stringify({ 
          error: `This emoji requires payment (${validation.emojiCount} emoji${validation.emojiCount !== 1 ? 's' : ''})`,
          type: 'payment_required',
          price_yen: priceYen,
          emoji_count: validation.emojiCount
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
    if (access_type === 'redirect' && target_url) {
      try {
        const url = new URL(target_url);
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
        emoji_combination,
        normalized_emoji: normalizedEmoji,
        short_id: shortId,
        user_id: user.id,
        status: 'active',
        is_premium: !!reservedEmoji
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
          emoji_combination,
          normalized_emoji: normalizedEmoji,
          short_id: shortId,
          access_type
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