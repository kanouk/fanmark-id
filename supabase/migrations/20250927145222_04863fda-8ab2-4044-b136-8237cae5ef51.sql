-- Drop the existing function first
DROP FUNCTION IF EXISTS public.get_fanmark_complete_data(uuid, text);

-- Recreate the function with is_public included
CREATE OR REPLACE FUNCTION public.get_fanmark_complete_data(fanmark_id_param uuid DEFAULT NULL::uuid, emoji_combo_param text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, emoji_combination text, normalized_emoji text, short_id text, access_type text, status text, created_at timestamp with time zone, updated_at timestamp with time zone, fanmark_name text, target_url text, text_content text, is_password_protected boolean, current_owner_id uuid, license_end timestamp with time zone, has_active_license boolean, license_id uuid, is_public boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        f.id,
        f.emoji_combination,
        f.normalized_emoji,
        f.short_id,
        COALESCE(bc.access_type, 'inactive') as access_type,
        f.status,
        f.created_at,
        f.updated_at,
        bc.fanmark_name,
        rc.target_url,
        mc.content as text_content,
        COALESCE(pc.is_enabled, false) as is_password_protected,
        fl.user_id as current_owner_id,
        fl.license_end,
        CASE 
            WHEN fl.status = 'active' AND fl.license_end > now() THEN true 
            ELSE false 
        END as has_active_license,
        fl.id as license_id,
        COALESCE(fp.is_public, true) as is_public
    FROM fanmarks f
    LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
        AND fl.status = 'active' 
        AND fl.license_end > now()
    LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
    LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
    LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
    LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
    LEFT JOIN fanmark_profiles fp ON fl.id = fp.license_id
    WHERE 
        (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
        OR 
        (emoji_combo_param IS NOT NULL AND f.emoji_combination = emoji_combo_param);
END;
$function$