-- Update favorite fanmark returned notification template to include grace_expires_at
UPDATE notification_templates
SET 
  body = 'お気に入り登録していたファンマ「{{fanmark_name}}」が返却中です。{{grace_expires_at}}までに抽選に参加しましょう！',
  summary = '抽選に参加して再取得のチャンスをつかもう',
  updated_at = now()
WHERE template_id = '4ba5ee3e-4222-4001-9a9f-8e968b36e920'
  AND language = 'ja';