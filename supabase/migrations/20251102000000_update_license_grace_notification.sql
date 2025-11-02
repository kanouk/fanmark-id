-- Update notification templates for license grace processing wording

-- Update Japanese template
UPDATE public.notification_templates
SET
  title = 'ライセンス失効処理中',
  body = 'ファンマーク「{{fanmark_name}}」のライセンスが失効処理中です。{{grace_expires_at}}までに更新してください。',
  summary = 'ライセンス更新が必要です（失効処理中）',
  updated_at = now()
WHERE template_id IN (
  SELECT template_id
  FROM public.notification_templates
  WHERE language = 'ja'
    AND channel = 'in_app'
    AND title = 'ライセンス猶予期間開始'
);

-- Update English template that shares the same template_id
UPDATE public.notification_templates
SET
  title = 'License Processing',
  body = 'Your fanmark "{{fanmark_name}}" license is now processing for expiration. Renew by {{grace_expires_at}}.',
  summary = 'License renewal required',
  updated_at = now()
WHERE template_id IN (
  SELECT template_id
  FROM public.notification_templates
  WHERE language = 'en'
    AND channel = 'in_app'
    AND title = 'License Grace Period Started'
);

