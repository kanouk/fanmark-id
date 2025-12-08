-- Update lottery_won notification templates to use formatted date
UPDATE public.notification_templates
SET body = REPLACE(body, '{{license_end}}', '{{license_end_formatted}}'),
    updated_at = now()
WHERE template_id IN (
  SELECT DISTINCT template_id 
  FROM public.notification_templates 
  WHERE template_id::text LIKE '%lottery_won%'
    OR template_id IN (
      SELECT id FROM public.notification_rules WHERE event_type = 'lottery_won'
    )
)
AND body LIKE '%{{license_end}}%';