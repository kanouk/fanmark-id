BEGIN READ ONLY;

SELECT COALESCE(
  jsonb_agg(
    jsonb_build_object(
      'id', id::text,
      'email_type', email_type,
      'language', language,
      'subject', subject,
      'body_text', body_text,
      'button_text', button_text,
      'is_active', is_active,
      'created_at', created_at::text,
      'updated_at', updated_at::text
    ) ORDER BY email_type, language
  ),
  '[]'::jsonb
) AS templates
FROM public.email_templates
WHERE email_type IN (
  'broadcast_announcement',
  'broadcast_maintenance',
  'broadcast_security'
);

COMMIT;
