-- Update public access to exclude grace licenses in short-id lookup.
CREATE OR REPLACE FUNCTION public.get_fanmark_by_short_id(shortid_param text)
RETURNS TABLE(
  id uuid,
  short_id text,
  user_input_fanmark text,
  display_fanmark text,
  emoji_ids uuid[],
  fanmark_name text,
  access_type text,
  target_url text,
  text_content text,
  status text,
  is_password_protected boolean,
  license_id uuid,
  license_status text,
  license_end timestamp with time zone,
  grace_expires_at timestamp with time zone,
  is_returned boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.id,
    f.short_id,
    f.user_input_fanmark,
    fl.display_fanmark,
    f.emoji_ids,
    COALESCE(bc.fanmark_name, f.user_input_fanmark) AS fanmark_name,
    COALESCE(bc.access_type, 'inactive') AS access_type,
    rc.target_url,
    mc.content AS text_content,
    f.status,
    COALESCE(pc.is_enabled, false) AS is_password_protected,
    fl.id AS license_id,
    fl.status AS license_status,
    fl.license_end,
    fl.grace_expires_at,
    fl.is_returned
  FROM fanmarks f
  LEFT JOIN LATERAL (
    SELECT fl_inner.*
    FROM fanmark_licenses fl_inner
    WHERE fl_inner.fanmark_id = f.id
      AND fl_inner.status = 'active'
    ORDER BY fl_inner.license_end DESC NULLS LAST
    LIMIT 1
  ) fl ON TRUE
  LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
  LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
  LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
  LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
  WHERE f.short_id = shortid_param
    AND f.status = 'active';
END;
$$;
