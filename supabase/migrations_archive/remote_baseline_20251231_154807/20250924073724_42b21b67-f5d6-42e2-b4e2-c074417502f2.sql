-- Update get_fanmark_by_emoji function to return fanmark_name instead of display_name
DROP FUNCTION public.get_fanmark_by_emoji(text);

CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(emoji_combo text)
 RETURNS TABLE(emoji_combination text, fanmark_name text, access_type text, target_url text, text_content text, status text, is_password_protected boolean, access_password text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 
    f.emoji_combination,
    f.fanmark_name,
    f.access_type,
    f.target_url,
    f.text_content,
    f.status,
    f.is_password_protected,
    f.access_password
  FROM public.fanmarks f
  WHERE f.emoji_combination = emoji_combo 
    AND f.status = 'active'
  LIMIT 1;
$function$;