-- Update get_fanmark_by_emoji to include short_id for redirect capability
-- First drop the existing function to avoid return type conflicts
DROP FUNCTION IF EXISTS public.get_fanmark_by_emoji(text);

CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(emoji_combo text)
RETURNS TABLE(
  id uuid,
  emoji_combination text,
  fanmark_name text,
  access_type text,
  target_url text,
  text_content text,
  status text,
  is_password_protected boolean,
  short_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.emoji_combination,
        COALESCE(bc.fanmark_name, f.emoji_combination) as fanmark_name,
        COALESCE(bc.access_type, 'inactive') as access_type,
        rc.target_url,
        mc.content as text_content,
        f.status,
        COALESCE(pc.is_enabled, false) as is_password_protected,
        f.short_id
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    WHERE f.normalized_emoji = emoji_combo
    AND f.status = 'active';
END;
$$;

-- Create function to get fanmark data by short_id
CREATE OR REPLACE FUNCTION public.get_fanmark_by_short_id(shortid_param text)
RETURNS TABLE(
  id uuid,
  emoji_combination text,
  fanmark_name text,
  access_type text,
  target_url text,
  text_content text,
  status text,
  is_password_protected boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.emoji_combination,
        COALESCE(bc.fanmark_name, f.emoji_combination) as fanmark_name,
        COALESCE(bc.access_type, 'inactive') as access_type,
        rc.target_url,
        mc.content as text_content,
        f.status,
        COALESCE(pc.is_enabled, false) as is_password_protected
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    WHERE f.short_id = shortid_param
    AND f.status = 'active';
END;
$$;