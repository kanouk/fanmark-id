-- Function to mark all notifications as read for a user

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(
  user_id_param uuid,
  read_via_param text DEFAULT 'app'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
  updated_count integer;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Only allow users to mark their own notifications as read
  IF current_user_id != user_id_param THEN
    RAISE EXCEPTION 'Unauthorized: can only mark own notifications as read';
  END IF;

  UPDATE public.notifications
  SET read_at = now(),
      read_via = read_via_param,
      updated_at = now()
  WHERE user_id = user_id_param
    AND read_at IS NULL
    AND status = 'delivered'
    AND (expires_at IS NULL OR expires_at > now());

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  RETURN updated_count;
END;
$$;
