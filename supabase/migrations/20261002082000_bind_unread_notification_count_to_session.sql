CREATE OR REPLACE FUNCTION public.get_unread_notification_count(user_id_param uuid DEFAULT NULL::uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_user_id uuid;
  unread_count integer;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RETURN 0;
  END IF;

  IF user_id_param IS NOT NULL AND user_id_param <> current_user_id THEN
    RAISE EXCEPTION 'Unauthorized: can only read own notification count';
  END IF;

  SELECT COUNT(*)::integer INTO unread_count
  FROM public.notifications
  WHERE user_id = current_user_id
    AND read_at IS NULL
    AND status = 'delivered'
    AND (expires_at IS NULL OR expires_at > now());

  RETURN unread_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_unread_notification_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_count(uuid) TO authenticated, service_role;
