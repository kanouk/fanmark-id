-- Add lottery win/lose notification templates and rules

-- Template: lottery_won (Japanese)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  gen_random_uuid(),
  1,
  'ja',
  'in_app',
  '抽選結果: 当選しました',
  'ファンマーク「{{fanmark_name}}」の抽選に当選しました。ライセンスは{{license_end}}まで有効です。',
  '抽選に当選しました',
  '{"required": ["user_id", "fanmark_id", "fanmark_name", "license_end"]}'::jsonb,
  true
);

-- Template: lottery_won (English)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  (SELECT template_id FROM public.notification_templates WHERE language = 'ja' AND title = '抽選結果: 当選しました' LIMIT 1),
  1,
  'en',
  'in_app',
  'Lottery Result: You Won',
  'You won the lottery for fanmark "{{fanmark_name}}". The license is valid until {{license_end}}.',
  'Lottery won',
  '{"required": ["user_id", "fanmark_id", "fanmark_name", "license_end"]}'::jsonb,
  true
);

-- Template: lottery_won (Korean)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  (SELECT template_id FROM public.notification_templates WHERE language = 'ja' AND title = '抽選結果: 当選しました' LIMIT 1),
  1,
  'ko',
  'in_app',
  '추첨 결과: 당첨되었습니다',
  '팬마크 "{{fanmark_name}}" 추첨에 당첨되었습니다. 라이선스는 {{license_end}}까지 유효합니다.',
  '추첨에 당첨되었습니다',
  '{"required": ["user_id", "fanmark_id", "fanmark_name", "license_end"]}'::jsonb,
  true
);

-- Template: lottery_won (Indonesian)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  (SELECT template_id FROM public.notification_templates WHERE language = 'ja' AND title = '抽選結果: 当選しました' LIMIT 1),
  1,
  'id',
  'in_app',
  'Hasil Undian: Anda Menang',
  'Anda memenangkan undian untuk fanmark "{{fanmark_name}}". Lisensi berlaku hingga {{license_end}}.',
  'Anda memenangkan undian',
  '{"required": ["user_id", "fanmark_id", "fanmark_name", "license_end"]}'::jsonb,
  true
);

-- Template: lottery_lost (Japanese)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  gen_random_uuid(),
  1,
  'ja',
  'in_app',
  '抽選結果: 落選しました',
  'ファンマーク「{{fanmark_name}}」の抽選に落選しました（応募総数: {{total_applicants}}）。次のチャンスをお待ちください。',
  '抽選に落選しました',
  '{"required": ["user_id", "fanmark_id", "fanmark_name", "total_applicants"]}'::jsonb,
  true
);

-- Template: lottery_lost (English)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  (SELECT template_id FROM public.notification_templates WHERE language = 'ja' AND title = '抽選結果: 落選しました' LIMIT 1),
  1,
  'en',
  'in_app',
  'Lottery Result: Not Selected',
  'You were not selected in the lottery for "{{fanmark_name}}" (total applicants: {{total_applicants}}). Better luck next time.',
  'Lottery lost',
  '{"required": ["user_id", "fanmark_id", "fanmark_name", "total_applicants"]}'::jsonb,
  true
);

-- Template: lottery_lost (Korean)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  (SELECT template_id FROM public.notification_templates WHERE language = 'ja' AND title = '抽選結果: 落選しました' LIMIT 1),
  1,
  'ko',
  'in_app',
  '추첨 결과: 낙첨되었습니다',
  '팬마크 "{{fanmark_name}}" 추첨에 낙첨되었습니다(응모 총수: {{total_applicants}}). 다음 기회를 기다려 주세요.',
  '추첨에 낙첨되었습니다',
  '{"required": ["user_id", "fanmark_id", "fanmark_name", "total_applicants"]}'::jsonb,
  true
);

-- Template: lottery_lost (Indonesian)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  (SELECT template_id FROM public.notification_templates WHERE language = 'ja' AND title = '抽選結果: 落選しました' LIMIT 1),
  1,
  'id',
  'in_app',
  'Hasil Undian: Tidak Terpilih',
  'Anda tidak terpilih dalam undian "{{fanmark_name}}" (total peserta: {{total_applicants}}). Coba lagi di kesempatan berikutnya.',
  'Tidak terpilih dalam undian',
  '{"required": ["user_id", "fanmark_id", "fanmark_name", "total_applicants"]}'::jsonb,
  true
);

-- Rule: lottery_won -> in_app notification
INSERT INTO public.notification_rules (
  event_type,
  channel,
  template_id,
  template_version,
  priority,
  delay_seconds,
  enabled,
  max_per_user,
  cooldown_window_seconds
)
VALUES (
  'lottery_won',
  'in_app',
  (SELECT template_id FROM public.notification_templates WHERE language = 'ja' AND title = '抽選結果: 当選しました' LIMIT 1),
  1,
  10,
  0,
  true,
  NULL,
  NULL
);

-- Rule: lottery_lost -> in_app notification
INSERT INTO public.notification_rules (
  event_type,
  channel,
  template_id,
  template_version,
  priority,
  delay_seconds,
  enabled,
  max_per_user,
  cooldown_window_seconds
)
VALUES (
  'lottery_lost',
  'in_app',
  (SELECT template_id FROM public.notification_templates WHERE language = 'ja' AND title = '抽選結果: 落選しました' LIMIT 1),
  1,
  5,
  0,
  true,
  NULL,
  NULL
);
