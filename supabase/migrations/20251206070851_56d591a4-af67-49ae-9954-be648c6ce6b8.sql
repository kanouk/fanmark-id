-- 1. Update license_grace_started templates to mention settings won't be carried over
UPDATE notification_templates
SET body = 'Your fanmark "{{fanmark_name}}" license has entered the grace period. Please renew by {{grace_expires_at}} to keep your fanmark. After the deadline, even if you win it back through lottery, your access settings will not be carried over.',
    updated_at = now()
WHERE template_id = 'efa32487-428f-4bb8-b4b3-90b5544e001a' AND language = 'en';

UPDATE notification_templates
SET body = 'ファンマーク「{{fanmark_name}}」のライセンスが失効処理中です。{{grace_expires_at}}までに更新してください。期限を過ぎると、抽選で再当選してもファンマアクセスの設定は引き継がれません。',
    updated_at = now()
WHERE template_id = 'efa32487-428f-4bb8-b4b3-90b5544e001a' AND language = 'ja';

UPDATE notification_templates
SET body = '팬마크 "{{fanmark_name}}" 라이선스가 유예 기간에 들어갔습니다. {{grace_expires_at}}까지 갱신하세요. 기한이 지나면 추첨에서 다시 당첨되더라도 액세스 설정이 이전되지 않습니다.',
    updated_at = now()
WHERE template_id = 'efa32487-428f-4bb8-b4b3-90b5544e001a' AND language = 'ko';

UPDATE notification_templates
SET body = 'Lisensi fanmark "{{fanmark_name}}" sedang dalam masa tenggang. Perbarui sebelum {{grace_expires_at}}. Setelah batas waktu, meskipun Anda memenangkannya kembali melalui lotre, pengaturan akses tidak akan dipertahankan.',
    updated_at = now()
WHERE template_id = 'efa32487-428f-4bb8-b4b3-90b5544e001a' AND language = 'id';

-- 2. Update license_expired templates to mention settings have been deleted
UPDATE notification_templates
SET body = 'Your fanmark "{{fanmark_name}}" license has expired. Your access settings have been deleted.',
    updated_at = now()
WHERE template_id = '47406236-126d-40ef-bc0c-da2d14cc1df9' AND language = 'en';

UPDATE notification_templates
SET body = 'ファンマーク「{{fanmark_name}}」のライセンスが失効しました。ファンマアクセスの設定データは削除されました。',
    updated_at = now()
WHERE template_id = '47406236-126d-40ef-bc0c-da2d14cc1df9' AND language = 'ja';

UPDATE notification_templates
SET body = '팬마크 "{{fanmark_name}}"의 라이선스가 만료되었습니다. 액세스 설정 데이터가 삭제되었습니다.',
    updated_at = now()
WHERE template_id = '47406236-126d-40ef-bc0c-da2d14cc1df9' AND language = 'ko';

UPDATE notification_templates
SET body = 'Lisensi fanmark "{{fanmark_name}}" Anda telah kedaluwarsa. Data pengaturan akses telah dihapus.',
    updated_at = now()
WHERE template_id = '47406236-126d-40ef-bc0c-da2d14cc1df9' AND language = 'id';

-- 3. Create notification templates for fanmark_returned_owner (4 languages)
INSERT INTO notification_templates (template_id, version, language, channel, title, body, summary, is_active)
VALUES 
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 1, 'en', 'in_app', 'Fanmark Returned', 'You have returned fanmark "{{fanmark_name}}". It will be available for lottery until {{grace_expires_at}}. Please note that even if you win it back through lottery, your access settings will not be carried over.', 'Fanmark has been returned', true),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 1, 'ja', 'in_app', 'ファンマーク返却完了', 'ファンマーク「{{fanmark_name}}」を返却しました。{{grace_expires_at}}まで抽選の対象となります。抽選で再当選した場合でも、ファンマアクセスの設定は引き継がれませんのでご注意ください。', 'ファンマークを返却しました', true),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 1, 'ko', 'in_app', '팬마크 반환 완료', '팬마크 "{{fanmark_name}}"를 반환했습니다. {{grace_expires_at}}까지 추첨 대상이 됩니다. 추첨에서 다시 당첨되더라도 액세스 설정이 이전되지 않으니 주의해 주세요.', '팬마크가 반환되었습니다', true),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 1, 'id', 'in_app', 'Fanmark Dikembalikan', 'Anda telah mengembalikan fanmark "{{fanmark_name}}". Fanmark akan tersedia untuk lotre hingga {{grace_expires_at}}. Perhatikan bahwa meskipun Anda memenangkannya kembali melalui lotre, pengaturan akses tidak akan dipertahankan.', 'Fanmark telah dikembalikan', true);

-- 4. Create new notification rule for fanmark_returned_owner (priority 1-10)
INSERT INTO notification_rules (
  event_type, channel, template_id, template_version, delay_seconds, priority, enabled
) VALUES (
  'fanmark_returned_owner', 'in_app', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 1, 0, 5, true
);