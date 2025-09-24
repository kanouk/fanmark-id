-- Drop and recreate get_fanmark_by_emoji function with updated return type
-- This will allow FanmarkProfile component to fetch profile data correctly

DROP FUNCTION IF EXISTS public.get_fanmark_by_emoji(text);

CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(emoji_combo text)
 RETURNS TABLE(id uuid, emoji_combination text, fanmark_name text, access_type text, target_url text, text_content text, status text, is_password_protected boolean, access_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        CASE WHEN pc.access_password IS NOT NULL THEN true ELSE false END as is_password_protected,
        pc.access_password
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    WHERE f.emoji_combination = emoji_combo 
    AND f.status = 'active';
END;
$function$