-- Update license_expired template to remove misleading "can reacquire" phrase
-- Template ID: 47406236-126d-40ef-bc0c-da2d14cc1df9

UPDATE public.notification_templates
SET body = 'ファンマーク「{{fanmark_name}}」のライセンスが失効しました。',
    updated_at = now()
WHERE template_id = '47406236-126d-40ef-bc0c-da2d14cc1df9' AND language = 'ja';

UPDATE public.notification_templates
SET body = 'Your fanmark "{{fanmark_name}}" license has expired.',
    updated_at = now()
WHERE template_id = '47406236-126d-40ef-bc0c-da2d14cc1df9' AND language = 'en';

UPDATE public.notification_templates
SET body = '팬마크 "{{fanmark_name}}"의 라이선스가 만료되었습니다.',
    updated_at = now()
WHERE template_id = '47406236-126d-40ef-bc0c-da2d14cc1df9' AND language = 'ko';

UPDATE public.notification_templates
SET body = 'Lisensi fanmark "{{fanmark_name}}" Anda telah kedaluwarsa.',
    updated_at = now()
WHERE template_id = '47406236-126d-40ef-bc0c-da2d14cc1df9' AND language = 'id';