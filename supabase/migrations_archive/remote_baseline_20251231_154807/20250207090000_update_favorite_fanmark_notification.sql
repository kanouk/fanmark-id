-- Update favorite_fanmark_available notification copy to reflect return-in-progress messaging

-- Update Japanese template text
UPDATE public.notification_templates
SET
  title = 'お気に入りファンマが返却されました',
  body = 'お気に入り登録していたファンマ「{{fanmark_name}}」が返却中です。まもなく再取得のチャンスが巡ってきます。',
  summary = '取得チャンスをお見逃しなく'
WHERE template_id IN (
  SELECT template_id
  FROM public.notification_templates
  WHERE language = 'ja'
    AND title = 'お気に入りファンマークが利用可能'
  LIMIT 1
)
AND language = 'ja';

-- Update English template text (shares template_id with Japanese entry)
UPDATE public.notification_templates
SET
  title = 'Favorite fanmark is being returned',
  body = 'Your favorited fanmark "{{fanmark_name}}" is currently being returned. Get ready to claim it again as soon as it reopens.',
  summary = 'Return in progress—be ready'
WHERE template_id IN (
  SELECT template_id
  FROM public.notification_templates
  WHERE language = 'ja'
    AND title = 'お気に入りファンマークが利用可能'
  LIMIT 1
)
AND language = 'en';
