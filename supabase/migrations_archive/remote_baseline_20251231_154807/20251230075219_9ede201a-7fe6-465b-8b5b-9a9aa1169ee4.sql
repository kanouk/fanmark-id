-- Update fanmark_returned_owner notification template for all languages

-- Japanese
UPDATE notification_templates
SET 
  body = 'ファンマーク「{{fanmark_name}}」を返却しました。{{grace_expires_at}}に失効します。失効するとファンマアクセスの設定は削除されます。',
  updated_at = now()
WHERE template_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
  AND language = 'ja';

-- English
UPDATE notification_templates
SET 
  body = 'You have returned fanmark "{{fanmark_name}}". It will expire on {{grace_expires_at}}. Your access settings will be deleted upon expiration.',
  updated_at = now()
WHERE template_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
  AND language = 'en';

-- Korean
UPDATE notification_templates
SET 
  body = '팬마크 "{{fanmark_name}}"를 반환했습니다. {{grace_expires_at}}에 만료됩니다. 만료되면 액세스 설정이 삭제됩니다.',
  updated_at = now()
WHERE template_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
  AND language = 'ko';

-- Indonesian
UPDATE notification_templates
SET 
  body = 'Anda telah mengembalikan fanmark "{{fanmark_name}}". Akan kedaluwarsa pada {{grace_expires_at}}. Pengaturan akses Anda akan dihapus saat kedaluwarsa.',
  updated_at = now()
WHERE template_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
  AND language = 'id';