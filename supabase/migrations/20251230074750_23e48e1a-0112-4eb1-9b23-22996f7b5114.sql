-- Update favorite fanmark returned notification template for all languages with grace_expires_at

-- English
UPDATE notification_templates
SET 
  body = 'Your favorite fanmark "{{fanmark_name}}" is available. Join the lottery by {{grace_expires_at}}!',
  summary = 'Join the lottery to get your favorite fanmark',
  updated_at = now()
WHERE template_id = '4ba5ee3e-4222-4001-9a9f-8e968b36e920'
  AND language = 'en';

-- Korean
UPDATE notification_templates
SET 
  body = '즐겨찾기한 팬마크 "{{fanmark_name}}"가 반환 중입니다. {{grace_expires_at}}까지 추첨에 참여하세요!',
  summary = '추첨에 참여하여 재취득 기회를 잡으세요',
  updated_at = now()
WHERE template_id = '4ba5ee3e-4222-4001-9a9f-8e968b36e920'
  AND language = 'ko';

-- Indonesian
UPDATE notification_templates
SET 
  body = 'Fanmark favorit Anda "{{fanmark_name}}" sedang dikembalikan. Ikuti undian sebelum {{grace_expires_at}}!',
  summary = 'Ikuti undian untuk mendapatkan fanmark favorit Anda',
  updated_at = now()
WHERE template_id = '4ba5ee3e-4222-4001-9a9f-8e968b36e920'
  AND language = 'id';