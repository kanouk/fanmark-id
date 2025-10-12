import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RegisterFanmarkRequest {
  user_input_fanmark: string; // Semantic parameter name for incoming fanmark string
  emoji_ids?: string[];
  normalized_emoji_ids?: string[];
  accessType?: string;
  displayName?: string;
  targetUrl?: string;
  textContent?: string;
  createProfile?: boolean;
  isTransferable?: boolean;
}

type DatabaseClient = SupabaseClient;

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
  user_input_fanmark: string;
  normalized_emoji: string;
  status: string;
  emoji_ids: string[] | null;
  normalized_emoji_ids: string[] | null;
  tier_level: number | null;
}

const SKIN_TONE_MODIFIER_REGEX = /\p{Emoji_Modifier}/u;
const SKIN_TONE_MODIFIER_GLOBAL_REGEX = /\p{Emoji_Modifier}/gu;
const EMOJI_CHARACTER_REGEX = /\p{Emoji}/u;
const COMBINING_CHARACTERS = new Set([
  String.fromCodePoint(0xfe0f),
  String.fromCodePoint(0x200d),
]);

const FE_VARIATION_SELECTOR_REGEX = /\uFE0F+/g;

const normalizeEmojiForLookup = (emoji: string): string =>
  emoji.normalize('NFC').replace(FE_VARIATION_SELECTOR_REGEX, '\uFE0F');

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

