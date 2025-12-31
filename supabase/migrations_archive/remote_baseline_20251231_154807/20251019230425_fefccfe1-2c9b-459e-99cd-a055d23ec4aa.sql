-- Database functions for notification system (fixed)

-- Function to render notification template
CREATE OR REPLACE FUNCTION public.render_notification_template(
  template_id_param uuid,
  template_version_param integer,
  payload_param jsonb,
  language_param text DEFAULT 'ja'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  template_record RECORD;
  rendered_title text;
  rendered_body text;
  rendered_summary text;
  key_name text;
BEGIN
  -- Fetch template
  SELECT title, body, summary
  INTO template_record
  FROM public.notification_templates
  WHERE template_id = template_id_param
    AND version = template_version_param
    AND language = language_param
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found: % version % language %', 
      template_id_param, template_version_param, language_param;
  END IF;

  -- Simple template rendering (replace {{key}} with payload values)
  rendered_title := template_record.title;
  rendered_body := template_record.body;
  rendered_summary := template_record.summary;

  -- Replace placeholders with payload values
  FOR key_name IN SELECT jsonb_object_keys(payload_param)
  LOOP
    rendered_title := REPLACE(rendered_title, '{{' || key_name || '}}', payload_param->>key_name);
    rendered_body := REPLACE(rendered_body, '{{' || key_name || '}}', payload_param->>key_name);
    IF rendered_summary IS NOT NULL THEN
      rendered_summary := REPLACE(rendered_summary, '{{' || key_name || '}}', payload_param->>key_name);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'title', rendered_title,
    'body', rendered_body,
    'summary', rendered_summary
  );
END;
$$;

-- Function to create notification event
CREATE OR REPLACE FUNCTION public.create_notification_event(
  event_type_param text,
  payload_param jsonb,
  source_param text DEFAULT 'system',
  dedupe_key_param text DEFAULT NULL,
  trigger_at_param timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_id uuid;
BEGIN
  -- Check for duplicate if dedupe_key is provided
  IF dedupe_key_param IS NOT NULL THEN
    SELECT id INTO event_id
    FROM public.notification_events
    WHERE dedupe_key = dedupe_key_param
      AND status IN ('pending', 'processing')
    LIMIT 1;

    IF FOUND THEN
      RAISE NOTICE 'Duplicate event found with dedupe_key: %', dedupe_key_param;
      RETURN event_id;
    END IF;
  END IF;

  -- Insert new event
  INSERT INTO public.notification_events (
    event_type,
    payload,
    source,
    dedupe_key,
    trigger_at,
    status
  )
  VALUES (
    event_type_param,
    payload_param,
    source_param,
    dedupe_key_param,
    trigger_at_param,
    'pending'
  )
  RETURNING id INTO event_id;

  RETURN event_id;
END;
$$;

-- Function to mark notification as read
CREATE OR REPLACE FUNCTION public.mark_notification_read(
  notification_id_param uuid,
  read_via_param text DEFAULT 'app'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.notifications
  SET read_at = now(),
      read_via = read_via_param,
      updated_at = now()
  WHERE id = notification_id_param
    AND user_id = current_user_id
    AND read_at IS NULL;

  RETURN FOUND;
END;
$$;

-- Function to get unread notification count
CREATE OR REPLACE FUNCTION public.get_unread_notification_count(
  user_id_param uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
  unread_count integer;
BEGIN
  current_user_id := COALESCE(user_id_param, auth.uid());

  IF current_user_id IS NULL THEN
    RETURN 0;
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

-- Function to archive old notifications
CREATE OR REPLACE FUNCTION public.archive_old_notifications(
  days_old integer DEFAULT 90
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  archived_count integer;
  cutoff_date timestamptz;
BEGIN
  cutoff_date := now() - (days_old || ' days')::interval;

  -- Move to history table
  WITH archived AS (
    DELETE FROM public.notifications
    WHERE created_at < cutoff_date
      AND status IN ('delivered', 'failed')
    RETURNING id, jsonb_build_object(
      'id', id,
      'user_id', user_id,
      'event_id', event_id,
      'rule_id', rule_id,
      'template_id', template_id,
      'template_version', template_version,
      'channel', channel,
      'status', status,
      'payload', payload,
      'priority', priority,
      'triggered_at', triggered_at,
      'delivered_at', delivered_at,
      'read_at', read_at,
      'read_via', read_via,
      'expires_at', expires_at,
      'retry_count', retry_count,
      'error_reason', error_reason,
      'created_at', created_at,
      'updated_at', updated_at
    ) as original_data
  )
  INSERT INTO public.notifications_history (id, original_data)
  SELECT id, original_data FROM archived;

  GET DIAGNOSTICS archived_count = ROW_COUNT;

  RETURN archived_count;
END;
$$;