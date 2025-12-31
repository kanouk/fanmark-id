-- Add access_type column to fanmark_basic_configs
ALTER TABLE public.fanmark_basic_configs 
ADD COLUMN access_type text NOT NULL DEFAULT 'inactive';

-- Migrate existing access_type data from fanmarks to fanmark_basic_configs
INSERT INTO public.fanmark_basic_configs (fanmark_id, access_type, fanmark_name)
SELECT 
  f.id as fanmark_id,
  f.access_type,
  f.emoji_combination as fanmark_name
FROM public.fanmarks f
LEFT JOIN public.fanmark_basic_configs bc ON f.id = bc.fanmark_id
WHERE bc.fanmark_id IS NULL
ON CONFLICT (fanmark_id) DO UPDATE SET
  access_type = EXCLUDED.access_type;

-- Update existing records in fanmark_basic_configs with access_type from fanmarks
UPDATE public.fanmark_basic_configs 
SET access_type = f.access_type
FROM public.fanmarks f
WHERE fanmark_basic_configs.fanmark_id = f.id;

-- Drop access_type column from fanmarks table
ALTER TABLE public.fanmarks DROP COLUMN access_type;

-- Update get_fanmark_complete_data function
CREATE OR REPLACE FUNCTION public.get_fanmark_complete_data(fanmark_id_param uuid DEFAULT NULL::uuid, emoji_combo_param text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, emoji_combination text, normalized_emoji text, short_id text, access_type text, status text, created_at timestamp with time zone, updated_at timestamp with time zone, fanmark_name text, target_url text, text_content text, is_password_protected boolean, access_password text, current_owner_id uuid, license_end timestamp with time zone, has_active_license boolean)
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
        
        -- Basic config
        bc.fanmark_name,
        
        -- Access configs based on type
        rc.target_url,
        mc.content as text_content,
        
        -- Password protection
        CASE WHEN pc.access_password IS NOT NULL THEN true ELSE false END as is_password_protected,
        pc.access_password,
        
        -- License info (for ownership checking)
        fl.user_id as current_owner_id,
        fl.license_end,
        CASE 
            WHEN fl.status = 'active' AND fl.license_end > now() THEN true 
            ELSE false 
        END as has_active_license
        
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
        AND fl.status = 'active' 
        AND fl.license_end > now()
    WHERE 
        (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
        OR 
        (emoji_combo_param IS NOT NULL AND f.emoji_combination = emoji_combo_param);
END;
$function$;

-- Update get_fanmark_by_emoji function
CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(emoji_combo text)
 RETURNS TABLE(emoji_combination text, fanmark_name text, access_type text, target_url text, text_content text, status text, is_password_protected boolean, access_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
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
$function$;