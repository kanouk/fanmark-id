-- Fix English version of license_grace_started (was incorrectly in Japanese)
UPDATE public.notification_templates
SET 
  title = 'License Grace Period Started',
  body = 'Your fanmark "{{fanmark_name}}" license has entered the grace period. Please renew by {{grace_expires_at}} to keep your fanmark.',
  summary = 'License renewal required',
  updated_at = now()
WHERE template_id = 'efa32487-428f-4bb8-b4b3-90b5544e001a' 
  AND language = 'en';

-- Add Korean (ko) translations
INSERT INTO public.notification_templates (template_id, channel, language, title, body, summary, version, is_active)
SELECT 
  '47406236-126d-40ef-bc0c-da2d14cc1df9'::uuid, 'in_app', 'ko', '라이선스 만료', 
  '팬마크 "{{fanmark_name}}"의 라이선스가 만료되었습니다. 다시 취득할 수 있습니다.', 
  '라이선스가 만료되었습니다', 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_templates 
  WHERE template_id = '47406236-126d-40ef-bc0c-da2d14cc1df9' AND language = 'ko'
);

INSERT INTO public.notification_templates (template_id, channel, language, title, body, summary, version, is_active)
SELECT 
  '4ba5ee3e-4222-4001-9a9f-8e968b36e920'::uuid, 'in_app', 'ko', '즐겨찾기 팬마크 이용 가능', 
  '즐겨찾기한 팬마크 "{{fanmark_name}}"가 반환되어 곧 재취득 기회가 옵니다!', 
  '즐겨찾기 팬마크를 취득할 수 있습니다', 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_templates 
  WHERE template_id = '4ba5ee3e-4222-4001-9a9f-8e968b36e920' AND language = 'ko'
);

INSERT INTO public.notification_templates (template_id, channel, language, title, body, summary, version, is_active)
SELECT 
  'efa32487-428f-4bb8-b4b3-90b5544e001a'::uuid, 'in_app', 'ko', '라이선스 유예 기간 시작', 
  '팬마크 "{{fanmark_name}}" 라이선스가 유예 기간에 들어갔습니다. {{grace_expires_at}}까지 갱신하세요.', 
  '라이선스 갱신이 필요합니다', 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_templates 
  WHERE template_id = 'efa32487-428f-4bb8-b4b3-90b5544e001a' AND language = 'ko'
);

-- Add Indonesian (id) translations
INSERT INTO public.notification_templates (template_id, channel, language, title, body, summary, version, is_active)
SELECT 
  '47406236-126d-40ef-bc0c-da2d14cc1df9'::uuid, 'in_app', 'id', 'Lisensi Kedaluwarsa', 
  'Lisensi fanmark "{{fanmark_name}}" Anda telah kedaluwarsa. Anda dapat memperolehnya kembali.', 
  'Lisensi telah kedaluwarsa', 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_templates 
  WHERE template_id = '47406236-126d-40ef-bc0c-da2d14cc1df9' AND language = 'id'
);

INSERT INTO public.notification_templates (template_id, channel, language, title, body, summary, version, is_active)
SELECT 
  '4ba5ee3e-4222-4001-9a9f-8e968b36e920'::uuid, 'in_app', 'id', 'Fanmark Favorit Tersedia', 
  'Fanmark favorit Anda "{{fanmark_name}}" telah dikembalikan. Kesempatan untuk mendapatkannya kembali akan segera tiba!', 
  'Fanmark favorit dapat diperoleh', 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_templates 
  WHERE template_id = '4ba5ee3e-4222-4001-9a9f-8e968b36e920' AND language = 'id'
);

INSERT INTO public.notification_templates (template_id, channel, language, title, body, summary, version, is_active)
SELECT 
  'efa32487-428f-4bb8-b4b3-90b5544e001a'::uuid, 'in_app', 'id', 'Masa Tenggang Lisensi Dimulai', 
  'Lisensi fanmark "{{fanmark_name}}" sedang dalam masa tenggang. Perbarui sebelum {{grace_expires_at}}.', 
  'Perpanjangan lisensi diperlukan', 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_templates 
  WHERE template_id = 'efa32487-428f-4bb8-b4b3-90b5544e001a' AND language = 'id'
);