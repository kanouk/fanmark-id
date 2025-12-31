-- Fix security definer view by removing it and creating a function instead
DROP VIEW IF EXISTS fanmark_complete_view;

-- Create a secure function to get complete fanmark data
CREATE OR REPLACE FUNCTION get_fanmark_complete_data(fanmark_id_param UUID DEFAULT NULL, emoji_combo_param TEXT DEFAULT NULL)
RETURNS TABLE (
    id UUID,
    emoji_combination TEXT,
    normalized_emoji TEXT,
    short_id TEXT,
    access_type TEXT,
    status TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    fanmark_name TEXT,
    target_url TEXT,
    text_content TEXT,
    is_password_protected BOOLEAN,
    access_password TEXT,
    current_owner_id UUID,
    license_end TIMESTAMP WITH TIME ZONE,
    has_active_license BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        f.id,
        f.emoji_combination,
        f.normalized_emoji,
        f.short_id,
        f.access_type,
        f.status,
        f.created_at,
        f.updated_at,
        
        -- Basic config
        bc.display_name as fanmark_name,
        
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;