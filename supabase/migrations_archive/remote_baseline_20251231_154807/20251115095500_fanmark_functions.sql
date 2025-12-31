DROP FUNCTION IF EXISTS public.get_favorite_fanmarks();

CREATE OR REPLACE FUNCTION public.upsert_fanmark_discovery(input_emoji_ids uuid[], increment_search boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  normalized_ids uuid[];
  discovery_id uuid;
  search_increment int := CASE WHEN increment_search THEN 1 ELSE 0 END;
BEGIN
  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);

  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Invalid emoji ids';
  END IF;

  INSERT INTO public.fanmark_discoveries (
    emoji_ids,
    normalized_emoji_ids,
    last_seen_at,
    search_count
  )
  VALUES (
    input_emoji_ids,
    normalized_ids,
    now(),
    search_increment
  )
  ON CONFLICT (seq_key(normalized_emoji_ids))
  DO UPDATE SET
    emoji_ids = EXCLUDED.emoji_ids,
    last_seen_at = now(),
    search_count = public.fanmark_discoveries.search_count + search_increment
  RETURNING id INTO discovery_id;

  IF discovery_id IS NULL THEN
    SELECT id INTO discovery_id
    FROM public.fanmark_discoveries
    WHERE seq_key(normalized_emoji_ids) = seq_key(normalized_ids)
    LIMIT 1;
  END IF;

  RETURN discovery_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_fanmark_search(input_emoji_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  discovery_id uuid;
  auth_user_id uuid;
BEGIN
  discovery_id := public.upsert_fanmark_discovery(input_emoji_ids, true);
  SELECT auth.uid() INTO auth_user_id;
  INSERT INTO public.fanmark_events (event_type, user_id, discovery_id, normalized_emoji_ids)
  VALUES ('search', auth_user_id, discovery_id, public.normalize_emoji_ids(input_emoji_ids));
  RETURN discovery_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_fanmark_favorite(input_emoji_ids uuid[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  auth_user_id uuid;
  normalized_ids uuid[];
  discovery_id uuid;
  linked_fanmark_id uuid;
BEGIN
  SELECT auth.uid() INTO auth_user_id;
  IF auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);
  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Invalid emoji ids';
  END IF;

  discovery_id := public.upsert_fanmark_discovery(input_emoji_ids, false);

  SELECT fanmark_id INTO linked_fanmark_id
  FROM public.fanmark_discoveries
  WHERE id = discovery_id;

  INSERT INTO public.fanmark_favorites (
    user_id,
    discovery_id,
    fanmark_id,
    normalized_emoji_ids
  )
  VALUES (
    auth_user_id,
    discovery_id,
    linked_fanmark_id,
    normalized_ids
  )
  ON CONFLICT (user_id, seq_key(normalized_emoji_ids))
  DO NOTHING;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.fanmark_discoveries
  SET favorite_count = favorite_count + 1
  WHERE id = discovery_id;

  INSERT INTO public.fanmark_events (event_type, user_id, discovery_id, normalized_emoji_ids)
  VALUES ('favorite_add', auth_user_id, discovery_id, normalized_ids);

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.remove_fanmark_favorite(input_emoji_ids uuid[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  auth_user_id uuid;
  normalized_ids uuid[];
  deleted_record RECORD;
BEGIN
  SELECT auth.uid() INTO auth_user_id;
  IF auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);
  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Invalid emoji ids';
  END IF;

  DELETE FROM public.fanmark_favorites
  WHERE user_id = auth_user_id
    AND normalized_emoji_ids = normalized_ids
  RETURNING discovery_id INTO deleted_record;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.fanmark_discoveries
  SET favorite_count = GREATEST(favorite_count - 1, 0)
  WHERE id = deleted_record.discovery_id;

  INSERT INTO public.fanmark_events (event_type, user_id, discovery_id, normalized_emoji_ids)
  VALUES ('favorite_remove', auth_user_id, deleted_record.discovery_id, normalized_ids);

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_favorite_fanmarks()
RETURNS TABLE(
  favorite_id uuid,
  discovery_id uuid,
  favorited_at timestamptz,
  fanmark_id uuid,
  normalized_emoji_ids uuid[],
  emoji_ids uuid[],
  sequence_key uuid,
  availability_status text,
  search_count bigint,
  favorite_count bigint,
  short_id text,
  fanmark_name text,
  access_type text,
  target_url text,
  text_content text,
  current_owner_username text,
  current_owner_display_name text,
  current_license_start timestamptz,
  current_license_end timestamptz,
  current_license_status text,
  is_password_protected boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  auth_user_id uuid;
BEGIN
  SELECT auth.uid() INTO auth_user_id;
  IF auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT
    ff.id AS favorite_id,
    ff.discovery_id,
    ff.created_at AS favorited_at,
    d.fanmark_id,
    ff.normalized_emoji_ids,
    d.emoji_ids,
    seq_key(d.normalized_emoji_ids) AS sequence_key,
    d.availability_status,
    d.search_count,
    d.favorite_count,
    f.short_id,
    bc.fanmark_name,
    bc.access_type,
    rc.target_url,
    mc.content AS text_content,
    us.username AS current_owner_username,
    us.display_name AS current_owner_display_name,
    fl.license_start AS current_license_start,
    fl.license_end AS current_license_end,
    fl.status AS current_license_status,
    COALESCE(pc.is_enabled, false) AS is_password_protected
  FROM public.fanmark_favorites ff
  JOIN public.fanmark_discoveries d ON d.id = ff.discovery_id
  LEFT JOIN public.fanmarks f ON f.id = d.fanmark_id
  LEFT JOIN LATERAL (
    SELECT fl_inner.*
    FROM public.fanmark_licenses fl_inner
    WHERE fl_inner.fanmark_id = f.id
    ORDER BY fl_inner.license_end DESC NULLS LAST
    LIMIT 1
  ) fl ON true
  LEFT JOIN public.user_settings us ON us.user_id = fl.user_id
  LEFT JOIN public.fanmark_basic_configs bc ON bc.license_id = fl.id
  LEFT JOIN public.fanmark_redirect_configs rc ON rc.license_id = fl.id
  LEFT JOIN public.fanmark_messageboard_configs mc ON mc.license_id = fl.id
  LEFT JOIN public.fanmark_password_configs pc ON pc.license_id = fl.id
  WHERE ff.user_id = auth_user_id
  ORDER BY ff.created_at DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.record_fanmark_search(uuid[]) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.add_fanmark_favorite(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_fanmark_favorite(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_favorite_fanmarks() TO authenticated;