async function convertEmojiSequenceToIds(
  supabase: DatabaseClient,
  emojiSequence: string,
): Promise<string[]> {
  const segments = getGraphemes(emojiSequence);
  if (segments.length === 0) {
    return [];
  }

  const normalizedSegments = segments.map(normalizeEmojiForLookup);
  const { data, error } = await supabase
    .from('emoji_master')
    .select('id, emoji')
    .in('emoji', normalizedSegments);

  if (error) {
    console.error('Failed to resolve emoji IDs:', error);
    throw new Error('Failed to resolve emoji IDs');
  }

  const rows = data ?? [];
  const lookup = new Map(
    rows.map((row: { id: string; emoji: string }) => [normalizeEmojiForLookup(row.emoji), row.id]),
  );

  return normalizedSegments.map((segment) => {
    const id = lookup.get(segment);
    if (!id) {
      throw new Error(`Emoji not found in master: ${segment}`);
    }
    return id;
  });
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

// Get max emoji characters from system settings
async function getMaxEmojiCharacters(supabase: DatabaseClient): Promise<number> {
  const { data } = await supabase
    .from('system_settings')
    .select('setting_value')
    .eq('setting_key', 'max_emoji_characters')
    .eq('is_public', true)
    .maybeSingle() as { data: { setting_value: string } | null };
  
  return data ? parseInt(data.setting_value, 10) : 5; // Default to 5
}

// Determine tier based on emoji count
function determineTier(emojiCount: number): number {
  if (emojiCount >= 3) return 1; // Tier1: 3-5 characters
  if (emojiCount === 2) return 2; // Tier2: 2 characters  
  if (emojiCount === 1) return 3; // Tier3: 1 character
  return 1; // Default to Tier1
}

// Get tier configuration
async function getTierConfig(supabase: DatabaseClient, tierLevel: number): Promise<{ initial_license_days: number; monthly_price_usd: number } | null> {
  const { data } = await supabase
    .from('fanmark_tiers')
    .select('initial_license_days, monthly_price_usd')
    .eq('tier_level', tierLevel)
    .eq('is_active', true)
    .single();
    
  return data;
}

// Validate emoji combination - strict emoji-only validation
async function validateEmojiCombination(supabase: DatabaseClient, emoji: string): Promise<{ valid: boolean; error?: string; emojiCount: number }> {
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
  
  // Get max emoji characters from system settings
  const maxEmojiCharacters = await getMaxEmojiCharacters(supabase);
  
  if (emojiCount < 1 || emojiCount > maxEmojiCharacters) {
    return { valid: false, error: `Emoji combination must contain 1-${maxEmojiCharacters} emojis`, emojiCount };
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
    .from('fanmark_availability_rules')
    .select('rule_type, priority, rule_config, is_available, price_usd')
    .eq('is_available', true)
    .order('priority', { ascending: true }) as { data: AvailabilityRuleRecord[] | null };

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
            priceUsd: rule.price_usd || undefined,
            reason: 'specific_pattern',
            isAvailable: rule.is_available
          };
        }
        break;

      case 'duplicate_pattern':
        if (config.enabled && hasDuplicateEmojis(normalizedEmoji)) {
          return {
            requiresPayment: true,
            priceUsd: rule.price_usd || undefined,
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

// Round up to next UTC midnight (0:00:00.000)
function roundUpToNextUtcMidnight(input: Date): Date {
  const d = new Date(input);
  if (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  ) {
    return d; // Already at UTC midnight
  }
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

const toPgUuidArrayLiteral = (ids: string[]): string =>
  `{${ids.map((id) => `"${id}"`).join(',')}}`;

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
    const {
      user_input_fanmark,
      emoji_ids: inputEmojiIds,
      normalized_emoji_ids: inputNormalizedEmojiIds,
      accessType = 'inactive',
      displayName,
      targetUrl,
      textContent,
      createProfile = false,
      isTransferable = true
    } = body;

    if (typeof user_input_fanmark !== 'string' || user_input_fanmark.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Emoji combination is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate fanmark string
    console.log('Validating user input fanmark:', user_input_fanmark);
    const validation = await validateEmojiCombination(supabase, user_input_fanmark);
    if (!validation.valid) {
      console.error('Validation failed:', validation.error);
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanEmoji = user_input_fanmark.replace(/\s/g, '');
    let emojiIds = Array.isArray(inputEmojiIds) ? inputEmojiIds.filter(Boolean) : [];
    if (emojiIds.length === 0) {
      // Fallback for legacy clients: resolve IDs on the backend (will be removed once migration completes)
      emojiIds = await convertEmojiSequenceToIds(supabase, cleanEmoji);
    }

    if (emojiIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'emoji_ids are required to register a fanmark' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize emoji for database storage
    const normalizedEmoji = normalizeEmoji(cleanEmoji);
    let normalizedEmojiIds = Array.isArray(inputNormalizedEmojiIds)
      ? inputNormalizedEmojiIds.filter(Boolean)
      : [];
    if (normalizedEmojiIds.length === 0) {
      normalizedEmojiIds = await convertEmojiSequenceToIds(supabase, normalizedEmoji);
    }
    console.log('Normalized emoji:', normalizedEmoji);
    
    // Determine tier level based on emoji count
    const tierLevel = determineTier(validation.emojiCount);
    console.log('Determined tier level:', tierLevel);
    
    // Get tier configuration
    const tierConfig = await getTierConfig(supabase, tierLevel);
    if (!tierConfig) {
      return new Response(
        JSON.stringify({ error: 'Tier configuration not found' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
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

    // Check if a fanmark record already exists for this normalized emoji ids
    let existingFanmark: FanmarkRow | null = null;
    if (normalizedEmojiIds.length > 0) {
      const normalizedIdsLiteral = toPgUuidArrayLiteral(normalizedEmojiIds);
      const { data, error } = await supabase
        .from('fanmarks')
        .select('id, status, user_input_fanmark, short_id, emoji_ids, normalized_emoji_ids, tier_level')
        .filter('normalized_emoji_ids', 'eq', normalizedIdsLiteral)
        .maybeSingle() as { data: FanmarkRow | null; error: any };

      if (error && error.code !== 'PGRST116') {
        console.error('Failed to lookup fanmark by normalized_emoji_ids:', error);
      }
      if (data) {
        existingFanmark = data;
      }
    }

    if (!existingFanmark) {
      const { data, error } = await supabase
        .from('fanmarks')
        .select('id, status, user_input_fanmark, short_id, emoji_ids, normalized_emoji_ids, tier_level')
        .eq('normalized_emoji', normalizedEmoji)
        .maybeSingle() as { data: FanmarkRow | null; error: any };

      if (error && error.code !== 'PGRST116') {
        console.error('Failed legacy fanmark lookup by normalized_emoji:', error);
      }
      if (data) {
        existingFanmark = data;
      }
    }

    // If a record exists:
    // - If it's not active, block registration.
    // - If it has an active/current license, block as taken.
    // - If it's active and unlicensed, reuse the record instead of inserting a new one.
    if (existingFanmark) {
      if (existingFanmark.status !== 'active') {
        return new Response(
          JSON.stringify({ error: 'This emoji pattern is not active and cannot be registered' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      // Check for active license or grace period license
      const { data: existingLicense } = await supabase
        .from('fanmark_licenses')
        .select('id, status, grace_expires_at')
        .eq('fanmark_id', existingFanmark.id)
        .in('status', ['active', 'grace'])
        .maybeSingle();
      
      if (existingLicense) {
        // If active, it's taken
        if (existingLicense.status === 'active') {
          return new Response(
            JSON.stringify({ error: 'This emoji combination is already taken' }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        // If grace, check if grace period has expired
        if (existingLicense.status === 'grace' && existingLicense.grace_expires_at) {
          const graceExpiresAt = new Date(existingLicense.grace_expires_at);
          const now = new Date();
          
          if (graceExpiresAt > now) {
            // Still in grace period - cannot acquire
            return new Response(
              JSON.stringify({ 
                error: 'This fanmark is in grace period and cannot be acquired yet',
                available_at: existingLicense.grace_expires_at,
                type: 'grace_period'
              }),
              { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }
      }
    }

    // Either reuse existing fanmark (active & unlicensed) or create a new one
    let fanmarkId: string;
    let fanmarkUserInput: string;
    let fanmarkShortId: string;
    let fanmarkEmojiIds: string[] = emojiIds;
    let fanmarkNormalizedEmojiIds: string[] = normalizedEmojiIds;
    if (existingFanmark) {
      fanmarkId = existingFanmark.id;
      fanmarkUserInput = existingFanmark.user_input_fanmark;
      fanmarkShortId = existingFanmark.short_id;
      if (existingFanmark.emoji_ids && existingFanmark.emoji_ids.length > 0) {
        fanmarkEmojiIds = existingFanmark.emoji_ids;
      } else {
        const { error: updateEmojiIdsError } = await supabase
          .from('fanmarks')
          .update({ emoji_ids: emojiIds })
          .eq('id', existingFanmark.id);
        if (updateEmojiIdsError) {
          console.error('Failed to update emoji_ids for existing fanmark:', updateEmojiIdsError);
        }
        fanmarkEmojiIds = emojiIds;
      }

      if (existingFanmark.normalized_emoji_ids && existingFanmark.normalized_emoji_ids.length > 0) {
        fanmarkNormalizedEmojiIds = existingFanmark.normalized_emoji_ids;
      } else {
        const { error: updateNormalizedIdsError } = await supabase
          .from('fanmarks')
          .update({ normalized_emoji_ids: normalizedEmojiIds, normalized_emoji: normalizedEmoji })
          .eq('id', existingFanmark.id);
        if (updateNormalizedIdsError) {
          console.error('Failed to update normalized_emoji_ids for existing fanmark:', updateNormalizedIdsError);
        }
        fanmarkNormalizedEmojiIds = normalizedEmojiIds;
      }

      // Update access type in basic config for existing fanmark
      const updates: { tier_level?: number } = {};
      if (!existingFanmark.tier_level || existingFanmark.tier_level !== tierLevel) {
        updates.tier_level = tierLevel;
      }

      if (Object.keys(updates).length > 0) {
        const { error: updateTierError } = await supabase
          .from('fanmarks')
          .update(updates)
          .eq('id', existingFanmark.id);
        if (updateTierError) {
          console.error('Failed to update tier level for existing fanmark:', updateTierError);
        }
      }

      const { error: existingBasicCfgErr } = await supabase
        .from('fanmark_basic_configs')
        .upsert(
          { 
            fanmark_id: existingFanmark.id, 
            access_type: accessType,
            fanmark_name: displayName || existingFanmark.user_input_fanmark
          },
          { onConflict: 'fanmark_id' as any }
        );
      if (existingBasicCfgErr) {
        console.error('Failed to update existing fanmark basic config:', existingBasicCfgErr);
      }
    } else {
      // Generate unique short ID
      let shortId = generateShortId();
      let attempts = 0;
      while (attempts < 10) {
        const { data: existing } = await supabase
          .from('fanmarks')
          .select('id')
          .eq('short_id', shortId)
          .maybeSingle() as { data: { id: string } | null };

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

      // Insert fanmark with conflict handling
      const { data: inserted, error: insertError } = await supabase
        .from('fanmarks')
        .insert({
          user_input_fanmark: user_input_fanmark,
          normalized_emoji: normalizedEmoji,
          short_id: shortId,
          status: 'active',
          emoji_ids: emojiIds,
          normalized_emoji_ids: normalizedEmojiIds,
          tier_level: tierLevel,
        })
        .select('id, user_input_fanmark, short_id, emoji_ids, normalized_emoji_ids, tier_level')
        .single();

      if (insertError) {
        if ((insertError as any).code === '23505') { // Unique constraint violation (emoji already exists)
          return new Response(
            JSON.stringify({ error: 'This emoji combination is already taken' }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        throw insertError;
      }

      if (!inserted) {
        return new Response(
          JSON.stringify({ error: 'Failed to create fanmark' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      fanmarkId = inserted.id;
      fanmarkUserInput = inserted.user_input_fanmark;
      fanmarkShortId = inserted.short_id;
      fanmarkEmojiIds = inserted.emoji_ids ?? emojiIds;
      fanmarkNormalizedEmojiIds = inserted.normalized_emoji_ids ?? normalizedEmojiIds;
    }

    // Create initial license for the fanmark
    // Round up to next UTC midnight for consistent batch processing
    const now = new Date();
    const licenseEndRaw = new Date(now);
    licenseEndRaw.setDate(licenseEndRaw.getDate() + tierConfig.initial_license_days);
    const licenseEndDate = roundUpToNextUtcMidnight(licenseEndRaw);

    const { data: license, error: licenseError } = await supabase
      .from('fanmark_licenses')
      .insert({
        fanmark_id: fanmarkId,
        user_id: user.id,
        license_end: licenseEndDate.toISOString(),
        status: 'active',
        is_initial_license: true,
        grace_expires_at: null  // Explicitly set to null for new licenses
      })
      .select('id')
      .single();

    if (licenseError) {
      console.error('Failed to create initial license:', licenseError);
      // Don't fail registration for this
    }

    // Save basic configurations (name and access type) - use license.id
    if (license) {
      const { error: basicCfgErr } = await supabase
        .from('fanmark_basic_configs')
        .upsert(
          { 
            license_id: license.id, 
            fanmark_name: displayName || null,
            access_type: accessType
          },
          { onConflict: 'license_id' as any }
        );
      if (basicCfgErr) {
        console.error('Failed to upsert basic config:', basicCfgErr);
      }

      if (accessType === 'redirect' && targetUrl) {
        const { error: redirectErr } = await supabase
          .from('fanmark_redirect_configs')
          .upsert(
            { license_id: license.id, target_url: targetUrl },
            { onConflict: 'license_id' as any }
          );
        if (redirectErr) {
          console.error('Failed to upsert redirect config:', redirectErr);
        }
      }

      if (accessType === 'text' && textContent) {
        const { error: messageErr } = await supabase
          .from('fanmark_messageboard_configs')
          .upsert(
            { license_id: license.id, content: textContent },
            { onConflict: 'license_id' as any }
          );
        if (messageErr) {
          console.error('Failed to upsert messageboard config:', messageErr);
        }
      }
      
      if (createProfile) {
        const { error: profileError } = await supabase
          .from('fanmark_profiles')
          .insert({
            license_id: license.id,
            display_name: displayName || null,
            bio: `Welcome to ${displayName || user_input_fanmark}'s profile!`,
            is_public: true
          });

        if (profileError) {
          console.error('Failed to create fanmark profile:', profileError);
          // Don't fail the whole registration for this
        }
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
        resource_id: fanmarkId,
        request_id: requestId,
        metadata: {
          user_input_fanmark: user_input_fanmark,
          normalized_emoji: normalizedEmoji,
          emoji_ids: fanmarkEmojiIds,
          normalized_emoji_ids: fanmarkNormalizedEmojiIds,
          short_id: fanmarkShortId,
          access_type: accessType,
          display_name: displayName,
          create_profile: createProfile
        }
      });

    return new Response(
      JSON.stringify({
        success: true,
        fanmark: {
          id: fanmarkId,
          user_input_fanmark: fanmarkUserInput,
          emoji_ids: fanmarkEmojiIds,
          normalized_emoji_ids: fanmarkNormalizedEmojiIds,
          short_id: fanmarkShortId,
          canonical_url: `/a/${fanmarkShortId}`,
          display_url: `/emoji/${encodeURIComponent(fanmarkUserInput)}`
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
