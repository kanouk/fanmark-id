-- Update get_fanmark_by_short_id function to include license_id in the return type
DROP FUNCTION IF EXISTS public.get_fanmark_by_short_id(text);

CREATE OR REPLACE FUNCTION public.get_fanmark_by_short_id(shortid_param text)
 RETURNS TABLE(id uuid, emoji_combination text, fanmark_name text, access_type text, target_url text, text_content text, status text, is_password_protected boolean, license_id uuid)
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
        COALESCE(pc.is_enabled, false) as is_password_protected,
        fl.id as license_id
    FROM fanmarks f
    LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
        AND fl.status = 'active' 
        AND fl.license_end > now()
    LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
    LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
    LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
    LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
    WHERE f.short_id = shortid_param
    AND f.status = 'active';
END;
$function$;