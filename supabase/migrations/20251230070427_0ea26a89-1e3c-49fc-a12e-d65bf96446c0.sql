-- Update license_grace_started template (efa32487-428f-4bb8-b4b3-90b5544e001a)
-- Add explicit "will be deleted" message

UPDATE public.notification_templates
SET body = 'ファンマーク「{{fanmark_name}}」のライセンスが失効処理中です。{{grace_expires_at}}までに更新してください。期限を過ぎるとファンマアクセスの設定データは削除され、復元できません。',
    updated_at = now()
WHERE template_id = 'efa32487-428f-4bb8-b4b3-90b5544e001a' AND language = 'ja';

UPDATE public.notification_templates
SET body = 'Your fanmark "{{fanmark_name}}" license has entered the grace period. Please renew by {{grace_expires_at}}. After the deadline, your access settings will be deleted and cannot be restored.',
    updated_at = now()
WHERE template_id = 'efa32487-428f-4bb8-b4b3-90b5544e001a' AND language = 'en';

UPDATE public.notification_templates
SET body = '팬마크 "{{fanmark_name}}" 라이선스가 유예 기간에 들어갔습니다. {{grace_expires_at}}까지 갱신하세요. 기한이 지나면 액세스 설정 데이터가 삭제되며 복원할 수 없습니다.',
    updated_at = now()
WHERE template_id = 'efa32487-428f-4bb8-b4b3-90b5544e001a' AND language = 'ko';

UPDATE public.notification_templates
SET body = 'Lisensi fanmark "{{fanmark_name}}" sedang dalam masa tenggang. Perbarui sebelum {{grace_expires_at}}. Setelah batas waktu, pengaturan akses Anda akan dihapus dan tidak dapat dipulihkan.',
    updated_at = now()
WHERE template_id = 'efa32487-428f-4bb8-b4b3-90b5544e001a' AND language = 'id';

-- Update license_expired template (47406236-126d-40ef-bc0c-da2d14cc1df9)
-- Change from "deleted" to "participate in lottery"

UPDATE public.notification_templates
SET body = 'ファンマーク「{{fanmark_name}}」のライセンスが失効しました。再取得するには抽選に参加してください。',
    updated_at = now()
WHERE template_id = '47406236-126d-40ef-bc0c-da2d14cc1df9' AND language = 'ja';

UPDATE public.notification_templates
SET body = 'Your fanmark "{{fanmark_name}}" license has expired. To reacquire it, please participate in the lottery.',
    updated_at = now()
WHERE template_id = '47406236-126d-40ef-bc0c-da2d14cc1df9' AND language = 'en';

UPDATE public.notification_templates
SET body = '팬마크 "{{fanmark_name}}"의 라이선스가 만료되었습니다. 재취득하려면 추첨에 참여하세요.',
    updated_at = now()
WHERE template_id = '47406236-126d-40ef-bc0c-da2d14cc1df9' AND language = 'ko';

UPDATE public.notification_templates
SET body = 'Lisensi fanmark "{{fanmark_name}}" Anda telah kedaluwarsa. Untuk mendapatkannya kembali, silakan ikuti lotre.',
    updated_at = now()
WHERE template_id = '47406236-126d-40ef-bc0c-da2d14cc1df9' AND language = 'id';