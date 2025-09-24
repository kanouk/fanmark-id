-- Fix security vulnerability: Remove overly permissive RLS policy that exposes user data
-- and replace with secure availability checking

-- First, drop the problematic policy that exposes user data
DROP POLICY IF EXISTS "Anyone can check fanmark license status for availability" ON public.fanmark_licenses;

-- Create a secure function to check fanmark availability without exposing user data
CREATE OR REPLACE FUNCTION public.check_fanmark_availability_secure(fanmark_emoji text)
RETURNS boolean AS $$
BEGIN
  -- Check if fanmark exists and has an active license
  RETURN NOT EXISTS (
    SELECT 1 
    FROM public.fanmarks f
    JOIN public.fanmark_licenses fl ON f.id = fl.fanmark_id
    WHERE f.emoji_combination = fanmark_emoji 
    AND fl.status = 'active' 
    AND fl.license_end > now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- Update the existing check_fanmark_availability function to use the secure approach
CREATE OR REPLACE FUNCTION public.check_fanmark_availability(input_emoji text)
RETURNS json AS $$
DECLARE
  fanmark_record RECORD;
  is_available boolean;
  tier_info RECORD;
  result json;
BEGIN
  -- Normalize the emoji input by removing skin tone modifiers
  input_emoji := regexp_replace(input_emoji, '[\x{1F3FB}-\x{1F3FF}]', '', 'g');
  
  -- Check if fanmark exists
  SELECT id, emoji_combination, status INTO fanmark_record
  FROM public.fanmarks 
  WHERE normalized_emoji = input_emoji;
  
  IF NOT FOUND THEN
    -- Fanmark doesn't exist, check if it can be created
    SELECT tier_level, monthly_price_usd, initial_license_days 
    INTO tier_info
    FROM public.fanmark_tiers 
    WHERE char_length(input_emoji) BETWEEN emoji_count_min AND emoji_count_max
    AND is_active = true
    ORDER BY tier_level ASC
    LIMIT 1;
    
    IF FOUND THEN
      result := json_build_object(
        'available', true,
        'tier_level', tier_info.tier_level,
        'price', tier_info.monthly_price_usd,
        'license_days', tier_info.initial_license_days
      );
    ELSE
      result := json_build_object('available', false, 'reason', 'invalid_length');
    END IF;
  ELSE
    -- Fanmark exists, check if it's available (no active license)
    is_available := public.check_fanmark_availability_secure(fanmark_record.emoji_combination);
    
    result := json_build_object(
      'available', is_available,
      'fanmark_id', fanmark_record.id,
      'reason', CASE WHEN NOT is_available THEN 'taken' ELSE null END
    );
  END IF;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;