-- Update render_notification_template to skip datetime placeholders
-- These will be formatted by the frontend using useNotificationFormatter

CREATE OR REPLACE FUNCTION public.render_notification_template(
  template_id_param uuid,
  template_version_param integer,
  payload_param jsonb,
  language_param text DEFAULT 'ja'::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  template_record RECORD;
  rendered_title text;
  rendered_body text;
  rendered_summary text;
  key_name text;
  -- Datetime placeholders should NOT be replaced here (frontend will format them)
  datetime_keys text[] := ARRAY['grace_expires_at', 'license_end', 'expires_at', 'created_at', 'updated_at'];
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

  rendered_title := template_record.title;
  rendered_body := template_record.body;
  rendered_summary := template_record.summary;

  -- Replace placeholders with payload values (except datetime keys)
  FOR key_name IN SELECT jsonb_object_keys(payload_param)
  LOOP
    IF NOT (key_name = ANY(datetime_keys)) THEN
      rendered_title := REPLACE(rendered_title, '{{' || key_name || '}}', payload_param->>key_name);
      rendered_body := REPLACE(rendered_body, '{{' || key_name || '}}', payload_param->>key_name);
      IF rendered_summary IS NOT NULL THEN
        rendered_summary := REPLACE(rendered_summary, '{{' || key_name || '}}', payload_param->>key_name);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'title', rendered_title,
    'body', rendered_body,
    'summary', rendered_summary,
    'metadata', payload_param
  );
END;
$function$;