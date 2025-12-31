-- Update get_fanmark_by_emoji function to work with new schema
CREATE OR REPLACE FUNCTION get_fanmark_by_emoji(emoji_combo text)
RETURNS TABLE (
    emoji_combination text,
    fanmark_name text,
    access_type text,
    target_url text,
    text_content text,
    status text,
    is_password_protected boolean,
    access_password text
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        f.emoji_combination,
        COALESCE(bc.display_name, f.emoji_combination) as fanmark_name,
        f.access_type,
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create view for complete fanmark data
CREATE OR REPLACE VIEW fanmark_complete_view AS
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
    AND fl.license_end > now();