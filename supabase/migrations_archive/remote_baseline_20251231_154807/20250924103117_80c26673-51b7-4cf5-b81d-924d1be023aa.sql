-- Create compatibility function for existing frontend
CREATE OR REPLACE FUNCTION get_public_emoji_profile(profile_fanmark_id UUID)
RETURNS TABLE (
    id UUID,
    fanmark_id UUID,
    user_id UUID,
    display_name TEXT,
    bio TEXT,
    social_links JSONB,
    theme_settings JSONB,
    is_public BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        fp.id,
        fp.fanmark_id,
        fp.user_id,
        fp.display_name,
        fp.bio,
        fp.social_links,
        fp.theme_settings,
        fp.is_public,
        fp.created_at,
        fp.updated_at
    FROM fanmark_profiles fp
    WHERE fp.fanmark_id = profile_fanmark_id
    AND fp.is_public = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;